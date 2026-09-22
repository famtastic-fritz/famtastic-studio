import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPhase2WorkerService } from '../server/kernel/durable-execution/phase2/runtime.js';
import { createVertexGeminiProvider } from '../server/kernel/durable-execution/phase2/vertex-gemini-provider.js';
import { VERTEX_GEMINI_REQUEST_TIMEOUT_MS } from '../server/kernel/durable-execution/phase2/vertex-gemini-provider-support.js';
import {
  assertProviderSubmissionAuthorization, PHASE2_PROVIDER_MIN_REMAINING_LEASE_MS,
} from '../server/kernel/durable-execution/phase2/provider-submission.js';
import { createComposedPhase2ProofHarness } from './helpers/phase2-proof-composed-harness.js';
import { phase2ProofPacket } from './helpers/phase2-proof-fixtures.js';
import { installProcessNetworkGuard } from './helpers/phase2-proof-fakes.js';
import { activeFencingHarness, seedField } from './helpers/phase2-fencing-fixture.js';

let network;
beforeEach(() => { network = installProcessNetworkGuard(); });
afterEach(() => {
  try { expect(Object.values(network.attempts)).toEqual([0, 0, 0, 0, 0]); }
  finally { network.restore(); }
});

const authorize = (h) => h.store.authorizeProviderSubmission({ lease: h.lease, modelCallId: h.call.model_call_id });

async function composedWorker(wrapStore = (store) => store) {
  const h = await createComposedPhase2ProofHarness();
  await h.store.setControls({ global_pause: false, dispatch_enabled: true,
    worker_enabled: true, provider_enabled: true }, 'synthetic-presubmission');
  expect((await h.call(h.controlHandler, {
    url: '/v1/staging/accept', body: { packet: phase2ProofPacket(1) },
    principal: h.runtime.gcp.intake_service_account,
  })).status).toBe(202);
  expect((await h.call(h.controlHandler, {
    url: '/internal/reconcile', body: {}, principal: h.runtime.gcp.scheduler_service_account,
  })).status).toBe(200);
  const worker = createPhase2WorkerService({
    config: h.runtime, store: wrapStore(h.store, h), sourceStore: h.sourceStore,
    artifactStore: h.artifactStore, effects: h.effects, clock: h.now,
    provider: createVertexGeminiProvider({ client: h.fakeVertex.client,
      projectId: h.runtime.gcp.project_id, location: h.runtime.provider.location }),
  });
  return { ...h, execute: () => worker.execute({ body: h.taskBodies()[0] }) };
}

