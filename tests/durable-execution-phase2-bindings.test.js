import { describe, expect, it } from 'vitest';
import { canonicalDigest, canonicalJson } from '../server/kernel/durable-execution/phase2/canonical.js';
import {
  VERTEX_GEMINI_MODEL,
  VERTEX_GEMINI_PRICEBOOK_VERSION,
} from '../server/kernel/durable-execution/phase2/pricebook.js';
import {
  accept,
  dispatchAndClaim,
  providerOutput,
  storeHarness,
} from './helpers/phase2-store-fixture.js';

const CALL_COST = 500;

async function activeAttempt({ reserveCall = false } = {}) {
  const base = await storeHarness();
  await base.enable();
  const accepted = await accept(base.store);
  const { lease } = await dispatchAndClaim(base.store, accepted);
  const call = reserveCall
    ? await base.store.reserveModelCall({
      lease,
      model: VERTEX_GEMINI_MODEL,
      reservedCostMicros: CALL_COST,
      pricebookVersion: VERTEX_GEMINI_PRICEBOOK_VERSION,
    })
    : null;
  return { ...base, accepted, lease, call };
}

function checkpointInput(lease, call, output = providerOutput()) {
  return {
    lease,
    modelCallId: call.model_call_id,
    output,
    providerRequestId: 'provider-request-1',
    inputTokens: 10,
    outputTokens: 10,
    thinkingTokens: 0,
    cachedInputTokens: 0,
    totalTokens: 20,
    latencyMs: 10,
    promptVersion: 'prompt-v1',
    inputSha256: 'e'.repeat(64),
    actualCostMicros: 200,
  };
}

