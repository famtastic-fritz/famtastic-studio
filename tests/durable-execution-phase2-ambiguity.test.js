import { describe, expect, it, vi } from 'vitest';
import { WORKER_CLAIM_ACK_MS } from '../server/kernel/durable-execution/phase2/firestore-dispatch-support.js';
import {
  VERTEX_GEMINI_MODEL,
  VERTEX_GEMINI_PRICEBOOK_VERSION,
} from '../server/kernel/durable-execution/phase2/pricebook.js';
import {
  definiteTaskCreateFailure,
  failRuntimeBeforeProvider,
  transientRuntimeFailure,
} from '../server/kernel/durable-execution/phase2/runtime-support.js';
import {
  accept,
  dispatchAndClaim,
  storeHarness,
  taskName,
  workEnvelope,
} from './helpers/phase2-store-fixture.js';

async function deliverWithoutClaim(base, accepted, generation) {
  const reservation = await base.store.reserveDispatch({
    intentId: accepted.intent_id,
    dispatcherId: 'dispatcher-1',
  });
  expect(reservation.dispatch_generation).toBe(generation);
  const name = taskName(reservation);
  await base.store.markDispatchDelivered({
    intentId: accepted.intent_id,
    dispatchGeneration: generation,
    reservationToken: reservation.reservation_token,
    taskName: name,
  });
  return { reservation, name };
}

async function claim(base, accepted, reservation, name, workerId = 'worker-1') {
  return base.store.claimJob({
    jobId: accepted.job_id,
    intentId: accepted.intent_id,
    dispatchGeneration: reservation.dispatch_generation,
    pilotRunId: 'pilot-1',
    siteId: reservation.site_id,
    packetDigest: reservation.packet_digest,
    workerId,
    leaseMs: 5_000,
    taskName: name,
  });
}

