import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createPaths, loadPathsConfig } from '../server/kernel/paths.js';
import { createDna } from '../server/kernel/dna.js';

let tmpRoot;
let prevEnvValue;
const config = loadPathsConfig();

beforeEach(() => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-next-dna-'));
  prevEnvValue = process.env[config.data_root_env];
  process.env[config.data_root_env] = tmpRoot;
});

afterEach(() => {
  if (prevEnvValue === undefined) delete process.env[config.data_root_env];
  else process.env[config.data_root_env] = prevEnvValue;
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

function makeDna() {
  const paths = createPaths();
  return createDna({ paths });
}

function startBasicRun(dna, overrides = {}) {
  return dna.startRun({
    site_id: 'site-a',
    recipe_ref: null,
    research_packet_ref: 'packet_1',
    source_commit: 'abc1234',
    tree_hash: 'tree5678',
    recipe_snapshot: { stack_directives: ['drupal+react-front'] },
    stage_graph: [
      { stage: 'research', depends_on: [] },
      { stage: 'generate', depends_on: ['research'] },
      { stage: 'verify', depends_on: ['generate'] },
    ],
    model_tool_versions: { model: 'claude-sonnet-5', node: process.version },
    ...overrides,
  });
}

describe('createDna: startRun', () => {
  it('requires source_commit, tree_hash, and a non-empty stage_graph', () => {
    const dna = makeDna();
    expect(() => dna.startRun({ tree_hash: 't', stage_graph: [{ stage: 'a' }] })).toThrow();
    expect(() => dna.startRun({ source_commit: 'c', stage_graph: [{ stage: 'a' }] })).toThrow();
    expect(() => dna.startRun({ source_commit: 'c', tree_hash: 't', stage_graph: [] })).toThrow();
  });

  it('creates a readable record with a seeded replay manifest', () => {
    const dna = makeDna();
    const { run_id, record } = startBasicRun(dna);
    expect(run_id).toBeTruthy();
    expect(record.outcome).toBeNull();
    const read = dna.read(run_id);
    expect(read.run_id).toBe(run_id);
    expect(read.replay_manifest.source_commit).toBe('abc1234');
    expect(read.replay_manifest.tree_hash).toBe('tree5678');
  });
});

describe('createDna: recordStage records every stage unconditionally', () => {
  it('records a successful stage', () => {
    const dna = makeDna();
    const { run_id } = startBasicRun(dna);
    dna.recordStage({
      run_id,
      stage: 'research',
      prompt_template: 'research/v1',
      prompt_snapshot: 'Research {{topic}} for {{site}}',
      model: 'claude-sonnet-5',
      agent: 'research-agent',
      inputs: [{ ref: 'input://brief', content: 'brief text' }],
      outputs: [{ ref: 'output://packet', content: 'packet text' }],
      duration_ms: 1200,
      cost_estimate: 0.02,
      usage: { input_tokens: 100, output_tokens: 200, cost_usd: 0.03 },
      verification: { passed: true, score: 1 },
      verifier_version: 'v1',
      evidence_ref: 'evidence://research',
      status: 'success',
    });
    const record = dna.read(run_id);
    expect(record.stages.length).toBe(1);
    expect(record.stages[0].status).toBe('success');
    expect(record.stages[0].inputs[0].sha256).toBeTruthy();
  });

  it('records a FAILED stage just as unconditionally as a success', () => {
    const dna = makeDna();
    const { run_id } = startBasicRun(dna);
    const attempt = dna.recordStage({
      run_id,
      stage: 'generate',
      status: 'failed',
      error: 'model timeout',
      duration_ms: 500,
    });
    const record = dna.read(run_id);
    expect(record.stages.length).toBe(1);
    expect(record.stages[0].status).toBe('failed');
    expect(record.stages[0].error).toBe('model timeout');
    expect(attempt.attempt_id).toBeTruthy();
  });

  it('records a retry as a new attempt referencing retry_of, never overwriting the failed attempt', () => {
    const dna = makeDna();
    const { run_id } = startBasicRun(dna);
    const failedAttempt = dna.recordStage({ run_id, stage: 'generate', status: 'failed', error: 'boom' });
    const retryAttempt = dna.recordStage({
      run_id,
      stage: 'generate',
      retry_of: failedAttempt.attempt_id,
      status: 'success',
    });

    const record = dna.read(run_id);
    expect(record.stages.length).toBe(2);
    expect(record.stages[0].attempt_id).toBe(failedAttempt.attempt_id);
    expect(record.stages[0].status).toBe('failed');
    expect(record.stages[1].attempt_id).toBe(retryAttempt.attempt_id);
    expect(record.stages[1].retry_of).toBe(failedAttempt.attempt_id);
    expect(record.stages[1].status).toBe('success');
  });

  it('rejects retry_of that does not reference a known attempt', () => {
    const dna = makeDna();
    const { run_id } = startBasicRun(dna);
    expect(() => dna.recordStage({ run_id, stage: 'generate', retry_of: 'att_bogus', status: 'success' })).toThrow();
  });

  it('requires run_id, stage, and status', () => {
    const dna = makeDna();
    const { run_id } = startBasicRun(dna);
    expect(() => dna.recordStage({ stage: 'x', status: 'success' })).toThrow();
    expect(() => dna.recordStage({ run_id, status: 'success' })).toThrow();
    expect(() => dna.recordStage({ run_id, stage: 'x' })).toThrow();
  });

  it('rejects recordStage against an unknown run_id', () => {
    const dna = makeDna();
    expect(() => dna.recordStage({ run_id: 'run_nonexistent', stage: 'x', status: 'success' })).toThrow();
  });
});

describe('createDna: failed stage is locatable and retryable at stage level only', () => {
  it('failedStages() locates a failed stage without touching the rest of the run', () => {
    const dna = makeDna();
    const { run_id } = startBasicRun(dna);
    dna.recordStage({ run_id, stage: 'research', status: 'success' });
    const failed = dna.recordStage({ run_id, stage: 'generate', status: 'failed', error: 'boom' });

    const located = dna.failedStages(run_id);
    expect(located.length).toBe(1);
    expect(located[0].attempt_id).toBe(failed.attempt_id);
    expect(located[0].stage).toBe('generate');

    // The retry is a single recordStage() call scoped to the failed stage.
    // No new startRun() is invoked and the earlier successful stage is untouched.
    dna.recordStage({ run_id, stage: 'generate', retry_of: failed.attempt_id, status: 'success' });
    const record = dna.read(run_id);
    expect(record.stages.filter((s) => s.stage === 'research').length).toBe(1);
    expect(record.stages.filter((s) => s.stage === 'generate').length).toBe(2);
  });
});

describe('createDna: replay manifest carries every A4 required field', () => {
  it('asserts each required field by name so a missing one fails loudly', () => {
    const dna = makeDna();
    const { run_id } = startBasicRun(dna);
    dna.recordStage({
      run_id,
      stage: 'research',
      prompt_template: 'research/v1',
      prompt_snapshot: 'Research {{topic}}',
      model: 'claude-sonnet-5',
      agent: 'research-agent',
      inputs: [{ ref: 'input://brief', sha256: 'a'.repeat(64) }],
      outputs: [{ ref: 'output://packet', sha256: 'b'.repeat(64) }],
      usage: { input_tokens: 10, output_tokens: 20, cost_usd: 0.01 },
      verification: { passed: true },
      verifier_version: 'v1',
      evidence_ref: 'evidence://research',
      status: 'success',
      external_assets: [{ id: 'asset_1', digest: 'c'.repeat(64) }],
    });

    const record = dna.read(run_id);
    const manifest = record.replay_manifest;

    expect(manifest).toHaveProperty('schema_version');
    expect(manifest).toHaveProperty('source_commit');
    expect(manifest).toHaveProperty('tree_hash');
    expect(manifest).toHaveProperty('recipe_snapshot');
    expect(manifest).toHaveProperty('recipe_snapshot_hash');
    expect(manifest).toHaveProperty('prompt_snapshots');
    expect(manifest.prompt_snapshots).toHaveProperty('research');
    expect(manifest.prompt_snapshots.research).toHaveProperty('hash');
    expect(manifest).toHaveProperty('stage_graph');
    expect(manifest).toHaveProperty('model_tool_versions');
    expect(manifest).toHaveProperty('external_assets');
    expect(manifest.external_assets[0]).toEqual({ id: 'asset_1', digest: 'c'.repeat(64) });

    const stage = record.stages[0];
    expect(stage).toHaveProperty('attempt_id');
    expect(stage).toHaveProperty('retry_of');
    expect(stage.inputs[0]).toHaveProperty('ref');
    expect(stage.inputs[0]).toHaveProperty('sha256');
    expect(stage.outputs[0]).toHaveProperty('ref');
    expect(stage.outputs[0]).toHaveProperty('sha256');
    expect(stage).toHaveProperty('model');
    expect(manifest.model_tool_versions).toBeTruthy();
    expect(stage).toHaveProperty('usage');
    expect(stage.usage).toHaveProperty('cost_usd');
    expect(stage).toHaveProperty('verifier_version');
    expect(stage).toHaveProperty('evidence_ref');
  });
});

describe('createDna: finishRun, read, list', () => {
  it('finishRun sets outcome, interventions, retro, and finished_at', () => {
    const dna = makeDna();
    const { run_id } = startBasicRun(dna);
    dna.recordStage({ run_id, stage: 'research', status: 'success' });
    const record = dna.finishRun({
      run_id,
      outcome: 'success',
      operator_interventions: [{ note: 'manually approved copy' }],
      retro: { lessons: ['verification threshold too loose'] },
    });
    expect(record.outcome).toBe('success');
    expect(record.operator_interventions.length).toBe(1);
    expect(record.retro.lessons.length).toBe(1);
    expect(record.finished_at).toBeTruthy();
  });

  it('finishRun requires run_id and outcome', () => {
    const dna = makeDna();
    expect(() => dna.finishRun({ outcome: 'success' })).toThrow();
    const { run_id } = startBasicRun(dna);
    expect(() => dna.finishRun({ run_id })).toThrow();
  });

  it('read() returns null for an unknown run', () => {
    const dna = makeDna();
    expect(dna.read('run_nonexistent')).toBeNull();
  });

  it('list() summarizes every run, newest first', () => {
    const dna = makeDna();
    const first = startBasicRun(dna);
    dna.finishRun({ run_id: first.run_id, outcome: 'success' });
    const second = startBasicRun(dna, { site_id: 'site-b' });
    dna.finishRun({ run_id: second.run_id, outcome: 'failed' });

    const listed = dna.list();
    expect(listed.length).toBe(2);
    expect(listed.map((r) => r.run_id)).toContain(first.run_id);
    expect(listed.map((r) => r.run_id)).toContain(second.run_id);
  });
});

// Efficiency telemetry must be true at the point of record, not re-derived by
// every consumer. Two defects motivated these: duration_ms was declared in the
// schema and never populated, and the run's own started_at was stamped when
// research finished rather than when the run began, so a 113s run reported
// itself as 1.09s.
describe('efficiency telemetry: durations and the true run start', () => {
  it('derives duration_ms from the recorded timestamps instead of leaving it null', () => {
    const paths = createPaths();
    const dna = createDna({ paths });
    const { run_id } = dna.startRun({ site_id: 'dur-1', source_commit: 'c', tree_hash: 't', stage_graph: [{ stage: 'research' }] });
    dna.recordStage({
      run_id, site_id: 'dur-1', stage: 'research', status: 'success',
      started_at: '2026-08-23T10:00:00.000Z', finished_at: '2026-08-23T10:01:52.000Z',
    });
    const rec = dna.read(run_id);
    expect(rec.stages[0].duration_ms).toBe(112000);
  });

  it('never fabricates a zero duration when a timestamp is missing', () => {
    const paths = createPaths();
    const dna = createDna({ paths });
    const { run_id } = dna.startRun({ site_id: 'dur-2', source_commit: 'c', tree_hash: 't', stage_graph: [{ stage: 'research' }] });
    dna.recordStage({ run_id, site_id: 'dur-2', stage: 'research', status: 'success', started_at: null });
    expect(dna.read(run_id).stages[0].duration_ms).toBeNull();
  });

  it('honors a caller-supplied started_at so the run span covers work done before the record opened', () => {
    const paths = createPaths();
    const dna = createDna({ paths });
    const trueStart = '2026-08-23T10:00:00.000Z';
    const { run_id } = dna.startRun({ site_id: 'dur-3', started_at: trueStart, source_commit: 'c', tree_hash: 't', stage_graph: [{ stage: 'research' }] });
    expect(dna.read(run_id).started_at).toBe(trueStart);
  });
});

// Standing efficiency telemetry. The reason this exists: the last audit found a
// 113s run recorded as 1.09s and nobody had noticed, because answering "are
// builds getting slower" meant opening every run file.
describe('efficiency log: one append-only line per finished run', () => {
  function readLog(paths) {
    const p = `${paths.root('dna')}/efficiency.jsonl`;
    if (!fs.existsSync(p)) return [];
    return fs.readFileSync(p, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l));
  }

  it('appends a line carrying total time, per-stage times and honest cost counts', () => {
    const paths = createPaths();
    const dna = createDna({ paths });
    const { run_id } = dna.startRun({
      site_id: 'eff-1', started_at: '2026-08-23T10:00:00.000Z',
      source_commit: 'c', tree_hash: 't', stage_graph: [{ stage: 'research' }],
    });
    dna.recordStage({
      run_id, site_id: 'eff-1', stage: 'research', status: 'success',
      model: 'cli-selected',
      started_at: '2026-08-23T10:00:00.000Z', finished_at: '2026-08-23T10:01:52.000Z',
      cost_estimate: { amount_usd: null, status: 'provider_did_not_report_currency_cost' },
    });
    dna.finishRun({ run_id, outcome: { status: 'success' } });

    const lines = readLog(paths);
    expect(lines).toHaveLength(1);
    expect(lines[0].run_id).toBe(run_id);
    expect(lines[0].stage_ms.research).toBe(112000);
    expect(lines[0].premium_stage_count).toBe(1);
    // A cost we cannot attest to is counted apart, never added in as zero.
    expect(lines[0].reported_cost_usd).toBe(0);
    expect(lines[0].unreported_cost_stage_count).toBe(1);
  });

  it('accumulates across runs so drift is a series, not a snapshot', () => {
    const paths = createPaths();
    const dna = createDna({ paths });
    for (const id of ['eff-a', 'eff-b']) {
      const { run_id } = dna.startRun({ site_id: id, source_commit: 'c', tree_hash: 't', stage_graph: [{ stage: 'build' }] });
      dna.finishRun({ run_id, outcome: { status: 'success' } });
    }
    expect(readLog(paths).length).toBe(2);
  });
});

// Rung 3 ground truth. Without this, telemetry can only ever recommend cheaper
// and faster, because nothing records whether the output was worth sending.
describe('outcome capture: the operator verdict', () => {
  function seed(dna, site_id = 'oc-1') {
    const { run_id } = dna.startRun({ site_id, source_commit: 'c', tree_hash: 't', stage_graph: [{ stage: 'build' }] });
    dna.finishRun({ run_id, outcome: { status: 'success' } });
    return run_id;
  }

  it('records a decision with who and when', () => {
    const dna = createDna({ paths: createPaths() });
    const run_id = seed(dna);
    const c = dna.setOutcome({ run_id, operator_decision: 'shipped', decided_by: 'fritz' });
    expect(c.operator_decision).toBe('shipped');
    expect(c.decided_by).toBe('fritz');
    expect(c.decided_at).toBeTruthy();
    expect(dna.read(run_id).outcome_capture.operator_decision).toBe('shipped');
  });

  it('refuses a decision outside the allowed set rather than storing free text', () => {
    const dna = createDna({ paths: createPaths() });
    const run_id = seed(dna);
    expect(() => dna.setOutcome({ run_id, operator_decision: 'looks fine' })).toThrow(/operator_decision must be one of/);
  });

  it('keeps prior decisions in history -- rejected-then-shipped is a different signal from shipped', () => {
    const dna = createDna({ paths: createPaths() });
    const run_id = seed(dna);
    dna.setOutcome({ run_id, operator_decision: 'rejected' });
    const second = dna.setOutcome({ run_id, operator_decision: 'edited_then_shipped' });
    expect(second.operator_decision).toBe('edited_then_shipped');
    expect(second.history).toHaveLength(1);
    expect(second.history[0].operator_decision).toBe('rejected');
  });

  it('does not erase a known customer direction when only the decision changes', () => {
    const dna = createDna({ paths: createPaths() });
    const run_id = seed(dna);
    dna.setOutcome({ run_id, operator_decision: 'pending', customer_selected_direction: 'direction-b' });
    const after = dna.setOutcome({ run_id, operator_decision: 'shipped' });
    expect(after.customer_selected_direction).toBe('direction-b');
  });

  // A1: a run is only addressable under the identity it was created with.
  it('refuses to record an outcome across a site boundary', () => {
    const dna = createDna({ paths: createPaths() });
    const run_id = seed(dna, 'oc-a');
    expect(() => dna.setOutcome({ run_id, site_id: 'oc-b', operator_decision: 'shipped' })).toThrow(/dna_run_not_found|no DNA record/);
  });

  it('surfaces outcome_capture in list() so the console can show it', () => {
    const paths = createPaths();
    const dna = createDna({ paths });
    const run_id = seed(dna, 'oc-list');
    dna.setOutcome({ run_id, operator_decision: 'shipped' });
    const row = dna.list().find((r) => r.run_id === run_id);
    expect(row.outcome_capture.operator_decision).toBe('shipped');
  });
});
