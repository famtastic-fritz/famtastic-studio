/**
 * Media slots: what an image is for, and which section it serves.
 *
 * Split out of spec-derive.js when that file crossed the monolith line. The
 * grouping is deliberate: everything here answers "which section does this
 * image belong to, and what is it meant to show" -- a question that used to have
 * no answer at all, which is why compose distributed images by POSITION and put
 * a face on a credential section.
 */
import { slugify } from './pipeline-text.js';

// What an image is FOR. A slot without an intent is a slot whose prompt was
// written about the page in general, which is how a face landed on a credential
// section and a photograph of papers closed a skincare page.
export const MEDIA_INTENTS = ['portrait', 'environment', 'detail', 'proof'];

// Intent is inferred from the SECTION the slot serves, never from the page.
const INTENT_CUES = [
  { intent: 'portrait', re: /\b(about|meet|stylist|esthetician|owner|founder|team|bio|mechanic|who we are)\b/i },
  { intent: 'proof', re: /\b(review|testimonial|credential|licen[cs]e|certification|award|result|before|after|gallery of work|proof)\b/i },
  { intent: 'detail', re: /\b(service|pricing|menu|product|treatment|process|how it works|tool|equipment)\b/i },
  { intent: 'environment', re: /\b(hero|visit|location|studio|shop|space|interior|find us|contact)\b/i },
];

export function intentForSection(section = {}) {
  const hay = [section.heading, section.instruction, section.id, section.type].filter(Boolean).join(' ');
  const hit = INTENT_CUES.find((c) => c.re.test(hay));
  // 'environment' is the honest default: a room is the least wrong thing to show
  // when the section does not say what it wants.
  return hit ? hit.intent : 'environment';
}

/**
 * bindSlotsToSections: every media slot must serve a SECTION.
 *
 * Compose used to distribute filled slots across sections BY POSITION
 * (`remaining[i]`), so slot 3 landed in section 3 with no relationship between
 * them. That is the visible shadow of the discarded slot names: a face on the
 * credential strip, papers on the floor at the close.
 *
 * Binding is by name first, position second, and a slot that binds to nothing is
 * recorded as such rather than quietly dropped or quietly placed.
 */
export function bindSlotsToSections(slots = [], pages = []) {
  const sections = [];
  for (const page of pages) {
    for (const sec of page.sections || []) sections.push({ page_id: page.id, section: sec });
  }
  const taken = new Set();
  const bound = slots.map((slot) => {
    // 1. Name match: research named the slot after the section it serves.
    const key = String(slot.role || slot.id || '').toLowerCase();
    let hit = sections.find(({ section }, i) => !taken.has(i)
      && key
      && (slugify(section.id || '') === slugify(key)
        || slugify(section.heading || '') === slugify(key)));
    let how = hit ? 'name' : null;
    if (!hit) {
      // 2. Position among sections that can carry an image and have none yet.
      const idx = sections.findIndex((_, i) => !taken.has(i));
      if (idx >= 0) { hit = sections[idx]; how = 'position'; }
    }
    if (!hit) {
      return { ...slot, section_id: null, page_id: null, intent: null, bound_by: 'none' };
    }
    taken.add(sections.indexOf(hit));
    return {
      ...slot,
      page_id: hit.page_id,
      section_id: hit.section.id,
      intent: intentForSection(hit.section),
      bound_by: how,
    };
  });
  return bound;
}

export function deriveMediaSlots(packet) {
  const prompts = Array.isArray(packet.media_prompts) ? packet.media_prompts : [];
  const seen = new Set();
  return prompts.map((entry, index) => {
    const isObject = entry !== null && typeof entry === 'object' && !Array.isArray(entry);
    // Research emits `{slot, prompt}` (see sanitizeMediaPrompts); earlier
    // callers used `role`. Reading only `role` meant every research-declared
    // slot name was silently discarded and every slot came back as "media-1",
    // "media-2" -- visible in every spec on disk. Both names are accepted, and
    // the numbered fallback is a last resort rather than the norm.
    const declaredRole = isObject
      ? [entry.slot, entry.role].find((v) => typeof v === 'string' && v.trim())
      : null;
    const role = declaredRole ? declaredRole.trim() : `media-${index + 1}`;
    const prompt = isObject
      ? (typeof entry.prompt === 'string' ? entry.prompt.trim() : '')
      : (typeof entry === 'string' ? entry.trim() : '');

    let id = slugify(role) || `media-${index + 1}`;
    while (seen.has(id)) id = `${id}-${index + 1}`;
    seen.add(id);

    return {
      id,
      role,
      prompt: prompt || null,
      // 'unfilled' is an A14 honest state, not an error. No asset exists yet.
      state: 'unfilled',
      asset_ref: null,
      // Recorded so a filled slot can never be mistaken for a generated one,
      // and so provenance survives into DNA.
      filled_by: null,
    };
  });
}
