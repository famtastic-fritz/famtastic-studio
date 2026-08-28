/**
 * Layout archetypes — the creative director's decision about SHAPE.
 *
 * WHY THIS EXISTS
 *
 * Five scored samples landed in a 66-71 band, and the band was narrow for one
 * reason: they were the same document. One column, `max-width: 960px`, and every
 * section built identically — heading, paragraph, full-width image — repeated
 * eight to twelve times. Nothing used the width at 1440. The 390 view reflowed
 * perfectly because there was no layout to reflow, which is robustness by
 * absence rather than by design.
 *
 * Compose was the only stage in the pipeline with no model and no variation. It
 * emitted one shape for every business, so every business got the same page.
 *
 * WHAT THIS CHANGES
 *
 * Layout becomes a RESEARCH-INFORMED DECISION rather than a default. The
 * director selects an archetype from what research established about the
 * business, assigns each section a layout and a weight, and orders them. That
 * decision is recorded in the spec with its reasoning, so it can be argued with
 * later — the same discipline as `routing_source` on a stage.
 *
 * THE DIRECTION MUST BE IN THE DATA PATH, NOT A NOTE
 *
 * The vNext pattern worth keeping: the creative director rewrites downstream
 * manifests so direction cannot be bypassed. A direction that downstream stages
 * must remember to consult is one more thing computed, stored, and read by
 * nothing -- which is the single most common defect shape in this project.
 * So the archetype is written INTO the spec's sections, not left beside them.
 */
import { intentForSection } from './media-slots.js';

/**
 * Archetypes. Each is a coherent set of decisions, not a theme: container width,
 * which layouts its sections may use, and how much vertical rhythm it wants.
 */
export const ARCHETYPES = {
  editorial: {
    id: 'editorial',
    container: 1120,
    // Long-form businesses: the reader is here to understand something.
    section_layouts: ['stack', 'split', 'pull', 'band'],
    rhythm: 'generous',
    hero: 'text-led',
    note: 'reading-first: a wide measure, alternating text and media, generous spacing',
  },
  showcase: {
    id: 'showcase',
    container: 1320,
    // Visual businesses: the work is the argument.
    section_layouts: ['full-bleed', 'split', 'cards', 'gallery', 'band'],
    rhythm: 'tight',
    hero: 'image-led',
    note: 'work-first: full-bleed imagery, a card grid for services, a gallery band',
  },
  directory: {
    id: 'directory',
    container: 1200,
    // Businesses whose value is legible structure: services, prices, hours.
    section_layouts: ['cards', 'table', 'stack', 'band'],
    rhythm: 'compact',
    hero: 'text-led',
    note: 'structure-first: dense cards and tables, scannable rather than narrative',
  },
  landing: {
    id: 'landing',
    container: 1240,
    // One decision to drive. Everything supports a single action.
    section_layouts: ['split-hero', 'feature-row', 'band', 'cards'],
    rhythm: 'punchy',
    hero: 'split',
    note: 'conversion-first: a split hero, alternating feature rows, repeated CTA',
  },
};

export const SECTION_WEIGHTS = ['primary', 'secondary', 'tertiary'];

// Category cues. Deliberately coarse: this picks a SHAPE, and a wrong shape is
// recoverable while a fabricated confidence is not.
// STEMS, matched at a word START only. A trailing \b would break every stem:
// `book-?keep\b` cannot match "Bookkeeping", and the same silently killed plumb,
// clean, landscap and train. Caught by testing the cues rather than reading them.
const CATEGORY_CUES = [
  { archetype: 'showcase', re: /\b(salon|hair|skin|esthet|barber|tattoo|photo|design|studio|gallery|florist|bak|restaurant|cater|interior)/i },
  { archetype: 'directory', re: /\b(repair|mechanic|plumb|electric|hvac|clean|landscap|book-?keep|account|tax|legal|insur|dental|clinic|school|lesson|train|tutor)/i },
  { archetype: 'landing', re: /\b(coach|consult|agency|saas|software|course|program|bootcamp|fitness|gym)/i },
];

/**
 * selectArchetype: the director's decision, with its reasoning.
 *
 * Content shape is a real input, not decoration: a business with many images
 * wants a shape that uses them, and one with a long service list wants a shape
 * that makes a list legible. A category alone would put a bike shop with twelve
 * photographs into the same dense table as a tax practice.
 */
