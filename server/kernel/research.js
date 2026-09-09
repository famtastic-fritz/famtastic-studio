// Research adapter dispatch (plan 2.5, ENDGAME items 6-7). The pipeline consumes
// a Research Packet and does not care who made it; this module is the only place
// that knows the two MVP adapters exist. Adapter choice is per-run and is
// recorded on the packet itself (source_adapter).
//
// shay-native is a REAL adapter: it spawns the operator's own installed
// `claude` CLI headless (no API key -- his existing subscription auth, per
// shay-adapters/claude.js) and grants it exactly two tools via --allowedTools,
// WebSearch and WebFetch, so it can actually look the business up rather than
// only reason from training data. Verified live on this build: a plain
// `claude -p` with no --allowedTools never searches; adding
// `--allowedTools WebSearch,WebFetch` (with -p placed AFTER the tools value --
// placing it before let the CLI's variadic tools flag swallow the prompt
// argument, failing with "Input must be provided either through stdin or as a
// prompt argument") makes it actually search and fetch, and a real run
// against the Beehive Studio brief (see research-prompts.js) came back with a
// live Setmore booking page it had fetched (address, hours, prices,
// cancellation policy) and a live Instagram profile.
//
// This module never trusts that self-report on its own, though. Every
// source_uri the CLI (or the brief itself) offers as a fact is independently
// re-fetched here, in code, before it is allowed into facts[] --
// verifyFactCandidates() below is the one place verification_state gets
// decided, always earned by a real fetch this process performed, never
// accepted on the model's or the brief's say-so. An unconfirmable source_uri
// is moved to not_found with an honest reason, exactly like notebooklm-import
// already does for passages with no detectable source. Deliberately NOT
// adopted: a hard "refuse to run without N pre-supplied reference URLs" gate
// seen in a legacy benchmark tool. That tool's intake always carried
// candidate URLs up front; the real briefs this adapter has to handle (a
// business name, a category, a city -- sometimes not even that) usually
// carry none, so a pre-generation gate would hard-fail the exact thin-brief
// case this module is required to handle honestly. Verification here instead
// happens after generation, against whatever the model or the brief actually
// offers -- the only shape that fits both a rich brief and "I sell shoes,
// category unsure."
//
// If the CLI is not installed, fails, times out, or prints something that
// cannot be parsed as JSON, this returns execution_status 'adapter_failed'
// with an honest reason -- never a fabricated packet. Brief-supplied facts
// still survive that path (they never depended on the CLI), still
// independently re-verified.
import { createPacket, writePacket, storeRawImport, sha256Hex } from './packet.js';
import { getAdapter } from './shay-adapters/index.js';
import { runCli, extractJson } from './shay-adapters/cli-runner.js';
import {
  buildResearchPrompt, RESEARCH_ALLOWED_TOOLS, isPlainObject, emptySiteNeeds, sanitizeStringArray,
  sanitizeBrand, sanitizeSiteNeeds, sanitizeMediaPrompts, sanitizeSeoTargets,
  brandHasContent, siteNeedsHasContent, seoTargetsHasContent,
} from './research-prompts.js';
import { looksLikeHttpUrl, verifyFactCandidates, verifySourceUri } from './research-verify.js';
import { verifyBenchmarks } from './benchmarks.js';

export const ADAPTERS = ['shay-native', 'notebooklm-import'];

// Pinned per owner directive: no API keys, ever -- the brain is the
// operator's own `claude` CLI on his existing subscription. Deliberately NOT
// shay.js's resolveProvider()/config/shay.json: that config selects Shay's
// CHAT provider (a different concern, a different prompt contract, and a
// much shorter expected turn). Research stays pinned to the one adapter this
// build has actually verified end to end against a live business brief.
const RESEARCH_ADAPTER_ID = 'claude';

// Real end-to-end runs (search-augmented, against the Beehive Studio brief)
// measured ~100-120s. This leaves real headroom rather than the sibling chat
// adapters' 60s default, which is sized for a much shorter chat turn.
const RESEARCH_TIMEOUT_MS_DEFAULT = 240000;

// Per-source-URI live verification. Short on purpose: this is confirming a
// citation resolves, not downloading a site.


