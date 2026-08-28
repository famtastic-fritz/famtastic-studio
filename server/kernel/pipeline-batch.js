// Batch builds: run several briefs concurrently.
//
// Split out of pipeline.js, which crossed the no-monolith limit.
//
// Takes the single-run function as a parameter rather than importing the
// pipeline, so this module has no opinion about how one build works and cannot
// drift from it.
import { DEFAULT_BATCH_CONCURRENCY, MAX_BATCH_CONCURRENCY } from './pipeline-constants.js';

function fail(statusCode, code, message) {
  return Object.assign(new Error(message), { statusCode, code });
}

/**
 * runBatch: build several sites concurrently.
 *
 * Measured 2026-08-23: three real briefs took 430s sequentially and 180s
 * concurrently -- 2.39x throughput, with per-brief times unchanged
 * (122/180/123 vs 128/182/120), so three concurrent CLI processes cost each
 * other nothing. That is expected: research is ~99% of a build and it is
 * network and provider bound, not CPU bound. Wall time becomes the slowest
 * brief rather than the sum.
 *
 * Concurrency is BOUNDED and defaults low. An unbounded fan-out over a
 * subscription CLI is how you find its rate limit in production rather than
 * in a test, and every extra concurrent run is another live process on the
 * operator's machine.
 *
 * Every brief gets its own result entry. One brief failing never fails the
 * batch: the failure is reported in its own slot with its run_id, so a
 * partial batch is legible rather than an exception that loses the rest.
 */
export async function runBatch({ run, briefs, concurrency = DEFAULT_BATCH_CONCURRENCY, initiator = 'console' } = {}) {
  if (typeof run !== 'function') {
    throw fail(500, 'batch_run_impl_required', 'runBatch requires the single-run function');
  }
  if (!Array.isArray(briefs) || briefs.length === 0) {
    throw fail(400, 'briefs_required', 'runBatch requires a non-empty briefs array');
  }
  const limit = Math.max(1, Math.min(Number(concurrency) || 1, MAX_BATCH_CONCURRENCY));
  const results = new Array(briefs.length);
  const startedAt = Date.now();
  let cursor = 0;

  async function worker() {
    for (;;) {
      const index = cursor;
      cursor += 1;
      if (index >= briefs.length) return;
      const entry = briefs[index];
      const site_id = entry?.site_id;
      const began = Date.now();
      if (!site_id) {
        results[index] = { site_id: null, ok: false, error: 'site_id is required for every brief in a batch', duration_ms: 0 };
        continue;
      }
      try {
        const r = await run({ ...entry, initiator: entry.initiator || initiator });
        results[index] = { site_id, ok: true, run_id: r.run_id, outcome: r.outcome, duration_ms: Date.now() - began };
      } catch (error) {
        results[index] = { site_id, ok: false, error: error.message, code: error.code || null, duration_ms: Date.now() - began };
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(limit, briefs.length) }, worker));

  const wall_ms = Date.now() - startedAt;
  const sum_of_parts_ms = results.reduce((a, r) => a + (r?.duration_ms || 0), 0);
  return {
    count: briefs.length,
    concurrency: limit,
    succeeded: results.filter((r) => r?.ok).length,
    failed: results.filter((r) => r && !r.ok).length,
    wall_ms,
    sum_of_parts_ms,
    // What concurrency actually bought on THIS batch, measured rather than
    // assumed. 1.0 means it ran effectively sequentially.
    speedup: wall_ms > 0 ? +(sum_of_parts_ms / wall_ms).toFixed(2) : null,
    results,
  };
}


