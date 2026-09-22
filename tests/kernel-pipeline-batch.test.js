// Batch builds. The measured win this exists for: three real briefs took 430s
// sequentially and 180s concurrently (2.39x), because research is ~99% of a
// build and is provider-bound rather than CPU-bound.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createPaths, loadPathsConfig } from '../server/kernel/paths.js';
import { createJournal } from '../server/kernel/journal.js';
import { createEvents } from '../server/kernel/events.js';
import { createDna } from '../server/kernel/dna.js';
import { createMutation } from '../server/kernel/mutation.js';
import { createSpec } from '../server/kernel/spec.js';
import { createPipeline, MAX_BATCH_CONCURRENCY } from '../server/kernel/pipeline.js';
import { makeResearchStub } from './research-stub.mjs';
import { makeCopyStub } from './copy-stub.mjs';

const config = loadPathsConfig();
const ownedRoots = new Set();
let previousRoot;
beforeEach(() => { previousRoot = process.env[config.data_root_env]; });
afterEach(() => {
  if (previousRoot === undefined) delete process.env[config.data_root_env];
  else process.env[config.data_root_env] = previousRoot;
  // Only directories allocated by this test, never a restored ambient root.
  for (const root of ownedRoots) {
    fs.rmSync(root, { recursive: true, force: true });
    expect(fs.existsSync(root)).toBe(false);
  }
  ownedRoots.clear();
});

function kernels() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-next-batch-'));
  ownedRoots.add(tmp);
  process.env[config.data_root_env] = tmp;
  const paths = createPaths();
  const journal = createJournal({ paths });
  const events = createEvents({ paths });
  const dna = createDna({ paths });
  const mutation = createMutation({ paths, journal, events });
  const spec = createSpec({ paths, mutation });
  const pipeline = createPipeline({ paths, journal, events, dna, spec, mutation, researchOptions: makeResearchStub({}), copyOptions: makeCopyStub() });
  return { pipeline, tmp };
}

const brief = (name) => ({ business: { name, description: `${name} does things.` } });

// These drive several full pipeline runs each. The 5s vitest default is too
// tight on a loaded machine and produced a flaky timeout; the work itself takes
// well under a second, so a generous ceiling costs nothing and removes the
// flake rather than hiding it.
const BATCH_TEST_TIMEOUT_MS = 30000;

describe('pipeline.runBatch', () => {
  it('builds every brief and reports one result slot per brief', async () => {
    const { pipeline } = kernels();
    const r = await pipeline.runBatch({
      briefs: [
        { site_id: 'batch-a', brief: brief('Alpha') },
        { site_id: 'batch-b', brief: brief('Bravo') },
        { site_id: 'batch-c', brief: brief('Charlie') },
      ],
    });
    expect(r.count).toBe(3);
    expect(r.succeeded).toBe(3);
    expect(r.failed).toBe(0);
    expect(r.results.map((x) => x.site_id)).toEqual(['batch-a', 'batch-b', 'batch-c']);
    for (const one of r.results) expect(one.run_id).toBeTruthy();
  }, BATCH_TEST_TIMEOUT_MS);

  it('reports a measured speedup rather than claiming one', async () => {
    const { pipeline } = kernels();
    const r = await pipeline.runBatch({ briefs: [{ site_id: 's-1', brief: brief('One') }, { site_id: 's-2', brief: brief('Two') }] });
    expect(typeof r.speedup).toBe('number');
    expect(r.wall_ms).toBeGreaterThanOrEqual(0);
    expect(r.sum_of_parts_ms).toBeGreaterThanOrEqual(0);
  });

  // A batch that loses the rest of its work because one brief threw is worse
  // than no batch at all.
  it('isolates a failing brief instead of failing the whole batch', async () => {
    const { pipeline } = kernels();
    const r = await pipeline.runBatch({
      briefs: [
        { site_id: 'ok-1', brief: brief('Fine') },
        { brief: brief('No site id') },
        { site_id: 'ok-2', brief: brief('Also fine') },
      ],
    });
    expect(r.succeeded).toBe(2);
    expect(r.failed).toBe(1);
    expect(r.results[1].ok).toBe(false);
    expect(r.results[1].error).toMatch(/site_id is required/);
    expect(r.results[0].ok).toBe(true);
    expect(r.results[2].ok).toBe(true);
  }, BATCH_TEST_TIMEOUT_MS);

  it('clamps concurrency to the ceiling and never below one', async () => {
    const { pipeline } = kernels();
    const high = await pipeline.runBatch({ briefs: [{ site_id: 'c-1', brief: brief('X') }], concurrency: 999 });
    expect(high.concurrency).toBe(MAX_BATCH_CONCURRENCY);
    const low = await pipeline.runBatch({ briefs: [{ site_id: 'c-2', brief: brief('Y') }], concurrency: 0 });
    expect(low.concurrency).toBe(1);
  }, BATCH_TEST_TIMEOUT_MS);

  it('refuses an empty batch rather than reporting a vacuous success', async () => {
    const { pipeline } = kernels();
    await expect(pipeline.runBatch({ briefs: [] })).rejects.toThrow(/briefs_required|non-empty/);
  }, BATCH_TEST_TIMEOUT_MS);
});
