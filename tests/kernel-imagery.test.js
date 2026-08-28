// The imagery adapter. The rule this file exists to defend: a slot that could
// not be filled is declared unfilled with a reason. Nothing is ever substituted
// -- no placeholder, no stock photo, no image borrowed from another slot.
import { describe, it, expect, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createPaths, loadPathsConfig } from '../server/kernel/paths.js';
import { preflight, fillMediaSlots } from '../server/kernel/imagery.js';

const config = loadPathsConfig();

function tmpPaths() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-next-img-'));
  process.env[config.data_root_env] = tmp;
  return createPaths();
}

const CFG = {
  enabled: true, provider: 'test', endpoint: 'https://example.test/prompt',
  width: 8, height: 8, max_images_per_run: 3, concurrency: 2,
  timeout_ms: 1000, preflight_timeout_ms: 1000,
};

function imageResponse(bytes = Buffer.from([1, 2, 3, 4])) {
  return {
    ok: true, status: 200,
    headers: { get: (n) => (n === 'content-type' ? 'image/jpeg' : null) },
    arrayBuffer: async () => bytes,
  };
}

const slots = (n) => Array.from({ length: n }, (_, i) => ({ id: `slot-${i + 1}`, role: `role-${i + 1}`, prompt: `prompt ${i + 1}`, state: 'unfilled', asset_ref: null, filled_by: null }));

