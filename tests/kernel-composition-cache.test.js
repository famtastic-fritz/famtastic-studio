import { describe, it, expect } from 'vitest';
import { structureKey, decideComposition, cacheEntry } from '../server/kernel/composition-cache.js';

const spec = () => ({
  composed_by: 'claude-cli', output_stack: 'html',
  tokens: { bg: '#fff', fg: '#111', accent: '#0f766e', muted: '#555' },
  layout: { archetype: 'showcase', container: 1320, rhythm: 'tight' },
  media_slots: [{ id: 'a', state: 'filled', section_id: 'hero' }],
  pages: [{ id: 'home', path: 'index.html', sections: [
    { id: 'hero', type: 'hero', body: 'Original copy.', layout: 'full-bleed', weight: 'primary' },
    { id: 'svc', type: 'list', items: ['a', 'b'], heading: 'Services', layout: 'cards', weight: 'secondary' },
  ] }],
});

describe('a palette change must never silently redesign an approved page', () => {
  const cached = cacheEntry({ spec: spec(), pages: [{ path: 'index.html' }] });

  it('reuses the composition when only tokens change', () => {
    const s = spec();
    s.tokens.accent = '#ff0000';
    expect(decideComposition({ spec: s, cached }).action).toBe('reuse');
  });

  it('reuses the composition when only copy changes', () => {
    const s = spec();
    s.pages[0].sections[0].body = 'Completely different words, same shape.';
    expect(decideComposition({ spec: s, cached }).action).toBe('reuse');
  });

  it('reuses when a heading is reworded but still present', () => {
    const s = spec();
    s.pages[0].sections[1].heading = 'What we do';
    expect(decideComposition({ spec: s, cached }).action).toBe('reuse');
  });
});

describe('structure changes force a recomposition', () => {
  const cached = cacheEntry({ spec: spec(), pages: [{ path: 'index.html' }] });
  const changes = {
    'a section is added': (s) => s.pages[0].sections.push({ id: 'x', type: 'text', layout: 'split', weight: 'tertiary' }),
    'a section is removed': (s) => s.pages[0].sections.pop(),
    'sections are reordered': (s) => s.pages[0].sections.reverse(),
    'a section changes type': (s) => { s.pages[0].sections[1].type = 'cta'; },
    'a section changes layout': (s) => { s.pages[0].sections[0].layout = 'stack'; },
    'a section changes weight': (s) => { s.pages[0].sections[1].weight = 'primary'; },
    'the archetype changes': (s) => { s.layout.archetype = 'directory'; },
    'a page is added': (s) => s.pages.push({ id: 'about', path: 'about.html', sections: [] }),
    'an image moves to another section': (s) => { s.media_slots[0].section_id = 'svc'; },
    'the provider changes': (s) => { s.composed_by = 'archetype-native'; },
    'a heading appears where there was none': (s) => { s.pages[0].sections[0].heading = 'New heading'; },
    'a body appears where there was none': (s) => { s.pages[0].sections[1].body = 'now has copy'; },
  };
  for (const [name, mutate] of Object.entries(changes)) {
    it(`recomposes when ${name}`, () => {
      const s = spec();
      mutate(s);
      expect(decideComposition({ spec: s, cached }).action, name).toBe('compose');
    });
  }
});

describe('cache honesty', () => {
  it('composes when there is no cached entry, and says so', () => {
    const d = decideComposition({ spec: spec(), cached: null });
    expect(d.action).toBe('compose');
    expect(d.reason).toMatch(/no cached composition/);
  });

  it('handles a spec with no pages rather than throwing', () => {
    expect(structureKey({})).toBeNull();
    expect(decideComposition({ spec: {}, cached: null }).action).toBe('compose');
  });

  // Time alone would not have caught any structural staleness this project hit.
  it('carries its own invalidation triggers', () => {
    const e = cacheEntry({ spec: spec(), pages: [{ path: 'index.html' }] });
    expect(e.invalidated_by.length).toBeGreaterThan(3);
    expect(e.invalidated_by.join(' ')).toMatch(/section/);
    expect(e.composed_at).toBeTruthy();
  });

  it('is stable for an identical spec', () => {
    expect(structureKey(spec())).toBe(structureKey(spec()));
  });
});
