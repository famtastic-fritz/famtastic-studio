/**
 * Deterministic build defects — the checks that catch "produced, then not
 * consumed".
 *
 * All three defects found in the 2026-08-25 calibration had one shape: a plan
 * was computed and then something downstream failed to consume it. Every one
 * passed the accessibility gate, because absence-checking cannot see a page
 * that has all its parts and none of its substance.
 *
 * These are deterministic. No model, no cost, and they run on every build.
 *
 *   OUTLINE_AS_COPY      blocking  body text echoes its own planning instruction
 *   THIN_PAGE            warning   word count below the floor for the page type
 *   NO_TOKENS_APPLIED    blocking  a brief declared a palette; the render has none
 *   LOW_TOKEN_ADHERENCE  warning   some tokens applied, but below the band
 *   IMAGERY_ORPHANED     warning   generated images that no render references
 *
 * NO_TOKENS_APPLIED is deliberately blocking while LOW_TOKEN_ADHERENCE is not.
 * There is no published threshold for acceptable token adherence, so a number
 * cannot be defended — but "literally zero of the declared palette reached the
 * render" is not a threshold question. It is the direction having been computed
 * and read by nothing, which is the failure this whole file exists to catch.
 */

export const DEFECT_CODES = {
  OUTLINE_AS_COPY: 'blocking',
  NO_TOKENS_APPLIED: 'blocking',
  SECTION_WITHOUT_COPY: 'warning',
  MEDIA_SLOT_UNBOUND: 'warning',
  THIN_PAGE: 'warning',
  LOW_TOKEN_ADHERENCE: 'warning',
  IMAGERY_ORPHANED: 'warning',
};

// A section that asked for copy and got none renders as a hole. Empty is HONEST
// -- it is what the copy stage does instead of inventing a fact it was not given
// -- but honest is not shippable, and a hole is invisible to every other check
// here: it has no outline text to catch, no thin-page trigger on its own, and no
// imagery to orphan.
//
// Measured on the five-sample after-set: 98 of 256 requested sections (38%) came
// back empty, and EVERY one was type 'text' asking for a fact the pipeline never
// gathered -- "Pricing", "Hours table with holiday exceptions", "mechanic bio,
// years, certifications", "current typical turnaround stated as a number". The
// copy stage was behaving correctly. Research had declared page sections whose
// facts it never collected.
//
// Warning, not blocking, and deliberately so: the fix is upstream in research
// coverage, and a blocking gate here would fail builds for a cause the build
// cannot address. It exists so the hole is COUNTED rather than silent.
export const EMPTY_SECTION_RATIO_WARN = 0.25;

/** Word floors per page type. OURS, provisional — no source supports a number. */
export const WORD_FLOOR = { home: 350, service: 250, about: 200, policy: 150, contact: 60, default: 200 };

const stop = new Set(['a','an','and','the','of','to','in','for','with','on','plus','or','one','its','it','that','this','is','are','be','as','at','by','from','into','their','they','you','your']);

export function normalizeWords(text) {
  return String(text || '').toLowerCase().replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/).filter((w) => w && !stop.has(w));
}

/**
 * Similarity between rendered copy and the instruction that asked for it.
 *
 * Jaccard over content words. Deliberately not exact-match: the observed defect
 * was never a byte-for-byte echo, it was the instruction lightly reflowed
 * ("four short cards linking into Services"). A set measure catches the
 * reflow; an equality check would not.
 */
export function echoScore(instruction, rendered) {
  const a = new Set(normalizeWords(instruction));
  const b = new Set(normalizeWords(rendered));
  if (!a.size || !b.size) return 0;
  let shared = 0;
  for (const w of a) if (b.has(w)) shared += 1;
  return shared / new Set([...a, ...b]).size;
}

export const ECHO_THRESHOLD = 0.6;

/**
 * @param {object} input
 * @param {Array}  input.sections   [{ id, instruction, rendered_body }]
 * @param {string} input.pageType
 * @param {number} input.wordCount  words in the rendered page
 * @param {string[]} input.declaredPalette  hex values the brief asked for
 * @param {string[]} input.renderedHex      hex values present in the render
 * @param {object} input.imagery     { generated, distinctUsed, unitCost }
 */
