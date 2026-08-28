/**
 * Detect a real site's colour tokens from its actual CSS, for the importer.
 *
 * Split out of importer.js to keep that file under the monolith line.
 *
 * Frequency, not authority: this reads every `color`/`background-color`
 * declaration in the given CSS text, parses each with the same tested colour
 * parser the contrast lane uses (server/kernel/css-color.mjs), and picks the
 * most-used light value as `bg`, the most-used dark value as `fg`, and the
 * most-used saturated value as `accent`. It is a real signal from the site's
 * own stylesheet, not a guess -- but it is also not certain to be right for a
 * page with unusual CSS, so a low sample count is reported rather than hidden
 * behind a confident-looking result.
 */
import { parseCssColor, contrastRatio } from './css-color.mjs';

// Same floor tokens.js already enforces for the generation path (WCAG body
// text, 4.5:1). A detected pair that fails it is not a usable result, it is
// noise that happened to be the most frequent value -- ship the honest
// default instead of a confident-looking wrong answer.
const MIN_CONTRAST = 4.5;

const DECL_RE = /\b(color|background-color)\s*:\s*([^;}{]+)[;}]/gi;
// Plain `background: <colour>` shorthand, only when nothing else follows the
// colour (no url(), no gradient, no position) -- anything more complex than
// that is not confidently "just a colour" and is left alone.
const BG_SHORTHAND_RE = /\bbackground\s*:\s*(#[0-9a-fA-F]{3,8}|rgba?\([^)]+\)|hsla?\([^)]+\)|[a-zA-Z]+)\s*[;}]/gi;

function isNearGray(rgb, threshold = 18) {
  const [r, g, b] = rgb;
  return Math.max(r, g, b) - Math.min(r, g, b) < threshold;
}

export function extractTokensFromCss(cssText) {
  const couldNotDetermine = [];
  if (!cssText || !cssText.trim()) {
    return { tokens: null, source: 'none', sample_count: 0, could_not_determine: ['no CSS text was given to detect tokens from'] };
  }

  const bgCounts = new Map();
  const fgCounts = new Map();
  const satCounts = new Map();
  let sampleCount = 0;

  const record = (kind, raw) => {
    const parsed = parseCssColor(raw.trim());
    if (!parsed || parsed.a < 0.5) return; // a mostly-transparent value carries no real colour signal
    sampleCount += 1;
    const key = parsed.rgb.join(',');
    const bucket = kind === 'color' ? fgCounts : bgCounts;
    bucket.set(key, (bucket.get(key) || 0) + 1);
    if (!isNearGray(parsed.rgb)) satCounts.set(key, (satCounts.get(key) || 0) + 1);
  };

  for (const m of cssText.matchAll(DECL_RE)) record(m[1].toLowerCase(), m[2]);
  for (const m of cssText.matchAll(BG_SHORTHAND_RE)) record('background-color', m[1]);

  const top = (counts) => {
    let best = null; let bestN = 0;
    for (const [key, n] of counts) if (n > bestN) { best = key; bestN = n; }
    return best ? best.split(',').map(Number) : null;
  };

  const toHex = (rgb) => `#${rgb.map((v) => v.toString(16).padStart(2, '0')).join('')}`;

  // No luminance-based swap: `background(-color)` declarations are already
  // read into the bg role and `color` declarations into the fg role by
  // construction -- that is what the property name means. A defensive swap
  // "when bg reads darker than fg" was tried and was backwards: it fired
  // exactly on a correct, ordinary dark-mode page (dark bg, light text) and
  // turned it into light-bg-dark-text, caught immediately by a test built
  // for that exact case. Trust the CSS property semantics; do not
  // second-guess them from luminance.
  const bgRgb = top(bgCounts);
  const fgRgb = top(fgCounts);
  const accentRgb = top(satCounts);

  if (!bgRgb) couldNotDetermine.push('no background-color declaration found to detect a page background from');
  if (!fgRgb) couldNotDetermine.push('no color declaration found to detect body text colour from');
  if (!accentRgb) couldNotDetermine.push('no saturated colour found to detect an accent from; the site may be monochrome or the accent may live in an image, not CSS');

  if (!bgRgb && !fgRgb) {
    return { tokens: null, source: 'none', sample_count: sampleCount, could_not_determine: couldNotDetermine };
  }

  // Real-world catch: a page using gradients or image backgrounds (both
  // deliberately NOT parsed as "just a colour" above) leaves plain
  // background-color declarations dominated by incidental fallback values --
  // on one real site the most-used bg AND fg were both the same white,
  // because the actual dark hero background never came from a colour
  // declaration at all. That is not a detected token, it is noise that
  // happens to be frequent, and shipping it would be worse than the default.
  if (bgRgb && fgRgb) {
    const ratio = contrastRatio(fgRgb, bgRgb);
    if (ratio < MIN_CONTRAST) {
      couldNotDetermine.push(`the most-used background and text colours found (contrast ${ratio.toFixed(2)}:1) fail the ${MIN_CONTRAST}:1 floor together, most likely because the real background comes from a gradient or image this pass does not read -- reporting no detected tokens rather than a pair that would be unreadable`);
      return { tokens: null, source: 'rejected_low_contrast', sample_count: sampleCount, could_not_determine: couldNotDetermine };
    }
  }

  const tokens = {
    bg: bgRgb ? toHex(bgRgb) : '#ffffff',
    fg: fgRgb ? toHex(fgRgb) : '#111111',
    accent: accentRgb ? toHex(accentRgb) : (fgRgb ? toHex(fgRgb) : '#2563eb'),
    // Muted: fg mixed 55/45 toward bg, per channel by INDEX -- not by value.
    // `.indexOf(v)` on the value itself would misfire the moment two channels
    // shared a number (e.g. rgb(100,100,50)), silently picking the wrong bg
    // channel to mix against.
    muted: fgRgb ? toHex(fgRgb.map((v, i) => Math.round(v * 0.55 + (bgRgb ? bgRgb[i] : 255) * 0.45))) : '#6b7280',
  };

  return { tokens, source: 'detected_from_css', sample_count: sampleCount, could_not_determine: couldNotDetermine };
}
