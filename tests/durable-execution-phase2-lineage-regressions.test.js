import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { idempotencyDocumentId } from '../server/kernel/durable-execution/phase2/firestore-values.js';
import { WORKER_CLAIM_ACK_MS } from '../server/kernel/durable-execution/phase2/firestore-dispatch-support.js';
import { activeFencingHarness, claimInput, seedField } from './helpers/phase2-fencing-fixture.js';
import { installProcessNetworkGuard } from './helpers/phase2-proof-fakes.js';
import { accept, dispatchAndClaim, reservationFor, storeHarness, taskName, workEnvelope } from './helpers/phase2-store-fixture.js';

let network;
beforeEach(() => { network = installProcessNetworkGuard(); });
afterEach(() => {
  try { expect(Object.values(network.attempts)).toEqual([0, 0, 0, 0, 0]); }
  finally { network.restore(); }
});

const complete = (h, lease = h.lease) => h.store.completeJob({ lease, modelCallId: h.call.model_call_id, artifact: h.artifact });

describe('A1 completion outbox lineage (synthetic only)', () => {
  it.each([['job_id', 'foreign'], ['intent_id', 'foreign'], ['pilot_run_id', 'foreign'],
    ['dispatch_generation', 2], ['dispatch_generation', 1.5]])('rejects outbox %s=%s without settlement', async (field, value) => {
    const h = await activeFencingHarness({ checkpoint: true });
    seedField(h, 'executionOutbox', h.lease.intent_id, field, value);
    const before = h.firestore.dump();
    await expect(complete(h)).rejects.toMatchObject({ code: 'dispatch_identity_conflict' });
    expect(h.firestore.dump()).toEqual(before);
    expect(await h.store.count('artifacts')).toBe(0);
  });

  it('refuses a missing outbox rather than completing a detached checkpoint', async () => {
    const h = await activeFencingHarness({ checkpoint: true });
    h.firestore.delete(`executionOutbox/${h.lease.intent_id}`);
    const before = h.firestore.dump();
    await expect(complete(h)).rejects.toThrow();
    expect(h.firestore.dump()).toEqual(before);
  });
});

describe('A2 expired claim and checkpoint generation lineage (synthetic only)', () => {
  it.each([false, true])('rejects an expired attempt of a foreign generation, checkpoint=%s', async (checkpoint) => {
    const h = await activeFencingHarness({ checkpoint });
    seedField(h, 'executionAttempts', h.lease.attempt_id, 'dispatch_generation', 2);
    h.advance(240_001);
    const before = h.firestore.dump();
    await expect(h.store.claimJob(claimInput(h))).rejects.toMatchObject({ code: 'dispatch_identity_conflict' });
    expect(h.firestore.dump()).toEqual(before);
    expect(await h.store.getBudget('pilot-1')).toMatchObject({ reserved_cost_micros: 80_000, uncertain_cost_micros: 0 });
  });

  it('allows an expired checkpoint to resume on its exact current generation', async () => {
    const h = await activeFencingHarness({ checkpoint: true });
    h.advance(240_001);
    const outbox = await h.store.getOutbox(h.lease.intent_id);
    const resumed = await h.store.claimJob(claimInput(h, { taskName: outbox.task_name }));
    expect(resumed).toMatchObject({ resumed: true, dispatch_generation: 1, attempt_id: h.lease.attempt_id });
    expect(resumed.fencing_token).toBe(h.lease.fencing_token + 1);
    expect((await complete(h, resumed)).state).toBe('awaiting_approval');
    expect(await h.store.count('calls')).toBe(1);
  });

  it('preserves one checkpoint through two unclaimed generation redrives and completion', async () => {
    const h = await activeFencingHarness({ checkpoint: true });
    h.advance(240_001);
    await h.store.reconcile({ pilotRunId: 'pilot-1', apply: true });
    for (const generation of [2, 3]) {
      const r = await h.store.reserveDispatch({ intentId: h.lease.intent_id, dispatcherId: 'synthetic-redrive' });
      expect(r.dispatch_generation).toBe(generation);
      await h.store.markDispatchDelivered({ intentId: h.lease.intent_id, dispatchGeneration: generation,
        reservationToken: r.reservation_token, taskName: taskName(r) });
      h.advance(WORKER_CLAIM_ACK_MS + 1);
      await h.store.reconcile({ pilotRunId: 'pilot-1', apply: true });
    }
    expect(await h.store.getAttempt(h.lease.attempt_id)).toMatchObject({ state: 'resume_scheduled', dispatch_generation: 1 });
    const { lease } = await dispatchAndClaim(h.store, h.accepted, { generation: 4, leaseMs: 240_000 });
    expect(lease).toMatchObject({ resumed: true, attempt_id: h.lease.attempt_id, dispatch_generation: 4 });
    expect(lease.provider_checkpoint.model_call_id).toBe(h.call.model_call_id);
    expect((await complete(h, lease)).state).toBe('awaiting_approval');
    expect(await h.store.count('calls')).toBe(1);
    expect(await h.store.count('attempts')).toBe(1);
    expect(await h.store.getBudget('pilot-1')).toMatchObject({ reserved_cost_micros: 0, settled_cost_micros: 550 });
  });

  it.each([2, 3])('rejects a scheduled checkpoint whose generation %i is not a predecessor', async (generation) => {
    const h = await activeFencingHarness({ checkpoint: true });
    h.advance(240_001);
    await h.store.reconcile({ pilotRunId: 'pilot-1', apply: true });
    seedField(h, 'executionAttempts', h.lease.attempt_id, 'dispatch_generation', generation);
    const before = h.firestore.dump();
    await expect(h.store.claimJob(claimInput(h, { dispatchGeneration: 2 })))
      .rejects.toMatchObject({ code: 'dispatch_identity_conflict' });
    expect(h.firestore.dump()).toEqual(before);
  });

  it('does not reinterpret an unscheduled same-generation checkpoint as a valid predecessor', async () => {
    const h = await activeFencingHarness({ checkpoint: true });
    h.advance(240_001);
    await h.store.reconcile({ pilotRunId: 'pilot-1', apply: true });
    seedField(h, 'executionAttempts', h.lease.attempt_id, 'dispatch_generation', 2);
    seedField(h, 'executionAttempts', h.lease.attempt_id, 'state', 'provider_succeeded');
    const before = h.firestore.dump();
    await expect(h.store.claimJob(claimInput(h, { dispatchGeneration: 2 })))
      .rejects.toMatchObject({ code: 'dispatch_identity_conflict' });
    expect(h.firestore.dump()).toEqual(before);
  });
});

