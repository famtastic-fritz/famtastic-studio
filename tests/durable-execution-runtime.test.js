import fs from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createEffectsFirewall,
  createExecutionRuntime,
  createMockArtifactStore,
  createMockProvider,
} from '../server/kernel/durable-execution/index.js';
import {
  createExecutionFixture,
  stagingPacket,
} from './helpers/durable-execution-fixture.js';

const fixtures = [];

function prepare(fixture, outcomes = {}) {
  const store = fixture.openStore();
  const packet = stagingPacket(1);
  store.acceptStagingPacket({ packet, siteId: 'project-1' });
  store.setPaused(false, 'test');
  store.setDispatchEnabled(true, 'test');
  store.setWorkerEnabled(true, 'test');
  const provider = createMockProvider({ outcomes });
  const runtime = createExecutionRuntime({
    store,
    provider,
    artifactStore: createMockArtifactStore({ paths: fixture.paths }),
    enabled: true,
    leaseMs: 1000,
    baseBackoffMs: 100,
  });
  runtime.dispatch();
  return { store, runtime, provider };
}

afterEach(() => {
  vi.restoreAllMocks();
  for (const fixture of fixtures.splice(0)) fixture.cleanup();
});

describe('mock-only durable execution runtime', () => {
  it('is disabled unless explicitly enabled', () => {
    const fixture = createExecutionFixture();
    fixtures.push(fixture);
    const store = fixture.openStore();
    const runtime = createExecutionRuntime({
      store,
      provider: createMockProvider(),
      artifactStore: createMockArtifactStore({ paths: fixture.paths }),
    });
    expect(() => runtime.runOne()).toThrowError(expect.objectContaining({ code: 'worker_runtime_disabled' }));
    expect(() => createExecutionRuntime({
      store,
      provider: createMockProvider(),
      artifactStore: createMockArtifactStore({ paths: fixture.paths }),
      enabled: 'false',
    })).toThrowError(expect.objectContaining({ code: 'execution_runtime_flag_invalid' }));
  });

  it('rejects blank failure classifications in a deterministic outcome plan', () => {
    expect(() => createMockProvider({ outcomes: {
      '1:1': { type: 'transient_failure', failureClass: '   ' },
    } })).toThrowError(expect.objectContaining({ code: 'mock_plan_invalid' }));
  });

  it('moves successful mock work to awaiting approval with one zero-cost call and artifact', () => {
    const fixture = createExecutionFixture();
    fixtures.push(fixture);
    const { store, runtime } = prepare(fixture);
    expect(runtime.runOne()).toMatchObject({ state: 'awaiting_approval' });
    expect(store.snapshotCounts()).toMatchObject({
      ExecutionAttempts: 1,
      ExecutionModelCalls: 1,
      ExecutionArtifacts: 1,
      ExecutionApprovals: 1,
      ExecutionDeadLetters: 0,
    });
    const call = store.rawDatabaseForTests().prepare('SELECT * FROM ExecutionModelCalls').get();
    expect(call).toMatchObject({ provider: 'mock', actual_cost_micros: 0, outcome: 'success' });
    expect(store.listJobs()[0].state).toBe('awaiting_approval');
  });

  it('uses deterministic backoff for a transient failure and then succeeds', () => {
    const fixture = createExecutionFixture();
    fixtures.push(fixture);
    const { store, runtime } = prepare(fixture, {
      '1:1': { type: 'transient_failure', failureClass: 'mock_timeout' },
    });
    const first = runtime.runOne();
    expect(first).toMatchObject({ state: 'retry_wait', available_at_ms: fixture.clock.read() + 100 });
    expect(runtime.runOne()).toBeNull();
    fixture.clock.advance(99);
    expect(runtime.runOne()).toBeNull();
    fixture.clock.advance(1);
    expect(runtime.runOne()).toMatchObject({ state: 'awaiting_approval' });
    expect(store.snapshotCounts().ExecutionModelCalls).toBe(2);
  });

  it('dead-letters permanent failure and retry exhaustion without a fourth attempt', () => {
    const permanentFixture = createExecutionFixture();
    fixtures.push(permanentFixture);
    const permanent = prepare(permanentFixture, {
      '1:*': { type: 'permanent_failure', failureClass: 'mock_policy' },
    });
    expect(permanent.runtime.runOne()).toMatchObject({ state: 'dead_letter' });
    expect(permanent.store.snapshotCounts().ExecutionDeadLetters).toBe(1);

    const retryFixture = createExecutionFixture();
    fixtures.push(retryFixture);
    const retry = prepare(retryFixture, {
      '1:*': { type: 'transient_failure', failureClass: 'mock_timeout' },
    });
    expect(retry.runtime.runOne().state).toBe('retry_wait');
    retryFixture.clock.advance(100);
    expect(retry.runtime.runOne().state).toBe('retry_wait');
    retryFixture.clock.advance(200);
    expect(retry.runtime.runOne().state).toBe('dead_letter');
    retryFixture.clock.advance(1000);
    expect(retry.runtime.runOne()).toBeNull();
    expect(retry.store.listJobs()[0].attempts_started).toBe(3);
    expect(retry.store.snapshotCounts().ExecutionModelCalls).toBe(3);
  });

  it('uses consistent default classifications when an outcome plan omits them', () => {
    const transientFixture = createExecutionFixture();
    fixtures.push(transientFixture);
    const transient = prepare(transientFixture, { '1:1': { type: 'transient_failure' } });
    expect(transient.runtime.runOne()).toMatchObject({ state: 'retry_wait' });
    expect(transient.store.listJobs()[0].last_failure_class).toBe('mock_transient');

    const permanentFixture = createExecutionFixture();
    fixtures.push(permanentFixture);
    const permanent = prepare(permanentFixture, { '1:*': { type: 'permanent_failure' } });
    expect(permanent.runtime.runOne()).toMatchObject({ state: 'dead_letter' });
    expect(permanent.store.listJobs()[0].last_failure_class).toBe('mock_permanent');
  });

  it('refuses a real provider before it can be invoked', () => {
    const fixture = createExecutionFixture();
    fixtures.push(fixture);
    const execute = vi.fn();
    expect(() => createExecutionRuntime({
      store: fixture.openStore(),
      provider: { kind: 'openai', execute },
      artifactStore: createMockArtifactStore({ paths: fixture.paths }),
      enabled: true,
    })).toThrowError(expect.objectContaining({ code: 'real_provider_denied' }));
    expect(execute).not.toHaveBeenCalled();
  });

  it('refuses a provider that only spoofs the mock kind', () => {
    const fixture = createExecutionFixture();
    fixtures.push(fixture);
    const execute = vi.fn();
    expect(() => createExecutionRuntime({
      store: fixture.openStore(),
      provider: { kind: 'mock', execute },
      artifactStore: createMockArtifactStore({ paths: fixture.paths }),
      enabled: true,
    })).toThrowError(expect.objectContaining({ code: 'real_provider_denied' }));
    expect(execute).not.toHaveBeenCalled();
  });

  it('makes callback, outbound, publish, and deploy effects impossible', () => {
    const effects = createEffectsFirewall();
    for (const action of ['callback', 'outbound', 'publish', 'deploy']) {
      expect(() => effects[action]()).toThrowError(expect.objectContaining({ code: 'external_effect_denied' }));
    }
  });

  it('reuses identical deterministic artifact bytes and rejects an identity conflict', () => {
    const fixture = createExecutionFixture();
    fixtures.push(fixture);
    const artifacts = createMockArtifactStore({ paths: fixture.paths });
    const first = artifacts.write({ jobId: 'job_safe', output: { value: 1 } });
    expect(artifacts.write({ jobId: 'job_safe', output: { value: 1 } })).toEqual(first);
    expect(() => artifacts.write({ jobId: 'job_safe', output: { value: 2 } }))
      .toThrowError(expect.objectContaining({ code: 'artifact_identity_conflict' }));
  });

  it('refuses job and artifact directory symlinks before writing bytes', () => {
    const fixture = createExecutionFixture();
    fixtures.push(fixture);
    const artifacts = createMockArtifactStore({ paths: fixture.paths });
    const outside = path.join(fixture.root, 'outside-artifacts');
    fs.mkdirSync(outside);

    fs.symlinkSync(outside, path.join(fixture.executionRoot, 'job_linked'));
    expect(() => artifacts.write({ jobId: 'job_linked', output: { value: 1 } }))
      .toThrowError(expect.objectContaining({ code: 'path_not_allowed' }));

    const jobDirectory = path.join(fixture.executionRoot, 'job_nested');
    fs.mkdirSync(jobDirectory);
    fs.symlinkSync(outside, path.join(jobDirectory, 'artifacts'));
    expect(() => artifacts.write({ jobId: 'job_nested', output: { value: 1 } }))
      .toThrowError(expect.objectContaining({ code: 'path_not_allowed' }));
    expect(fs.readdirSync(outside)).toEqual([]);
  });

  it('reuses the same artifact after a crash between file write and database completion', () => {
    const fixture = createExecutionFixture();
    fixtures.push(fixture);
    const { store, provider } = prepare(fixture);
    const artifacts = createMockArtifactStore({ paths: fixture.paths });
    const abandoned = store.claimNextJob({ workerId: 'abandoned-worker', leaseMs: 1000 });
    const abandonedResult = provider.execute(abandoned);
    const firstArtifact = artifacts.write({ jobId: abandoned.job_id, output: abandonedResult.output });
    fixture.clock.advance(1001);
    const recovered = store.claimNextJob({ workerId: 'recovery-worker', leaseMs: 1000 });
    const recoveredResult = provider.execute(recovered);
    const recoveredArtifact = artifacts.write({ jobId: recovered.job_id, output: recoveredResult.output });
    expect(recoveredArtifact).toEqual(firstArtifact);
    expect(store.completeJob({ lease: recovered, call: recoveredResult.call, artifact: recoveredArtifact }).state)
      .toBe('awaiting_approval');
  });

  it('rechecks the global pause after acquiring a lease and before the provider call', () => {
    const fixture = createExecutionFixture();
    fixtures.push(fixture);
    const baseStore = fixture.openStore();
    baseStore.acceptStagingPacket({ packet: stagingPacket(1), siteId: 'project-1' });
    baseStore.setPaused(false, 'test');
    baseStore.setDispatchEnabled(true, 'test');
    baseStore.setWorkerEnabled(true, 'test');
    baseStore.dispatchPending();
    const provider = createMockProvider();
    const store = {
      claimNextJob(input) {
        const lease = baseStore.claimNextJob(input);
        baseStore.setPaused(true, 'test-race');
        return lease;
      },
      assertWorkerRunnable: () => baseStore.assertWorkerRunnable(),
    };
    const runtime = createExecutionRuntime({
      store,
      provider,
      artifactStore: createMockArtifactStore({ paths: fixture.paths }),
      enabled: true,
      leaseMs: 1000,
    });
    expect(() => runtime.runOne()).toThrowError(expect.objectContaining({ code: 'execution_paused' }));
    expect(provider.telemetry().mock_calls).toBe(0);
  });

  it.each(['missing', 'corrupt'])('fails closed when the global pause row is %s after lease acquisition', (mode) => {
    const fixture = createExecutionFixture();
    fixtures.push(fixture);
    const baseStore = fixture.openStore();
    baseStore.acceptStagingPacket({ packet: stagingPacket(1), siteId: 'project-1' });
    baseStore.setPaused(false, 'test');
    baseStore.setDispatchEnabled(true, 'test');
    baseStore.setWorkerEnabled(true, 'test');
    baseStore.dispatchPending();
    const provider = createMockProvider();
    const store = {
      claimNextJob(input) {
        const lease = baseStore.claimNextJob(input);
        const db = baseStore.rawDatabaseForTests();
        if (mode === 'missing') {
          db.prepare("DELETE FROM ExecutionControls WHERE control_key = 'global_pause'").run();
        } else {
          db.prepare("UPDATE ExecutionControls SET control_value = 'invalid' WHERE control_key = 'global_pause'").run();
        }
        return lease;
      },
      assertWorkerRunnable: () => baseStore.assertWorkerRunnable(),
    };
    const runtime = createExecutionRuntime({
      store,
      provider,
      artifactStore: createMockArtifactStore({ paths: fixture.paths }),
      enabled: true,
      leaseMs: 1000,
    });
    expect(() => runtime.runOne()).toThrowError(expect.objectContaining({ code: 'execution_paused' }));
    expect(provider.telemetry().mock_calls).toBe(0);
  });

  it('rejects inconsistent call outcomes and malformed artifact identities atomically', () => {
    const fixture = createExecutionFixture();
    fixtures.push(fixture);
    const { store, provider } = prepare(fixture);
    const lease = store.claimNextJob({ workerId: 'invariant-worker', leaseMs: 1000 });
    const successful = provider.execute(lease);
    expect(() => store.failJob({
      lease,
      call: successful.call,
      retryable: false,
      failureClass: 'mock_policy',
      reason: 'mismatch',
    })).toThrowError(expect.objectContaining({ code: 'model_call_outcome_mismatch' }));
    expect(() => store.completeJob({
      lease,
      call: successful.call,
      artifact: { logical_key: '../escape', version: 1, artifact_ref: 'fixture:bad', sha256: 'a'.repeat(64), bytes: 1 },
    })).toThrowError(expect.objectContaining({ code: 'artifact_invalid' }));
    expect(store.snapshotCounts().ExecutionModelCalls).toBe(0);
    expect(store.getJob(lease.job_id).state).toBe('running');
  });
});