function adapterError(message, extra = {}) {
  return Object.assign(new Error(message), { statusCode: 400, code: 'adapter_invalid', ...extra });
}

function defaultBriefRef(site_id, brief_hash) {
  return `brief:${site_id}:${brief_hash.slice(0, 16)}`;
}

function passthroughOr(value, fallback) {
  return value !== undefined && value !== null ? value : fallback;
}

// Candidate facts pulled directly from the brief -- rare, but if the brief
// itself already carries claim + source_uri pairs (e.g. the customer handed
// over a citation), those are real, checkable candidates, not fabrication.
// Returned unverified: verifyFactCandidates() below decides verification_state
// for every candidate uniformly, brief-sourced or model-sourced, from an
// actual fetch rather than trusting whatever the brief itself claimed.
function factCandidatesFromBrief(brief) {
  const list = Array.isArray(brief?.facts) ? brief.facts : [];
  return list
    .filter((f) => f && typeof f.claim === 'string' && f.claim.trim() && typeof f.source_uri === 'string' && f.source_uri.trim())
    .map((f) => ({
      claim: f.claim.trim(),
      source_uri: f.source_uri.trim(),
      design_use: typeof f.design_use === 'string' ? f.design_use : null,
      mutable: typeof f.mutable === 'boolean' ? f.mutable : true,
    }));
}

// What the customer told us, carried through unverified and kept structurally
// apart from facts[] (A3: customer claims are never promoted to facts).
function customerClaimsFromBrief(brief) {
  const explicit = Array.isArray(brief?.customer_claims) ? brief.customer_claims : [];
  const fromClaims = explicit
    .filter((c) => c && typeof c.claim === 'string' && c.claim.trim())
    .map((c) => ({ claim: c.claim, field: c.field || null, source: 'customer' }));
  const businessFields = brief?.business && typeof brief.business === 'object' ? brief.business : null;
  const fromBusiness = businessFields
    ? Object.entries(businessFields)
        .filter(([, v]) => typeof v === 'string' && v.trim())
        .map(([field, v]) => ({ claim: v, field: `business.${field}`, source: 'customer' }))
    : [];
  return [...fromClaims, ...fromBusiness];
}


function classifyCliFailure({ exitCode, timedOut, spawnError, stderr }) {
  if (spawnError) return { reason: 'spawn_failed', detail: `the claude CLI could not be started: ${spawnError.message}` };
  if (timedOut) return { reason: 'timed_out', detail: 'the claude CLI did not respond before the timeout and was killed' };
  return { reason: 'nonzero_exit', detail: `the claude CLI exited with code ${exitCode}${stderr ? `: ${stderr.trim().slice(0, 300)}` : ''}` };
}

// Shared assembly for every 'adapter_failed' outcome: brief-supplied facts
// still get independently verified and kept (they never depended on the CLI
// call that just failed), everything else honestly falls back to whatever
// structure the brief itself carried, and confidence_notes says exactly what
// happened rather than a generic error string.
async function adapterFailedFields({ base, brief, briefCandidates, options, requiredCapabilityQuestions, reason, detail }) {
  const { facts, rejected } = await verifyFactCandidates(briefCandidates, { fetchImpl: options.fetchImpl });
  const briefFactsNote = facts.length
    ? ` ${facts.length} fact(s) came from the brief's own sourced citations and were independently re-verified; nothing else was looked up.`
    : ' No live research ran for this call.';
  return {
    ...base,
    execution_status: 'adapter_failed',
    facts,
    brand: passthroughOr(brief?.brand, {}),
    site_needs: passthroughOr(brief?.site_needs, emptySiteNeeds()),
    component_needs: passthroughOr(brief?.component_needs, []),
    media_prompts: passthroughOr(brief?.media_prompts, []),
    seo_targets: passthroughOr(brief?.seo_targets, { keywords: [], meta_direction: '' }),
    open_questions: [...requiredCapabilityQuestions],
    not_found: rejected,
    confidence_notes: `adapter_failed (${reason}): ${detail}.${briefFactsNote}`,
  };
}

