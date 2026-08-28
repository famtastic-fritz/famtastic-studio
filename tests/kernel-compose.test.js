import { describe, it, expect } from 'vitest';
import { composeSite, COMPOSERS, DEFAULT_COMPOSER } from '../server/kernel/compose.js';

function sampleSpec() {
  return {
    brand: { name: 'Acme Bakery', description: 'Fresh bread, every morning.' },
    seo_targets: { meta_direction: 'local bakery in town' },
    pages: [
      {
        id: 'home', path: 'index.html', title: 'Acme Bakery', heading: 'Acme Bakery',
        sections: [
          { id: 'hero', type: 'hero', body: 'Fresh bread, every morning.' },
          { id: 'offers', type: 'list', heading: 'What we offer', items: ['Sourdough', 'Croissants'] },
          { id: 'cta', type: 'cta', heading: 'Get started', items: ['Order now'] },
        ],
      },
      {
        id: 'about', path: 'about.html', title: 'About — Acme Bakery', heading: 'About',
        sections: [{ id: 'about', type: 'text', heading: 'About', body: 'More about Acme Bakery is coming soon.' }],
      },
    ],
  };
}

describe('composeSite', () => {
  it('declares deterministic as the only available composer', () => {
    expect(COMPOSERS).toEqual(['deterministic']);
    expect(DEFAULT_COMPOSER).toBe('deterministic');
  });

  it('produces one HTML artifact per spec page plus standard static assets', () => {
    const spec = sampleSpec();
    const result = composeSite({ spec });
    expect(result.composer).toBe('deterministic');
    expect(result.pages).toHaveLength(2);
    expect(result.pages.map((p) => p.path)).toEqual(['index.html', 'about.html']);
    const assetPaths = result.assets.map((a) => a.path);
    expect(assetPaths).toEqual(['styles.css', 'js/main.js', 'robots.txt', 'package.json', 'README.md', '404.html']);
    const stylesAsset = result.assets.find((a) => a.path === 'styles.css');
    expect(stylesAsset.contents).toContain(':root');
  });

  it('emits exactly one <h1> per page and links the shared stylesheet', () => {
    const spec = sampleSpec();
    const { pages } = composeSite({ spec });
    for (const page of pages) {
      const h1Matches = page.html.match(/<h1[ >]/g) || [];
      expect(h1Matches).toHaveLength(1);
      expect(page.html).toContain('<link rel="stylesheet" href="styles.css">');
      expect(page.html).toMatch(/^<!doctype html>/);
    }
  });

  it('renders real content, not template placeholders', () => {
    const spec = sampleSpec();
    const { pages } = composeSite({ spec });
    const home = pages.find((p) => p.path === 'index.html');
    expect(home.html).toContain('Fresh bread, every morning.');
    expect(home.html).toContain('Sourdough');
    expect(home.html).toContain('Order now');
    for (const page of pages) {
      expect(page.html).not.toMatch(/\{\{|\}\}/);
    }
  });

  it('escapes HTML-unsafe characters in section content', () => {
    const spec = sampleSpec();
    spec.pages[0].sections[0].body = 'Fresh <bread> & "pastries"';
    const { pages } = composeSite({ spec });
    const home = pages.find((p) => p.path === 'index.html');
    expect(home.html).toContain('Fresh &lt;bread&gt; &amp; &quot;pastries&quot;');
    expect(home.html).not.toContain('<bread>');
  });

  it('renders navigation linking every page, marking the current page', () => {
    const spec = sampleSpec();
    const { pages } = composeSite({ spec });
    const home = pages.find((p) => p.path === 'index.html');
    expect(home.html).toContain('href="about.html"');
    expect(home.html).toContain('aria-current="page"');
  });

  it('throws (not silently falls back) for an unimplemented composer', () => {
    const spec = sampleSpec();
    expect(() => composeSite({ spec, composer: 'gpt-magic' })).toThrow(/composer_not_implemented|not implemented/);
    try {
      composeSite({ spec, composer: 'gpt-magic' });
    } catch (error) {
      expect(error.code).toBe('composer_not_implemented');
      expect(error.statusCode).toBe(501);
    }
  });

  it('refuses to compose a spec with no pages', () => {
    expect(() => composeSite({ spec: { pages: [] } })).toThrow(/pages to be a non-empty array/);
    expect(() => composeSite({ spec: {} })).toThrow();
  });
});

