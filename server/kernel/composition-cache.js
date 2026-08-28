/**
 * Composition caching: recompose only when STRUCTURE changes.
 *
 * WHY
 *
 * The bake-off's decisive column was timing, not layout count: 0ms and
 * reproducible against 89s and different every run. Those are suited to
 * different jobs (AMENDMENT A2), and the job that must never vary is the one
 * that happens most: a rebuild after a palette tweak or a copy fix.
 *
 * **A palette change must never silently redesign a page a client already
 * approved.** With a non-deterministic composer, recomposing on a token edit
 * does exactly that -- the client asked for a different green and got a
 * different website. Caching is not only a speed optimisation here; it is what
 * makes a non-deterministic provider safe to use at all.
 *
 * WHAT COUNTS AS STRUCTURE
 *
 * Structure is what the composer's decisions were made FROM: which pages exist,
 * which sections they hold, in what order, of what type, carrying which images,
 * under which layout archetype. Change any of that and the composition is stale.
 *
 * Tokens and copy are deliberately NOT structure. A colour, a font, or a
 * rewritten paragraph re-renders through the same composition -- the page keeps
 * the shape that was approved.
 */
import crypto from 'node:crypto';

const sha = (v) => crypto.createHash('sha256').update(JSON.stringify(v)).digest('hex');

/**
 * structureKey: everything a recomposition would legitimately change.
 * Deliberately excludes tokens, brand voice, and every section `body`.
 */
export function structureKey(spec) {
  if (!spec || !Array.isArray(spec.pages)) return null;
  return sha({
    provider: spec.composed_by || null,
    output_stack: spec.output_stack || null,
    archetype: spec.layout?.archetype || null,
    container: spec.layout?.container || null,
    rhythm: spec.layout?.rhythm || null,
    pages: spec.pages.map((p) => ({
      id: p.id,
      path: p.path,
      sections: (p.sections || []).map((s) => ({
        id: s.id,
        type: s.type,
        layout: s.layout || null,
        weight: s.weight || null,
        // Whether a section HAS a heading changes the shape; its wording does not.
        has_heading: Boolean(s.heading),
        has_body: Boolean(s.body),
        item_count: Array.isArray(s.items) ? s.items.length : 0,
      })),
    })),
    // Which section each image serves is structural; the image bytes are not.
    media: (spec.media_slots || [])
      .filter((m) => m.state === 'filled')
      .map((m) => ({ id: m.id, section_id: m.section_id || null })),
  });
}

/**
 * decide: recompose, or re-render the cached composition?
 * Returns the reason either way, so a build can say why it did what it did.
 */
export function decideComposition({ spec, cached = null } = {}) {
  const key = structureKey(spec);
  if (!key) return { action: 'compose', reason: 'no spec pages to key on', key: null };
  if (!cached) return { action: 'compose', reason: 'no cached composition for this site', key };
  if (cached.structure_key !== key) {
    return { action: 'compose', reason: 'structure changed: pages, sections, layout or image placement differ from the cached composition', key };
  }
  return {
    action: 'reuse',
    reason: 'structure is unchanged; tokens and copy re-render through the cached composition so an approved page keeps its approved shape',
    key,
  };
}

/**
 * A cache entry carries its own invalidation triggers, per the generalized
 * `invalidated_by` pattern: time alone would not have caught any of the
 * structural staleness this project has hit.
 */
export function cacheEntry({ spec, pages }) {
  return {
    structure_key: structureKey(spec),
    composed_by: spec.composed_by || null,
    output_stack: spec.output_stack || null,
    page_paths: pages.map((p) => p.path),
    composed_at: new Date().toISOString(),
    invalidated_by: [
      'a page is added or removed',
      'a section is added, removed, reordered or retyped',
      'the layout archetype changes',
      'an image is bound to a different section',
      'the composer provider changes',
    ],
  };
}
