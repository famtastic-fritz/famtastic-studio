import { describe, it, expect } from 'vitest';
import { parseCssColor, contrastRatio, compositeStack, relativeLuminance } from '../server/kernel/css-color.mjs';

// The WebAIM lane is BLOCKING and has failed a good page twice, both times by
// misreading a colour. A blocking gate that misreads colour is the most
// dangerous kind there is, so every syntax it can meet is covered here.

describe('the two defects that motivated this suite', () => {
  // color-mix() serializes as color(srgb 0.92 ...) with channels in 0..1 while
  // rgb() uses 0..255. Reading 0.92 as 0.92/255 made near-white read as black
  // and reported a 15:1 paragraph as 1.15:1.
  it('reads color(srgb) channels as 0..1, not 0..255', () => {
    const c = parseCssColor('color(srgb 0.919686 0.913882 0.918588)');
    expect(c.rgb[0]).toBeGreaterThan(230);
    const ratio = contrastRatio([20, 22, 26], c.rgb);
    expect(ratio).toBeGreaterThan(10);
  });

  // An rgba(255,255,255,0.04) overlay treated as opaque scored a button on a
  // dark header against white.
  it('keeps alpha so a faint overlay does not become an opaque layer', () => {
    const overlay = parseCssColor('rgba(255,255,255,0.04)');
    expect(overlay.a).toBeCloseTo(0.04, 3);
    const composited = compositeStack([overlay], [17, 17, 17]);
    // 4% white over near-black is still near-black.
    expect(composited[0]).toBeLessThan(40);
  });
});

describe('every syntax the lane can meet', () => {
  const cases = [
    ['rgb(20, 22, 26)', [20, 22, 26], 1],
    ['rgb(20 22 26)', [20, 22, 26], 1],
    ['rgba(20, 22, 26, 0.5)', [20, 22, 26], 0.5],
    ['rgb(20 22 26 / 50%)', [20, 22, 26], 0.5],
    ['rgb(100%, 0%, 0%)', [255, 0, 0], 1],
    ['#abc', [170, 187, 204], 1],
    ['#a1b2c3', [161, 178, 195], 1],
    ['#a1b2c300', [161, 178, 195], 0],
    ['hsl(0, 100%, 50%)', [255, 0, 0], 1],
    ['hsl(210 50% 40%)', [51, 102, 153], 1],
    ['hsla(0, 100%, 50%, 0.25)', [255, 0, 0], 0.25],
    ['color(srgb 1 0 0)', [255, 0, 0], 1],
    ['color(srgb 1 1 1 / 0.5)', [255, 255, 255], 0.5],
    ['white', [255, 255, 255], 1],
    ['BLACK', [0, 0, 0], 1],
  ];
  for (const [input, rgb, a] of cases) {
    it(`parses ${input}`, () => {
      const c = parseCssColor(input);
      expect(c, `${input} failed to parse`).not.toBeNull();
      for (let i = 0; i < 3; i += 1) expect(Math.abs(c.rgb[i] - rgb[i]), `${input} channel ${i}`).toBeLessThanOrEqual(2);
      expect(c.a).toBeCloseTo(a, 2);
    });
  }

  // oklch is checked by round-tripping a known anchor rather than exact channels.
  it('converts oklch into plausible sRGB', () => {
    expect(parseCssColor('oklch(0 0 0)').rgb).toEqual([0, 0, 0]);
    const white = parseCssColor('oklch(1 0 0)').rgb;
    for (const ch of white) expect(ch).toBeGreaterThan(250);
    const teal = parseCssColor('oklch(0.7 0.1 200)').rgb;
    expect(teal[1]).toBeGreaterThan(teal[0]); // greener than red
  });
});

describe('what must return null rather than a confident wrong answer', () => {
  // Guessing here is exactly how a gate invents a contrast failure.
  for (const input of ['transparent', 'none', 'currentColor', '', null, undefined, 'not-a-colour', '#12345', 'color(display-p3 1 0 0)', 'color-mix(in srgb, red 50%, blue)']) {
    it(`returns null for ${JSON.stringify(input)}`, () => {
      expect(parseCssColor(input)).toBeNull();
    });
  }

  // display-p3 is a real colour, but reading it as sRGB would be a confident
  // wrong answer. Null forces the caller to handle it.
  it('refuses a colour space it cannot convert instead of pretending it is sRGB', () => {
    expect(parseCssColor('color(display-p3 0.5 0.2 0.1)')).toBeNull();
  });
});

describe('contrast maths', () => {
  it('gives 21:1 for black on white and 1:1 for identical colours', () => {
    expect(contrastRatio([0, 0, 0], [255, 255, 255])).toBeCloseTo(21, 1);
    expect(contrastRatio([120, 120, 120], [120, 120, 120])).toBeCloseTo(1, 5);
  });

  it('is symmetric', () => {
    expect(contrastRatio([20, 30, 40], [200, 210, 220]))
      .toBeCloseTo(contrastRatio([200, 210, 220], [20, 30, 40]), 6);
  });

  it('composites a stack back to front', () => {
    // Opaque layer wins outright.
    expect(compositeStack([{ rgb: [255, 0, 0], a: 1 }], [0, 0, 0])).toEqual([255, 0, 0]);
    // Half white over black is mid grey.
    expect(compositeStack([{ rgb: [255, 255, 255], a: 0.5 }], [0, 0, 0])[0]).toBeCloseTo(128, -1);
  });

  it('skips null layers rather than treating them as black', () => {
    expect(compositeStack([null, { rgb: [255, 255, 255], a: 1 }], [0, 0, 0])).toEqual([255, 255, 255]);
  });

  it('luminance is monotonic in brightness', () => {
    expect(relativeLuminance([0, 0, 0])).toBeLessThan(relativeLuminance([128, 128, 128]));
    expect(relativeLuminance([128, 128, 128])).toBeLessThan(relativeLuminance([255, 255, 255]));
  });
});
