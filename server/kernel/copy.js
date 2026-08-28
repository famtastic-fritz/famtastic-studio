/**
 * The copy stage — consumes an instruction, emits prose. Never echoes.
 *
 * WHY THIS EXISTS
 *
 * The pipeline had no copy stage at all: STAGES went research -> spec ->
 * compose. Research declares sections as strings like
 * "Hero: name, one-line clinical positioning, primary Book CTA", spec-derive
 * split on the colon, and compose rendered the half after it. Five consecutive
 * builds published their own outline to the page. Every DOM check passed,
 * because absence-checking cannot see a page with all its parts and none of its
 * substance.
 *
 * spec-derive now keeps that half in `instruction` and leaves `body` null, so
 * the outline can no longer reach a render. This stage is what fills `body`.
 *
 * THE GUARD IS PART OF THE STAGE, NOT DOWNSTREAM OF IT
 *
 * A model handed "four short cards linking into Services" will sometimes hand
 * it straight back, lightly reflowed. So every returned body is scored against
 * the instruction that asked for it, and anything at or above the echo
 * threshold is REJECTED — body stays null and the section renders empty.
 *
 * That is deliberate. A visibly short page is a problem someone fixes. A page
 * confidently displaying its own planning notes is a problem someone ships.
 *
 * ONE CALL PER PAGE, NOT PER SECTION
 *
 * Sections on a page have to read as one voice and must not repeat each other.
 * Per-section calls cannot see their siblings, so they restate the same
 * positioning three ways. One call per page also costs a fraction as much.
 */

import { runCli, extractJson } from './shay-adapters/cli-runner.js';
import { echoScore, ECHO_THRESHOLD } from './build-defects.mjs';

export const COPY_TIMEOUT_MS_DEFAULT = 120000;

function fail(statusCode, code, message) {
  const e = new Error(message); e.statusCode = statusCode; e.code = code; return e;
}

export function buildCopyPrompt({ business = {}, page = {}, sections = [] }) {
  const voice = Array.isArray(business.voice_anti_patterns) && business.voice_anti_patterns.length
    ? `\nNEVER use these words or ideas — the owner has explicitly forbidden them: ${business.voice_anti_patterns.join(', ')}.`
    : '';
  const list = sections.map((s, i) =>
    `${i + 1}. id="${s.id}"${s.heading ? ` heading="${s.heading}"` : ''}\n   WHAT THIS SECTION MUST COVER: ${s.instruction}`).join('\n');

  return `You are writing the actual website copy for a real business. It will be published as written.

BUSINESS: ${business.name || 'this business'}
${business.description ? `WHAT THEY DO: ${business.description}` : ''}
PAGE: ${page.title || page.id || 'home'}${voice}

Below is a list of sections. Each one tells you WHAT THE SECTION MUST COVER.
That text is a note to you. It is NOT the copy. Do not repeat it, rephrase it,
or hand it back as a sentence — a previous version of this system published
those notes to customers and it read as an unfinished outline.

${list}

For each section, write the finished prose a visitor will read.

RULES
- Write plain declarative sentences. No marketing throat-clearing.
- 2 to 4 sentences per section unless the section is a single line by nature.
- Be specific to THIS business. A sentence that would fit any competitor is a
  failed sentence.
- Never invent a fact you were not given: no prices, no years in business, no
  credentials, no guarantees, no client names. Write around what you do not
  know.
- Do not restate the heading as the first sentence.
- If a section's note asks for something you cannot write honestly from what
  you were given, return an empty string for that section. An empty section is
  better than an invented one.

Return ONLY this JSON, no prose around it:
{"sections":[{"id":"<the id>","body":"<the finished copy>"}]}`;
}

/**
 * @returns {{sections: Array, summary: object}} sections carry `body` (string
 * or null) and, when rejected, `copy_error` explaining why.
 */
export async function writeCopy({
  business = {}, page = {}, sections = [],
  adapter, spawnImpl, timeoutMs = COPY_TIMEOUT_MS_DEFAULT,
  echoThreshold = ECHO_THRESHOLD,
} = {}) {
  const needing = sections.filter((s) => s && s.instruction && !s.body);
  if (!needing.length) {
    return { sections, summary: { requested: 0, written: 0, rejected_echo: 0, note: 'no section needed copy' } };
  }
  if (!adapter || !adapter.command) {
    throw fail(503, 'copy_adapter_unavailable', 'writeCopy requires a CLI adapter; no copy was invented in its absence');
  }

  const result = await runCli({
    command: adapter.command,
    args: ['-p', buildCopyPrompt({ business, page, sections: needing })],
    timeoutMs,
    spawnImpl,
  });

  if (!result.ok) {
    // Never fabricate on adapter failure — same rule research follows.
    return {
      sections: sections.map((s) => (needing.includes(s) ? { ...s, copy_error: 'copy adapter failed; body left unwritten rather than invented' } : s)),
      summary: { requested: needing.length, written: 0, rejected_echo: 0, adapter_failed: true, note: 'the copy adapter failed. Sections render empty rather than carrying invented text.' },
    };
  }

  // extractJson returns a WRAPPER ({ ok, value, matched }), not the object.
  // Reading `parsed.sections` off the wrapper silently yielded undefined, so
  // every section came back "returned empty" and the guard looked like it was
  // working when nothing had been parsed at all.
  const parsed = extractJson(result.stdout || '');
  const payload = parsed && parsed.ok ? parsed.value : null;
  if (!payload) {
    return {
      sections: sections.map((s) => (needing.includes(s) ? { ...s, copy_error: 'the writer returned no parseable JSON; body left unwritten rather than invented' } : s)),
      summary: { requested: needing.length, written: 0, rejected_echo: 0, returned_empty: needing.length, unparseable: true, note: 'the writer returned nothing parseable. Sections render empty rather than carrying invented text.' },
    };
  }
  const returned = new Map(
    (Array.isArray(payload.sections) ? payload.sections : [])
      .filter((s) => s && typeof s.id === 'string')
      .map((s) => [s.id, typeof s.body === 'string' ? s.body.trim() : '']),
  );

  let written = 0; let rejectedEcho = 0; let empty = 0;
  const out = sections.map((s) => {
    if (!needing.includes(s)) return s;
    const body = returned.get(s.id);
    if (!body) { empty += 1; return { ...s, copy_error: 'the writer returned nothing for this section' }; }
    const score = echoScore(s.instruction, body);
    if (score >= echoThreshold) {
      rejectedEcho += 1;
      return {
        ...s,
        copy_error: `rejected: the returned copy repeats its own instruction (similarity ${score.toFixed(2)} >= ${echoThreshold}). Body left null rather than publishing the outline.`,
        copy_echo_similarity: Number(score.toFixed(2)),
      };
    }
    written += 1;
    return { ...s, body, copy_echo_similarity: Number(score.toFixed(2)) };
  });

  return {
    sections: out,
    summary: {
      requested: needing.length, written, rejected_echo: rejectedEcho, returned_empty: empty,
      note: `${written} written; ${rejectedEcho} rejected for echoing the instruction; ${empty} returned empty. Nothing was invented.`,
    },
  };
}
