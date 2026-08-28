import { describe, it, expect } from 'vitest';
import { record, isStale, assertFresh, DEFAULT_TTL_DAYS } from '../server/kernel/measurements.js';

// "Research is ~99% of build time" was measured correctly on 2026-08-23, quoted
// as fact on 2026-08-25, and was wrong by then: two model-backed stages had been
// added and research was 24-32%. The stale number produced the wrong diagnosis
// twice. R2 extends from rulings to measurements for the same reason: both look
// authoritative and neither announces its own age.
describe('measurements carry their own conditions and expiry', () => {
  const ok = {
    metric: 'build.stage_share.research', value: 0.24, unit: 'fraction',
    measured_at: '2026-08-25T20:00:00Z',
    conditions: { machine: 'idle', pages: 6 },
    invalidated_by: ['adding or removing a model-backed stage'],
  };

  it('refuses an undated number, because an undated number is an anecdote', () => {
    expect(() => record({ ...ok, measured_at: undefined })).toThrow(/measured_at/);
  });

  // The same build on a loaded machine and an idle one are different numbers.
  it('refuses a number with no conditions', () => {
    expect(() => record({ ...ok, conditions: {} })).toThrow(/conditions/);
  });

  it('refuses a value that is absent rather than treating it as zero', () => {
    expect(() => record({ ...ok, value: null })).toThrow(/no value/);
  });

  it('derives an expiry from the measurement date', () => {
    const r = record(ok);
    const expected = Date.parse(ok.measured_at) + DEFAULT_TTL_DAYS * 86400000;
    expect(Date.parse(r.expires_at)).toBe(expected);
  });

  it('goes stale on schedule and refuses to be quoted once it has', () => {
    const r = record(ok);
    const after = Date.parse(r.expires_at) + 1000;
    expect(isStale(r, after)).toBe(true);
    try {
      assertFresh(r, after);
      throw new Error('should have thrown');
    } catch (e) {
      expect(e.code).toBe('stale_measurement');
      // The error must say what would invalidate it, not just that it is old.
      expect(e.message).toMatch(/model-backed stage/);
    }
  });

  // The important field: "research is 99%" did not go stale with TIME, it went
  // stale when a stage was added. An expiry alone would not have caught it.
  it('records what would invalidate the number, not only when it expires', () => {
    expect(record(ok).invalidated_by).toContain('adding or removing a model-backed stage');
  });

  it('treats a record with no expiry as stale rather than trusting it', () => {
    expect(isStale({ metric: 'x' })).toBe(true);
  });
});
