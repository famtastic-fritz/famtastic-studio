// Tokens. The defect these prevent: research wrote a real palette into
// brand.palette_direction and compose hardcoded #2563eb, so five sites shipped
// in stock blue with their own colours sitting one field away.
import { describe, it, expect } from 'vitest';
import { deriveTokens, tokensToCss, lightness, saturation, extractHexes, contrastRatio } from '../server/kernel/tokens.js';
import { composeSite } from '../server/kernel/compose.js';

const REAL = 'Clinical-warm, not spa-pastel. Anchor on a deep near-black ink (#14161A) and a clean off-white paper (#F7F6F3) for the majority of the surface, with a single restrained accent — a muted clay or dusty terracotta (#B57B62).';

describe('deriveTokens', () => {
  it('assigns by measured lightness, not by order in the prose', () => {
    const { tokens, declared } = deriveTokens({ paletteDirection: REAL });
    expect(declared).toEqual(['#14161a', '#f7f6f3', '#b57b62']);
    expect(tokens.fg).toBe('#14161a');   // darkest -> ink
    expect(tokens.bg).toBe('#f7f6f3');   // lightest -> paper
    // The clay is chosen as the accent (most saturated remaining), then darkened
    // if it cannot clear the WCAG text floor. Asserting the raw declared value
    // here would be asserting an accent that fails contrast, which is what the
    // first version of this file did.
    expect(tokens.accent).not.toBe(tokens.bg);
    expect(saturation(tokens.accent)).toBeGreaterThan(0.2);
    expect(contrastRatio(tokens.accent, tokens.bg)).toBeGreaterThanOrEqual(4.5);
  });

  it('does not invert a direction that names paper before ink', () => {
    const reversed = 'Paper (#F7F6F3) first, then ink (#14161A), accent (#B57B62).';
    const { tokens } = deriveTokens({ paletteDirection: reversed });
    expect(tokens.fg).toBe('#14161a');
    expect(tokens.bg).toBe('#f7f6f3');
  });

  it('falls back to platform defaults and SAYS SO when no hex is named', () => {
    const { tokens, source, note } = deriveTokens({ paletteDirection: 'warm and clinical, not spa-like' });
    expect(source).toBe('default');
    expect(tokens.accent).toBe('#2563eb');
    expect(note).toMatch(/named no hex values/);
  });

  it('derives muted from the palette rather than inventing a grey', () => {
    const { tokens } = deriveTokens({ paletteDirection: REAL });
    expect(lightness(tokens.muted)).toBeGreaterThan(lightness(tokens.fg));
    expect(lightness(tokens.muted)).toBeLessThan(lightness(tokens.bg));
  });

  it('reads three-digit hex too', () => {
    expect(extractHexes('ink #000 on paper #FFF')).toEqual(['#000000', '#ffffff']);
  });
});

describe('the composer reads tokens and nothing else', () => {
  it('puts the declared palette in the stylesheet', () => {
    const { tokens } = deriveTokens({ paletteDirection: REAL });
    const spec = { business: { name: 'X' }, tokens, pages: [{ id: 'home', path: 'index.html', title: 'X', heading: 'X', sections: [] }] };
    const css = (composeSite({ spec }).assets || []).map((a) => a.contents).join('');
    // The palette reaches the stylesheet: ink and paper verbatim, and an accent
    // derived from the declared clay (contrast-adjusted, so not byte-identical).
    expect(css).toContain('#14161a');
    expect(css).toContain('#f7f6f3');
    expect(css).toContain(tokens.accent);
    expect(css).not.toContain('#2563eb');
  });

  it('never consults brand.palette_direction — a direction it must remember to read is one it forgets', () => {
    // Tokens absent, direction present. The composer must NOT rescue itself by
    // reading the direction; it must use platform defaults, so the missing
    // token path is visible instead of silently working sometimes.
    const spec = { business: { name: 'X' }, brand: { palette_direction: REAL }, pages: [{ id: 'home', path: 'index.html', title: 'X', heading: 'X', sections: [] }] };
    const css = (composeSite({ spec }).assets || []).map((a) => a.contents).join('');
    expect(css).toContain('#2563eb');
    expect(css).not.toContain('#14161a');
  });
});

