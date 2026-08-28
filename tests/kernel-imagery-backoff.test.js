import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createPaths, loadPathsConfig } from '../server/kernel/paths.js';
import { fillMediaSlots, loadImageryConfig } from '../server/kernel/imagery.js';

// The previous schedule multiplied a 4s base by the attempt number (4, 8, 12,
// 16): too long on the first retry, when the limiter has usually cleared, and
// too slow to grow when it has not. Exponential from 1s recovers faster in the
// common case and backs off harder in the bad one.
describe('imagery rate-limit backoff', () => {
  const withRoot = async (fn) => {
    const key = loadPathsConfig().data_root_env;
    const prev = process.env[key];
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'img-'));
    process.env[key] = tmp;
    try { return await fn(createPaths()); } finally {
      if (prev === undefined) delete process.env[key]; else process.env[key] = prev;
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  };

  const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
  const okRes = () => ({ ok: true, status: 200, headers: { get: () => 'image/png' }, arrayBuffer: async () => PNG.buffer.slice(PNG.byteOffset, PNG.byteOffset + PNG.byteLength) });
  const limited = () => ({ ok: false, status: 429, headers: { get: () => null }, arrayBuffer: async () => new ArrayBuffer(0) });

  it('waits on an exponential schedule, not a linear one', async () => {
    await withRoot(async (paths) => {
      const slept = [];
      let n = 0;
      // Preflight consumes the first call; then 3 x 429 before success.
      const fetchImpl = async () => { n += 1; return (n === 1 || n > 4) ? okRes() : limited(); };
      const out = await fillMediaSlots({
        slots: [{ id: 'm1', role: 'hero', prompt: 'a shop', state: 'unfilled' }],
        paths, site_id: 'bo-1',
        fetchImpl,
        randomImpl: () => 1,          // full jitter at its ceiling: the schedule itself
        sleepImpl: async (ms) => { slept.push(ms); },
      });
      expect(slept).toEqual([1000, 2000, 4000]);
      expect(out.slots[0].state).toBe('filled');
      // A slot that only arrived after backoff is not the same as one that
      // arrived first time, and the record says so.
      expect(out.slots[0].rate_limited_attempts).toBe(3);
      expect(out.slots[0].backoff_waited_ms).toBe(7000);
    });
  });

  // Without jitter, N concurrent workers that hit a 429 in the same window sleep
  // the same duration and retry in lockstep, reproducing the burst.
  it('applies full jitter so concurrent workers do not retry in lockstep', async () => {
    await withRoot(async (paths) => {
      const slept = [];
      let n = 0;
      const fetchImpl = async () => { n += 1; return (n === 1 || n > 3) ? okRes() : limited(); };
      await fillMediaSlots({
        slots: [{ id: 'm1', role: 'hero', prompt: 'a shop', state: 'unfilled' }],
        paths, site_id: 'bo-2', fetchImpl,
        randomImpl: () => 0.5,        // half of each ceiling
        sleepImpl: async (ms) => { slept.push(ms); },
      });
      expect(slept).toEqual([500, 1000]);
    });
  });

  it('gives up after the configured attempts and leaves the slot honestly unfilled', async () => {
    await withRoot(async (paths) => {
      let n = 0;
      const fetchImpl = async () => { n += 1; return n === 1 ? okRes() : limited(); };
      const out = await fillMediaSlots({
        slots: [{ id: 'm1', role: 'hero', prompt: 'a shop', state: 'unfilled' }],
        paths, site_id: 'bo-3', fetchImpl,
        randomImpl: () => 1, sleepImpl: async () => {},
      });
      expect(out.slots[0].state).toBe('unfilled');
      expect(out.slots[0].fill_error).toMatch(/429/);
      // Never substituted.
      expect(out.slots[0].asset_ref).toBeFalsy();
    });
  });

  it('does not wait at all when nothing is rate limited', async () => {
    await withRoot(async (paths) => {
      const slept = [];
      const out = await fillMediaSlots({
        slots: [{ id: 'm1', role: 'hero', prompt: 'a shop', state: 'unfilled' }],
        paths, site_id: 'bo-4', fetchImpl: async () => okRes(),
        randomImpl: () => 1, sleepImpl: async (ms) => { slept.push(ms); },
      });
      expect(slept).toEqual([]);
      expect(out.slots[0].rate_limited_attempts).toBeUndefined();
    });
  });

  it('reads the exponential parameters from config', () => {
    const c = loadImageryConfig();
    expect(c.rate_limit_backoff_initial_ms).toBe(1000);
    expect(c.rate_limit_backoff_multiplier).toBe(2);
  });
});