/**
 * shay-native: real research, run through the operator's own `claude` CLI
 * (see module header). Async because it is: spawning a CLI and independently
 * re-fetching cited sources both take real wall-clock time (real runs:
 * roughly 100-120s end to end).
 */
// A live research call occasionally comes back completely empty -- exit 0,
// parseable JSON, but no facts, no open questions, no brand direction, nothing.
// Observed once in eight real runs on 2026-08-23 (The Beehive Studio); two
// immediate retries of the same brief returned 8 and 6 verified facts, so the
// failure is transient, not a property of the brief. Without a retry the
// pipeline accepted that empty packet and built a thin site that reported
// success, which is exactly the shape of a broken proof reaching a customer.
// One retry, then honesty: a still-empty second attempt is reported as
// no_findings with a note saying it was attempted twice, never dressed up.
async function runShayNative({ site_id, brief, options = {} }) {
  const attempts = options.emptyPacketRetries ?? 1;
  let packet = await runShayNativeOnce({ site_id, brief, options });
  const worthRetrying = (p) => isEmptyPacket(p) || isRetryableAdapterFailure(p);
  for (let i = 0; i < attempts && worthRetrying(packet); i += 1) {
    packet = await runShayNativeOnce({ site_id, brief, options });
    if (!worthRetrying(packet)) {
      packet.confidence_notes = `${packet.confidence_notes} (The first attempt returned nothing usable; this is the retry.)`;
    } else {
      packet.confidence_notes = `${packet.confidence_notes} Attempted ${i + 2} times; every attempt returned a completely empty packet.`;
    }
  }
  return packet;
}

// Empty means the call produced nothing usable at all -- not merely "no
// verifiable facts", which is a legitimate and common honest result for a thin
// brief and must NOT trigger a retry.
// Transient adapter failures are worth one retry; permanent ones are not.
// 'unparseable_output' (the CLI exits 0 having printed nothing parseable),
// 'timed_out' and 'spawn_failed' are all things that succeed on a second
// attempt. 'not_installed' never will, and retrying it just wastes a probe.
const RETRYABLE_ADAPTER_FAILURES = ['unparseable_output', 'timed_out', 'spawn_failed'];

function isRetryableAdapterFailure(packet) {
  if (packet?.execution_status !== 'adapter_failed') return false;
  const notes = typeof packet.confidence_notes === 'string' ? packet.confidence_notes : '';
  return RETRYABLE_ADAPTER_FAILURES.some((reason) => notes.includes(`adapter_failed (${reason})`));
}

function isEmptyPacket(packet) {
  if (!packet) return true;
  if (packet.execution_status === 'adapter_failed') return false;
  return (packet.facts?.length ?? 0) === 0
    && (packet.open_questions?.length ?? 0) === 0
    && (packet.media_prompts?.length ?? 0) === 0
    && (packet.not_found?.length ?? 0) === 0
    && !brandHasContent(packet.brand)
    && !siteNeedsHasContent(packet.site_needs);
}

