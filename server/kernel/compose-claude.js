/**
 * Composer provider #2: claude-cli.
 *
 * Authors the page markup directly from the spec, rather than filling a
 * deterministic template. It exists to be SCORED against archetype-native on the
 * same brief, not to replace it: the whole point of a registry is that the
 * question is settled by the gate rather than by argument.
 *
 * WHAT IT IS GIVEN, AND WHAT IT IS NOT
 *
 * It receives the spec's own content -- headings, written bodies, tokens, media
 * slots with the section each serves. It does NOT receive the instructions those
 * bodies were written from. A composer that can see an instruction can publish
 * it, which is the defect this project has now found in body, heading, alt text
 * and meta description. Not passing it is structural prevention rather than a
 * rule the prompt has to remember.
 *
 * WHY OUTPUT IS VALIDATED, NOT TRUSTED
 *
 * The model returns markup. Markup is not proof of anything: it can omit the
 * hero image it was handed, invent copy that was never in the spec, or return a
 * fragment that is not a document. Each returned page is checked against the
 * spec it came from before it is accepted, and a page that fails is REJECTED
 * rather than shipped with a warning. A generator may never approve its own
 * output.
 */
import { runCli } from './shay-adapters/cli-runner.js';

export const CLAUDE_COMPOSER_TIMEOUT_MS = 180000;

function fail(statusCode, code, message) {
  return Object.assign(new Error(message), { statusCode, code });
}

/** Only what a page needs to be built. No instructions, ever. */
function pagePayload(spec, page) {
  const all = (spec.media_slots || []).filter((m) => m.state === 'filled' && m.asset_ref && (!m.page_id || m.page_id === page.id));
  // Same compatibility rule compose uses: a spec built before slots carried
  // section_id has only UNBOUND slots. Passing only bound ones handed this
  // provider zero images on an eleven-image site and made the comparison
  // meaningless -- the bake-off measured "one composer had photographs".
  const bound = all.filter((m) => m.section_id);
  const unbound = all.filter((m) => !m.section_id);
  const sections = page.sections || [];
  const positional = new Map();
  if (!bound.length && unbound.length) {
    sections.forEach((sec, i) => { if (unbound[i]) positional.set(sec.id, unbound[i]); });
  }
  const slotFor = (id) => bound.find((m) => m.section_id === id) || positional.get(id) || null;
  return {
    business: { name: spec.brand?.name || '', description: spec.brand?.description || '' },
    voice: spec.brand?.voice || null,
    tokens: spec.tokens || null,
    layout: spec.layout || null,
    page: {
      id: page.id,
      title: page.title,
      heading: page.heading,
      sections: (page.sections || []).map((s) => ({
        id: s.id,
        type: s.type,
        heading: s.heading || null,
        // `body` only. `instruction` is deliberately absent.
        body: s.body || null,
        items: s.items || null,
        layout: s.layout || null,
        weight: s.weight || null,
        image: slotFor(s.id)
          ? { src: slotFor(s.id).asset_ref, alt: slotFor(s.id).alt || null }
          : null,
      })),
    },
    nav: (spec.pages || []).map((p) => ({ path: p.path, title: p.title })),
  };
}

export function buildComposerPrompt(payload) {
  return [
    'You are composing ONE page of a small business website as standalone HTML.',
    '',
    'Return ONLY a complete HTML document. No markdown fences, no commentary.',
    '',
    'RULES:',
    '- Use EXACTLY the copy given in `body`. Do not rewrite, extend or invent copy.',
    '- A section with a null body has no copy yet: render its heading and nothing else. Do not write copy to fill it.',
    '- Use every image given. Each belongs to the section it is attached to.',
    '- Use the given tokens as CSS custom properties. Do not introduce other colours.',
    '- One <h1>, correct heading order, real <nav> from the nav list.',
    '- Every <img> needs meaningful alt text describing the image, never a filename or an id.',
    '- Text contrast must meet WCAG 4.5:1 against its background.',
    '- Interactive targets at least 24x24 CSS px.',
    '- No external requests: no CDN, no web fonts, no analytics.',
    '- Use the full width at 1440 and collapse to a single readable column below 860.',
    '',
    'SPEC:',
    JSON.stringify(payload, null, 2),
  ].join('\n');
}

/**
 * Validate a returned page against the spec that produced it. Returns the list
 * of violations; empty means acceptable.
 */
