// Shared shape every CLI-backed Shay adapter is built from (see
// shay-adapters/claude.js, codex.js, gemini.js, kimi.js -- each is a small
// config object handed to createCliAdapter()). This is the one place that
// spawns a CLI, classifies what came back, and turns raw model JSON into
// validated cards. No API keys anywhere in this file: every adapter spawns
// the operator's own installed CLI on their existing subscription auth.
import { runCli, commandExists, extractJson } from './cli-runner.js';
import { buildPrompt } from './prompt.js';
import { buildCard } from '../cards.js';

const PROBE_PROMPT =
  'Reply with strict JSON only, no markdown fences, exactly: {"ok":true,"cards":[{"type":"plan","title":"probe"}]}';

// Known, named failure signatures worth reporting honestly by cause rather
// than lumping every failure into one generic bucket. This machine's actual
// observed states: gemini's individual Code Assist tier was retired
// (IneligibleTierError), and CLIs occasionally fail on billing/403. Neither
// is guessed at -- both are pattern-matched off real CLI output, so a
// classification always traces back to something the CLI actually printed.
const KNOWN_FAILURE_PATTERNS = Object.freeze([
  {
    test: /IneligibleTierError|no longer supported for Gemini Code Assist/i,
    classification: 'ineligible_tier',
    summary: 'This account tier is no longer eligible for this CLI (for example, individual Gemini Code Assist was retired).',
  },
  {
    test: /\b403\b|billing/i,
    classification: 'billing_blocked',
    summary: 'The provider rejected the request for a billing reason (403 or billing-cycle error).',
  },
  {
    test: /not logged in|please (run|use)[^\n]*login|authentication required|no credentials|not authenticated/i,
    classification: 'not_authenticated',
    summary: 'The CLI reports it is not logged in.',
  },
]);

function classifyFailure({ exitCode, timedOut, stdout, stderr, spawnError }) {
  if (spawnError) return { classification: 'spawn_failed', summary: spawnError.message };
  if (timedOut) return { classification: 'timed_out', summary: 'The CLI did not respond before the timeout and was killed.' };
  const haystack = `${stdout || ''}\n${stderr || ''}`;
  for (const pattern of KNOWN_FAILURE_PATTERNS) {
    if (pattern.test.test(haystack)) return { classification: pattern.classification, summary: pattern.summary };
  }
  if (exitCode !== 0) {
    return { classification: 'nonzero_exit', summary: `exited with code ${exitCode}${stderr ? `: ${stderr.trim().slice(0, 300)}` : ''}` };
  }
  return { classification: 'unparseable_output', summary: 'exited 0 but produced no parseable JSON' };
}

// candidate -> validated Card, via cards.js's own buildCard (never
// reimplemented here). A candidate that fails validation is dropped with its
// reason recorded, never silently passed through and never allowed to throw
// out of ask() -- one bad card in a batch must not take the honest ones with it.
function toCardsAndDrops({ rawCards, site_id, conversation_id }) {
  const cards = [];
  const dropped = [];
  for (const candidate of rawCards) {
    try {
      const card = buildCard({
        type: candidate?.type,
        site_id,
        conversation_id,
        title: candidate?.title,
        body: typeof candidate?.body === 'string' ? candidate.body : '',
        evidence: Array.isArray(candidate?.evidence) ? candidate.evidence : [],
        actions: Array.isArray(candidate?.actions) ? candidate.actions : [],
        state: typeof candidate?.state === 'string' ? candidate.state : 'pending',
      });
      cards.push(card);
    } catch (error) {
      dropped.push({ reason: error.message, candidate });
    }
  }
  return { cards, dropped };
}

/**
 * Builds one adapter implementing the shared interface:
 *   { id, displayName, command, isInstalled(), isAuthenticated(), probe(), ask({ envelope, timeoutMs }) }
 *
 * @param {string} id - stable adapter id, e.g. 'claude'
 * @param {string} displayName - human label
 * @param {string} command - the executable name looked up on PATH
 * @param {(promptText: string) => string[]} buildArgs - CLI argv for a given prompt
 * @param {Function} [spawnImpl] - injected in place of node:child_process's spawn (tests only)
 * @param {Function} [commandExistsImpl] - injected in place of the real PATH check (tests only)
 * @param {number} [probeTimeoutMs]
 * @param {number} [askTimeoutMsDefault]
 */
export function createCliAdapter({
  id,
  displayName,
  command,
  buildArgs,
  spawnImpl,
  commandExistsImpl = commandExists,
  probeTimeoutMs = 20000,
  askTimeoutMsDefault = 60000,
}) {
  function isInstalled() {
    return commandExistsImpl(command);
  }

  function runPrompt(promptText, timeoutMs) {
    return runCli({ command, args: buildArgs(promptText), timeoutMs, spawnImpl });
  }

  // A real, minimal, live call to the CLI -- not a guess, not a cached
  // assumption. This is the only method on the interface that spends a
  // model turn just to answer "does this work right now", so callers that
  // only need "is it on PATH" should use isInstalled() instead.
  async function probe() {
    if (!isInstalled()) {
      return { ok: false, installed: false, classification: 'not_installed', summary: `${command} is not on PATH`, raw: null };
    }
    const result = await runPrompt(PROBE_PROMPT, probeTimeoutMs);
    if (!result.ok) {
      return { ok: false, installed: true, ...classifyFailure(result), raw: result.stdout || result.stderr || null };
    }
    const parsed = extractJson(result.stdout);
    if (!parsed.ok) {
      return { ok: false, installed: true, classification: 'unparseable_output', summary: 'probe exited 0 but produced no parseable JSON', raw: result.stdout };
    }
    return { ok: true, installed: true, classification: 'ok', summary: 'probe succeeded', raw: result.stdout };
  }

  async function isAuthenticated() {
    const result = await probe();
    return result.ok;
  }

  async function ask({ envelope, timeoutMs = askTimeoutMsDefault } = {}) {
    if (!envelope || typeof envelope !== 'object') {
      return { ok: false, classification: 'invalid_envelope', summary: 'ask() requires an envelope', cards: [], dropped: [], raw: null };
    }
    if (!isInstalled()) {
      return { ok: false, classification: 'not_installed', summary: `${command} is not on PATH`, cards: [], dropped: [], raw: null };
    }
    const result = await runPrompt(buildPrompt(envelope), timeoutMs);
    if (!result.ok) {
      return { ok: false, ...classifyFailure(result), cards: [], dropped: [], raw: result.stdout || result.stderr || null };
    }
    const parsed = extractJson(result.stdout);
    if (!parsed.ok) {
      return { ok: false, classification: 'unparseable_output', summary: 'CLI exited 0 but produced no parseable JSON', cards: [], dropped: [], raw: result.stdout };
    }
    const rawCards = Array.isArray(parsed.value?.cards) ? parsed.value.cards : [];
    const { cards, dropped } = toCardsAndDrops({ rawCards, site_id: envelope.site_id, conversation_id: envelope.conversation_id });
    return {
      ok: true,
      classification: 'ok',
      summary: `parsed ${rawCards.length} candidate card(s): ${cards.length} valid, ${dropped.length} dropped`,
      cards,
      dropped,
      raw: result.stdout,
    };
  }

  return Object.freeze({ id, displayName, command, isInstalled, isAuthenticated, probe, ask });
}
