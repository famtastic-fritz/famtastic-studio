/**
 * The HTML importer: derive a spec from a site that already exists on disk.
 *
 * WHY THIS EXISTS
 *
 * The console only ever worked on sites Studio itself generated, because
 * nothing could turn an operator's real HTML into the structured record every
 * other screen reads (spec.pages[].sections[]). Every real site therefore had
 * no spec, and every screen resolved nothing and rendered honestly empty.
 * This closes that gap the same way the rest of the pipeline is honest: parse
 * what is actually there, never ask the operator to write JSON, and say
 * plainly what could not be determined rather than guessing.
 *
 * WHAT IT REUSES, DELIBERATELY, RATHER THAN REBUILDING
 *
 * - `parseLeaves()` from canvas.js: the exact tokenizer and selector scheme
 *   click-to-edit already uses. An imported page's sections carry the SAME
 *   selectors the canvas would compute re-parsing the same bytes later, so an
 *   imported page is canvas-editable with no translation step.
 * - `parseCssColor()` / `relativeLuminance()` from css-color.mjs: the same
 *   34-test colour parser the contrast lane runs, so a detected token is
 *   read by the identical code that already handles every real CSS colour
 *   syntax rather than a second, untested one.
 * - `attachBackend()` from spec-derive.js: MBSH's PHP backend is carried,
 *   never parsed, exactly as already ruled for any application-class site
 *   Studio did not generate.
 *
 * A PARTIAL PARSE IS A RESULT, NOT A FAILURE
 *
 * Every extractor records what it could not determine instead of silently
 * omitting it or inventing a plausible answer. That list travels with the
 * spec (`generated_from.could_not_determine`) so the operator -- or a later
 * screen -- can see exactly where Studio's understanding of a real page is
 * thin.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { parseLeaves, decodeEntities } from './canvas.js';
import { parseCssColor, relativeLuminance } from './css-color.mjs';
import { attachBackend } from './spec-derive.js';
import { discoverPages } from './thumbnails.js';
import { slugify, titleCase } from './pipeline-text.js';

function fail(statusCode, code, message) {
  return Object.assign(new Error(message), { statusCode, code });
}

const HEADING_TAGS = new Set(['h1', 'h2', 'h3', 'h4', 'h5', 'h6']);
// Text leaves worth reading as body copy. 'a' is included because a real page
// often has its actual calls to action as anchor text with no wrapping <p>.
const BODY_TAGS = new Set(['p', 'li', 'blockquote', 'figcaption', 'a', 'span', 'div', 'dd', 'dt']);
const CTA_WORDS = /\b(book|order|contact|call|reserve|shop|buy|schedule|sign up|get started|learn more|request|apply|register|rsvp|donate|subscribe)\b/i;


function leafText(html, leaf) {
  return decodeEntities(html.slice(leaf.textStart, leaf.textEnd)).replace(/\s+/g, ' ').trim();
}

/** Attributes of the tag a leaf's selector names, read straight from the raw
 * bytes rather than trusting anything precomputed, since parseLeaves() only
 * hands back text spans and a selector, not parsed attributes. */
function tagAttrs(html, leaf) {
  const openStart = html.lastIndexOf('<', leaf.textStart);
  const openEnd = leaf.attrsEnd;
  const raw = html.slice(openStart, openEnd);
  const attrs = {};
  for (const m of raw.matchAll(/([a-zA-Z-]+)\s*=\s*"([^"]*)"/g)) attrs[m[1].toLowerCase()] = m[2];
  return attrs;
}

/** Every <img>, wherever it sits, whether or not it is inside a text leaf
 * (an image is a void element and never itself a text leaf). Inventory only:
 * these are real assets already on the page, never generation slots.
 * Exported: the Media screen re-reads real pages for their full image
 * inventory the same way (real assets, not just the ones a section happened
 * to claim by proximity), rather than duplicating this regex. */
export function extractImages(html) {
  const images = [];
  for (const m of html.matchAll(/<img\b[^>]*>/gi)) {
    const attrs = {};
    for (const am of m[0].matchAll(/([a-zA-Z-]+)\s*=\s*"([^"]*)"/g)) attrs[am[1].toLowerCase()] = am[2];
    if (attrs.src) images.push({ src: attrs.src, alt: attrs.alt || null, at: m.index });
  }
  return images;
}

