import { afterEach, describe, expect, it } from 'vitest';
import {
  createExecutionFixture,
  stagingPacket,
} from './helpers/durable-execution-fixture.js';

const fixtures = [];

function accept(store, number = 1, packet = stagingPacket(number)) {
  return store.acceptStagingPacket({ packet, siteId: `project-${packet.project_id}` });
}

function mockCall(lease, outcome = 'success') {
  return {
    model_call_id: `call-${lease.attempt_id}`,
    provider: 'mock',
    model: 'deterministic-mock-v1',
    provider_request_id: `mock:${lease.attempt_id}`,
    input_tokens: 4,
    output_tokens: outcome === 'success' ? 8 : 0,
    latency_ms: 5,
    actual_cost_micros: 0,
    outcome,
    failure_class: outcome === 'success' ? null : 'fixture_failure',
  };
}

afterEach(() => {
  for (const fixture of fixtures.splice(0)) fixture.cleanup();
});

describe('durable execution store', () => {
  it('atomically accepts one task, AgentTaskLog row, and dispatch intent', () => {
    const fixture = createExecutionFixture();
    fixtures.push(fixture);
    const store = fixture.openStore();
    const result = accept(store);
    expect(result).toMatchObject({ state: 'accepted', dispatch_state: 'pending', duplicate: false });
    expect(store.snapshotCounts()).toMatchObject({ AgentTaskLog: 1, ExecutionJobs: 1, ExecutionOutbox: 1 });
    const log = store.rawDatabaseForTests().prepare('SELECT * FROM AgentTaskLog').get();
    expect(log.task_id).toBe(result.task_id);
    expect(JSON.parse(log.input_refs)).toEqual([
      'packet:packet-1',
      `artifact-manifest:sha256:${stagingPacket(1).artifact_manifest_sha256}`,
    ]);
    expect(log.cost_actual).toBeNull();
  });

  it('returns the original receipt for an identical duplicate and rejects a conflicting reuse', () => {
    const fixture = createExecutionFixture();
    fixtures.push(fixture);
    const store = fixture.openStore();
    const first = accept(store);
    const duplicate = accept(store);
    expect(duplicate).toMatchObject({ task_id: first.task_id, receipt_id: first.receipt_id, duplicate: true });
    expect(store.snapshotCounts()).toMatchObject({ AgentTaskLog: 1, ExecutionJobs: 1, ExecutionOutbox: 1 });

    const conflict = stagingPacket(1, { packet_id: 'packet-conflicting-content' });
    expect(() => accept(store, 1, conflict)).toThrowError(expect.objectContaining({ code: 'idempotency_conflict' }));
    expect(store.snapshotCounts()).toMatchObject({ AgentTaskLog: 1, ExecutionJobs: 1, ExecutionOutbox: 1 });
  });

  it('rolls back every acceptance row when outbox persistence aborts', () => {
    const fixture = createExecutionFixture();
    fixtures.push(fixture);
    const store = fixture.openStore();
    store.rawDatabaseForTests().exec(`CREATE TRIGGER abort_execution_outbox
      BEFORE INSERT ON ExecutionOutbox BEGIN SELECT RAISE(ABORT, 'forced outbox failure'); END`);
    expect(() => accept(store)).toThrow(/forced outbox failure/);
    expect(store.snapshotCounts()).toMatchObject({ AgentTaskLog: 0, ExecutionJobs: 0, ExecutionOutbox: 0 });
  });

  it('fails closed until pause and dispatch controls are explicitly changed', () => {
    const fixture = createExecutionFixture();
    fixtures.push(fixture);
    const store = fixture.openStore();
    accept(store);
    expect(store.controlEnabled('global_pause')).toBe(true);
    expect(() => store.setDispatchEnabled('false', 'test')).toThrowError(expect.objectContaining({ code: 'execution_control_value_invalid' }));
    expect(store.controlEnabled('dispatch_enabled')).toBe(false);
    expect(() => store.dispatchPending()).toThrowError(expect.objectContaining({ code: 'execution_paused' }));
    store.setPaused(false, 'test');
    expect(() => store.dispatchPending()).toThrowError(expect.objectContaining({ code: 'dispatch_disabled' }));
    store.setDispatchEnabled(true, 'test');
    expect(store.dispatchPending()).toHaveLength(1);
    expect(store.dispatchPending()).toEqual([]);
    expect(store.getJob(store.listJobs()[0].job_id).state).toBe('queued');
  });

  it('gives one active lease to competing store handles', () => {
    const fixture = createExecutionFixture();
    fixtures.push(fixture);
    const first = fixture.openStore();
    accept(first);
    first.setPaused(false, 'test');
    first.setDispatchEnabled(true, 'test');
    first.setWorkerEnabled(true, 'test');
    first.dispatchPending();
    const second = fixture.openStore();

    const lease = first.claimNextJob({ workerId: 'worker-a', leaseMs: 1000 });
    expect(lease).toBeTruthy();
    expect(second.claimNextJob({ workerId: 'worker-b', leaseMs: 1000 })).toBeNull();
    expect(first.rawDatabaseForTests().prepare("SELECT COUNT(*) AS count FROM ExecutionAttempts WHERE state = 'running'").get().count).toBe(1);
  });

  it('recovers an expired lease and rejects the stale fencing token', () => {
    const fixture = createExecutionFixture();
    fixtures.push(fixture);
    const first = fixture.openStore();
    accept(first);
    first.setPaused(false, 'test');
    first.setDispatchEnabled(true, 'test');
    first.setWorkerEnabled(true, 'test');
    first.dispatchPending();
    const oldLease = first.claimNextJob({ workerId: 'worker-old', leaseMs: 1000 });
    fixture.clock.advance(1001);
    const second = fixture.openStore();
    const newLease = second.claimNextJob({ workerId: 'worker-new', leaseMs: 1000 });
    expect(newLease.fencing_token).toBeGreaterThan(oldLease.fencing_token);
    expect(() => first.completeJob({
      lease: oldLease,
      call: mockCall(oldLease),
      artifact: { logical_key: 'mock-result', version: 1, artifact_ref: 'fixture:old', sha256: 'a'.repeat(64), bytes: 1 },
    })).toThrowError(expect.objectContaining({ code: 'stale_lease' }));
  });

  it('does not let callers override the trusted clock, database, or id factory', () => {
    const fixture = createExecutionFixture();
    fixtures.push(fixture);
    const store = fixture.openStore();
    accept(store);
    store.setPaused(false, 'test');
    store.setDispatchEnabled(true, 'test');
    store.setWorkerEnabled(true, 'test');
    store.dispatchPending();
    const lease = store.claimNextJob({ workerId: 'worker-a', leaseMs: 1000 });
    fixture.clock.advance(1001);
    expect(() => store.completeJob({
      lease,
      at: () => 0,
      db: { prepare: () => { throw new Error('caller database used'); } },
      nextId: () => 'caller-id',
      call: mockCall(lease),
      artifact: {
        logical_key: 'mock-result',
        version: 1,
        artifact_ref: `execution-artifact:${lease.job_id}/mock-result-v1.json`,
        sha256: 'a'.repeat(64),
        bytes: 1,
      },
    })).toThrowError(expect.objectContaining({ code: 'stale_lease' }));
  });

  it('reconciles at most one missing Phase 1 intent and never considers schedules or legacy jobs', () => {
    const fixture = createExecutionFixture();
    fixtures.push(fixture);
    const store = fixture.openStore();
    const first = accept(store, 1);
    const second = accept(store, 2);
    const db = store.rawDatabaseForTests();
    db.exec('PRAGMA foreign_keys = OFF');
    db.prepare('DELETE FROM ExecutionOutbox WHERE job_id IN (?, ?)').run(first.job_id, second.job_id);
    db.exec('PRAGMA foreign_keys = ON');

    const dryRun = store.reconcile();
    expect(dryRun).toMatchObject({ dry_run: true, schedules_considered: 0, legacy_jobs_considered: 0 });
    expect(dryRun.missing_intents).toHaveLength(2);
    expect(() => store.reconcile({ apply: 'false' })).toThrowError(expect.objectContaining({ code: 'reconcile_apply_invalid' }));
    expect(store.reconcile().missing_intents).toHaveLength(2);
    expect(store.reconcile({ apply: true }).repaired).toBeTruthy();
    expect(store.reconcile().missing_intents).toHaveLength(1);
  });
});
