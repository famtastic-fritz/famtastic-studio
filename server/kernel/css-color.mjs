/**
 * CSS colour parsing for the contrast lane.
 *
 * WHY THIS IS ITS OWN MODULE
 *
 * The WebAIM lane is BLOCKING, and it has now failed a good page twice, both
 * times by misreading a colour:
 *
 *   1. An `rgba(255,255,255,0.04)` overlay was treated as opaque, so a button on
 *      a dark header was scored against white.
 *   2. `color-mix()` serializes as `color(srgb 0.92 0.91 0.92)` with channels in
 *      0..1 while `rgb()` uses 0..255, so a near-white background read as black
 *      and a 15:1 paragraph was reported as 1.15:1.
 *
 * A blocking gate that misreads colour is the most dangerous kind there is: it
 * fails good work, and the rule already says a gate that fails good pages is
 * worse than no gate. The parser previously lived inside a `page.evaluate()`
 * closure where nothing could test it. It lives here so it can be tested against
 * every syntax it will meet.
 *
 * Returns { rgb: [r, g, b] in 0..255, a: 0..1 } or null when the value carries
 * no colour (`transparent`, `none`, unparseable). Null is a real answer and
 * callers must handle it -- treating unparseable as black is exactly how defect
 * 2 happened.
 */

const NAMED = {
  transparent: null,
  black: [0, 0, 0], white: [255, 255, 255], red: [255, 0, 0], green: [0, 128, 0],
  blue: [0, 0, 255], yellow: [255, 255, 0], cyan: [0, 255, 255], aqua: [0, 255, 255],
  magenta: [255, 0, 255], fuchsia: [255, 0, 255], gray: [128, 128, 128], grey: [128, 128, 128],
  silver: [192, 192, 192], maroon: [128, 0, 0], olive: [128, 128, 0], lime: [0, 255, 0],
  teal: [0, 128, 128], navy: [0, 0, 128], purple: [128, 0, 128], orange: [255, 165, 0],
  pink: [255, 192, 203], brown: [165, 42, 42], gold: [255, 215, 0], indigo: [75, 0, 130],
  violet: [238, 130, 238], beige: [245, 245, 220], ivory: [255, 255, 240], coral: [255, 127, 80],
  crimson: [220, 20, 60], salmon: [250, 128, 114], khaki: [240, 230, 140], plum: [221, 160, 221],
  orchid: [218, 112, 214], tan: [210, 180, 140], turquoise: [64, 224, 208], lavender: [230, 230, 250],
};

const clamp255 = (v) => Math.max(0, Math.min(255, Math.round(v)));
const num = (t) => (String(t).trim().endsWith('%') ? parseFloat(t) / 100 : parseFloat(t));

/** Alpha may be a number or a percentage. */
function parseAlpha(t) {
  if (t === undefined || t === null || t === '') return 1;
  const s = String(t).trim();
  if (s === 'none') return 1;
  const v = s.endsWith('%') ? parseFloat(s) / 100 : parseFloat(s);
  return Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : 1;
}

function hslToRgb(h, s, l) {
  const hh = ((h % 360) + 360) % 360 / 360;
  if (s === 0) { const v = clamp255(l * 255); return [v, v, v]; }
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const hue = (t) => {
    let tt = t; if (tt < 0) tt += 1; if (tt > 1) tt -= 1;
    if (tt < 1 / 6) return p + (q - p) * 6 * tt;
    if (tt < 1 / 2) return q;
    if (tt < 2 / 3) return p + (q - p) * (2 / 3 - tt) * 6;
    return p;
  };
  return [clamp255(hue(hh + 1 / 3) * 255), clamp255(hue(hh) * 255), clamp255(hue(hh - 1 / 3) * 255)];
}

/** oklch -> sRGB. Browsers increasingly serialize it verbatim. */
function oklchToRgb(L, C, hDeg) {
  const h = (hDeg * Math.PI) / 180;
  const a = Math.cos(h) * C;
  const b = Math.sin(h) * C;
  const l_ = L + 0.3963377774 * a + 0.2158037573 * b;
  const m_ = L - 0.1055613458 * a - 0.0638541728 * b;
  const s_ = L - 0.0894841775 * a - 1.2914855480 * b;
  const l = l_ ** 3, m = m_ ** 3, s = s_ ** 3;
  const lin = [
    +4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s,
  ];
  const enc = (v) => (v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055);
  return lin.map((v) => clamp255(enc(Math.max(0, Math.min(1, v))) * 255));
}

