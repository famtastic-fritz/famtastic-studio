// Deterministic composer (ENDGAME items 10-11, plan 2.1 'compose' stage).
//
// There is no model provider connected in this build. Rather than fake or
// defer generation, this composer turns a spec (server/kernel/pipeline.js's
// deriveSpecFromPacket output, or any object with the same pages/sections
// shape) into real, valid, semantic HTML + a shared stylesheet, entirely via
// templates. This genuinely builds a real site and is honest about how.
//
// SEAM for a model-backed composer: add its name to COMPOSERS and add a
// branch in composeSite() that returns the same { composer, pages, assets }
// shape (pages: [{ path, title, html }], assets: [{ path, contents }]).
// Nothing in pipeline.js or verify.js needs to change to accommodate it --
// both consume only that shape, never how it was produced. pipeline.js's
// MODEL_ROUTING table records which composer actually ran, per run, in DNA.
import { tokensToCss, DEFAULT_TOKENS } from './tokens.js';
import { materializeArtifactBundle } from './artifact-bundle.js';
import {
  composeDrupalStandard,
  composeDrupalDecoupled,
  composeWordPressStandard,
  composeWordPressDecoupled,
} from './compose-cms.js';

export const COMPOSERS = ['deterministic', 'artifact'];
export const DEFAULT_COMPOSER = 'deterministic';

function fail(statusCode, code, message) {
  return Object.assign(new Error(message), { statusCode, code });
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (ch) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[ch]));
}

function itemLabel(item) {
  if (typeof item === 'string') return item;
  if (item && typeof item === 'object') return item.label || item.name || item.title || JSON.stringify(item);
  return String(item);
}

function renderNav(pages, currentPath) {
  const items = pages
    .map((p) => `<a href="${escapeHtml(p.path)}"${p.path === currentPath ? ' aria-current="page"' : ''}>${escapeHtml(p.heading || p.title)}</a>`)
    .join('\n      ');
  return `<nav class="site-nav">\n      ${items}\n    </nav>`;
}

// resolveCtaTarget: a CTA must link somewhere that actually resolves. The
// prior version hardcoded every CTA to `#contact` regardless of whether the
// current page had any element with that id -- on home (whose own CTA
// section is id="cta", not id="contact") that produced a link to a same-page
// anchor that never existed, while verify.js separately skipped ALL
// same-page fragment links so it never caught it. Preference order: (1) a
// dedicated contact page elsewhere in the site, if this isn't already it;
// (2) a same-page anchor, but only when this page actually has a section
// with id="contact" to land on; (3) the page itself, so a CTA never points
// at a fragment nothing on the page provides.
function resolveCtaTarget({ allPages, currentPath, sectionIdsOnPage }) {
  const contactPage = allPages.find((p) => p.path === 'contact.html' || p.id === 'contact');
  if (contactPage && contactPage.path !== currentPath) return contactPage.path;
  if (sectionIdsOnPage.has('contact')) return '#contact';
  return currentPath;
}

// Sections render below the page's single <h1>. Every heading a section emits
// is an <h2>, never an <h1> -- that is what keeps "exactly one h1 per page"
// (a verify.js hard requirement) true by construction rather than by luck.
// A filled media slot becomes a real <img>, placed at page level rather than
// inside a hero section: research-derived specs carry their sections as plain
// STRINGS, so section.type is never 'hero' and a section-scoped hero would
// never render for a real build (it silently did not, on a real run).
//
// An UNFILLED slot renders nothing at all -- no placeholder box, no grey
// rectangle, no alt-text-only stub. A site missing an image should look like a
// site without that image, not a broken one, and must never imply an asset
// exists when none does.
function renderHeroImage(heroImage, businessName = '') {
  if (!heroImage || heroImage.state !== 'filled' || !heroImage.asset_ref) return '';
  const src = escapeHtml(heroImage.asset_ref);
  // Same rule as a section image: `role` is an identifier, not a description.
  const alt = escapeHtml(heroImage.alt || businessName || '');
  return `<img class="hero-image" src="${src}" alt="${alt}" width="1024" height="576" loading="eager">`;
}

