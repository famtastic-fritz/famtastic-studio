#!/usr/bin/env node
/**
 * Efficiency analyzer: derives per-run and per-stage efficiency facts from DNA
 * records that already exist. No new instrumentation -- duration_ms,
 * started_at/finished_at, routing_source, usage, cost_estimate and retry_of are
 * all already recorded, so wall time, idle gaps, retry counts and actual
 * parallelism are derivable rather than needing new plumbing.
 *
 * Idle gap is the interval between one stage finishing and the next starting.
 * It is the pipeline's own overhead, and it is the number most likely to be
 * invisible otherwise.
 *
 * Usage: node scripts/efficiency-report.mjs [--site-prefix <p>] [--json]
 */
import fs from 'node:fs';
import path from 'node:path';
import { createPaths } from '../server/kernel/paths.js';

const args = process.argv.slice(2);
const prefixIdx = args.indexOf('--site-prefix');
const sitePrefix = prefixIdx >= 0 ? args[prefixIdx + 1] : null;
const asJson = args.includes('--json');

const paths = createPaths();
const dnaRoot = paths.root('dna');
if (!fs.existsSync(dnaRoot)) {
  console.error(`no dna root at ${dnaRoot}`);
  process.exit(1);
}

function ms(a, b) {
  const t0 = Date.parse(a); const t1 = Date.parse(b);
  return Number.isNaN(t0) || Number.isNaN(t1) ? null : t1 - t0;
}

function analyzeRun(record) {
  const stages = [...(record.stages || [])].sort((x, y) => Date.parse(x.started_at) - Date.parse(y.started_at));
  const total = ms(record.started_at, record.finished_at);

  let stageSum = 0;
  const rows = stages.map((s) => {
    const dur = typeof s.duration_ms === 'number' ? s.duration_ms : ms(s.started_at, s.finished_at);
    stageSum += dur || 0;
    return {
      stage: s.stage,
      attempt_id: s.attempt_id,
      retry_of: s.retry_of || null,
      duration_ms: dur,
      model: s.model,
      agent: s.agent,
      routing_source: s.routing_source || null,
      status: s.status,
      usage_status: s.usage?.status || (s.usage && s.usage.input_tokens === 0 ? 'explicit_zero' : null),
      input_tokens: s.usage?.input_tokens ?? null,
      output_tokens: s.usage?.output_tokens ?? null,
      cost_status: s.cost_estimate?.status || (s.cost_estimate && s.cost_estimate.amount_usd === 0 ? 'explicit_zero' : null),
      cost_usd: s.cost_estimate?.amount_usd ?? null,
      started_at: s.started_at,
      finished_at: s.finished_at,
    };
  });

  // Idle: gaps between consecutive stages. Negative gap means overlap, which is
  // real concurrency and is reported as such rather than clamped to zero.
  const gaps = [];
  let overlapMs = 0;
  for (let i = 1; i < stages.length; i += 1) {
    const gap = ms(stages[i - 1].finished_at, stages[i].started_at);
    if (gap === null) continue;
    if (gap < 0) overlapMs += -gap;
    gaps.push({ after: stages[i - 1].stage, before: stages[i].stage, gap_ms: gap });
  }
  const idleMs = gaps.filter((g) => g.gap_ms > 0).reduce((a, g) => a + g.gap_ms, 0);

  const retries = rows.filter((r) => r.retry_of).length;
  const premium = rows.filter((r) => r.model && r.model !== 'none').length;

  return {
    run_id: record.run_id,
    site_id: record.site_id,
    outcome: record.outcome?.status || record.outcome,
    total_ms: total,
    stage_sum_ms: stageSum,
    idle_ms: idleMs,
    overlap_ms: overlapMs,
    // Sequential unless proven otherwise: any overlap at all would show here.
    concurrency: overlapMs > 0 ? 'some_overlap_detected' : 'fully_sequential',
    stage_count: rows.length,
    retry_count: retries,
    premium_stage_count: premium,
    premium_share: rows.length ? +(premium / rows.length).toFixed(3) : 0,
    reported_cost_usd: rows.reduce((a, r) => a + (typeof r.cost_usd === 'number' ? r.cost_usd : 0), 0),
    unreported_cost_stages: rows.filter((r) => r.cost_status && r.cost_status.startsWith('provider_did_not_report')).map((r) => r.stage),
    gaps,
    stages: rows,
  };
}

const files = fs.readdirSync(dnaRoot).filter((f) => f.endsWith('.json'));
const runs = [];
for (const f of files) {
  let rec;
  try { rec = JSON.parse(fs.readFileSync(path.join(dnaRoot, f), 'utf8')); } catch { continue; }
  if (sitePrefix && !String(rec.site_id || '').startsWith(sitePrefix)) continue;
  runs.push(analyzeRun(rec));
}
runs.sort((a, b) => String(a.site_id).localeCompare(String(b.site_id)));

if (asJson) {
  console.log(JSON.stringify(runs, null, 2));
} else {
  for (const r of runs) {
    console.log(`\n${r.site_id}  (${r.run_id})  ${r.outcome}`);
    console.log(`  total ${r.total_ms}ms | stage sum ${r.stage_sum_ms}ms | idle ${r.idle_ms}ms | ${r.concurrency} | retries ${r.retry_count} | premium ${r.premium_stage_count}/${r.stage_count}`);
    for (const s of r.stages) {
      const pct = r.total_ms ? ((s.duration_ms / r.total_ms) * 100).toFixed(1) : '?';
      console.log(`    ${String(s.stage).padEnd(9)} ${String(s.duration_ms).padStart(7)}ms ${String(pct).padStart(5)}%  ${String(s.model).padEnd(13)} ${String(s.routing_source).padEnd(8)} cost=${s.cost_status ?? 'null'}`);
    }
    const worst = [...r.gaps].sort((a, b) => b.gap_ms - a.gap_ms)[0];
    if (worst) console.log(`    largest idle gap: ${worst.gap_ms}ms between ${worst.after} and ${worst.before}`);
  }
}
