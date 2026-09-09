/**
 * Design tokens — the one place a brand direction becomes CSS.
 *
 * WHY THIS EXISTS
 *
 * Research produced a real palette. For Starlight it wrote: "Anchor on a deep
 * near-black ink (#14161A) and a clean off-white paper (#F7F6F3) ... a muted
 * clay or dusty terracotta (#B57B62)". That reached the spec as
 * `brand.palette_direction` and then nothing read it. compose hardcoded
 * `--accent: #2563eb`, so five sites shipped in default black-on-white with a
 * stock blue link while their own palette sat one field away.
 *
 * That is the same failure shape as the outline-as-copy defect: a plan produced
 * and then not consumed. The legacy vNext recipe warned about it by name — a
 * direction downstream stages "had to remember to consult" becomes another
 * thing computed, stored, and read by nothing.
 *
 * THE FIX IS THE DATA PATH, NOT A REMINDER
 *
 * The direction is converted into tokens ONCE, here, and the composer reads
 * tokens and nothing else. There is no code path in which compose consults
 * `palette_direction`, so it cannot forget to.
 *
 * Colours are assigned by measured lightness rather than by the order they
 * appear in the prose: the darkest becomes ink, the lightest paper, and the
 * most saturated remaining one the accent. Position in a sentence is not a
 * reliable signal, and a direction that names paper before ink would otherwise
 * invert the whole site.
 */

export const DEFAULT_TOKENS = {
  bg: '#ffffff', fg: '#111111', accent: '#2563eb', muted: '#555555',
};

const HEX = /#([0-9a-fA-F]{6}|[0-9a-fA-F]{3})\b/g;

function expand(hex) {
  const h = hex.replace('#', '');
  return h.length === 3 ? `#${h.split('').map((c) => c + c).join('')}`.toLowerCase() : `#${h}`.toLowerCase();
}

export function rgbOf(hex) {
  const h = expand(hex).slice(1);
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
}