describe('applying a brand palette must never cost accessibility', () => {
  // Both of these shipped on a real five-site run and were caught by the WebAIM
  // gate, not by review. They are the reason contrast is part of derivation.

  it('never sets fg and bg from the same single declared colour', () => {
    // Ledger's direction named exactly one hex. fg and bg both became #000000:
    // black text on a black page, 21 elements at contrast 1.0.
    const { tokens, note } = deriveTokens({ paletteDirection: 'Keep it black and white. Ink (#000000).' });
    expect(tokens.fg).not.toBe(tokens.bg);
    expect(contrastRatio(tokens.fg, tokens.bg)).toBeGreaterThanOrEqual(4.5);
    expect(note).toMatch(/only one was named/);
  });

  it('forces every text-bearing token to clear 4.5:1 against the background', () => {
    const { tokens } = deriveTokens({ paletteDirection: 'ink (#14161A), paper (#F4F1EC), clay (#B8724E), slate (#5C6B75)' });
    for (const role of ['fg', 'accent', 'muted']) {
      expect(contrastRatio(tokens[role], tokens.bg), `${role} must clear the WCAG text floor`).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('records what it adjusted, so a changed colour is never a mystery', () => {
    const { adjusted } = deriveTokens({ paletteDirection: 'ink (#14161A), paper (#F4F1EC), clay (#B8724E)' });
    const accent = adjusted.find((a) => a.role === 'accent');
    expect(accent).toBeTruthy();
    expect(accent.declared).toBe('#b8724e');
    expect(accent.ratio_before).toBeLessThan(4.5);
    expect(contrastRatio(accent.applied, accent.against)).toBeGreaterThanOrEqual(4.5);
  });

  it('derives muted from the palette AND clears the floor — a fixed mix ratio does not', () => {
    // The 0.45 mix landed ~3.7:1 on every site in the run.
    const { tokens } = deriveTokens({ paletteDirection: 'ink (#14161A), paper (#F4F1EC)' });
    expect(contrastRatio(tokens.muted, tokens.bg)).toBeGreaterThanOrEqual(4.5);
    expect(lightness(tokens.muted)).toBeGreaterThan(lightness(tokens.fg));
  });

  it('holds for a light-on-dark palette too', () => {
    const { tokens } = deriveTokens({ paletteDirection: 'near-black ground (#0B0C0E) with bone text (#EDE8E0) and a gold accent (#C8A24B)' });
    for (const role of ['fg', 'accent', 'muted']) {
      expect(contrastRatio(tokens[role], tokens.bg), `${role} on a dark ground`).toBeGreaterThanOrEqual(4.5);
    }
  });
});

// On the five-sample after-set, four sites got their palette and Tidepool Swim
// School did not: its direction asked for "a calm, clean aquatic range ... a
// deep teal" and the site rendered in the platform's default blue. The deriver
// read hex and nothing else, so whether a brand reached the render depended on
// whether research happened to emit a hex code. Same pipeline, different outcome
// by luck.
describe('palette direction written in prose', () => {
  it('reads a named colour when no hex is present', async () => {
    const { deriveTokens } = await import('../server/kernel/tokens.js');
    const r = deriveTokens({ paletteDirection: 'a calm aquatic range built on teal' });
    expect(r.source).toBe('palette_direction');
    expect(r.declared.length).toBeGreaterThan(0);
  });

  it('honours a lightness modifier, so deep and pale are not the same token', async () => {
    const { extractNamedColours } = await import('../server/kernel/tokens.js');
    const [deep] = extractNamedColours('a deep teal');
    const [pale] = extractNamedColours('a pale teal');
    expect(deep).not.toBe(pale);
    // Deep must actually be darker, not merely different.
    const { lightness } = await import('../server/kernel/tokens.js');
    expect(lightness(deep)).toBeLessThan(lightness(pale));
  });

  // An explicit hex is a decision; a colour word is an intent. A direction
  // carrying both must not have its decision diluted by its prose.
  it('lets an explicit hex win over any colour word in the same direction', async () => {
    const { deriveTokens } = await import('../server/kernel/tokens.js');
    const r = deriveTokens({ paletteDirection: 'warm teal feeling, but use #7b2d26 and #f4ede4' });
    expect(r.declared.sort()).toEqual(['#7b2d26', '#f4ede4']);
  });

  it('still falls back to defaults, honestly, when the direction names no colour at all', async () => {
    const { deriveTokens } = await import('../server/kernel/tokens.js');
    const r = deriveTokens({ paletteDirection: 'something confident and modern' });
    expect(r.source).toBe('default');
    expect(r.note).toMatch(/unapplied/);
  });

  // A named colour is not a licence to skip the accessibility floor.
  it('forces a named colour through the same WCAG floor as a declared hex', async () => {
    const { deriveTokens, contrastRatio } = await import('../server/kernel/tokens.js');
    const r = deriveTokens({ paletteDirection: 'pale mint on white' });
    expect(contrastRatio(r.tokens.fg, r.tokens.bg)).toBeGreaterThanOrEqual(4.5);
  });
});