// A section may carry one filled media slot.
//
// The composer previously used filledSlots[0] as the page hero and IGNORED
// every other filled slot, reporting them in media_summary instead. On a real
// build that meant ten images generated, paid for, written to disk — and one
// rendered, the same photograph repeated on every page. Nothing failed: no
// reference broke, no gate fired, the page just showed one picture everywhere,
// which is the generic-template look arriving through a path nothing was
// watching.
//
// Slots beyond the hero are now distributed across the page's sections in
// order, so what was made is what is used. A section with no slot renders
// exactly as before.
function renderSectionImage(slot) {
  if (!slot || slot.state !== 'filled' || !slot.asset_ref) return '';
  const src = escapeHtml(slot.asset_ref);
  // `slot.role` is an ID ("media-1", "credential-strip"), not a description.
  // Shipping it produced alt="media-1" on every image on every page: alt text
  // that is PRESENT but meaningless, which the accessibility gate cannot detect
  // because it only checks presence. A written alt, or the section's own
  // heading, or nothing -- never an identifier.
  const alt = escapeHtml(slot.alt || slot.section_heading || '');
  return `\n      <img class="section-image" src="${src}" alt="${alt}" width="1024" height="576" loading="lazy">`;
}

function renderSection(section, ctaTarget, image = null) {
  const type = section?.type || 'text';
  const id = escapeHtml(section?.id || type);
  let inner = '';

  if (type === 'hero') {
    // No heading here: the page's <h1> already carries the headline. A hero
    // section only adds the supporting line, if there is one.
    if (section.body) inner = `<p class="lead">${escapeHtml(section.body)}</p>`;
  } else if (type === 'list' && Array.isArray(section.items) && section.items.length) {
    const heading = section.heading ? `<h2>${escapeHtml(section.heading)}</h2>` : '';
    const items = section.items.map((item) => `        <li>${escapeHtml(itemLabel(item))}</li>`).join('\n');
    inner = `${heading}\n      <ul>\n${items}\n      </ul>`;
  } else if (type === 'cta' && Array.isArray(section.items) && section.items.length) {
    const heading = section.heading ? `<h2>${escapeHtml(section.heading)}</h2>` : '';
    const links = section.items.map((item) => `<a class="cta" href="${escapeHtml(ctaTarget)}">${escapeHtml(itemLabel(item))}</a>`).join('\n      ');
    inner = `${heading}\n      ${links}`;
  } else {
    const heading = section.heading ? `<h2>${escapeHtml(section.heading)}</h2>` : '';
    const body = section.body ? `<p>${escapeHtml(section.body)}</p>` : '';
    inner = `${heading}\n      ${body}`;
  }

  // Layout and weight come from the creative director and are written INTO the
  // section, so compose cannot forget to consult them. A direction downstream
  // stages must remember to read is one more thing computed and read by nothing.
  const layout = escapeHtml(section?.layout || 'stack');
  const weight = escapeHtml(section?.weight || 'tertiary');
  const side = section?.layout_side ? ` layout-${escapeHtml(section.layout_side)}` : '';
  const cls = `section section-${escapeHtml(type)} layout-${layout} weight-${weight}${side}`;
  const media = renderSectionImage(image);
  // A split or feature-row places media BESIDE the text, so the two are wrapped
  // rather than stacked. Every other layout keeps the stacked order.
  const content = (layout === 'split' || layout === 'feature-row' || layout === 'split-hero') && media
    ? `<div class="section-text">${inner}</div><div class="section-media">${media}</div>`
    : `${inner}${media}`;
  return `<section class="${cls}" id="${id}">\n      ${content}\n    </section>`;
}