async function runShayNativeOnce({ site_id, brief, options = {} }) {
  const brief_hash = sha256Hex(brief ?? {});
  const base = {
    source_adapter: 'shay-native',
    brief_ref: brief?.brief_ref || defaultBriefRef(site_id, brief_hash),
    brief_hash,
    customer_claims: customerClaimsFromBrief(brief),
  };
  const requiredCapabilities = Array.isArray(brief?.required_capabilities) ? brief.required_capabilities : [];
  const requiredCapabilityQuestions = requiredCapabilities.map(
    (cap) => `Unanswered: "${cap}" -- no research provider confirmed this, so it was never looked up.`,
  );
  const briefCandidates = factCandidatesFromBrief(brief);

  const adapter = getAdapter(RESEARCH_ADAPTER_ID, { spawnImpl: options.spawnImpl, commandExistsImpl: options.commandExistsImpl });
  if (!adapter || !adapter.isInstalled()) {
    return adapterFailedFields({
      base, brief, briefCandidates, options, requiredCapabilityQuestions,
      reason: 'not_installed', detail: `the ${RESEARCH_ADAPTER_ID} CLI is not on PATH in this environment`,
    });
  }

  // Sub-stage timing. Research is ~99% of a build's wall clock, so "research is
  // slow" is not an actionable finding -- knowing whether the time is the CLI
  // call or our own source verification is. Recorded on the packet so every run
  // carries it, not just runs someone thought to instrument.
  const tCliStart = Date.now();
  const cliResult = await runCli({
    command: adapter.command,
    args: ['--allowedTools', RESEARCH_ALLOWED_TOOLS, '-p', buildResearchPrompt(brief)],
    timeoutMs: options.timeoutMs ?? RESEARCH_TIMEOUT_MS_DEFAULT,
    spawnImpl: options.spawnImpl,
  });
  const cliMs = Date.now() - tCliStart;
  if (!cliResult.ok) {
    const { reason, detail } = classifyCliFailure(cliResult);
    return adapterFailedFields({ base, brief, briefCandidates, options, requiredCapabilityQuestions, reason, detail });
  }

  const parsed = extractJson(cliResult.stdout);
  if (!parsed.ok) {
    return adapterFailedFields({
      base, brief, briefCandidates, options, requiredCapabilityQuestions,
      reason: 'unparseable_output', detail: 'the claude CLI exited 0 but printed nothing this module could parse as JSON',
    });
  }

  const modelOutput = isPlainObject(parsed.value) ? parsed.value : {};
  const modelFactCandidates = Array.isArray(modelOutput.facts)
    ? modelOutput.facts
        .filter((f) => f && typeof f === 'object')
        .map((f) => ({
          claim: typeof f.claim === 'string' ? f.claim.trim() : '',
          source_uri: typeof f.source_uri === 'string' ? f.source_uri.trim() : '',
          // v2: the model may state what a finding is for; it is still only
          // promoted after the source independently verifies.
          design_use: typeof f.design_use === 'string' ? f.design_use : null,
          mutable: typeof f.mutable === 'boolean' ? f.mutable : true,
        }))
    : [];

  const tVerifyStart = Date.now();
  const { facts, rejected } = await verifyFactCandidates([...briefCandidates, ...modelFactCandidates], { fetchImpl: options.fetchImpl });

  // Market facts, verified the same way facts are: by a fetch this process
  // performed. Kept in their own field so a market range can never be mistaken
  // for something the customer told us. See benchmarks.js for the distinction.
  const benchmarkResult = await verifyBenchmarks(modelOutput.benchmarks, {
    verifySourceUri, looksLikeHttpUrl, fetchImpl: options.fetchImpl,
  });
  const verifyMs = Date.now() - tVerifyStart;

  const open_questions = [...sanitizeStringArray(modelOutput.open_questions), ...requiredCapabilityQuestions];

  const sanitizedBrand = sanitizeBrand(modelOutput.brand);
  const sanitizedSiteNeeds = sanitizeSiteNeeds(modelOutput.site_needs);
  const sanitizedMediaPrompts = sanitizeMediaPrompts(modelOutput.media_prompts);
  const sanitizedSeoTargets = sanitizeSeoTargets(modelOutput.seo_targets);
  // Research enriches a brief; it must not erase an approved design contract
  // merely because the model returned a fresh palette or voice direction.
  const brand = brandHasContent(sanitizedBrand)
    ? { ...passthroughOr(brief?.brand, {}), ...sanitizedBrand }
    : passthroughOr(brief?.brand, {});
  const site_needs = siteNeedsHasContent(sanitizedSiteNeeds) ? sanitizedSiteNeeds : passthroughOr(brief?.site_needs, emptySiteNeeds());
  const media_prompts = sanitizedMediaPrompts.length ? sanitizedMediaPrompts : passthroughOr(brief?.media_prompts, []);
  const seo_targets = seoTargetsHasContent(sanitizedSeoTargets) ? sanitizedSeoTargets : passthroughOr(brief?.seo_targets, { keywords: [], meta_direction: '' });

  const hasSubstance = facts.length > 0 || benchmarkResult.benchmarks.length > 0 || open_questions.length > 0 || brandHasContent(brand) || siteNeedsHasContent(site_needs) || media_prompts.length > 0 || seoTargetsHasContent(seo_targets);
  // Status keys off EVIDENCE (facts verified, sources rejected), never off
  // open_questions. Open questions are a positive signal -- honest research
  // always surfaces unknowns -- so gating 'ok' on having none made 'ok'
  // unreachable for any real run and collapsed every packet to 'partial',
  // whether it carried 8 verified facts or none. That is the same rule the
  // notebooklm-import path below already used; the two paths now agree.
  let execution_status;
  if (!hasSubstance) execution_status = 'no_findings';
  else if (facts.length === 0) execution_status = 'partial';
  else if (rejected.length === 0) execution_status = 'ok';
  else execution_status = 'partial';

  const modelNotes = typeof modelOutput.confidence_notes === 'string' && modelOutput.confidence_notes.trim()
    ? modelOutput.confidence_notes.trim()
    : 'The CLI returned a packet with no confidence_notes of its own.';
  const verificationNote = rejected.length
    ? ` ${rejected.length} claimed source(s) could not be independently confirmed and were moved to not_found rather than trusted.`
    : (facts.length ? ` All ${facts.length} fact(s) were independently re-fetched and confirmed live before being trusted.` : '');

  return {
    ...base,
    execution_status,
    timings: {
      cli_ms: cliMs,
      verify_sources_ms: verifyMs,
      sources_checked: new Set([...briefCandidates, ...modelFactCandidates].map((c) => c.source_uri).filter(Boolean)).size,
    },
    facts,
    benchmarks: benchmarkResult.benchmarks,
    component_needs: passthroughOr(brief?.component_needs, []),
    brand,
    site_needs,
    media_prompts,
    seo_targets,
    open_questions,
    not_found: [...rejected, ...benchmarkResult.rejected],
    confidence_notes: `${modelNotes}${verificationNote}`,
  };
}