describe('Phase 2 Firestore ownership bindings', () => {
  it.each([
    ['attempt_id', 'attempt_other'],
    ['job_id', 'job-other'],
    ['task_id', 'task-other'],
    ['pilot_run_id', 'pilot-other'],
    ['packet_id', 'packet-other'],
    ['project_id', 'project-other'],
    ['intent_id', 'intent-other'],
    ['dispatch_generation', 2],
    ['attempt_number', 2],
    ['worker_id', 'worker-other'],
    ['lease_token', 'lease-other'],
    ['fencing_token', 2],
    ['lease_expires_at_ms', 1_800_000_999_999],
  ])('reserveModelCall rejects a cross-linked attempt.%s', async (field, value) => {
    const base = await activeAttempt();
    const path = `executionAttempts/${base.lease.attempt_id}`;
    base.firestore.seed(path, { ...base.firestore.read(path), [field]: value });

    await expect(base.store.reserveModelCall({
      lease: base.lease,
      model: VERTEX_GEMINI_MODEL,
      reservedCostMicros: CALL_COST,
      pricebookVersion: VERTEX_GEMINI_PRICEBOOK_VERSION,
    })).rejects.toMatchObject({ code: 'attempt_identity_conflict', statusCode: 409 });
    expect(await base.store.count('calls')).toBe(0);
    expect(await base.store.getBudget('pilot-1')).toMatchObject({ reserved_cost_micros: 0 });
  });

  it('reserveModelCall rejects an attempt that references a missing different call', async () => {
    const base = await activeAttempt();
    const path = `executionAttempts/${base.lease.attempt_id}`;
    base.firestore.seed(path, {
      ...base.firestore.read(path),
      model_call_id: 'call_different',
    });

    await expect(base.store.reserveModelCall({
      lease: base.lease,
      model: VERTEX_GEMINI_MODEL,
      reservedCostMicros: CALL_COST,
      pricebookVersion: VERTEX_GEMINI_PRICEBOOK_VERSION,
    })).rejects.toMatchObject({ code: 'model_call_identity_conflict', statusCode: 409 });
    expect(await base.store.count('calls')).toBe(0);
  });

  it('reserveModelCall rejects a job lease expiry detached from its attempt', async () => {
    const base = await activeAttempt();
    const path = `executionJobs/${base.accepted.job_id}`;
    base.firestore.seed(path, {
      ...base.firestore.read(path),
      lease_expires_at_ms: base.lease.lease_expires_at_ms + 1,
    });

    await expect(base.store.reserveModelCall({
      lease: base.lease,
      model: VERTEX_GEMINI_MODEL,
      reservedCostMicros: CALL_COST,
      pricebookVersion: VERTEX_GEMINI_PRICEBOOK_VERSION,
    })).rejects.toMatchObject({ code: 'attempt_identity_conflict', statusCode: 409 });
    expect(await base.store.count('calls')).toBe(0);
  });

  it.each([
    ['model_call_id', 'call_other'],
    ['job_id', 'job-other'],
    ['attempt_id', 'attempt_other'],
  ])('checkpointProviderSuccess rejects a cross-linked call.%s', async (field, value) => {
    const base = await activeAttempt({ reserveCall: true });
    const path = `executionModelCalls/${base.call.model_call_id}`;
    base.firestore.seed(path, { ...base.firestore.read(path), [field]: value });

    await expect(base.store.checkpointProviderSuccess(
      checkpointInput(base.lease, base.call),
    )).rejects.toMatchObject({ code: 'model_call_identity_conflict', statusCode: 409 });
    expect(await base.store.getBudget('pilot-1')).toMatchObject({ reserved_cost_micros: CALL_COST });
  });

  it('completeJob revalidates the attempt lease before settling a checkpoint', async () => {
    const base = await activeAttempt({ reserveCall: true });
    const output = providerOutput();
    await base.store.checkpointProviderSuccess(checkpointInput(base.lease, base.call, output));
    const attemptPath = `executionAttempts/${base.lease.attempt_id}`;
    base.firestore.seed(attemptPath, {
      ...base.firestore.read(attemptPath),
      fencing_token: base.lease.fencing_token + 1,
    });

    await expect(base.store.completeJob({
      lease: base.lease,
      modelCallId: base.call.model_call_id,
      artifact: {
        logical_key: 'shadow-result',
        version: 1,
        artifact_ref: 'gs://pilot/shadow-result.json#1',
        sha256: canonicalDigest(output),
        bytes: Buffer.byteLength(canonicalJson(output)),
      },
    })).rejects.toMatchObject({ code: 'attempt_identity_conflict', statusCode: 409 });
    expect(await base.store.getJob(base.accepted.job_id)).toMatchObject({ state: 'running' });
    expect(await base.store.count('artifacts')).toBe(0);
  });

  it.each([
    ['job_id', 'job-other'],
    ['pilot_run_id', 'pilot-other'],
    ['intent_id', 'intent-other'],
    ['dispatch_generation', 2],
  ])('failJob rejects a cross-linked outbox.%s', async (field, value) => {
    const base = await activeAttempt({ reserveCall: true });
    const path = `executionOutbox/${base.lease.intent_id}`;
    base.firestore.seed(path, { ...base.firestore.read(path), [field]: value });

    await expect(base.store.failJob({
      lease: base.lease,
      modelCallId: base.call.model_call_id,
      retryable: true,
      failureClass: 'provider_transient',
      reason: 'retry',
      actualCostMicros: 0,
    })).rejects.toMatchObject({ code: 'dispatch_identity_conflict', statusCode: 409 });
    expect(await base.store.getModelCall(base.call.model_call_id)).toMatchObject({ state: 'reserved' });
    expect(await base.store.getBudget('pilot-1')).toMatchObject({ reserved_cost_micros: CALL_COST });
  });

  it('markUncertain rejects an attempt that references another model call', async () => {
    const base = await activeAttempt({ reserveCall: true });
    const path = `executionAttempts/${base.lease.attempt_id}`;
    base.firestore.seed(path, {
      ...base.firestore.read(path),
      model_call_id: 'call_different',
    });

    await expect(base.store.markUncertain({
      lease: base.lease,
      modelCallId: base.call.model_call_id,
      reason: 'unknown provider outcome',
    })).rejects.toMatchObject({ code: 'model_call_identity_conflict', statusCode: 409 });
    expect(await base.store.getModelCall(base.call.model_call_id)).toMatchObject({ state: 'reserved' });
    expect(await base.store.getBudget('pilot-1')).toMatchObject({ reserved_cost_micros: CALL_COST });
  });
});