describe('Phase 2 provider pre-submission fencing (synthetic only)', () => {
  it('authorizes an exact reserved call without claiming that submission occurred', async () => {
    const h = await activeFencingHarness();
    const budget = await h.store.getBudget('pilot-1');
    const receipt = await authorize(h);
    expect(receipt).toMatchObject({ job_id: h.lease.job_id, attempt_id: h.lease.attempt_id,
      model_call_id: h.call.model_call_id, dispatch_generation: 1, authorized_at_ms: h.now() });
    expect(await h.store.getModelCall(h.call.model_call_id)).toMatchObject({
      state: 'reserved', provider_submission_authorized_at_ms: h.now(), actual_cost_micros: null,
    });
    expect(await h.store.getBudget('pilot-1')).toEqual(budget);
    expect(() => assertProviderSubmissionAuthorization(h.lease, h.call.model_call_id, receipt, h.now())).not.toThrow();
  });

  it.each([
    ['executionJobs', 'job_id', 'job_id', 'foreign'],
    ['executionJobs', 'job_id', 'state', 'dead_letter'],
    ['executionJobs', 'job_id', 'active_attempt_id', 'foreign'],
    ['executionJobs', 'job_id', 'fencing_token', 99],
    ['executionJobs', 'job_id', 'lease_token', 'foreign'],
    ['executionJobs', 'job_id', 'site_id', 'foreign'],
    ['executionJobs', 'job_id', 'packet_digest', 'foreign'],
    ['executionJobs', 'job_id', 'source_ref', 'foreign'],
    ['executionOutbox', 'intent_id', 'intent_id', 'foreign'],
    ['executionOutbox', 'intent_id', 'job_id', 'foreign'],
    ['executionOutbox', 'intent_id', 'pilot_run_id', 'foreign'],
    ['executionOutbox', 'intent_id', 'dispatch_generation', 2],
    ['executionAttempts', 'attempt_id', 'attempt_id', 'foreign'],
    ['executionAttempts', 'attempt_id', 'dispatch_generation', 2],
    ['executionAttempts', 'attempt_id', 'model_call_id', 'foreign'],
    ['executionAttempts', 'attempt_id', 'state', 'provider_succeeded'],
    ['executionModelCalls', 'model_call_id', 'model_call_id', 'foreign'],
    ['executionModelCalls', 'model_call_id', 'attempt_id', 'foreign'],
    ['executionModelCalls', 'model_call_id', 'job_id', 'foreign'],
    ['executionModelCalls', 'model_call_id', 'state', 'completed'],
    ['executionModelCalls', 'model_call_id', 'model', 'foreign'],
    ['executionModelCalls', 'model_call_id', 'provider', 'foreign'],
    ['executionModelCalls', 'model_call_id', 'pricebook_version', 'foreign'],
    ['executionModelCalls', 'model_call_id', 'reserved_cost_micros', 1],
  ])('rejects %s.%s field %s before authorization writes', async (collection, idKey, field, value) => {
    const h = await activeFencingHarness();
    seedField(h, collection, { ...h.lease, ...h.call }[idKey], field, value);
    const before = h.firestore.dump();
    await expect(authorize(h)).rejects.toThrow();
    expect(h.firestore.dump()).toEqual(before);
  });

  it.each([{ global_pause: true }, { worker_enabled: false }, { provider_enabled: false },
    { active_pilot_run_id: 'foreign' }])('rechecks persistent controls %j', async (patch) => {
    const h = await activeFencingHarness();
    const path = 'executionControls/global';
    h.firestore.seed(path, { ...h.firestore.read(path), ...patch });
    const before = h.firestore.dump();
    await expect(authorize(h)).rejects.toThrow();
    expect(h.firestore.dump()).toEqual(before);
  });

  it('requires the shared provider timeout plus headroom, including at the local boundary', async () => {
    expect(PHASE2_PROVIDER_MIN_REMAINING_LEASE_MS).toBe(VERTEX_GEMINI_REQUEST_TIMEOUT_MS + 5_000);
    const h = await activeFencingHarness({ leaseMs: PHASE2_PROVIDER_MIN_REMAINING_LEASE_MS });
    const receipt = await authorize(h);
    expect(() => assertProviderSubmissionAuthorization(h.lease, h.call.model_call_id, receipt, h.now())).not.toThrow();
    expect(() => assertProviderSubmissionAuthorization(h.lease, h.call.model_call_id, receipt, h.now() + 1))
      .toThrow(expect.objectContaining({ code: 'phase2_provider_lease_insufficient' }));
    h.advance(1);
    const before = h.firestore.dump();
    await expect(authorize(h)).rejects.toMatchObject({ code: 'phase2_provider_lease_insufficient' });
    expect(h.firestore.dump()).toEqual(before);
  });

  it('refuses a work envelope different from the one durably claimed', async () => {
    const h = await activeFencingHarness();
    h.lease.work_envelope = { ...h.lease.work_envelope, packet_digest: 'f'.repeat(64) };
    const before = h.firestore.dump();
    await expect(authorize(h)).rejects.toMatchObject({ code: 'work_envelope_binding_mismatch' });
    expect(h.firestore.dump()).toEqual(before);
  });

  it.each(['executionJobs', 'executionBudgets'].flatMap((collection) =>
    [0, undefined, NaN, '80000'].map((value) => [collection, value])))('requires %s to cover the reserved call, rejecting %s', async (collection, value) => {
    const h = await activeFencingHarness();
    seedField(h, collection, collection === 'executionJobs' ? h.lease.job_id : h.lease.pilot_run_id, 'reserved_cost_micros', value);
    const before = h.firestore.dump();
    await expect(authorize(h)).rejects.toMatchObject({ code: 'model_call_identity_conflict' });
    expect(h.firestore.dump()).toEqual(before);
  });

  it('rejects a backwards local clock or mismatched authorization receipt', async () => {
    const h = await activeFencingHarness();
    const receipt = await authorize(h);
    for (const [value, now] of [[receipt, h.now() - 1], [{ ...receipt, model_call_id: 'foreign' }, h.now()],
      [{ ...receipt, lease_expires_at_ms: receipt.lease_expires_at_ms + 1 }, h.now()]]) {
      expect(() => assertProviderSubmissionAuthorization(h.lease, h.call.model_call_id, value, now))
        .toThrow(expect.objectContaining({ code: 'phase2_provider_authorization_invalid' }));
    }
  });

  it.each([1_000, 116_000])('refreshes authorization time after a discarded transaction retry delayed %i ms', async (delay) => {
    const h = await activeFencingHarness();
    const original = h.firestore.runTransaction.bind(h.firestore);
    h.firestore.runTransaction = async (operation) => {
      await original(async (tx) => { await operation(tx); tx.operations = []; });
      h.advance(delay);
      return original(operation);
    };
    if (delay === 1_000) {
      expect((await authorize(h)).authorized_at_ms).toBe(h.now());
    } else {
      const before = h.firestore.dump();
      await expect(authorize(h)).rejects.toMatchObject({ code: 'phase2_provider_lease_insufficient' });
      expect(h.firestore.dump()).toEqual(before);
    }
  });

  it.each(['reserveModelCall', 'authorizeProviderSubmission'])('does not submit after delayed %s response and terminal reconciliation', async (boundary) => {
    const h = await composedWorker((store, base) => ({ ...store, async [boundary](input) {
      const receipt = await store[boundary](input);
      base.advance(240_001);
      await store.reconcile({ pilotRunId: base.runtime.pilot_run_id, apply: true });
      expect((await store.getJob('job-01')).state).toBe('dead_letter');
      return receipt;
    } }));
    // Failure settlement also refuses the now-terminal attempt. It must not
    // overwrite reconciliation's uncertain cost with a pre-provider zero.
    await expect(h.execute()).rejects.toMatchObject({ code: 'attempt_identity_conflict' });
    expect(h.fakeVertex.calls).toHaveLength(0);
    expect(h.artifactMemory.objects.size).toBe(0);
    expect(await h.store.getBudget(h.runtime.pilot_run_id)).toMatchObject({
      reserved_cost_micros: 0, uncertain_cost_micros: 80_000,
    });
  });

  it('rejects an authorization response with insufficient lease left, before provider work', async () => {
    const h = await composedWorker((store, base) => ({ ...store, async authorizeProviderSubmission(input) {
      const receipt = await store.authorizeProviderSubmission(input);
      base.advance(116_000);
      return receipt;
    } }));
    expect((await h.execute()).body).toMatchObject({ ok: false, state: 'retry_wait' });
    expect(h.fakeVertex.calls).toHaveLength(0);
    expect(await h.store.getBudget(h.runtime.pilot_run_id)).toMatchObject({
      reserved_cost_micros: 0, settled_cost_micros: 0, uncertain_cost_micros: 0,
    });
  });

  it('can settle a lost authorization response at zero because submission never occurred', async () => {
    const h = await composedWorker((store) => ({ ...store, async authorizeProviderSubmission(input) {
      await store.authorizeProviderSubmission(input);
      throw Object.assign(new Error('synthetic lost authorization response'), { code: 14 });
    } }));
    expect((await h.execute()).body.state).toBe('retry_wait');
    expect(h.fakeVertex.calls).toHaveLength(0);
    expect(await h.store.getBudget(h.runtime.pilot_run_id)).toMatchObject({
      reserved_cost_micros: 0, settled_cost_micros: 0, uncertain_cost_micros: 0,
    });
  });

  it('requires the new store API and completes the positive authorized path', async () => {
    await expect(composedWorker((store) => ({ ...store, authorizeProviderSubmission: undefined })))
      .rejects.toMatchObject({ code: 'phase2_runtime_dependency_invalid' });
    let authorization;
    const h = await composedWorker((store) => ({ ...store,
      authorizeProviderSubmission: authorization = vi.fn((input) => store.authorizeProviderSubmission(input)),
    }));
    expect((await h.execute()).body.state).toBe('awaiting_approval');
    expect(authorization).toHaveBeenCalledTimes(1);
    expect(h.fakeVertex.calls).toHaveLength(1);
  });
});
