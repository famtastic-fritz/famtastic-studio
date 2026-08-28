import { describe, it, expect } from 'vitest';
import {
  sanitizeBenchmark, sanitizeBenchmarks, verifyBenchmarks,
  frameForCopy, assertNotOwnClaim, SUPPLIES_SECTION_TYPES,
} from '../server/kernel/benchmarks.js';

const PRICING = {
  claim: 'Fades in this market run $25-$35',
  kind: 'pricing', sources: ['https://a.example/x'],
  applies_to: 'locality', display_rule: 'indicative', confidence: 'medium',
};

// 98 of 256 sections rendered empty because the only categories available were
// facts[] (needs a source about THIS business) and not_found[].
describe('the distinction that must never be blurred', () => {
  it('accepts a market claim as a benchmark', () => {
    expect(sanitizeBenchmark(PRICING)).toMatchObject({ kind: 'pricing', applies_to: 'locality' });
  });

  it('rejects anything without a recognised kind, so a business claim cannot sneak in as one', () => {
    expect(sanitizeBenchmark({ claim: 'This shop charges $30', kind: 'business_fact' })).toBeNull();
    expect(sanitizeBenchmark({ claim: 'This shop charges $30' })).toBeNull();
  });

  // A benchmark whose display rule the model failed to state is not licence to
  // render it freely.
  it('defaults to the MOST restrictive display rule, not the most permissive', () => {
    expect(sanitizeBenchmark({ claim: 'x', kind: 'pricing' }).display_rule).toBe('never_as_own_claim');
    expect(sanitizeBenchmark({ claim: 'x', kind: 'pricing', display_rule: 'nonsense' }).display_rule).toBe('never_as_own_claim');
  });

  it('defaults confidence to low rather than assuming', () => {
    expect(sanitizeBenchmark({ claim: 'x', kind: 'pricing' }).confidence).toBe('low');
  });

  it('declares which section types each kind can supply', () => {
    expect(sanitizeBenchmark(PRICING).supplies_section_types).toContain('pricing');
    expect(SUPPLIES_SECTION_TYPES.hours_pattern).toContain('hours');
  });
});

describe('benchmarks earn their place by a real fetch, exactly like facts', () => {
  const looksLikeHttpUrl = (v) => typeof v === 'string' && /^https?:\/\//.test(v);

  it('drops a benchmark whose sources cannot be re-fetched, with a reason', async () => {
    const verifySourceUri = async () => ({ ok: false, status: 404 });
    const r = await verifyBenchmarks([PRICING], { verifySourceUri, looksLikeHttpUrl });
    expect(r.benchmarks).toHaveLength(0);
    expect(r.rejected[0].reason).toMatch(/could be independently re-fetched/);
  });

  // A benchmark without a source is indistinguishable from an invented one.
  it('drops a benchmark with no source at all rather than softening it', async () => {
    const verifySourceUri = async () => ({ ok: true, status: 200 });
    const r = await verifyBenchmarks([{ ...PRICING, sources: [] }], { verifySourceUri, looksLikeHttpUrl });
    expect(r.benchmarks).toHaveLength(0);
    expect(r.rejected[0].reason).toMatch(/indistinguishable from an invented one/);
  });

  it('keeps only the sources that actually confirmed', async () => {
    const verifySourceUri = async (u) => ({ ok: u.includes('good'), status: u.includes('good') ? 200 : 403 });
    const r = await verifyBenchmarks([{ ...PRICING, sources: ['https://good.example/a', 'https://bad.example/b'] }], { verifySourceUri, looksLikeHttpUrl });
    expect(r.benchmarks[0].sources).toEqual(['https://good.example/a']);
    expect(r.benchmarks[0].verification_state).toBe('source_confirmed');
  });
});

describe('a benchmark may never become the customer\'s own claim', () => {
  const b = sanitizeBenchmark(PRICING);

  // Prevention: the writer never receives a bare range, so the shape that
  // reaches the page is the shape that is true.
  it('hands the writer a pre-framed market statement, not a bare number', () => {
    const f = frameForCopy(b);
    expect(f.framed).toMatch(/^Locally,/);
    expect(f.framed).toContain('$25-$35');
    expect(f.must_not).toMatch(/describes the market/);
  });

  it('frames by scope', () => {
    expect(frameForCopy({ ...b, applies_to: 'market' }).framed).toMatch(/^In this market,/);
    expect(frameForCopy({ ...b, applies_to: 'category' }).framed).toMatch(/^For this kind of business,/);
  });

  // The last line of defence, after framing already made it unlikely.
  it('rejects copy that states a benchmark in the first person', () => {
    expect(assertNotOwnClaim('We charge $25-$35 for a fade.', b)).toMatch(/own claim/);
    expect(assertNotOwnClaim('Our fades are $25-$35.', b)).toMatch(/own claim/);
  });

  it('allows copy that states it as a market range', () => {
    expect(assertNotOwnClaim('Locally, fades run $25-$35 at comparable studios.', b)).toBeNull();
  });

  // A page may legitimately say "we" elsewhere; only the sentence carrying the
  // number is judged.
  it('does not fire on a first-person sentence elsewhere in the body', () => {
    expect(assertNotOwnClaim('We book one client at a time. Locally, fades run $25-$35.', b)).toBeNull();
  });

  it('is a no-op when the benchmark carries no number to trace', () => {
    expect(assertNotOwnClaim('We do great work.', sanitizeBenchmark({ claim: 'salons here open late', kind: 'hours_pattern' }))).toBeNull();
  });
});

describe('sanitizeBenchmarks', () => {
  it('drops unusable entries without throwing', () => {
    expect(sanitizeBenchmarks([PRICING, null, 'x', { claim: '', kind: 'pricing' }])).toHaveLength(1);
    expect(sanitizeBenchmarks(undefined)).toEqual([]);
  });
});