describe('imagery preflight', () => {
  it('reports unavailable without spending when disabled', async () => {
    const fetchImpl = vi.fn();
    const r = await preflight({ config: { ...CFG, enabled: false }, fetchImpl });
    expect(r.available).toBe(false);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('reports unavailable when the generator returns a non-image', async () => {
    const fetchImpl = async () => ({ ok: true, status: 200, headers: { get: () => 'text/html' } });
    const r = await preflight({ config: CFG, fetchImpl });
    expect(r.available).toBe(false);
    expect(r.reason).toMatch(/not an image/);
  });

  it('reports unavailable rather than throwing when the generator is unreachable', async () => {
    const fetchImpl = async () => { throw new Error('ECONNREFUSED'); };
    const r = await preflight({ config: CFG, fetchImpl });
    expect(r.available).toBe(false);
    expect(r.reason).toMatch(/unreachable/);
  });
});

describe('imagery fill', () => {
  it('fills every slot and records full provenance per image', async () => {
    const paths = tmpPaths();
    const r = await fillMediaSlots({ slots: slots(3), paths, site_id: 'img-a', config: CFG, fetchImpl: async () => imageResponse() });
    expect(r.summary.filled).toBe(3);
    for (const s of r.slots) {
      expect(s.state).toBe('filled');
      expect(s.asset_ref).toMatch(/^media\/slot-\d+\.jpg$/);
      expect(s.filled_by.sha256).toMatch(/^[0-9a-f]{64}$/);
      expect(s.filled_by.prompt_sent).toBeTruthy();
      expect(s.filled_by.bytes).toBeGreaterThan(0);
      expect(fs.existsSync(path.join(paths.within('sites', 'img-a', 'media'), path.basename(s.asset_ref)))).toBe(true);
    }
  });

  // Preflight exists so an unreachable generator costs one request, not twelve.
  it('spends exactly one request when preflight fails, and leaves every slot unfilled with the reason', async () => {
    const paths = tmpPaths();
    const fetchImpl = vi.fn(async () => { throw new Error('down'); });
    const r = await fillMediaSlots({ slots: slots(5), paths, site_id: 'img-b', config: CFG, fetchImpl });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(r.summary.filled).toBe(0);
    expect(r.slots).toHaveLength(5);
    for (const s of r.slots) {
      expect(s.state).toBe('unfilled');
      expect(s.fill_error).toMatch(/unreachable|down/);
      expect(s.asset_ref).toBeNull();
    }
  });

  it('honors the per-run budget, marking the excess declared-but-not-attempted', async () => {
    const paths = tmpPaths();
    let calls = 0;
    const fetchImpl = async () => { calls += 1; return imageResponse(); };
    const r = await fillMediaSlots({ slots: slots(6), paths, site_id: 'img-c', config: CFG, fetchImpl });
    // 1 preflight + 3 budgeted generations
    expect(calls).toBe(4);
    expect(r.summary.filled).toBe(3);
    expect(r.summary.skipped_over_budget).toBe(3);
    expect(r.slots.filter((s) => /over the per-run budget/.test(s.fill_error || ''))).toHaveLength(3);
  });

  // The central guarantee.
  it('NEVER substitutes: a failing slot stays unfilled while its neighbours succeed', async () => {
    const paths = tmpPaths();
    let n = 0;
    const fetchImpl = async () => {
      n += 1;
      if (n === 3) return { ok: false, status: 503, headers: { get: () => 'image/jpeg' } };
      return imageResponse();
    };
    const r = await fillMediaSlots({ slots: slots(3), paths, site_id: 'img-d', config: { ...CFG, concurrency: 1 }, fetchImpl });
    const failed = r.slots.filter((s) => s.state === 'unfilled');
    expect(failed).toHaveLength(1);
    expect(failed[0].asset_ref).toBeNull();
    expect(failed[0].fill_error).toMatch(/HTTP 503/);
    expect(r.summary.filled).toBe(2);
    // No file was written for the failed slot, and no other slot's image was reused for it.
    const dir = paths.within('sites', 'img-d', 'media');
    expect(fs.readdirSync(dir)).toHaveLength(2);
  });

  // Observed on a real 9-slot run: concurrency 4 with no backoff filled 2 of 9
  // and lost the rest to 429. A 429 is "wait", not "no".
  it('retries a rate-limited slot with backoff instead of losing it', async () => {
    const paths = tmpPaths();
    let calls = 0;
    const fetchImpl = async () => {
      calls += 1;
      if (calls === 2) return { ok: false, status: 429, headers: { get: () => 'text/plain' } };
      return imageResponse();
    };
    const cfg = { ...CFG, rate_limit_retries: 3, rate_limit_backoff_ms: 1 };
    const r = await fillMediaSlots({ slots: slots(1), paths, site_id: 'img-429', config: cfg, fetchImpl });
    expect(r.summary.filled).toBe(1);
    expect(r.slots[0].state).toBe('filled');
  });

  it('gives up honestly when the generator stays rate-limited, rather than hanging', async () => {
    const paths = tmpPaths();
    const fetchImpl = async (url) => (String(url).includes('test%20pattern')
      ? imageResponse()
      : { ok: false, status: 429, headers: { get: () => 'text/plain' } });
    const cfg = { ...CFG, rate_limit_retries: 2, rate_limit_backoff_ms: 1 };
    const r = await fillMediaSlots({ slots: slots(1), paths, site_id: 'img-429b', config: cfg, fetchImpl });
    expect(r.slots[0].state).toBe('unfilled');
    expect(r.slots[0].fill_error).toMatch(/HTTP 429/);
  });

  it('refuses a slot with no prompt rather than inventing one', async () => {
    const paths = tmpPaths();
    const r = await fillMediaSlots({
      slots: [{ id: 's1', role: 'hero', prompt: null, state: 'unfilled', asset_ref: null }],
      paths, site_id: 'img-e', config: CFG, fetchImpl: async () => imageResponse(),
    });
    expect(r.slots[0].state).toBe('unfilled');
    expect(r.slots[0].fill_error).toMatch(/no prompt was declared/);
  });

  it('treats a zero-byte response as a failure, not a filled slot', async () => {
    const paths = tmpPaths();
    const fetchImpl = async () => ({ ok: true, status: 200, headers: { get: () => 'image/jpeg' }, arrayBuffer: async () => Buffer.alloc(0) });
    const r = await fillMediaSlots({ slots: slots(1), paths, site_id: 'img-f', config: CFG, fetchImpl });
    expect(r.slots[0].state).toBe('unfilled');
    expect(r.slots[0].fill_error).toMatch(/zero bytes/);
  });
});