const URL_RE = /https?:\/\/[^\s)]+/;

// Splits raw NotebookLM output into paragraph-ish chunks so each one can be
// checked independently for a source URL.
function chunksOf(rawText) {
  return String(rawText)
    .split(/\n\s*\n+/)
    .map((c) => c.trim())
    .filter(Boolean);
}

/**
 * notebooklm-import: normalizes pasted/uploaded NotebookLM output into the
 * packet schema. A chunk with a detectable URL becomes a fact (verification_state
 * 'unverified' -- extracted, not independently re-checked). A chunk with no URL
 * cannot be sourced, so it is never guessed into a fact; it goes to not_found
 * with an honest reason instead of being silently dropped. Unlike shay-native,
 * this adapter performs no live I/O of its own, so it stays synchronous.
 */
function runNotebookLmImport({ paths, site_id, packet_id, brief, raw_import, design_use, mutable }) {
  // v2: design_use travels with the IMPORT, not with each chunk, because the
  // eight brief questions are run one at a time — so every fact in a single
  // import answers the same question and shares what it is for. An import that
  // does not say what its answers are for cannot produce facts; its passages go
  // to not_found rather than becoming findings nothing can act on.
  const designUse = typeof design_use === 'string' && design_use.trim() ? design_use.trim() : null;
  const isMutable = typeof mutable === 'boolean' ? mutable : true;
  if (raw_import === undefined || raw_import === null || String(raw_import).trim() === '') {
    throw adapterError('notebooklm-import requires raw_import (pasted or uploaded NotebookLM output)');
  }
  const { import_ref, import_hash } = storeRawImport({ paths, site_id, packet_id, bytes: raw_import });

  const brief_hash = sha256Hex(brief ?? {});
  const customer_claims = customerClaimsFromBrief(brief);
  const now = new Date().toISOString();

  const facts = [];
  const not_found = [];
  for (const chunk of chunksOf(raw_import)) {
    const match = chunk.match(URL_RE);
    if (match) {
      const source_uri = match[0];
      const claim = chunk.replace(source_uri, '').trim() || chunk;
      if (!designUse) {
        not_found.push({
          claim: chunk.length > 200 ? `${chunk.slice(0, 200)}...` : chunk,
          reason: 'sourced passage, but the import carried no design_use; a finding that cannot say what it changes is not promoted to a fact',
        });
      } else {
        facts.push({
          claim,
          source_uri,
          retrieved_at: now,
          checked_at: now,
          verification_state: 'unverified',
          design_use: designUse,
          mutable: isMutable,
        });
      }
    } else {
      not_found.push({
        claim: chunk.length > 200 ? `${chunk.slice(0, 200)}...` : chunk,
        reason: 'no source URL found in this imported passage; cannot map to a sourced fact without guessing',
      });
    }
  }

  let execution_status;
  if (facts.length === 0) execution_status = 'no_findings';
  else if (not_found.length === 0) execution_status = 'ok';
  else execution_status = 'partial';

  const confidence_notes = facts.length
    ? `Imported from NotebookLM output. ${facts.length} passage(s) carried a detectable source URL and were mapped to facts (unverified -- extracted, not independently re-checked). ${not_found.length} passage(s) had no detectable source and were left in not_found rather than guessed.`
    : 'Imported from NotebookLM output. No passage carried a detectable source URL, so nothing could be mapped to a sourced fact; every passage is recorded in not_found rather than guessed.';

  return {
    source_adapter: 'notebooklm-import',
    brief_ref: brief?.brief_ref || defaultBriefRef(site_id, brief_hash),
    brief_hash,
    import_ref,
    import_hash,
    execution_status,
    facts,
    customer_claims,
    not_found,
    brand: passthroughOr(brief?.brand, {}),
    site_needs: passthroughOr(brief?.site_needs, emptySiteNeeds()),
    component_needs: passthroughOr(brief?.component_needs, []),
    media_prompts: passthroughOr(brief?.media_prompts, []),
    seo_targets: passthroughOr(brief?.seo_targets, { keywords: [], meta_direction: '' }),
    open_questions: [],
    confidence_notes,
  };
}