describe('Phase 2 ambiguous-boundary recovery', () => {
  it('classifies native transient Firestore statuses as retryable before provider submission', async () => {
    for (const code of [4, 8, 10, 13, 14]) {
      expect(transientRuntimeFailure({ code })).toBe(true);
    }
    for (const code of ['DEADLINE_EXCEEDED', 'RESOURCE_EXHAUSTED', 'ABORTED', 'INTERNAL', 'UNAVAILABLE']) {
      expect(transientRuntimeFailure({ code })).toBe(true);
    }
    expect(transientRuntimeFailure({ code: 7 })).toBe(false);
    expect(transientRuntimeFailure({ statusCode: 409, code: 'conflict' })).toBe(false);

    const failJob = vi.fn(async (request) => request);
    const result = await failRuntimeBeforeProvider({ failJob }, { job_id: 'job-1' }, {
      code: 14,
    });
    expect(result).toMatchObject({
      retryable: true,
      failureClass: 'phase2_source_transient',
      actualCostMicros: 0,
    });
  });

  it('marks a mismatched existing Cloud Task unknown while retaining none for local conflicts', async () => {
    expect(definiteTaskCreateFailure({
      statusCode: 409,
      code: 'cloud_task_existing_identity_conflict',
    })).toBe(true);

    for (const [error, executionRisk] of [
      ['cloud_task_identity_conflict', 'none'],
      ['cloud_task_existing_identity_conflict', 'unknown'],
    ]) {
      const base = await storeHarness();
      await base.enable();
      const accepted = await accept(base.store);
      const reservation = await base.store.reserveDispatch({
        intentId: accepted.intent_id,
        dispatcherId: 'dispatcher-1',
      });
      await base.store.releaseDispatch({
        intentId: accepted.intent_id,
        dispatchGeneration: reservation.dispatch_generation,
        reservationToken: reservation.reservation_token,
        error,
        permanent: true,
        submissionAttempted: true,
      });
      const record = await base.store.findByKey('site-1', 'idem-1');
      expect(record.outbox).toMatchObject({
        state: 'manual_review',
        execution_risk: executionRisk,
        requires_operator_review: true,
      });
      expect(record.job.state).toBe('dead_letter');
    }
  });

  it('settles a committed reservation at zero only with proven pre-provider absence', async () => {
    const base = await storeHarness();
    await base.enable();
    const accepted = await accept(base.store);
    const { lease } = await dispatchAndClaim(base.store, accepted);
    const call = await base.store.reserveModelCall({
      lease,
      model: VERTEX_GEMINI_MODEL,
      reservedCostMicros: 500,
      pricebookVersion: VERTEX_GEMINI_PRICEBOOK_VERSION,
    });

    await expect(base.store.failJob({
      lease,
      retryable: true,
      failureClass: 'phase2_provider_gate_closed',
      reason: 'model-call reservation response was lost',
      actualCostMicros: 0,
    })).rejects.toMatchObject({ code: 'model_call_identity_required', statusCode: 409 });
    await base.store.failJob({
      lease,
      retryable: true,
      failureClass: 'phase2_provider_gate_closed',
      reason: 'model-call reservation response was lost',
      actualCostMicros: 0,
      providerSubmissionConfirmedAbsent: true,
    });

    expect(await base.store.getModelCall(call.model_call_id)).toMatchObject({
      state: 'completed',
      outcome: 'transient_failure',
      actual_cost_micros: 0,
    });
    expect(await base.store.getJob(accepted.job_id)).toMatchObject({
      state: 'retry_wait',
      reserved_cost_micros: 0,
    });
    expect(await base.store.getBudget('pilot-1')).toMatchObject({
      reserved_cost_micros: 0,
      settled_cost_micros: 0,
      uncertain_cost_micros: 0,
    });
  });

  it('rejects a supplied model-call identity that differs from the active attempt', async () => {
    const base = await storeHarness();
    await base.enable();
    const accepted = await accept(base.store);
    const { lease } = await dispatchAndClaim(base.store, accepted);
    const call = await base.store.reserveModelCall({
      lease,
      model: VERTEX_GEMINI_MODEL,
      reservedCostMicros: 500,
      pricebookVersion: VERTEX_GEMINI_PRICEBOOK_VERSION,
    });
    await expect(base.store.failJob({
      lease,
      modelCallId: `${call.model_call_id}_wrong`,
      retryable: true,
      failureClass: 'pre_provider_failure',
      reason: 'test mismatch',
      actualCostMicros: 0,
      providerSubmissionConfirmedAbsent: true,
    })).rejects.toMatchObject({ code: 'model_call_identity_conflict', statusCode: 409 });
    expect(await base.store.getModelCall(call.model_call_id)).toMatchObject({ state: 'reserved' });
    expect(await base.store.getBudget('pilot-1')).toMatchObject({ reserved_cost_micros: 500 });
  });

  it('redrives three exhausted pre-claim deliveries and admits only the current generation', async () => {
    const base = await storeHarness();
    await base.enable();
    const accepted = await accept(base.store);
    let first;
    for (let generation = 1; generation <= 3; generation += 1) {
      const delivered = await deliverWithoutClaim(base, accepted, generation);
      if (!first) first = delivered;
      base.advance(WORKER_CLAIM_ACK_MS + 1);
      const recovery = await base.store.reconcile({ pilotRunId: 'pilot-1', apply: true });
      expect(recovery.redriven_unclaimed).toEqual([{
        job_id: accepted.job_id,
        dispatch_generation: generation + 1,
      }]);
    }
    await expect(claim(base, accepted, first.reservation, first.name, 'stale-worker'))
      .rejects.toMatchObject({ code: 'task_identity_mismatch', statusCode: 409 });

    const current = await deliverWithoutClaim(base, accepted, 4);
    const lease = await claim(base, accepted, current.reservation, current.name, 'current-worker');
    await base.store.reserveModelCall({
      lease,
      model: VERTEX_GEMINI_MODEL,
      reservedCostMicros: 500,
      pricebookVersion: VERTEX_GEMINI_PRICEBOOK_VERSION,
    });

    expect(await base.store.count('attempts')).toBe(1);
    expect(await base.store.count('calls')).toBe(1);
    expect(await base.store.getOutbox(accepted.intent_id)).toMatchObject({
      dispatch_generation: 4,
      worker_claimed_at_ms: base.now(),
      claim_not_after_ms: null,
    });
  });

  it('ends exhausted pre-claim generations in visible manual review', async () => {
    const base = await storeHarness();
    await base.enable();
    const accepted = await accept(base.store, workEnvelope(), { maxDispatchGenerations: 3 });
    for (let generation = 1; generation <= 3; generation += 1) {
      await deliverWithoutClaim(base, accepted, generation);
      base.advance(WORKER_CLAIM_ACK_MS + 1);
      const recovery = await base.store.reconcile({ pilotRunId: 'pilot-1', apply: true });
      if (generation < 3) {
        expect(recovery.redriven_unclaimed).toHaveLength(1);
      } else {
        expect(recovery.unclaimed_manual_reviews).toEqual([accepted.job_id]);
      }
    }
    expect(await base.store.getJob(accepted.job_id)).toMatchObject({
      state: 'dead_letter',
      last_failure_class: 'worker_claim_ack_exhausted',
    });
    expect(await base.store.getOutbox(accepted.intent_id)).toMatchObject({
      state: 'manual_review',
      execution_risk: 'none',
      requires_operator_review: true,
    });
  });
});
