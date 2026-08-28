import { describe, it, expect } from 'vitest';
import { selectArchetype, assignSectionLayouts, directLayout, ARCHETYPES } from '../server/kernel/layout-archetypes.js';

// Five scored samples landed in a 66-71 band because they were the same
// document: one column, max-width 960, every section heading/paragraph/image
// repeated. Compose was the only stage with no model and no variation.
const pagesWith = (sections) => [{ id: 'home', sections }];
const BASE = [
  { id: 'hero', type: 'hero' },
  { id: 'services', type: 'list', items: ['a', 'b'] },
  { id: 'about', type: 'text', heading: 'Meet your stylist' },
];

describe('archetype selection is a research-informed decision', () => {
  it('selects by category and records why', () => {
    const r = selectArchetype({ packet: { brand: { category: 'Hair Salon' } }, pages: pagesWith(BASE) });
    expect(r.selection.archetype).toBe('showcase');
    expect(r.selection.source).toBe('category');
    expect(r.selection.reason).toMatch(/category/);
  });

  // A trailing \b broke every STEM: book-?keep\b cannot match "Bookkeeping".
  // It silently killed plumb, clean, landscap and train too.
  it('matches category stems, not only whole words', () => {
    for (const [cat, want] of [['Bookkeeping', 'directory'], ['Plumbing', 'directory'], ['Landscaping', 'directory'], ['Swim Lessons', 'directory']]) {
      const r = selectArchetype({ packet: { brand: { category: cat } }, pages: pagesWith(BASE) });
      expect(r.selection.archetype, `${cat} should select ${want}`).toBe(want);
    }
  });

  // A bike shop with twelve photographs is not a tax practice.
  it('lets content shape override a weak category signal, and says so', () => {
    const r = selectArchetype({ packet: { brand: { category: 'Bookkeeping' }, media_prompts: Array(10) }, pages: pagesWith(BASE) });
    expect(r.selection.archetype).toBe('showcase');
    expect(r.selection.reason).toMatch(/overridden to showcase/);
    expect(r.selection.reason).toMatch(/10 images/);
  });

  it('falls back to editorial and states that it is a fallback', () => {
    const r = selectArchetype({ packet: {}, pages: pagesWith([{ id: 'a', type: 'text' }]) });
    expect(r.selection.archetype).toBe('editorial');
    expect(r.selection.reason).toMatch(/no category or content signal/);
  });

  it('records the signals it decided from, so the decision is arguable later', () => {
    const r = selectArchetype({ packet: { brand: { category: 'Hair Salon' }, media_prompts: Array(3) }, pages: pagesWith(BASE) });
    expect(r.selection.signals).toMatchObject({ category: 'Hair Salon', image_count: 3, section_count: 3 });
  });
});

describe('sections get a layout and a weight, not uniform treatment', () => {
  it('assigns layouts drawn only from the archetype it was given', () => {
    const out = assignSectionLayouts(BASE, ARCHETYPES.showcase);
    for (const sec of out) {
      expect(['full-bleed', 'split', 'cards', 'gallery', 'band', 'stack']).toContain(sec.layout);
      expect(['primary', 'secondary', 'tertiary']).toContain(sec.weight);
    }
  });

  // Uniform weight across twelve sections is why nothing signalled what mattered.
  it('does not give every section the same weight', () => {
    const out = assignSectionLayouts([...BASE, { id: 'x', type: 'text' }, { id: 'y', type: 'cta', items: ['Book'] }], ARCHETYPES.showcase);
    expect(new Set(out.map((s) => s.weight)).size).toBeGreaterThan(1);
  });

  it('gives the hero primary weight in every archetype', () => {
    for (const a of Object.values(ARCHETYPES)) {
      expect(assignSectionLayouts(BASE, a)[0].weight).toBe('primary');
    }
  });

  // Consecutive media sections stacking identically is the defect being fixed.
  it('alternates sides so consecutive split sections do not stack identically', () => {
    const many = Array.from({ length: 4 }, (_, i) => ({ id: `s${i}`, type: 'text', heading: `H${i}` }));
    const out = assignSectionLayouts(many, ARCHETYPES.landing).filter((s) => s.layout_side);
    expect(new Set(out.map((s) => s.layout_side)).size).toBe(2);
  });

  it('produces different shapes for different archetypes on the same sections', () => {
    const show = assignSectionLayouts(BASE, ARCHETYPES.showcase).map((s) => s.layout).join(',');
    const dir = assignSectionLayouts(BASE, ARCHETYPES.directory).map((s) => s.layout).join(',');
    expect(show).not.toBe(dir);
  });
});