/**
 * runResearch({ paths, journal, events, site_id, adapter, brief, raw_import,
 * initiator, options }) dispatches to the named adapter, assembles a valid
 * Research Packet v1, persists it under the site, journals the run, and emits
 * an event. Returns a Promise<Packet> -- always a Promise, even for
 * notebooklm-import (which itself performs no I/O), so callers have one
 * consistent contract to await rather than a function that is sometimes sync
 * and sometimes not depending on which adapter was chosen. shay-native in
 * particular spawns a real CLI subprocess and may perform live fetch
 * verification, so it cannot complete synchronously; callers MUST await (or
 * .then()) this call. `options` accepts `{ spawnImpl, commandExistsImpl,
 * fetchImpl, timeoutMs }`, all test-injection points that default to the real
 * node:child_process spawn, the real PATH check, the real global fetch, and
 * RESEARCH_TIMEOUT_MS_DEFAULT respectively when omitted.
 */
export async function runResearch({ paths, journal, events, site_id, adapter, brief, raw_import, design_use, mutable, options, initiator = 'console' }) {
  if (!site_id) throw Object.assign(new Error('runResearch requires site_id (no ambient site)'), { statusCode: 400, code: 'identity_required' });
  if (!ADAPTERS.includes(adapter)) throw adapterError(`unknown adapter '${adapter}'; must be one of ${ADAPTERS.join(', ')}`);
  if (!brief || typeof brief !== 'object') throw adapterError('runResearch requires a brief object');

  const packet_id = `rp_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;

  const fields = adapter === 'shay-native'
    ? await runShayNative({ site_id, brief, options: options || {} })
    : runNotebookLmImport({ paths, site_id, packet_id, brief, raw_import, design_use, mutable });
  fields.packet_id = packet_id;

  const packet = createPacket(fields, { paths, site_id });
  packet.site_id = site_id;
  writePacket({ paths, packet });

  if (journal) {
    journal.append({
      site_id,
      initiator,
      intent: `research.run:${adapter}`,
      changes: [{ type: 'research_packet', packet_id: packet.packet_id }],
      result: { execution_status: packet.execution_status, facts: packet.facts.length, not_found: packet.not_found.length },
      evidence: { packet_id: packet.packet_id },
    });
  }
  if (events) {
    events.emit({ type: 'research.packet.created', site_id, payload: { packet_id: packet.packet_id, source_adapter: adapter, execution_status: packet.execution_status } });
  }

  return packet;
}
