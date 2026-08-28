/**
 * The WebAIM Six — a deterministic, blocking, zero-model-cost gate.
 *
 * Sourced, not invented. The WebAIM Million 2026 study of one million home
 * pages found 95.9% had detectable WCAG failures at an average of 56.1 errors
 * per page, and that SIX categories account for 96% of every error detected —
 * unchanged for seven years:
 *
 *   low contrast text .............. 83.9% of pages
 *   missing image alt text ......... 53.1%
 *   missing form input labels ...... 51%
 *   empty links .................... 46.3%
 *   empty buttons .................. 30.6%
 *   missing document language ...... 13.5%
 *
 * Every one is machine-detectable. So this runs FIRST, before any model is
 * asked anything: it is the cheapest possible way to catch the failures that
 * actually occur, and a page that fails here should never cost a judge call.
 *
 * Contrast thresholds come from WCAG 2.2 SC 1.4.3 (4.5:1 normal, 3:1 large at
 * 18pt / 14pt bold, which is 24px / 18.5px at 1pt = 1.333px).
 *
 * MUST run on a settled capture. Judged mid-load, lazy-loaded images read as
 * missing and revealed content reads as absent — the exact artifact class that
 * produced two false defects during calibration.
 */

export const WEBAIM_SIX = [
  'low_contrast_text', 'missing_alt_text', 'missing_form_labels',
  'empty_links', 'empty_buttons', 'missing_document_language',
];

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// The parser that runs in the page is the SAME source the test suite exercises.
// Keeping a second copy inline is the producer/consumer duplication that has
// already cost this project a whole afternoon; a tested module beside an
// untested duplicate is worse than no module.
const COLOR_SRC = fs.readFileSync(
  // Relocated to server/kernel/ (2026-08-27): the HTML importer now shares this
  // exact parser too, via a normal import rather than this text-injection
  // trick (which exists only because THIS file's copy has to run inside a
  // browser page, not Node).
  path.join(path.dirname(fileURLToPath(import.meta.url)), '../../server/kernel/css-color.mjs'),
  'utf8',
).replace(/^export /gm, '');

export async function runWebaimSix(page) {
  return page.evaluate((colorSrc) => {
    // eslint-disable-next-line no-eval
    eval(colorSrc);
    // luminance / ratio / parse / alphaOf now come from the injected css-color
    // module, which the test suite covers for every syntax the lane can meet:
    // rgb, rgba, hex 3/4/6/8, hsl, hsla, color(srgb), oklch, named,
    // currentColor, transparent and alpha stacks.
    const luminance = (r, g, b) => relativeLuminance([r, g, b]);
    const ratio = (fg, bg) => contrastRatio(fg, bg);
    // null means "this value carries no colour we can evaluate" and must be
    // handled, never coerced to black.
    const parse = (c) => (parseCssColor(c)?.rgb ?? null);
    const alphaOf = (c) => (parseCssColor(c)?.a ?? 0);
    const bgOf = (el) => {
      const layers = [];
      let n = el;
      while (n && n !== document.documentElement) {
        const c = getComputedStyle(n).backgroundColor;
        const rgb = parse(c);
        const a = alphaOf(c);
        // rgb is null when the value carries no evaluable colour (transparent,
        // currentColor, a colour space we do not convert). Skip it and keep
        // walking up, rather than treating it as a layer.
        if (rgb && rgb.length === 3 && a > 0) {
          layers.push({ rgb, a });
          if (a >= 0.999) break; // fully opaque: nothing below it shows through
        }
        n = n.parentElement;
      }
      if (!layers.length) return [255, 255, 255];
      // Bottom-most first, then composite each layer over the accumulator.
      let acc = layers[layers.length - 1].a >= 0.999
        ? layers[layers.length - 1].rgb
        : [255, 255, 255];
      for (let i = layers.length - 1; i >= 0; i -= 1) {
        const { rgb, a } = layers[i];
        acc = [0, 1, 2].map((k) => Math.round(rgb[k] * a + acc[k] * (1 - a)));
      }
      return acc;
    };
    const visible = (el) => {
      const s = getComputedStyle(el);
      if (s.display === 'none' || s.visibility === 'hidden' || Number(s.opacity) === 0) return false;
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0;
    };
    const named = (el) =>
      (el.textContent || '').trim()
      || el.getAttribute('aria-label')
      || el.getAttribute('title')
      || (el.querySelector('img[alt]')?.getAttribute('alt') || '').trim()
      || (el.getAttribute('aria-labelledby')
          && (document.getElementById(el.getAttribute('aria-labelledby'))?.textContent || '').trim());

    const findings = { low_contrast_text: [], missing_alt_text: [], missing_form_labels: [], empty_links: [], empty_buttons: [], missing_document_language: [] };

    // 1. Low contrast text — WCAG 1.4.3
    for (const el of document.querySelectorAll('body *')) {
      if (!visible(el)) continue;
      const direct = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim());
      if (!direct) continue;
      const s = getComputedStyle(el);
      const fg = parse(s.color);
      // Unevaluable text colour is skipped, not scored. Scoring a colour we
      // could not read is how this lane produced two false positives.
      if (!fg || fg.length !== 3) continue;
      const px = parseFloat(s.fontSize);
      const bold = Number(s.fontWeight) >= 700;
      const large = px >= 24 || (bold && px >= 18.5);
      const need = large ? 3 : 4.5;
      const got = ratio(fg, bgOf(el));
      if (got < need) {
        findings.low_contrast_text.push({
          text: (el.textContent || '').trim().slice(0, 60),
          ratio: Number(got.toFixed(2)), required: need, font_px: px, large,
        });
      }
    }
    // 2. Missing alt text
    for (const img of document.images) {
      if (!visible(img)) continue;
      if (img.getAttribute('alt') === null) {
        findings.missing_alt_text.push({ src: (img.currentSrc || img.src || '').split('/').pop().slice(0, 50) });
      }
    }
    // 3. Missing form input labels
    for (const el of document.querySelectorAll('input, select, textarea')) {
      if (!visible(el)) continue;
      const t = (el.getAttribute('type') || '').toLowerCase();
      if (['hidden', 'submit', 'button', 'reset', 'image'].includes(t)) continue;
      const labelled = (el.id && document.querySelector(`label[for="${CSS.escape(el.id)}"]`))
        || el.closest('label') || el.getAttribute('aria-label') || el.getAttribute('aria-labelledby')
        || el.getAttribute('title');
      if (!labelled) findings.missing_form_labels.push({ name: el.getAttribute('name') || el.id || t || 'unnamed' });
    }
    // 4. Empty links
    for (const a of document.querySelectorAll('a[href]')) {
      if (!visible(a)) continue;
      if (!named(a)) findings.empty_links.push({ href: (a.getAttribute('href') || '').slice(0, 50) });
    }
    // 5. Empty buttons
    for (const b of document.querySelectorAll('button, [role="button"], input[type="button"], input[type="submit"]')) {
      if (!visible(b)) continue;
      const v = b.getAttribute('value');
      if (!named(b) && !(v && v.trim())) findings.empty_buttons.push({ tag: b.tagName.toLowerCase() });
    }
    // 6. Missing document language
    const lang = document.documentElement.getAttribute('lang');
    if (!lang || !lang.trim()) findings.missing_document_language.push({ note: 'html element has no lang attribute' });

    const counts = Object.fromEntries(Object.entries(findings).map(([k, v]) => [k, v.length]));
    const total = Object.values(counts).reduce((a, b) => a + b, 0);
    return { pass: total === 0, total, counts, findings };
  }, COLOR_SRC);
}