// Exported: the SEO screen re-reads real pages for title/description fresh
// rather than a stored copy, since spec.pages[] does not carry per-page
// meta_description (only the site-level seo_targets.meta_direction, seeded
// from whichever page's description was found first at import time).
export function extractMeta(html) {
  const rawTitle = /<title>([^<]*)<\/title>/i.exec(html)?.[1]?.trim() || null;
  const rawDescription = /<meta\s+name=["']description["']\s+content=["']([^"']*)["']/i.exec(html)?.[1]
    || /<meta\s+content=["']([^"']*)["']\s+name=["']description["']/i.exec(html)?.[1]
    || null;
  return {
    title: rawTitle ? decodeEntities(rawTitle) : null,
    description: rawDescription ? decodeEntities(rawDescription) : null,
  };
}

/**
 * extractPageStructure: the pure, testable core. One page's HTML in, a typed
 * section list and honest gaps out. No filesystem, no site identity -- easy
 * to verify against a fixture independent of any real disk state.
 */
export function extractPageStructure(html, { pagePath = '' } = {}) {
  const couldNotDetermine = [];
  const leaves = parseLeaves(html);
  const images = extractImages(html);
  const meta = extractMeta(html);

  const sections = [];
  const ctas = [];
  let current = null;
  let usedImageIdx = new Set();
  let sawH1 = false;

  const attachNearestImage = (afterOffset) => {
    // The next image AFTER this section's heading, before the next heading --
    // approximate, but a real page's images sit near the copy they illustrate
    // far more often than not, and this is recorded as a heuristic, not a fact.
    const idx = images.findIndex((img, i) => !usedImageIdx.has(i) && img.at >= afterOffset);
    if (idx === -1) return null;
    usedImageIdx.add(idx);
    return images[idx];
  };

  const closeSection = () => { if (current && (current.out.body || current._heading)) sections.push(current); };

  for (const leaf of leaves) {
    const text = leafText(html, leaf);
    if (!text) continue;

    if (HEADING_TAGS.has(leaf.tag)) {
      closeSection();
      const isFirst = !sawH1 && leaf.tag === 'h1';
      sawH1 = sawH1 || leaf.tag === 'h1';
      // The hero always gets the literal id 'hero', matching the convention
      // every other spec producer already uses (normalizeSections' own hero
      // promotion does the same) -- not slugified from its own headline, so
      // anything downstream that keys off id === 'hero' works on an imported
      // page exactly as it does on a generated one.
      const id = isFirst ? 'hero' : (slugify(text) || `section-${sections.length + 1}`);
      current = {
        _heading: text,
        out: {
          id, type: isFirst ? 'hero' : 'text', heading: isFirst ? undefined : text,
          body: null, instruction: null, source_selector: leaf.selector,
        },
      };
      continue;
    }

    if (!BODY_TAGS.has(leaf.tag)) continue;

    // A link inside a <nav> is navigation, full stop, whatever its text says.
    // "Contact" as a bare nav item is not a call to action; "Contact us to
    // book a table" in body copy might be. parseLeaves() does not hand back
    // an ancestor chain, only the selector string, so this reads it off that:
    // selectors are `tag[nth]>tag[nth]...`, and any `nav[` component means an
    // ancestor was a <nav>.
    if (leaf.tag === 'a' && /(^|>)nav\[/.test(leaf.selector)) continue;

    // A short link whose text reads as an action becomes a declared CTA
    // rather than folded into body prose -- this is the one place the
    // importer classifies rather than just transcribes, and it is
    // deliberately narrow: word count capped, and the verb list is the whole
    // rule, nothing inferred beyond it.
    if (leaf.tag === 'a' && text.split(/\s+/).length <= 5 && CTA_WORDS.test(text)) {
      const attrs = tagAttrs(html, leaf);
      ctas.push({ label: text, href: attrs.href || null });
      continue;
    }
    if (leaf.tag === 'a' || leaf.tag === 'span') continue; // nav/inline links: not body copy

    if (!current) {
      // Body text before any heading at all -- keep it, but say the shape is
      // uncertain: a page like this was not built with Studio's heading-per-
      // section assumption, so a synthetic hero absorbs it.
      current = { _heading: null, out: { id: 'hero', type: 'hero', body: null, instruction: null, source_selector: leaf.selector } };
      couldNotDetermine.push(`page ${pagePath || '(unknown path)'}: body text appears before any heading; grouped into a synthetic hero section rather than dropped`);
    }
    current.out.body = current.out.body ? `${current.out.body}\n\n${text}` : text;
  }
  closeSection();

  if (!sections.length) {
    couldNotDetermine.push(`page ${pagePath || '(unknown path)'}: no heading or body text leaves found; the page may be image-only or script-rendered`);
  }

  // A second pass to attach images now that section boundaries (by text
  // offset) are known -- parseLeaves() does not carry byte offsets forward
  // into the returned leaf objects for closed sections, so this reads the raw
  // offsets from `leaves` again rather than the already-built `sections`.
  const headingOffsets = leaves.filter((l) => HEADING_TAGS.has(l.tag)).map((l) => l.textStart);
  sections.forEach((sec, i) => {
    const img = attachNearestImage(headingOffsets[i] ?? 0);
    if (img) sec.out.image = { src: img.src, alt: img.alt };
  });

  if (images.length && usedImageIdx.size < images.length) {
    couldNotDetermine.push(`page ${pagePath || '(unknown path)'}: ${images.length - usedImageIdx.size} of ${images.length} image(s) could not be associated with a section by proximity`);
  }
  if (!meta.description) {
    couldNotDetermine.push(`page ${pagePath || '(unknown path)'}: no meta description present`);
  }

  return {
    title: meta.title,
    meta_description: meta.description,
    heading: sections.find((s) => s.out.type === 'hero')?._heading || meta.title || null,
    sections: sections.map((s) => s.out),
    ctas,
    image_count: images.length,
    could_not_determine: couldNotDetermine,
  };
}

export { extractTokensFromCss } from './importer-tokens.js';
import { extractTokensFromCss } from './importer-tokens.js';

/** Every stylesheet a page actually links, plus inline <style> blocks, so
 * token detection reads real declared colours rather than nothing. Remote
 * URLs are skipped (never fetched -- this is a filesystem-only import), and
 * `seen` is shared across the whole site so one global stylesheet linked from
 * every page is only read and counted once. */
function collectCss(dir, html, seen) {
  let text = '';
  for (const m of html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/gi)) text += `${m[1]}\n`;
  for (const m of html.matchAll(/<link\b[^>]*rel=["']stylesheet["'][^>]*>/gi)) {
    const href = /href=["']([^"']+)["']/i.exec(m[0])?.[1];
    if (!href || /^https?:\/\//i.test(href) || seen.has(href)) continue;
    seen.add(href);
    const cssPath = path.join(dir, href.split('?')[0]);
    try {
      if (fs.existsSync(cssPath) && fs.statSync(cssPath).isFile()) text += `${fs.readFileSync(cssPath, 'utf8')}\n`;
    } catch { /* unreadable stylesheet: skip, do not fail the whole import over one file */ }
  }
  return text;
}

/** A CTA found near the top-level BODY text keeps its position by riding
 * along as a `type: 'cta'` section, right after the section it was found in,
 * rather than being hoisted into a page-agnostic list and losing where on
 * the page it actually was. */
function foldCtasIntoSections(structure) {
  if (!structure.ctas.length) return structure.sections;
  const ctaSection = {
    id: 'cta', type: 'cta', heading: undefined, body: null, instruction: null,
    items: structure.ctas.map((c) => c.label),
  };
  return [...structure.sections, ctaSection];
}

function businessNameFor(siteId, entry) {
  if (entry?.domain) {
    const base = entry.domain.replace(/^(www|api)\./, '').replace(/\.[a-z]{2,}(\.[a-z]{2})?$/i, '');
    if (base) return titleCase(base.replace(/[-.]/g, ' '));
  }
  return titleCase(siteId.replace(/^site-/, '').replace(/-/g, ' '));
}

/**
 * createImporter: the orchestration layer. Walks a real site's actual pages
 * (the same walk page.js already uses for the Pages screen, so "what gets
 * imported" and "what the Pages screen lists" never diverge), extracts each
 * one, detects tokens from whatever CSS the pages actually link, and writes
 * the assembled spec through spec.write() -- journaled, undoable, exactly
 * like any other mutation.
 */
export function createImporter({ paths, spec }) {
  function importSite(siteId, { initiator = 'importer' } = {}) {
    const resolved = paths.resolveSite(siteId);
    if (resolved.source !== 'portfolio') {
      throw fail(400, 'not_a_portfolio_site', `${siteId} is a studio-generated site; there is nothing to import, it already has a spec`);
    }
    const dir = resolved.dir;
    // application-class evidence decides whether backend/ is even a
    // candidate page source at all, not just whether it wins a collision --
    // see discoverPages()'s own docstring for why: a brochure-class site's
    // backend/ (Drupal, a plain API, whatever it is) is never walked for
    // pages, full stop, because nothing about a directory named "backend"
    // guarantees it holds presentation content and not, say, another site's
    // vendor tree or proof-pipeline output.
    const isApplication = Boolean(resolved.entry.backend_evidence);
    // Walk every real content subtree (the same resolution page.js's Pages
    // screen already uses, so "what gets imported" and "what the Pages
    // screen lists" never diverge), keeping paths relative to the site's own
    // root -- the same convention page.js and canvas.js resolve pagePath
    // against.
    const discovered = discoverPages(dir, { includeBackend: isApplication });
    const htmlPaths = discovered.pages.map((p) => p.path);
    if (!htmlPaths.length) {
      throw fail(404, 'no_pages_found', `no .html file found under ${siteId}; nothing for the importer to read`);
    }

    const pages = [];
    const allCtaLabels = new Set();
    // Every shadowed duplicate is reported, never silently dropped -- the
    // operator can see exactly which page an import chose not to import.
    const couldNotDetermine = discovered.shadowed.map(
      (s) => `${s.path}: not imported, shadowed by ${s.shadowed_by} (${s.reason})`,
    );
    const cssSeen = new Set();
    let cssText = '';
    let firstMetaDescription = null;

    for (const relPath of htmlPaths.sort()) {
      let html;
      try {
        html = fs.readFileSync(path.join(dir, relPath), 'utf8');
      } catch (error) {
        couldNotDetermine.push(`${relPath}: could not be read (${error.message})`);
        continue;
      }
      const structure = extractPageStructure(html, { pagePath: relPath });
      cssText += collectCss(dir, html, cssSeen);
      couldNotDetermine.push(...structure.could_not_determine);
      structure.ctas.forEach((c) => allCtaLabels.add(c.label));
      if (!firstMetaDescription && structure.meta_description) firstMetaDescription = structure.meta_description;

      const stem = relPath.replace(/\.html$/i, '');
      pages.push({
        id: relPath === 'index.html' ? 'home' : (slugify(stem.replace(/\//g, '-')) || stem),
        path: relPath,
        title: structure.title || titleCase(stem.replace(/[-/]/g, ' ')),
        heading: structure.heading || structure.title || titleCase(stem.replace(/[-/]/g, ' ')),
        sections: foldCtasIntoSections(structure),
      });
    }

    const tokenResult = extractTokensFromCss(cssText);
    couldNotDetermine.push(...tokenResult.could_not_determine.map((s) => `tokens: ${s}`));

    // Direct, not routed through classifyCapability(): that function exists to
    // read a DECLARED class off an existing spec, falling back to inferring
    // from spec.backend. There is no spec yet -- this IS the inference, made
    // once, from the same backend evidence the portfolio scan already found.
    let draftSpec = {
      capability_class: isApplication ? 'application' : 'brochure',
      origin: 'legit',
      brand: { name: businessNameFor(siteId, resolved.entry), description: null, voice: null },
      tokens: tokenResult.tokens || undefined,
      tokens_provenance: { source: tokenResult.source, sample_count: tokenResult.sample_count },
      pages,
      offers: [],
      ctas: [...allCtaLabels],
      seo_targets: { keywords: [], meta_direction: firstMetaDescription || '' },
      open_questions: [],
      media_slots: [],
      generated_from: {
        source_adapter: 'html-importer',
        packet_id: null,
        derivation: 'imported',
        execution_status: 'imported',
        note: `Derived by parsing ${pages.length} real HTML page(s) already on disk under ${resolved.rootName}. No copy was written or altered; every section's body is the page's own existing text.`,
        pages_imported: pages.length,
        could_not_determine: couldNotDetermine,
      },
    };

    // MBSH-shaped sites: the backend is carried, never parsed. This is the
    // exact discipline already ruled for any application-class site Studio
    // did not generate -- studio_understands_contents stays false.
    if (isApplication) {
      draftSpec = attachBackend(draftSpec, {
        root: 'backend',
        runtime: 'php',
        authored_by: 'external',
        verify: [],
      });
    }

    const result = spec.write(siteId, draftSpec, { initiator });
    return {
      site_id: siteId,
      revision: result.revision,
      journal_entry_id: result.journal_entry_id,
      undo_token: result.undo_token,
      pages_imported: pages.length,
      tokens_detected: Boolean(tokenResult.tokens),
      capability_class: draftSpec.capability_class,
      could_not_determine: couldNotDetermine,
    };
  }

  return { importSite };
}
