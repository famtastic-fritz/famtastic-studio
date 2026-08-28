// The importer's pure core: real HTML in, a typed section list and honest
// gaps out. No filesystem here -- see tests/kernel-importer-live.test.js for
// the orchestration layer against actual portfolio directories.
import { describe, it, expect } from 'vitest';
import { extractPageStructure } from '../server/kernel/importer.js';
import { extractTokensFromCss } from '../server/kernel/importer-tokens.js';

const REAL_PAGE = `<!doctype html>
<html><head>
<title>Starlight Skin Bar &mdash; Home</title>
<meta name="description" content="Licensed esthetician, private suite, results-driven facials.">
</head><body>
<h1>Quiet luxury for your skin.</h1>
<p>Suite 6, licensed esthetician, results-driven facials in a private studio.</p>
<img src="hero.jpg" alt="Treatment room">
<h2>Signature services</h2>
<p>Custom facials, peels, and dermaplaning for real skin concerns.</p>
<img src="services.jpg" alt="Facial treatment">
<h2>First visit</h2>
<p>What to expect at your first appointment, and how to find Studio 6.</p>
<a href="/book">Book a consultation</a>
<nav><a href="/about">About</a> <a href="/contact">Contact</a></nav>
</body></html>`;

describe('extractPageStructure: real HTML in, typed sections out', () => {
  it('reads the title and meta description', () => {
    const r = extractPageStructure(REAL_PAGE, { pagePath: 'index.html' });
    expect(r.title).toBe('Starlight Skin Bar — Home');
    expect(r.meta_description).toMatch(/Licensed esthetician/);
  });

  it('promotes the first h1 to a hero section, decoded and trimmed', () => {
    const r = extractPageStructure(REAL_PAGE);
    expect(r.sections[0].type).toBe('hero');
    expect(r.sections[0].body).toBe('Suite 6, licensed esthetician, results-driven facials in a private studio.');
  });

  it('starts a new section at every subsequent heading', () => {
    const r = extractPageStructure(REAL_PAGE);
    const ids = r.sections.map((s) => s.id);
    expect(ids).toEqual(['hero', 'signature-services', 'first-visit']);
    expect(r.sections[1].heading).toBe('Signature services');
    expect(r.sections[1].body).toMatch(/Custom facials/);
  });

  // A composer that can see an instruction can publish it. An imported
  // section's copy is the real ground truth, not a note -- there is nothing
  // to write, so instruction must stay null or the copy stage's own
  // machinery would have something to echo against.
  it('never writes an instruction for imported content -- there is nothing to write', () => {
    const r = extractPageStructure(REAL_PAGE);
    for (const s of r.sections) expect(s.instruction).toBeNull();
  });

  it('extracts a short, verb-led link as a CTA rather than body copy', () => {
    const r = extractPageStructure(REAL_PAGE);
    expect(r.ctas).toEqual([{ label: 'Book a consultation', href: '/book' }]);
    // And it must not ALSO appear duplicated inside a section's body.
    for (const s of r.sections) expect(s.body || '').not.toContain('Book a consultation');
  });

  it('does not treat ordinary nav links as CTAs or body copy', () => {
    const r = extractPageStructure(REAL_PAGE);
    const allBody = r.sections.map((s) => s.body).join(' ');
    expect(allBody).not.toContain('About');
    expect(r.ctas.find((c) => c.label === 'About')).toBeUndefined();
  });

  it('associates a nearby image with its section by document order', () => {
    const r = extractPageStructure(REAL_PAGE);
    expect(r.sections[0].image).toEqual({ src: 'hero.jpg', alt: 'Treatment room' });
    expect(r.sections[1].image).toEqual({ src: 'services.jpg', alt: 'Facial treatment' });
  });

  it('reports what it could not determine rather than staying silent', () => {
    const noMeta = '<html><body><h1>Just a headline</h1></body></html>';
    const r = extractPageStructure(noMeta, { pagePath: 'about.html' });
    expect(r.could_not_determine.some((s) => /meta description/.test(s))).toBe(true);
  });

  it('handles a page with no headings or body text honestly, not as a crash', () => {
    const r = extractPageStructure('<html><body><img src="a.jpg" alt="x"></body></html>', { pagePath: 'gallery.html' });
    expect(r.sections).toEqual([]);
    expect(r.could_not_determine.some((s) => /no heading or body text/.test(s))).toBe(true);
  });

  it('keeps body text that appears before any heading, and says so', () => {
    const r = extractPageStructure('<html><body><p>Welcome in.</p><h2>Services</h2><p>What we do.</p></body></html>');
    expect(r.sections[0].body).toBe('Welcome in.');
    expect(r.could_not_determine.some((s) => /before any heading/.test(s))).toBe(true);
  });

  it('decodes HTML entities in body copy', () => {
    const r = extractPageStructure('<html><body><h1>Title</h1><p>Rock &amp; roll &mdash; est. 1996</p></body></html>');
    expect(r.sections[0].body).toContain('Rock & roll');
  });
});

