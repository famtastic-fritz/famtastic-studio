import { describe, it, expect } from 'vitest';
import { buildCard, validateCard, CARD_TYPES, isKnownCardType } from '../server/kernel/cards.js';

const BASE = { site_id: 'site-a', conversation_id: 'conv_a', title: 'Do the thing' };

describe('CARD_TYPES', () => {
  it('exports the fixed type list from PHASE-2-CONTRACTS.md section 2', () => {
    expect(CARD_TYPES).toEqual([
      'plan',
      'proposal',
      'diff',
      'confirm',
      'progress',
      'success',
      'failure',
      'recovery',
      'deploy_receipt',
    ]);
  });

  it('isKnownCardType reflects the exported list', () => {
    for (const type of CARD_TYPES) expect(isKnownCardType(type)).toBe(true);
    expect(isKnownCardType('rumor')).toBe(false);
  });
});

describe('buildCard', () => {
  it('accepts every legal type', () => {
    for (const type of CARD_TYPES) {
      const built = buildCard({ ...BASE, type });
      expect(built.type).toBe(type);
      expect(built.card_id).toMatch(/^cd_/);
      expect(built.schema_version).toBe(1);
      expect(Array.isArray(built.evidence)).toBe(true);
      expect(Array.isArray(built.actions)).toBe(true);
      expect(built.state).toBe('pending');
    }
  });

  it('rejects an illegal type at construction', () => {
    expect(() => buildCard({ ...BASE, type: 'rumor' })).toThrow(/unknown card type/i);
  });

  it('requires site_id (no ambient site)', () => {
    expect(() => buildCard({ type: 'plan', conversation_id: 'conv_a', title: 'x' })).toThrow(/site_id/);
  });

  it('requires conversation_id (no ambient conversation)', () => {
    expect(() => buildCard({ type: 'plan', site_id: 'site-a', title: 'x' })).toThrow(/conversation_id/);
  });

  it('requires a title', () => {
    expect(() => buildCard({ type: 'plan', site_id: 'site-a', conversation_id: 'conv_a' })).toThrow(/title/);
  });

  it('defaults evidence to an empty array and never fabricates a reference', () => {
    const built = buildCard({ ...BASE, type: 'progress' });
    expect(built.evidence).toEqual([]);
  });

  it('accepts well-formed evidence entries', () => {
    const built = buildCard({
      ...BASE,
      type: 'diff',
      evidence: [{ kind: 'file', ref: 'dist/index.html', note: 'before/after' }],
    });
    expect(built.evidence).toEqual([{ kind: 'file', ref: 'dist/index.html', note: 'before/after' }]);
  });

  it('rejects evidence with an unknown kind', () => {
    expect(() =>
      buildCard({ ...BASE, type: 'diff', evidence: [{ kind: 'rumor', ref: 'x' }] }),
    ).toThrow(/evidence\.kind/);
  });

  it('rejects evidence missing a ref', () => {
    expect(() => buildCard({ ...BASE, type: 'diff', evidence: [{ kind: 'file' }] })).toThrow(/evidence\.ref/);
  });

  it('accepts well-formed actions, including confirm_required gating', () => {
    const built = buildCard({
      ...BASE,
      type: 'proposal',
      actions: [{ id: 'apply', label: 'Apply this proposal', method: 'POST', path: '/api/sites/edit', confirm_required: true }],
    });
    expect(built.actions[0].confirm_required).toBe(true);
  });

  it('rejects an action missing confirm_required', () => {
    expect(() =>
      buildCard({ ...BASE, type: 'proposal', actions: [{ id: 'apply', label: 'Apply', method: 'POST', path: '/api/x' }] }),
    ).toThrow(/confirm_required/);
  });

  it('rejects an unknown state', () => {
    expect(() => buildCard({ ...BASE, type: 'plan', state: 'vibing' })).toThrow(/state/);
  });

  it('stamps a real ISO8601 ts', () => {
    const built = buildCard({ ...BASE, type: 'plan' });
    expect(Number.isNaN(Date.parse(built.ts))).toBe(false);
  });
});

describe('validateCard', () => {
  it('accepts a card built via buildCard', () => {
    const built = buildCard({ ...BASE, type: 'success' });
    expect(() => validateCard(built)).not.toThrow();
    expect(validateCard(built)).toBe(built);
  });

  it('rejects a hand-built object with an illegal type', () => {
    const fake = {
      card_id: 'cd_fake',
      schema_version: 1,
      type: 'rumor',
      site_id: 'site-a',
      conversation_id: 'conv_a',
      ts: new Date().toISOString(),
      title: 'x',
      body: '',
      evidence: [],
      actions: [],
      state: 'pending',
    };
    expect(() => validateCard(fake)).toThrow(/unknown card type/i);
  });

  it('rejects a card with an unsupported schema_version', () => {
    const built = buildCard({ ...BASE, type: 'plan' });
    expect(() => validateCard({ ...built, schema_version: 2 })).toThrow(/schema_version/);
  });

  it('rejects a non-object', () => {
    expect(() => validateCard(null)).toThrow();
    expect(() => validateCard('a card')).toThrow();
  });
});