export function parseCssColor(input) {
  if (input === null || input === undefined) return null;
  const raw = String(input).trim();
  if (!raw) return null;
  const lower = raw.toLowerCase();

  if (lower === 'transparent' || lower === 'none') return null;
  // `currentColor` is unresolvable without an element context. Null, not black:
  // guessing a value here is how a gate invents a contrast failure.
  if (lower === 'currentcolor') return null;
  if (Object.prototype.hasOwnProperty.call(NAMED, lower)) {
    const v = NAMED[lower];
    return v ? { rgb: v, a: 1 } : null;
  }

  // #rgb #rgba #rrggbb #rrggbbaa
  if (raw.startsWith('#')) {
    const h = raw.slice(1);
    const ex = (i, len) => parseInt(len === 1 ? h[i] + h[i] : h.slice(i * 2, i * 2 + 2), 16);
    if (h.length === 3 || h.length === 4) {
      const a = h.length === 4 ? ex(3, 1) / 255 : 1;
      return { rgb: [ex(0, 1), ex(1, 1), ex(2, 1)], a };
    }
    if (h.length === 6 || h.length === 8) {
      const a = h.length === 8 ? ex(3, 2) / 255 : 1;
      return { rgb: [ex(0, 2), ex(1, 2), ex(2, 2)], a };
    }
    return null;
  }

  const fn = /^([a-z-]+)\(([\s\S]*)\)$/i.exec(raw);
  if (!fn) return null;
  const name = fn[1].toLowerCase();
  // Both comma and space syntax, with an optional `/ alpha`.
  const [mainPart, alphaPart] = fn[2].split('/');
  const parts = mainPart.trim().split(/[\s,]+/).filter(Boolean);
  const alphaFromSlash = alphaPart !== undefined ? parseAlpha(alphaPart) : null;

  if (name === 'rgb' || name === 'rgba') {
    const ch = parts.slice(0, 3).map((t) => (t.endsWith('%') ? clamp255(parseFloat(t) * 2.55) : clamp255(parseFloat(t))));
    if (ch.length < 3 || ch.some((v) => !Number.isFinite(v))) return null;
    const a = alphaFromSlash !== null ? alphaFromSlash : parseAlpha(parts[3]);
    return { rgb: ch, a };
  }
  if (name === 'hsl' || name === 'hsla') {
    const h = parseFloat(parts[0]);
    const s = num(parts[1]);
    const l = num(parts[2]);
    if (![h, s, l].every(Number.isFinite)) return null;
    const a = alphaFromSlash !== null ? alphaFromSlash : parseAlpha(parts[3]);
    return { rgb: hslToRgb(h, s, l), a };
  }
  if (name === 'oklch') {
    const L = num(parts[0]); const C = parseFloat(parts[1]); const h = parseFloat(parts[2]) || 0;
    if (![L, C].every(Number.isFinite)) return null;
    return { rgb: oklchToRgb(L, C, h), a: alphaFromSlash !== null ? alphaFromSlash : 1 };
  }
  if (name === 'color') {
    // color(srgb 0.92 0.91 0.92 / 0.5) -- CHANNELS ARE 0..1, which is defect 2.
    const space = parts[0]?.toLowerCase();
    const ch = parts.slice(1, 4).map((t) => (t.endsWith('%') ? parseFloat(t) / 100 : parseFloat(t)));
    if (ch.length < 3 || ch.some((v) => !Number.isFinite(v))) return null;
    // Only sRGB-family spaces are handled. Anything else returns null rather
    // than being read as sRGB, which would be a confident wrong answer.
    if (space && !['srgb', 'srgb-linear'].includes(space)) return null;
    const enc = (v) => (space === 'srgb-linear' ? (v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055) : v);
    return { rgb: ch.map((v) => clamp255(enc(v) * 255)), a: alphaFromSlash !== null ? alphaFromSlash : 1 };
  }
  // color-mix() is normally resolved by the browser before it reaches us. If it
  // arrives unresolved we cannot evaluate it, and null is the honest answer.
  return null;
}

export function relativeLuminance([r, g, b]) {
  const f = (v) => { const x = v / 255; return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4; };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}

export function contrastRatio(fgRgb, bgRgb) {
  const a = relativeLuminance(fgRgb);
  const b = relativeLuminance(bgRgb);
  const [hi, lo] = a > b ? [a, b] : [b, a];
  return (hi + 0.05) / (lo + 0.05);
}

/** Composite a back-to-front stack of {rgb,a} layers over an opaque base. */
export function compositeStack(layers, base = [255, 255, 255]) {
  let acc = base;
  for (const layer of layers) {
    if (!layer) continue;
    const { rgb, a } = layer;
    acc = [0, 1, 2].map((k) => Math.round(rgb[k] * a + acc[k] * (1 - a)));
  }
  return acc;
}