async function admissionHarness(operation) {
  const h = await storeHarness();
  await h.enable();
  const envelope = workEnvelope();
  const input = reservationFor(envelope);
  await h.store.reserveWorkAdmission(input);
  const finalize = () => h.store.finalizeWorkAdmission({ envelope, siteId: envelope.site_id,
    pilotRunId: envelope.pilot_run_id, idempotencyKey: envelope.idempotency_key });
  if (operation.startsWith('duplicate')) await finalize();
  return { ...h, envelope, input, keyId: idempotencyDocumentId(envelope.site_id, envelope.idempotency_key),
    invoke: operation.endsWith('finalize') ? finalize : () => h.store.reserveWorkAdmission(input) };
}

describe('A3 duplicate and renewed admission lineage (synthetic only)', () => {
  for (const operation of ['renew', 'finalize', 'duplicate-reserve', 'duplicate-finalize']) {
    it.each(['job_id', 'task_id', 'site_id', 'pilot_run_id', 'packet_id', 'project_id',
      'request_id', 'idempotency_key', 'packet_digest', 'artifact_manifest_sha256',
      'selected_direction_id', 'intent_id', 'identity_digest', 'receipt_id'])(`${operation} rejects a cross-linked job.%s`, async (field) => {
      const h = await admissionHarness(operation);
      seedField(h, 'executionJobs', h.envelope.job_id, field, 'foreign');
      const before = h.firestore.dump();
      await expect(h.invoke()).rejects.toThrow();
      expect(h.firestore.dump()).toEqual(before);
    });

    it.each(['job_id', 'task_id', 'site_id', 'pilot_run_id', 'idempotency_key', 'intent_id', 'receipt_id'])(`${operation} rejects a redirected binding.%s`, async (field) => {
      const h = await admissionHarness(operation);
      seedField(h, 'executionIdempotency', h.keyId, field, 'foreign');
      const before = h.firestore.dump();
      await expect(h.invoke()).rejects.toThrow();
      expect(h.firestore.dump()).toEqual(before);
    });
  }

  for (const operation of ['duplicate-reserve', 'duplicate-finalize']) {
    it.each([['job_id', 'foreign'], ['intent_id', 'foreign'], ['pilot_run_id', 'foreign'],
      ['dispatch_generation', 0], ['dispatch_generation', 11]])(`${operation} rejects outbox.%s=%s`, async (field, value) => {
      const h = await admissionHarness(operation);
      const job = await h.store.getJob(h.envelope.job_id);
      seedField(h, 'executionOutbox', job.intent_id, field, value);
      const before = h.firestore.dump();
      await expect(h.invoke()).rejects.toThrow();
      expect(h.firestore.dump()).toEqual(before);
    });

    it.each(['envelope_digest', 'source_ref', 'source_sha256', 'source_bytes'])(`${operation} rejects binding source mismatch %s`, async (field) => {
      const h = await admissionHarness(operation);
      seedField(h, 'executionIdempotency', h.keyId, field, 'foreign');
      const before = h.firestore.dump();
      await expect(h.invoke()).rejects.toThrow();
      expect(h.firestore.dump()).toEqual(before);
    });
  }

  it('renews a matching reservation, then returns exact duplicates without consuming another slot', async () => {
    const h = await admissionHarness('renew');
    h.advance(1_000);
    expect(await h.invoke()).toMatchObject({ finalized: false, reservation_generation: 2, expires_at_ms: h.now() + 900_000 });
    const first = await accept(h.store, h.envelope);
    const before = h.firestore.dump();
    expect((await h.invoke()).acceptance).toMatchObject({ job_id: first.job_id, receipt_id: first.receipt_id, duplicate: true });
    expect(await accept(h.store, h.envelope)).toMatchObject({ job_id: first.job_id, receipt_id: first.receipt_id, duplicate: true });
    expect(h.firestore.dump()).toEqual(before);
    expect(await h.store.getBudget('pilot-1')).toMatchObject({ accepted_jobs: 1 });
  });
});