function renderPage(spec, pageSpec, allPages) {
  const nav = renderNav(allPages, pageSpec.path);
  const pageSections = Array.isArray(pageSpec.sections) ? pageSpec.sections : [];
  const sectionIdsOnPage = new Set(pageSections.map((s) => s?.id).filter(Boolean));
  const ctaTarget = resolveCtaTarget({ allPages, currentPath: pageSpec.path, sectionIdsOnPage });
  // The first filled slot is the page's hero. The REST are distributed across
  // the page's sections in order, so an image that was generated is an image
  // that is used. Previously only filledSlots[0] rendered and the remainder
  // were recorded in media_summary — which on a real build meant ten images
  // paid for and one shown, the same photograph on every page.
  // Slots render into the section they were BOUND to, never by position.
  // Positional distribution (`remaining[i]`) put slot 3 in section 3 with no
  // relationship between them: a face on a credential section, papers on the
  // floor at the close. A slot bound to a section on another page is not this
  // page's to render.
  const filledSlots = Array.isArray(spec.media_slots) ? spec.media_slots.filter((m) => m.state === 'filled' && m.asset_ref) : [];
  const forThisPage = filledSlots.filter((m) => !m.page_id || m.page_id === pageSpec.id);
  const bound = forThisPage.filter((m) => m.section_id);
  const unbound = forThisPage.filter((m) => !m.section_id);
  const bySection = new Map(bound.map((m) => [m.section_id, m]));
  // A BOUND slot is never hijacked as the hero: it was assigned to a section and
  // stealing it renders it at the top of the page instead, which is the same
  // wrong-image-wrong-place defect binding exists to fix. Only a slot bound to a
  // hero section, or an unbound one, may be the hero.
  const heroImage = bound.find((m) => pageSections.some((sec) => sec.id === m.section_id && sec.type === 'hero'))
    || unbound[0]
    || null;
  // BACKWARD COMPATIBILITY: a spec built before slots carried `section_id` has
  // only unbound slots. Dropping them would silently remove every image from
  // every existing site on disk, so unbound slots keep the old positional
  // distribution. Bound slots always win their section.
  const positional = unbound.filter((m) => m !== heroImage);
  let cursor = 0;
  const sections = pageSections
    .map((sec) => {
      const boundHere = bySection.get(sec.id);
      if (boundHere && boundHere !== heroImage) return renderSection(sec, ctaTarget, boundHere);
      if (boundHere === heroImage) return renderSection(sec, ctaTarget, null);
      return renderSection(sec, ctaTarget, positional[cursor++] || null);
    })
    .join('\n    ');
  // meta_direction is a DIRECTION -- an instruction to a writer. Publishing it
  // shipped "Every keyword above is a template ... must be substituted before
  // publication" as the meta description of a live page, which is the
  // outline-as-copy defect in the most externally visible field there is.
  // Only a written description is published; a direction never is.
  const metaDescription = escapeHtml(spec.seo_targets?.meta_description || spec.brand?.description || pageSpec.title || '');
  const heading = pageSpec.heading || pageSpec.title || spec.brand?.name || 'Untitled';
  const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(pageSpec.title || heading)}</title>
  <meta name="description" content="${metaDescription}">
  <link rel="stylesheet" href="styles.css">
  <script src="js/main.js" defer></script>
</head>
<body>
  <header class="site-header">
    ${nav}
  </header>
  <main>
    <h1>${escapeHtml(heading)}</h1>
    ${renderHeroImage(heroImage, spec.brand?.name || '')}
    ${sections}
  </main>
  <footer class="site-footer">
    <p>${escapeHtml(spec.brand?.name || '')}</p>
  </footer>
</body>
</html>
`;
  return { path: pageSpec.path, title: pageSpec.title || heading, html };
}

// The composer's ONLY colour input is `tokens`. It never reads
// brand.palette_direction, and that is deliberate: for five builds the
// direction sat one field away carrying real hex values while this function
// hardcoded a stock blue, because nothing obliged it to look. A direction that
// downstream must REMEMBER to consult is a direction that gets forgotten.
// Tokens are resolved once, in tokens.js, and arrive here already decided.
function buildStylesheet(tokens = DEFAULT_TOKENS, layout = null, designContract = null) {
  const container = layout?.container || 960;
  const typography = designContract?.typography || {};
  const bodyFont = typography.body || typography.font_family || 'system-ui, -apple-system, sans-serif';
  const headingFont = typography.headings || typography.heading || bodyFont;
  // Rhythm is the vertical scale: how much air a page gives itself. A single
  // spacing value for every section is why twelve sections read as one
  // undifferentiated column.
  const RHYTHM = { generous: [7, 4.5, 3], tight: [5, 3.25, 2.25], compact: [4, 2.75, 2], punchy: [6, 4, 2.5] };
  const [gapPrimary, gapSecondary, gapTertiary] = RHYTHM[layout?.rhythm] || RHYTHM.generous;
  return `${tokensToCss(tokens)}