describe('directLayout writes the decision into the spec', () => {
  it('puts layout on every section rather than beside them', () => {
    const spec = { pages: [{ id: 'home', sections: BASE }] };
    const out = directLayout({ spec, packet: { brand: { category: 'Hair Salon' } } });
    for (const sec of out.pages[0].sections) expect(sec.layout).toBeTruthy();
    expect(out.layout.archetype).toBe('showcase');
    expect(out.layout.container).toBe(ARCHETYPES.showcase.container);
    expect(out.layout_provenance.reason).toBeTruthy();
  });

  it('uses a container wider than the old fixed 960 for every archetype', () => {
    for (const a of Object.values(ARCHETYPES)) expect(a.container).toBeGreaterThan(960);
  });
});

// Found by looking at real output twice, after the tests were already green.
describe('regressions caught by reading the rendered result', () => {
  const pages = (n) => [{ id: 'home', sections: Array.from({ length: n }, (_, i) => ({ id: `s${i}`, type: i ? 'text' : 'hero', heading: `H${i}` })) }];

  // Ledger & Larkspur is bookkeeping FOR RESTAURANTS. "restaurant" in the
  // description matched the showcase cue before "bookkeeping" in the category
  // matched directory, so a B2B practice was shaped by its clients' industry.
  it('lets the category outrank the description', () => {
    const r = selectArchetype({
      packet: { brand: { category: 'Bookkeeping', description: 'bookkeeping for independent restaurants' } },
      pages: pages(9),
    });
    expect(r.selection.archetype).toBe('directory');
  });

  it('still consults the description when the category says nothing', () => {
    const r = selectArchetype({
      packet: { brand: { category: 'Other', description: 'a photography studio' } },
      pages: pages(4),
    });
    expect(r.selection.archetype).toBe('showcase');
  });

  // An absolute "8 or more images" fired on nearly every build once imagery
  // filled reliably, so the override has to be relative to how much there is
  // to say.
  it('does not override a category on image count alone when density is ordinary', () => {
    const r = selectArchetype({
      packet: { brand: { category: 'Bookkeeping' }, media_prompts: Array(9) },
      pages: pages(11),
    });
    expect(r.selection.archetype).toBe('directory');
  });

  it('does override when images genuinely outnumber the sections', () => {
    const r = selectArchetype({
      packet: { brand: { category: 'Bookkeeping' }, media_prompts: Array(12) },
      pages: pages(6),
    });
    expect(r.selection.archetype).toBe('showcase');
    expect(r.selection.reason).toMatch(/per section/);
  });

  // Eight consecutive splits on a real page: uniform again, just a different
  // uniform. A page needs a shape that changes and returns.
  it('rotates body layouts instead of repeating one shape down the page', () => {
    const many = Array.from({ length: 9 }, (_, i) => ({ id: `s${i}`, type: i ? 'text' : 'hero', heading: `H${i}` }));
    const out = assignSectionLayouts(many, ARCHETYPES.showcase);
    const body = out.slice(1).map((s) => s.layout);
    expect(new Set(body).size).toBeGreaterThanOrEqual(3);
    // No layout may run more than twice consecutively.
    let run = 1;
    for (let i = 1; i < body.length; i += 1) {
      run = body[i] === body[i - 1] ? run + 1 : 1;
      expect(run, `"${body[i]}" repeated ${run} times in a row`).toBeLessThanOrEqual(2);
    }
  });
});