describe('extractTokensFromCss: real CSS in, detected tokens out', () => {
  const CSS = `
    body { background-color: #f4f1ec; color: #1a1c1e; }
    .cta { background: #e2601f; }
    a { color: #e2601f; }
    .card { background-color: #f4f1ec; }
    p { color: #1a1c1e; }
  `;

  it('picks the most-used background and text colours by frequency', () => {
    const r = extractTokensFromCss(CSS);
    expect(r.tokens.bg.toLowerCase()).toBe('#f4f1ec');
    expect(r.tokens.fg.toLowerCase()).toBe('#1a1c1e');
    expect(r.source).toBe('detected_from_css');
  });

  it('picks a saturated colour as accent over a near-gray one', () => {
    const r = extractTokensFromCss(CSS);
    expect(r.tokens.accent.toLowerCase()).toBe('#e2601f');
  });

  it('reports zero samples and no tokens for empty CSS rather than defaulting silently', () => {
    const r = extractTokensFromCss('');
    expect(r.tokens).toBeNull();
    expect(r.sample_count).toBe(0);
    expect(r.could_not_determine.length).toBeGreaterThan(0);
  });

  it('reports what it could not determine when only one role is found', () => {
    const r = extractTokensFromCss('body { color: #111; }');
    expect(r.could_not_determine.some((s) => /background-color/.test(s))).toBe(true);
  });

  // REGRESSION, found running the importer against a real site: a page whose
  // actual background comes from a gradient (deliberately not parsed as "just
  // a colour") left plain background-color declarations dominated by an
  // incidental fallback -- white -- and the most-used text colour on the same
  // page was ALSO white, for text meant to sit on that gradient. Frequency
  // alone shipped white-on-white as a "detected" token pair.
  it('rejects a detected pair that fails the contrast floor instead of shipping it', () => {
    const css = `
      .hero { color: #ffffff; }
      .footer-fine-print { color: #ffffff; }
      .card { background-color: #ffffff; }
      .panel { background-color: #ffffff; }
    `;
    const r = extractTokensFromCss(css);
    expect(r.tokens).toBeNull();
    expect(r.source).toBe('rejected_low_contrast');
    expect(r.could_not_determine.some((s) => /fail the .*floor/.test(s))).toBe(true);
  });

  // Property semantics decide the role, never a luminance guess afterward: a
  // dark-mode site's dark background-color and light color declarations are
  // already correct as read, with no swap needed.
  it('reads an ordinary dark-mode page correctly: dark bg, light fg, no swap', () => {
    const darkCss = 'body { background-color: #111111; } p { color: #f5f5f5; }';
    const r = extractTokensFromCss(darkCss);
    expect(r.tokens.bg.toLowerCase()).toBe('#111111');
    expect(r.tokens.fg.toLowerCase()).toBe('#f5f5f5');
  });
});