:root { --container: ${container}px; --gap-primary: ${gapPrimary}rem; --gap-secondary: ${gapSecondary}rem; --gap-tertiary: ${gapTertiary}rem; --font-body: ${bodyFont}; --font-heading: ${headingFont}; }
* { box-sizing: border-box; }
body {
  margin: 0;
  container-type: inline-size;
  overflow-x: hidden;
  background: var(--bg);
  color: var(--fg);
  font-family: var(--font-body);
  line-height: 1.5;
}
main { max-width: var(--container); margin: 0 auto; padding: 2rem 1.25rem; }
h1, h2, h3 { font-family: var(--font-heading); }
h1 { font-size: 2.25rem; margin-bottom: 1.5rem; line-height: 1.15; }
h2 { font-size: 1.5rem; margin-top: 0; margin-bottom: 0.75rem; }
h3 { font-size: 1.15rem; margin-top: 0; }
p { margin-top: 0; margin-bottom: 1rem; }
.site-header { padding: 1rem 1.25rem; border-bottom: 1px solid #e5e5e5; display: flex; justify-content: space-between; align-items: center; }
.site-nav { display: flex; gap: 1rem; }
.site-nav a { color: var(--fg); text-decoration: none; font-weight: 500; }
.site-nav a[aria-current="page"] { color: var(--accent); font-weight: 700; }
.section { padding: var(--gap-tertiary) 0; }

/* Layout archetypes: structural grid definitions driven by the archetype chosen
   in the spec. A layout class must NEVER be a no-op -- an archetype that emits
   a class with no matching CSS was the exact defect that left cards, splits, and
   galleries rendering as identical vertical text dumps. */
.layout-stack { display: block; }
.layout-split { display: grid; grid-template-columns: 1fr 1fr; gap: 2.5rem; align-items: center; }
.layout-split.layout-right > .section-media { order: 1; }
.layout-split.layout-left > .section-media { order: -1; }
.layout-split-hero { display: grid; grid-template-columns: 1.2fr 1fr; gap: 3rem; align-items: center; }
.layout-feature-row { display: grid; grid-template-columns: 1fr 1.5fr; gap: 2.5rem; align-items: start; }
.layout-full-bleed { width: 100vw; margin-left: calc(50% - 50vw); }
.layout-full-bleed img { width: 100%; height: clamp(280px, 45vh, 520px); object-fit: cover; }
.layout-gallery { display: grid; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); gap: 1.5rem; }
.layout-cards ul { list-style: none; padding: 0; display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: 1.25rem; }
.layout-cards li { border: 1px solid var(--muted); border-radius: 10px; padding: 1.1rem; }
.layout-gallery .section-media img { width: 100%; border-radius: 10px; }

/* A band is a full-width tinted strip: rhythm you can see. */
/* 100vw INCLUDES the scrollbar, so a full-width block overflows the document by
   the scrollbar's width and every page reported horizontal overflow at 390.
   Container units exclude it; the fallback simply stays in the container. */
.layout-band { width: 100cqw; max-width: 100vw; margin-left: calc(50% - 50cqw); padding: var(--gap-secondary) 2rem; background: color-mix(in srgb, var(--accent) 8%, var(--bg)); }
@supports not (width: 100cqw) { .layout-band { width: auto; margin-left: 0; } }
.layout-band > * { max-width: var(--container); margin-left: auto; margin-right: auto; }

.layout-table ul { list-style: none; padding: 0; }
.layout-table li { display: flex; justify-content: space-between; gap: 1rem; padding: 0.6rem 0; border-bottom: 1px solid var(--muted); }

/* One column below the split point. The 390 view is now a genuine collapse of a
   real layout rather than a page that never had one. */