export function selectArchetype({ packet = {}, pages = [] } = {}) {
  const category = String(packet.brand?.category || packet.business?.category || '').trim();
  const description = String(packet.brand?.description || '').trim();
  // Category OUTRANKS description. Ledger & Larkspur is bookkeeping *for
  // restaurants*: "restaurant" in the description matched the showcase cue
  // before "bookkeeping" in the category matched directory, so a B2B practice
  // was shaped by its clients' industry. A description mentions who a business
  // serves; the category says what it IS.
  const hay = category || description;

  const home = pages.find((p) => p.id === 'home') || pages[0] || { sections: [] };
  const sectionCount = (home.sections || []).length;
  const imageCount = (packet.media_prompts || []).length;
  const listSections = (home.sections || []).filter((s) => s.type === 'list' || s.type === 'cta').length;

  let byCategory = CATEGORY_CUES.find((c) => c.re.test(hay));
  // Only consult the description when the category said nothing at all.
  if (!byCategory && category && description) {
    byCategory = CATEGORY_CUES.find((c) => c.re.test(description));
  }
  let id = byCategory?.archetype || null;
  let reason = byCategory ? `category matched the ${id} shape` : null;

  // Content shape can override a weak category signal, and says so when it does.
  // The override must be RELATIVE. An absolute "8 or more images" fired on
  // almost every build once imagery started filling reliably, and put a
  // bookkeeping practice into a showcase shape. What matters is whether images
  // OUTNUMBER the things there are to say.
  const imageDensity = sectionCount ? imageCount / sectionCount : 0;
  if (byCategory && imageDensity >= 1.4 && id !== 'showcase') {
    reason = `${reason}; overridden to showcase because ${imageCount} images across ${sectionCount} sections is image-led (${imageDensity.toFixed(1)} per section) and a text-first shape would waste them`;
    id = 'showcase';
  } else if (!id && imageDensity >= 1.2) {
    id = 'showcase';
    reason = `no category signal; ${imageCount} images across ${sectionCount} sections reads as image-led`;
  } else if (!id && listSections >= 2) {
    id = 'directory';
    reason = `no category signal; ${listSections} list/CTA sections read as structure rather than narrative`;
  } else if (!id && sectionCount >= 8) {
    id = 'editorial';
    reason = `no category signal; ${sectionCount} sections is long-form, which reads better in an editorial shape`;
  }

  if (!id) {
    id = 'editorial';
    reason = 'no category or content signal; editorial is the safe default because a wide measure with generous rhythm is the least wrong shape for unknown content';
  }

  return {
    archetype: ARCHETYPES[id],
    selection: {
      archetype: id,
      reason,
      // Provenance, same discipline as routing_source: a layout decision must be
      // arguable after the fact.
      signals: { category: category || null, section_count: sectionCount, image_count: imageCount, list_sections: listSections },
      source: byCategory ? 'category' : 'content_shape',
    },
  };
}

/**
 * assignSectionLayouts: give each section a layout and a WEIGHT.
 *
 * Not every section deserves equal weight. Uniform weight is why the samples had
 * no hierarchy: with twelve sections all rendered identically, nothing signals
 * what matters, and the eye has nowhere to land.
 */
export function assignSectionLayouts(sections = [], archetype = ARCHETYPES.editorial) {
  const allowed = archetype.section_layouts;
  let alternate = 0;

  return sections.map((sec, i) => {
    const intent = intentForSection(sec);
    let layout;
    let weight;

    if (sec.type === 'hero') {
      layout = archetype.hero === 'split' ? 'split-hero' : (archetype.hero === 'image-led' ? 'full-bleed' : 'stack');
      weight = 'primary';
    } else if (sec.type === 'cta') {
      layout = allowed.includes('band') ? 'band' : 'stack';
      weight = 'primary';
    } else if (sec.type === 'list') {
      layout = allowed.includes('cards') ? 'cards' : (allowed.includes('table') ? 'table' : 'stack');
      weight = 'secondary';
    } else if (intent === 'proof' && allowed.includes('gallery')) {
      layout = 'gallery';
      weight = 'secondary';
    } else {
      // ROTATE through the archetype's body layouts. Assigning the same layout
      // to every text section produced eight consecutive splits on a real page:
      // uniform again, just a different uniform. A page needs a rhythm, which
      // means a shape that changes and returns.
      const bodyLayouts = allowed.filter((l) => ['split', 'feature-row', 'stack', 'band', 'gallery', 'pull', 'cards'].includes(l));
      const rotation = bodyLayouts.length ? bodyLayouts : ['stack'];
      layout = rotation[alternate % rotation.length];
      // A band every time it comes round is too loud; demote every second one.
      if (layout === 'band' && alternate % (rotation.length * 2) !== rotation.indexOf('band')) layout = 'stack';
      weight = alternate % 3 === 0 ? 'secondary' : 'tertiary';
      alternate += 1;
    }

    // The second section on a page carries the most weight after the hero: it is
    // the first thing a reader chooses to keep reading for.
    if (i === 1 && weight === 'tertiary') weight = 'secondary';

    return { ...sec, layout, weight, intent, layout_side: layout === 'feature-row' || layout === 'split' ? (alternate % 2 ? 'left' : 'right') : null };
  });
}

/**
 * directLayout: the whole decision, applied into the spec's own sections.
 * Returns the spec with layout written in, plus the recorded reasoning.
 */
export function directLayout({ spec, packet = {} } = {}) {
  const { archetype, selection } = selectArchetype({ packet, pages: spec.pages || [] });
  const pages = (spec.pages || []).map((page) => ({
    ...page,
    sections: assignSectionLayouts(page.sections || [], archetype),
  }));
  return {
    ...spec,
    pages,
    layout: {
      archetype: archetype.id,
      container: archetype.container,
      rhythm: archetype.rhythm,
      note: archetype.note,
    },
    layout_provenance: selection,
  };
}