/** Perceived lightness, 0..1. */
export function lightness(hex) {
  const [r, g, b] = rgbOf(hex).map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** Distance from grey, 0..1 — how much a colour is doing. */
export function saturation(hex) {
  const [r, g, b] = rgbOf(hex);
  const max = Math.max(r, g, b); const min = Math.min(r, g, b);
  return max === 0 ? 0 : (max - min) / max;
}

export function extractHexes(text) {
  const found = String(text || '').match(HEX) || [];
  return [...new Set(found.map(expand))];
}

/**
 * Named colours a palette direction may use instead of hex.
 *
 * WHY THIS EXISTS
 *
 * `extractHexes` reads hex and nothing else. Research writes palette direction
 * in PROSE, so whether a brand reaches the render depended on whether the model
 * happened to emit a hex code. On the five-sample after-set four sites got their
 * palette and Tidepool Swim School did not: its direction asked for "a calm,
 * clean aquatic range ... a deep teal" and the site rendered in the platform's
 * default blue. Same pipeline, same stage, different outcome by luck.
 *
 * The values are deliberately mid-range and unsaturated. They exist to carry an
 * INTENT ("deep teal") into a usable token, not to be a brand's exact colour --
 * and every one still goes through the same WCAG floor as a declared hex, so a
 * named colour can never cost accessibility either.
 */
const NAMED_COLOURS = {
  black: '#111111', white: '#ffffff', ivory: '#faf7f0', cream: '#f7f1e3', bone: '#f3efe7',
  charcoal: '#2b2b2b', slate: '#3f4c5a', graphite: '#33383d', grey: '#6b7280', gray: '#6b7280',
  navy: '#1b2a4a', indigo: '#3730a3', cobalt: '#1d4ed8', azure: '#0ea5e9', sky: '#38bdf8',
  teal: '#0f766e', aqua: '#14b8a6', turquoise: '#14b8a6', seafoam: '#7fd1c1', mint: '#6ee7b7',
  emerald: '#047857', forest: '#14532d', olive: '#4d5320', sage: '#8a9a7b', moss: '#4a5d3a',
  lime: '#65a30d', mustard: '#c99700', gold: '#b8860b', amber: '#b45309', ochre: '#b4602a',
  orange: '#c2410c', rust: '#9a3412', terracotta: '#b4553a', brick: '#9b3a2f', maroon: '#6d2230',
  burgundy: '#5f1a2b', crimson: '#a3142f', red: '#b91c1c', coral: '#e07a5f', peach: '#f0b49a',
  pink: '#db2777', rose: '#be123c', blush: '#eccfcb', magenta: '#a21caf', purple: '#6b21a8',
  violet: '#7c3aed', lavender: '#b6a8d6', plum: '#5b2a44', brown: '#5c4433', tan: '#c8a887',
  beige: '#e8ddcb', sand: '#dfc9a3', taupe: '#8b7d6b', blue: '#1d4ed8', green: '#047857',
  yellow: '#ca8a04',
};

// Modifiers shift lightness. "deep teal" and "pale teal" must not be the same
// token, and a direction that says "deep" and gets a pastel has been ignored.
const DARKEN = /\b(deep|dark|rich|midnight|ink|charred|burnt)\b/;
const LIGHTEN = /\b(pale|light|soft|dusty|washed|muted|powder)\b/;

function shift(hex, factor) {
  const [r, g, b] = rgbOf(hex);
  const f = (v) => Math.max(0, Math.min(255, Math.round(v * factor)));
  return `#${[f(r), f(g), f(b)].map((v) => v.toString(16).padStart(2, '0')).join('')}`;
}

/**
 * extractNamedColours: pull colour intent out of prose, in the order named.
 * Order matters -- deriveTokens sorts by lightness to assign ink and paper, so
 * the set is what counts, not the sequence.
 */
export function extractNamedColours(text) {
  const src = String(text || '').toLowerCase();
  const out = [];
  for (const [name, hex] of Object.entries(NAMED_COLOURS)) {
    // Match the colour word with an optional modifier immediately before it, so
    // "deep teal" is one reading rather than a modifier applied to everything.
    const re = new RegExp(`\\b(?:(${DARKEN.source.slice(2, -2)}|${LIGHTEN.source.slice(2, -2)})\\s+)?${name}\\b`, 'g');
    let m;
    while ((m = re.exec(src)) !== null) {
      const mod = m[1] || '';
      let value = hex;
      if (mod && DARKEN.test(mod)) value = shift(hex, 0.62);
      else if (mod && LIGHTEN.test(mod)) value = shift(hex, 1.45);
      if (!out.includes(value)) out.push(value);
    }
  }
  return out;
}

/**
 * Turn a prose palette direction into tokens.
 * @returns {{tokens: object, source: string, declared: string[], note: string}}
 */
/** WCAG 2.2 SC 1.4.3 contrast ratio between two hex colours. */
export function contrastRatio(a, b) {
  const [la, lb] = [lightness(a), lightness(b)];
  const [hi, lo] = la > lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

/** Step a colour toward black or white until it clears `target` against bg. */
function forceContrast(colour, bg, target = 4.5) {
  if (contrastRatio(colour, bg) >= target) return colour;
  const towardBlack = lightness(bg) > 0.5;
  const [r, g, b] = rgbOf(colour);
  for (let step = 1; step <= 20; step += 1) {
    const t = step / 20;
    const mixWith = towardBlack ? 0 : 255;
    const c = [r, g, b].map((v) => Math.round(v + (mixWith - v) * t));
    const hex = `#${c.map((v) => v.toString(16).padStart(2, '0')).join('')}`;
    if (contrastRatio(hex, bg) >= target) return hex;
  }
  return towardBlack ? '#000000' : '#ffffff';
}

/**
 * Turn a prose palette direction into tokens.
 *
 * CONTRAST IS PART OF DERIVATION, NOT A CHECK AFTERWARDS.
 *
 * The first version of this shipped two accessibility regressions on a real
 * five-site run, both caught by the WebAIM gate:
 *
 *  - A direction naming ONE colour (#000000) set fg AND bg from the same single
 *    entry, producing black text on a black page: 21 elements at contrast 1.0,
 *    an invisible site. A palette with fewer than two distinct colours cannot
 *    supply both ink and paper, so the missing role now keeps its default.
 *  - `muted` was mixed 45% toward the background with no contrast check and
 *    landed around 3.7:1 against a 4.5 requirement, failing on every site.
 *
 * Applying a brand palette must never cost accessibility. Every text-bearing
 * token is now forced to clear its WCAG floor against the resolved background,
 * and the adjustment is recorded so nobody has to wonder why the rendered
 * colour differs from the declared one.
 *
 * @returns {{tokens: object, source: string, declared: string[], adjusted: object[], note: string}}
 */
export function deriveTokens({ paletteDirection = '', explicitTokens = null, fallback = DEFAULT_TOKENS } = {}) {
  // A selected build may carry an already-approved token set from FAMtastic's
  // design contract. Preserve those exact decisions; do not re-interpret them
  // from prose and accidentally turn a dark contract into a light default.
  if (explicitTokens && typeof explicitTokens === 'object'
    && ['bg', 'fg', 'accent', 'muted'].every((key) => typeof explicitTokens[key] === 'string' && explicitTokens[key].trim())) {
    return {
      tokens: { ...fallback, ...Object.fromEntries(['bg', 'fg', 'accent', 'muted'].map((key) => [key, explicitTokens[key].toLowerCase()])) },
      declared: ['bg', 'fg', 'accent', 'muted'].map((key) => explicitTokens[key].toLowerCase()),
      adjusted: [], source: 'design_contract',
      note: 'copied from the approved machine-readable design contract',
    };
  }
  // Hex wins: an explicit value is a decision, a colour word is an intent.
  const hexes = extractHexes(paletteDirection);
  const named = hexes.length ? [] : extractNamedColours(paletteDirection);
  const declared = hexes.length ? hexes : named;
  if (!declared.length) {
    return {
      tokens: { ...fallback }, declared: [], adjusted: [], source: 'default',
      note: paletteDirection
        ? 'the palette direction named no hex values; platform defaults used and the direction recorded as unapplied'
        : 'no palette direction was declared; platform defaults used',
    };
  }

  const byLight = [...declared].sort((a, b) => lightness(a) - lightness(b));
  const distinct = byLight.length;

  // Fewer than two distinct colours cannot supply both ink and paper. Taking
  // both from one entry is how a site ends up black-on-black.
  let fg = byLight[0];
  let bg = distinct >= 2 ? byLight[byLight.length - 1] : fallback.bg;
  if (distinct < 2) {
    // The single declared colour becomes ink if it reads on the default paper,
    // otherwise it becomes the accent and ink stays default.
    if (contrastRatio(fg, bg) < 4.5) { fg = fallback.fg; }
  }

  const rest = declared.filter((h) => h !== fg && h !== bg);
  let accent = rest.length
    ? rest.slice().sort((a, b) => saturation(b) - saturation(a))[0]
    : (distinct > 1 ? byLight[Math.floor(byLight.length / 2)] : fallback.accent);

  const adjusted = [];
  const enforce = (role, colour, target) => {
    const safe = forceContrast(colour, bg, target);
    if (safe !== colour) adjusted.push({ role, declared: colour, applied: safe, against: bg, target, ratio_before: Number(contrastRatio(colour, bg).toFixed(2)) });
    return safe;
  };

  fg = enforce('fg', fg, 4.5);
  // The accent carries links and is text, so it takes the text floor too.
  accent = enforce('accent', accent, 4.5);
  // Muted is derived from ink, then forced to clear the same floor rather than
  // trusted to a fixed mix ratio.
  const mix = (a, b, t) => {
    const [ar, ag, ab] = rgbOf(a); const [br, bg2, bb] = rgbOf(b);
    const c = (x, y) => Math.round(x + (y - x) * t).toString(16).padStart(2, '0');
    return `#${c(ar, br)}${c(ag, bg2)}${c(ab, bb)}`;
  };
  const muted = enforce('muted', mix(fg, bg, 0.35), 4.5);

  return {
    tokens: { bg, fg, accent, muted },
    declared, adjusted, source: 'palette_direction',
    note: `derived from ${distinct} declared colour(s)`
      + (distinct < 2 ? '; only one was named, so the missing role kept its platform default' : '')
      + (adjusted.length ? `; ${adjusted.length} adjusted to clear WCAG 4.5:1 against the background` : '; all cleared WCAG 4.5:1 unadjusted'),
  };
}

/** The stylesheet variables block. The composer's ONLY colour input. */
export function tokensToCss(tokens = DEFAULT_TOKENS) {
  const t = { ...DEFAULT_TOKENS, ...tokens };
  return `:root {\n  --bg: ${t.bg};\n  --fg: ${t.fg};\n  --accent: ${t.accent};\n  --muted: ${t.muted};\n}`;
}