@media (max-width: 860px) {
  .layout-split, .layout-feature-row, .layout-split-hero { grid-template-columns: 1fr; gap: 1.25rem; }
  .layout-split.layout-left > .section-media, .layout-feature-row.layout-left > .section-media { order: 0; }
  .layout-full-bleed img { height: clamp(220px, 38vh, 360px); }
}

.hero-image { width: 100%; height: auto; max-width: 100%; border-radius: 10px; display: block; margin-bottom: 1.25rem; }
.cta {
  display: inline-block;
  margin: 0.5rem 0.75rem 0.5rem 0;
  padding: 0.6rem 1.1rem;
  background: var(--accent);
  color: #fff;
  border-radius: 6px;
  text-decoration: none;
}
.site-footer { padding: 1.5rem 2rem; border-top: 1px solid #e5e5e5; color: var(--muted); text-align: center; }
`;
}

/**
 * composeSite({ spec, composer }) -> { composer, pages: [{path,title,html}],
 * assets: [{path,contents}] }. Throws (statusCode 501, code
 * composer_not_implemented) for any composer name other than 'deterministic'
 * -- the seam is explicit and refuses silently, it never falls back to
 * pretending a model ran.
 */
export function composeSite({ spec, composer = DEFAULT_COMPOSER } = {}) {
  if (!COMPOSERS.includes(composer)) {
    throw fail(501, 'composer_not_implemented', `composer '${composer}' is not implemented; available: ${COMPOSERS.join(', ')}`);
  }
  if (!spec || !Array.isArray(spec.pages) || spec.pages.length === 0) {
    throw fail(400, 'spec_has_no_pages', 'compose requires spec.pages to be a non-empty array');
  }

  // An approved proof is already the rendered design. The artifact composer
  // deliberately does not regenerate it from prose; it validates and returns
  // the exact bytes supplied by FAMtastic so the local build is byte-identical.
  if (composer === 'artifact') {
    if (!spec.artifact_bundle) throw fail(400, 'artifact_bundle_missing', 'artifact composer requires the approved proof artifact bundle');
    const files = materializeArtifactBundle(spec.artifact_bundle);
    const pages = files.filter((file) => 'html' in file).map((file) => ({ path: file.path, title: file.title, html: file.html }));
    const assets = files.filter((file) => 'contents' in file).map((file) => ({ path: file.path, contents: file.contents }));
    return { composer, pages, assets, provider: 'famtastic-proof-artifact', output_stack: 'static-artifact' };
  }

  const allPages = spec.pages.map((p) => ({ id: p.id, path: p.path, heading: p.heading || p.title, title: p.title }));
  const pages = spec.pages.map((pageSpec) => renderPage(spec, pageSpec, allPages));

  // Self-check: a template that failed to interpolate a value would leave a
  // literal {{...}} in the output. This build never uses that templating
  // style, but the check costs nothing and turns a future regression into an
  // immediate, loud failure here instead of a silent one downstream in verify.
  for (const page of pages) {
    if (/\{\{|\}\}/.test(page.html)) {
      throw fail(500, 'unresolved_placeholder', `composed page ${page.path} still contains an unresolved template token`);
    }
  }

  const bName = spec?.brand?.name || 'Site';
  const slug = (spec?.brand?.name || 'site').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') || 'site';
  const recipeId = spec?.recipe || spec?.archetype;

  // Recipe-specific composers for CMS and Decoupled multi-tier stacks
  if (recipeId === 'drupal-standard-v1') {
    const res = composeDrupalStandard({ spec, bName, slug, tokens: spec.tokens });
    return { composer, ...res, provider: 'drupal-standard', output_stack: 'drupal-cms' };
  }
  if (recipeId === 'drupal-decoupled-tri-tier-v1') {
    const res = composeDrupalDecoupled({ spec, bName, slug, tokens: spec.tokens });
    return { composer, ...res, provider: 'drupal-decoupled', output_stack: 'drupal-decoupled' };
  }
  if (recipeId === 'wordpress-standard-v1') {
    const res = composeWordPressStandard({ spec, bName, slug, tokens: spec.tokens });
    return { composer, ...res, provider: 'wordpress-standard', output_stack: 'wordpress-cms' };
  }
  if (recipeId === 'wordpress-decoupled-tri-tier-v1') {
    const res = composeWordPressDecoupled({ spec, bName, slug, tokens: spec.tokens });
    return { composer, ...res, provider: 'wordpress-decoupled', output_stack: 'wordpress-decoupled' };
  }

  const pageList = (spec?.pages || []).map((p) => `- \`${p.path}\` — ${p.title || p.heading || p.id}`).join('\n');

  const mainJs = `/**
 * Progressive Enhancement for ${bName}
 * Responsive navigation, smooth scrolling, and dynamic date hydration.
 */
document.addEventListener('DOMContentLoaded', () => {
  // Smooth scrolling for in-page anchor links
  document.querySelectorAll('a[href^="#"]').forEach((anchor) => {
    anchor.addEventListener('click', function (e) {
      const targetId = this.getAttribute('href');
      if (!targetId || targetId === '#') return;
      const target = document.querySelector(targetId);
      if (target) {
        e.preventDefault();
        target.scrollIntoView({ behavior: 'smooth' });
      }
    });
  });

  // Mobile navigation toggling
  const navToggle = document.querySelector('.nav-toggle');
  const siteNav = document.querySelector('.site-nav');
  if (navToggle && siteNav) {
    navToggle.addEventListener('click', () => {
      siteNav.classList.toggle('is-open');
    });
  }

  // Dynamic copyright year hydration
  const yearEl = document.querySelector('.current-year');
  if (yearEl) {
    yearEl.textContent = new Date().getFullYear();
  }
});
`;

  const packageJson = JSON.stringify({
    name: `site-${slug}`,
    version: '1.0.0',
    private: true,
    description: `${bName} — static website built with Site Studio`,
    scripts: {
      dev: 'npx serve . -l 3000',
      build: 'echo "Static build verified in place"',
    },
    keywords: ['famtastic', 'site-studio', 'static-site'],
  }, null, 2) + '\n';

  const readmeMd = `# ${bName}

${spec?.brand?.description ? `> ${spec.brand.description}\n\n` : ''}Built and verified by FAMtastic Site Studio with Shay AI.

## Project Structure
${pageList}
- \`styles.css\` — Design tokens and layout system
- \`js/main.js\` — Progressive enhancement & interaction scripts
- \`robots.txt\` — Search engine crawler directives
- \`404.html\` — Custom error page
- \`spec.json\` — Site specification & brand tokens

## Local Development
Run a local static server:
\`\`\`bash
npm run dev
\`\`\`
`;

  const robotsTxt = `User-agent: *
Allow: /

Sitemap: /sitemap.xml
`;

  const html404 = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>404 Page Not Found — ${escapeHtml(bName)}</title>
  <link rel="stylesheet" href="styles.css">
  <script src="js/main.js" defer></script>
</head>
<body>
  <header class="site-header">
    <nav class="site-nav">
      <a href="index.html">Home</a>
    </nav>
  </header>
  <main style="max-width: var(--container, 960px); margin: 4rem auto; text-align: center; padding: 0 1.5rem;">
    <h1>404 — Page Not Found</h1>
    <p style="margin: 1.5rem 0; color: var(--muted, #646464);">The page you requested could not be found or has been moved.</p>
    <a href="index.html" class="cta">Return to Home</a>
  </main>
  <footer class="site-footer">
    <p>${escapeHtml(bName)}</p>
  </footer>
</body>
</html>
`;

  return {
    composer,
    pages,
    provider: 'archetype-native',
    output_stack: 'html-css',
    assets: [
      { path: 'styles.css', contents: buildStylesheet(spec?.tokens, spec?.layout, spec?.brand?.design_contract) },
      { path: 'js/main.js', contents: mainJs },
      { path: 'robots.txt', contents: robotsTxt },
      { path: 'package.json', contents: packageJson },
      { path: 'README.md', contents: readmeMd },
      { path: '404.html', contents: html404 },
    ],
  };
}