// Imagery in the page. The rule: a filled slot becomes a real <img>; an unfilled
// slot renders nothing at all. No placeholder box, no grey rectangle, nothing
// that implies an asset exists when none does.
describe('compose: filled media slots render, unfilled ones render nothing', () => {
  const baseSpec = (mediaSlots) => ({
    brand: { name: 'Starlight Skin Bar' },
    seo_targets: { keywords: [], meta_direction: '' },
    media_slots: mediaSlots,
    pages: [{ id: 'home', path: 'index.html', title: 'Starlight', heading: 'Starlight', sections: [{ id: 'hero', type: 'hero', body: 'Skin care that explains itself.' }] }],
  });

  it('renders a real img for a filled slot', () => {
    const out = composeSite({ spec: baseSpec([{ id: 'media-1', role: 'hero', state: 'filled', asset_ref: 'media/media-1.jpg' }]) });
    const home = out.pages.find((p) => p.path === 'index.html');
    expect(home.html).toMatch(/<img class="hero-image" src="media\/media-1\.jpg"/);
    // Alt text must never be an IDENTIFIER. `role` used to supply it, which
    // shipped alt="media-1" on every image on every page: present, and therefore
    // invisible to an accessibility gate that only checks presence, but
    // meaningless to a screen reader.
    const alt = /<img class="hero-image"[^>]*alt="([^"]*)"/.exec(home.html)?.[1];
    expect(alt).toBeDefined();
    expect(alt).not.toMatch(/^media-\d+$/);
    expect(alt).not.toBe('hero');
  });

  it('renders NO image markup at all when every slot is unfilled', () => {
    const out = composeSite({ spec: baseSpec([{ id: 'media-1', role: 'hero', state: 'unfilled', asset_ref: null, fill_error: 'HTTP 429' }]) });
    const home = out.pages.find((p) => p.path === 'index.html');
    expect(home.html).not.toMatch(/<img/);
    // and the supporting copy still renders, so the page is whole without it
    expect(home.html).toMatch(/Skin care that explains itself/);
  });

  it('skips unfilled slots and uses the first FILLED one as the hero', () => {
    const out = composeSite({
      spec: baseSpec([
        { id: 'media-1', role: 'hero', state: 'unfilled', asset_ref: null },
        { id: 'media-2', role: 'treatment room', state: 'filled', asset_ref: 'media/media-2.jpg' },
      ]),
    });
    expect(out.pages[0].html).toMatch(/src="media\/media-2\.jpg"/);
  });

  it('composes normally for a spec with no media_slots field at all', () => {
    const spec = baseSpec(undefined);
    delete spec.media_slots;
    const out = composeSite({ spec });
    expect(out.pages[0].html).not.toMatch(/<img/);
  });
});

// REGRESSION: research-derived specs carry sections as plain STRINGS, so a
// section-scoped hero image never rendered on a real build even though the
// images were generated and on disk. The image is placed at page level.
describe('compose: hero image renders for string-sectioned specs too', () => {
  it('renders the image when sections are plain strings, as research produces them', () => {
    const spec = {
      brand: { name: 'Starlight Skin Bar' },
      seo_targets: { keywords: [], meta_direction: '' },
      media_slots: [{ id: 'media-1', role: 'hero', state: 'filled', asset_ref: 'media/media-1.jpg' }],
      pages: [{
        id: 'home', path: 'index.html', title: 'Starlight', heading: 'Starlight',
        sections: ['Hero: name, one-line positioning, city, primary Book CTA', 'Services overview'],
      }],
    };
    const out = composeSite({ spec });
    expect(out.pages[0].html).toMatch(/<img class="hero-image" src="media\/media-1\.jpg"/);
  });
});

