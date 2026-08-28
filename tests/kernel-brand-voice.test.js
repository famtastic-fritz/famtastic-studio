// The brand-voice gate: the first machine-readable quality signal.
// It is deterministic on purpose -- a model judging another model's compliance
// shares its failure mode. The audit found every local model reaching for
// "luxurious" in copy for a business whose voice forbids exactly that.
import { describe, it, expect } from 'vitest';
import { checkBrandVoice, extractForbiddenTerms } from '../server/kernel/brand-voice.js';

const VOICE = "Warm, direct, and specific -- an expert who talks like a person. Never uses 'pamper', 'indulge', 'luxurious escape', or miracle claims.";

describe('extractForbiddenTerms', () => {
  it('mines quoted anti-patterns out of the voice prose research already writes', () => {
    expect(extractForbiddenTerms({ voice: VOICE }).sort()).toEqual(['indulge', 'luxurious escape', 'pamper']);
  });

  it('honors an explicit forbidden_terms list', () => {
    expect(extractForbiddenTerms({ forbidden_terms: ['Synergy', 'world-class'] }).sort()).toEqual(['synergy', 'world-class']);
  });

  // A word merely mentioned in a voice description is not a ban.
  it('never infers a ban from unquoted prose', () => {
    expect(extractForbiddenTerms({ voice: 'Warm and confident, never stuffy or corporate.' })).toEqual([]);
  });

  // A real run mined `") rather than to abstract"` as a forbidden term out of
  // ordinary prose. Banning a parsing artifact is worse than missing a term.
  it('rejects parsing artifacts: punctuation fragments and half-sentences', () => {
    const voice = 'Never uses \'pamper\' or \'guaranteed clear skin\'. Speak concretely (as in "real, measurable outcomes") rather than to abstract ideals.';
    const terms = extractForbiddenTerms({ voice });
    expect(terms).toContain('pamper');
    expect(terms).toContain('guaranteed clear skin');
    for (const t of terms) {
      expect(t).not.toMatch(/[)("]/);
      expect(t.split(/\s+/).length).toBeLessThanOrEqual(4);
    }
  });

  it('returns an empty list for a brand with no voice at all', () => {
    expect(extractForbiddenTerms({})).toEqual([]);
    expect(extractForbiddenTerms(null)).toEqual([]);
  });
});

describe('checkBrandVoice', () => {
  it('fails copy that uses a forbidden phrase and says exactly where', () => {
    const r = checkBrandVoice({ copy: { hero: 'A luxurious escape awaits you', about: 'Direct and warm.' }, brand: { voice: VOICE } });
    expect(r.passed).toBe(false);
    expect(r.violations).toHaveLength(1);
    expect(r.violations[0]).toMatchObject({ term: 'luxurious escape', where: 'hero' });
    expect(r.violations[0].context).toMatch(/luxurious escape/);
  });

  it('passes compliant copy', () => {
    const r = checkBrandVoice({ copy: { hero: 'Skin care that explains itself.' }, brand: { voice: VOICE } });
    expect(r.passed).toBe(true);
    expect(r.violations).toEqual([]);
  });

  it('walks nested objects and arrays, reporting the exact field path', () => {
    const copy = { pages: [{ sections: [{ body: 'Come indulge with us' }] }] };
    const r = checkBrandVoice({ copy, brand: { voice: VOICE } });
    expect(r.passed).toBe(false);
    expect(r.violations[0].where).toBe('pages[0].sections[0].body');
  });

  it('is word-boundaried: a forbidden term inside a larger word is not a violation', () => {
    const r = checkBrandVoice({ copy: 'Our pampering-free approach', brand: { forbidden_terms: ['pamper'] } });
    expect(r.passed).toBe(true);
  });

  // Deliberate: banning one word must not silently ban its relatives.
  it('does not infer stems -- banning "luxurious" leaves "luxury" alone', () => {
    const r = checkBrandVoice({ copy: 'A luxury studio', brand: { forbidden_terms: ['luxurious'] } });
    expect(r.passed).toBe(true);
  });

  // A pass with nothing to check is not an endorsement and must not read as one.
  it('marks a pass vacuous when the brand declared no anti-patterns', () => {
    const r = checkBrandVoice({ copy: 'anything at all', brand: {} });
    expect(r.passed).toBe(true);
    expect(r.vacuous).toBe(true);
  });

  it('is case-insensitive', () => {
    const r = checkBrandVoice({ copy: 'PAMPER yourself', brand: { voice: VOICE } });
    expect(r.passed).toBe(false);
  });
});