export function detectDefects({
  sections = [], pageType = 'default', wordCount = 0,
  declaredPalette = [], renderedHex = [], imagery = null, mediaSlots = [],
} = {}) {
  const defects = [];

  // 0. Sections that asked for copy and got none.
  const asked = sections.filter((sec) => sec && sec.instruction);
  const empty = asked.filter((sec) => !sec.rendered_body || !String(sec.rendered_body).trim());
  if (empty.length) {
    const ratio = empty.length / asked.length;
    defects.push({
      code: 'SECTION_WITHOUT_COPY',
      severity: 'warning',
      page_type: pageType,
      empty_sections: empty.length,
      asked_sections: asked.length,
      ratio: Number(ratio.toFixed(3)),
      over_threshold: ratio >= EMPTY_SECTION_RATIO_WARN,
      sections: empty.map((sec) => ({ id: sec.id, instruction: String(sec.instruction).slice(0, 120) })),
      note: `${empty.length} of ${asked.length} section(s) asked for copy and rendered empty. Empty is honest -- the writer refuses to invent a fact it was not given -- but the page has a hole. These instructions ask for facts research did not gather; the fix is upstream research coverage, not the writer.`,
    });
  }

  // 0b. Media slots that serve no section.
  // An image that belongs to no section is placed by POSITION, which is what put
  // a face on a credential section and papers on the floor at a page's close.
  // Warning rather than blocking: a spec built before slots carried section_id
  // has only unbound slots, and failing those builds would punish them for a
  // schema change they predate.
  const slots = Array.isArray(mediaSlots) ? mediaSlots.filter((m) => m && m.state === 'filled') : [];
  const unboundSlots = slots.filter((m) => !m.section_id);
  if (unboundSlots.length) {
    defects.push({
      code: 'MEDIA_SLOT_UNBOUND',
      severity: 'warning',
      unbound: unboundSlots.length,
      filled: slots.length,
      slots: unboundSlots.map((m) => m.id),
      note: `${unboundSlots.length} of ${slots.length} filled media slot(s) serve no section, so they are placed by position rather than by what they show.`,
    });
  }

  // 1. Outline rendered as copy.
  for (const s of sections) {
    if (!s.instruction || !s.rendered_body) continue;
    const score = echoScore(s.instruction, s.rendered_body);
    if (score >= ECHO_THRESHOLD) {
      defects.push({
        code: 'OUTLINE_AS_COPY', severity: 'blocking', section: s.id,
        similarity: Number(score.toFixed(2)), threshold: ECHO_THRESHOLD,
        instruction: String(s.instruction).slice(0, 120),
        rendered: String(s.rendered_body).slice(0, 120),
        message: 'the rendered body repeats the instruction that asked for it; the section was planned and never written',
      });
    }
  }

  // 2. Thin page.
  const floor = WORD_FLOOR[pageType] ?? WORD_FLOOR.default;
  if (wordCount < floor) {
    defects.push({
      code: 'THIN_PAGE', severity: 'warning', page_type: pageType,
      word_count: wordCount, floor,
      message: `page has ${wordCount} words against a floor of ${floor} for type "${pageType}" — an outline is short because it is an outline`,
    });
  }

  // 3. Brand direction reaching the render.
  if (declaredPalette.length) {
    const want = new Set(declaredPalette.map((h) => h.toLowerCase()));
    const got = new Set(renderedHex.map((h) => h.toLowerCase()));
    let hit = 0;
    for (const h of want) if (got.has(h)) hit += 1;
    const adherence = hit / want.size;
    if (hit === 0) {
      defects.push({
        code: 'NO_TOKENS_APPLIED', severity: 'blocking',
        declared: [...want], found_in_render: [...got].slice(0, 8), adherence: 0,
        message: 'the brief declared a palette and not one value reached the render; the direction was computed and read by nothing',
      });
    } else if (adherence < 0.8) {
      defects.push({
        code: 'LOW_TOKEN_ADHERENCE', severity: 'warning',
        adherence: Number(adherence.toFixed(2)), band: [0.8, 0.95],
        message: `${hit} of ${want.size} declared palette values reached the render`,
      });
    }
  }

  // 4. Imagery generated but never rendered.
  if (imagery && Number(imagery.generated) > 0) {
    const orphans = Number(imagery.generated) - Number(imagery.distinctUsed || 0);
    if (orphans > 0) {
      const cost = imagery.unitCost != null ? orphans * Number(imagery.unitCost) : null;
      defects.push({
        code: 'IMAGERY_ORPHANED', severity: 'warning',
        generated: imagery.generated, distinct_used: imagery.distinctUsed, orphaned: orphans,
        orphaned_cost: cost,
        message: `${imagery.generated} images generated, ${imagery.distinctUsed} distinct rendered, ${orphans} paid for and never shown — either the planner declared too many slots or the composer is not using what was made`,
      });
    }
  }

  const blocking = defects.filter((d) => d.severity === 'blocking');
  return {
    pass: blocking.length === 0,
    blocking_count: blocking.length,
    warning_count: defects.length - blocking.length,
    defects,
  };
}