describe('generated imagery is consumed, not stockpiled', () => {
  it('places slots beyond the hero into sections instead of rendering one image everywhere', async () => {
    const { composeSite } = await import('../server/kernel/compose.js');
    const slots = Array.from({ length: 5 }, (_, i) => ({ id: `m${i}`, role: `role-${i}`, state: 'filled', asset_ref: `media/m${i}.jpg` }));
    const sections = ['a', 'b', 'c'].map((id) => ({ id, type: 'text', heading: id.toUpperCase(), body: 'copy' }));
    const spec = { business: { name: 'X' }, media_slots: slots, pages: [{ id: 'home', path: 'index.html', title: 'X', heading: 'X', sections }] };
    const html = (composeSite({ spec }).pages || []).map((p) => p.contents ?? p.html ?? '').join('');
    const distinct = new Set((html.match(/src="media\/[^"]+"/g) || []));
    // hero + one per section. Previously this was 1, and the same photograph
    // appeared on every page while the other four were paid for and discarded.
    expect(distinct.size).toBe(4);
  });

  it('renders nothing for an unfilled slot — no placeholder, no grey box', async () => {
    const { composeSite } = await import('../server/kernel/compose.js');
    const spec = { business: { name: 'X' },
      media_slots: [{ id: 'm0', state: 'unfilled', fill_error: 'generator returned 429' }],
      pages: [{ id: 'home', path: 'index.html', title: 'X', heading: 'X', sections: [{ id: 'a', type: 'text', heading: 'A', body: 'copy' }] }] };
    const html = (composeSite({ spec }).pages || []).map((p) => p.contents ?? p.html ?? '').join('');
    expect(html).not.toContain('<img');
  });

  it('renders nothing for a commissioned slot — it is waiting on a human, not missing', async () => {
    const { composeSite } = await import('../server/kernel/compose.js');
    const spec = { business: { name: 'X' },
      media_slots: [{ id: 'mascot', state: 'commissioned', note: 'held for commissioned work' }],
      pages: [{ id: 'home', path: 'index.html', title: 'X', heading: 'X', sections: [{ id: 'a', type: 'text', heading: 'A', body: 'copy' }] }] };
    const html = (composeSite({ spec }).pages || []).map((p) => p.contents ?? p.html ?? '').join('');
    expect(html).not.toContain('<img');
  });
});

// Ruling 2 (2026-08-26): a slot must serve a SECTION. Positional distribution
// put slot 3 in section 3 with no relationship between them, which is what put a
// face on a credential section and papers on the floor at the close.
describe('media slots render into the section they were bound to', () => {
  it('places a bound slot in its own section, not by position', () => {
    const spec = {
      brand: { name: 'Acme' },
      tokens: { bg: '#fff', fg: '#111', accent: '#2563eb', muted: '#555' },
      media_slots: [
        { id: 'm-a', role: 'a', state: 'filled', asset_ref: 'media/a.jpg', section_id: 'third', page_id: 'home', intent: 'proof' },
      ],
      pages: [{
        id: 'home', path: 'index.html', title: 'Acme', heading: 'Acme',
        sections: [
          { id: 'first', type: 'text', heading: 'First', body: 'One.' },
          { id: 'second', type: 'text', heading: 'Second', body: 'Two.' },
          { id: 'third', type: 'text', heading: 'Third', body: 'Three.' },
        ],
      }],
    };
    const home = composeSite({ spec }).pages.find((p) => p.path === 'index.html');
    // The image belongs to "third" and must appear after that heading, not the first.
    const idxThird = home.html.indexOf('Third');
    const idxImg = home.html.indexOf('media/a.jpg');
    expect(idxImg).toBeGreaterThan(idxThird);
  });

  // A spec built before slots carried section_id has only unbound slots.
  // Dropping them would silently remove every image from every site on disk.
  it('still distributes unbound slots positionally, so older specs keep their images', () => {
    const spec = {
      brand: { name: 'Acme' },
      tokens: { bg: '#fff', fg: '#111', accent: '#2563eb', muted: '#555' },
      media_slots: [
        { id: 'm1', role: 'media-1', state: 'filled', asset_ref: 'media/1.jpg' },
        { id: 'm2', role: 'media-2', state: 'filled', asset_ref: 'media/2.jpg' },
      ],
      pages: [{
        id: 'home', path: 'index.html', title: 'Acme', heading: 'Acme',
        sections: [{ id: 'a', type: 'text', heading: 'A', body: 'One.' }, { id: 'b', type: 'text', heading: 'B', body: 'Two.' }],
      }],
    };
    const home = composeSite({ spec }).pages.find((p) => p.path === 'index.html');
    expect(home.html).toContain('media/1.jpg');
    expect(home.html).toContain('media/2.jpg');
  });

  // meta_direction is an instruction to a writer. It shipped as the meta
  // description of live pages.
  it('never publishes an SEO direction as the meta description', () => {
    const spec = {
      brand: { name: 'Acme', description: 'A real description.' },
      tokens: { bg: '#fff', fg: '#111', accent: '#2563eb', muted: '#555' },
      seo_targets: { keywords: [], meta_direction: 'Lead every title with the city, not the brand name' },
      media_slots: [],
      pages: [{ id: 'home', path: 'index.html', title: 'Acme', heading: 'Acme', sections: [] }],
    };
    const home = composeSite({ spec }).pages.find((p) => p.path === 'index.html');
    expect(home.html).not.toContain('Lead every title');
    expect(home.html).toContain('A real description.');
  });
});