export function validateComposedPage(html, payload) {
  const problems = [];
  if (typeof html !== 'string' || !/<html[\s>]/i.test(html)) {
    problems.push('not a complete HTML document');
    return problems;
  }
  const h1s = html.match(/<h1[\s>]/gi) || [];
  if (h1s.length !== 1) problems.push(`expected exactly one <h1>, found ${h1s.length}`);

  // Every written body must survive verbatim. A composer that paraphrases the
  // copy has replaced a written, echo-guarded body with an unguarded one.
  for (const sec of payload.page.sections) {
    if (!sec.body) continue;
    const probe = sec.body.slice(0, 40).replace(/\s+/g, ' ').trim();
    const flat = html.replace(/\s+/g, ' ');
    if (probe && !flat.includes(probe)) problems.push(`section "${sec.id}" body was altered or dropped`);
  }
  // Every image handed over must be used, or it is another orphaned asset.
  for (const sec of payload.page.sections) {
    if (sec.image && !html.includes(sec.image.src)) problems.push(`image ${sec.image.src} for section "${sec.id}" was not rendered`);
  }
  // Alt text that is an identifier is the defect already found in our own composer.
  for (const m of html.matchAll(/<img[^>]*alt="([^"]*)"/gi)) {
    const alt = m[1].trim();
    if (!alt) problems.push('an image has empty alt text');
    else if (/^(media-\d+|[\w-]+\.(jpg|jpeg|png|webp))$/i.test(alt)) problems.push(`alt text "${alt}" is an identifier, not a description`);
  }
  if (/<script[\s>]/i.test(html)) problems.push('inline script present; output must be static');
  if (/https?:\/\//i.test(html.replace(/https?:\/\/(www\.)?w3\.org/gi, ''))) problems.push('external request present; output must be self-contained');
  return problems;
}

import { creditComposition } from './creator-credit.js';

function extractHtml(raw) {
  const fenced = /```(?:html)?\s*([\s\S]*?)```/i.exec(raw);
  const text = fenced ? fenced[1] : raw;
  const start = text.search(/<!doctype html|<html[\s>]/i);
  return start >= 0 ? text.slice(start).trim() : text.trim();
}

/**
 * composeWithClaude: one CLI call per page, in parallel.
 * Pages are independent, and serial composition would repeat the copy stage's
 * mistake of doing concurrent-safe work one at a time.
 */
export async function composeWithClaude(options = {}) {
  const result = await composeUncreditedWithClaude(options);
  return result.pages.length ? creditComposition(result) : result;
}

async function composeUncreditedWithClaude({ spec, spawnImpl, timeoutMs = CLAUDE_COMPOSER_TIMEOUT_MS, concurrency = 3 } = {}) {
  if (!spec || !Array.isArray(spec.pages) || !spec.pages.length) {
    throw fail(400, 'spec_required', 'composeWithClaude requires a spec with pages');
  }

  const results = [];
  const queue = [...spec.pages];
  async function worker() {
    for (;;) {
      const page = queue.shift();
      if (!page) return;
      const payload = pagePayload(spec, page);
      const prompt = buildComposerPrompt(payload);
      const started = Date.now();
      try {
        const out = await runCli({ command: 'claude', args: ['-p', prompt], timeoutMs, spawnImpl });
        const html = extractHtml(String(out?.stdout ?? out ?? ''));
        const problems = validateComposedPage(html, payload);
        results.push({
          path: page.path,
          page_id: page.id,
          html: problems.length ? null : html,
          // A rejected page is recorded with WHY, and its html withheld, so a
          // caller cannot ship it by ignoring a flag.
          rejected: problems.length ? problems : null,
          duration_ms: Date.now() - started,
        });
      } catch (error) {
        results.push({ path: page.path, page_id: page.id, html: null, rejected: [`composer call failed: ${error.message}`], duration_ms: Date.now() - started });
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, spec.pages.length) }, worker));

  const accepted = results.filter((r) => r.html);
  return {
    provider: 'claude-cli',
    output_stack: 'html-css',
    pages: accepted.map((r) => ({ path: r.path, html: r.html })),
    // Assets stay the deterministic composer's: tokens are ours to resolve and a
    // model is not asked to re-derive a palette that already passed a contrast floor.
    assets: [],
    report: {
      requested: spec.pages.length,
      accepted: accepted.length,
      rejected: results.filter((r) => r.rejected).map((r) => ({ page: r.page_id, problems: r.rejected })),
      total_ms: results.reduce((a, r) => a + r.duration_ms, 0),
    },
  };
}
