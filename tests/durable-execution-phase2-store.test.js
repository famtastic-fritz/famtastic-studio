import { describe, expect, it } from 'vitest';
import {
  VERTEX_GEMINI_MODEL,
  VERTEX_GEMINI_PRICEBOOK_VERSION,
} from '../server/kernel/durable-execution/phase2/pricebook.js';
import { canonicalDigest, canonicalJson } from '../server/kernel/durable-execution/phase2/canonical.js';
import {
  accept,
  dispatchAndClaim,
  providerOutput,
  reservationFor,
  storeHarness as harness,
  workEnvelope,
} from './helpers/phase2-store-fixture.js';

describe('Phase 2 Firestore execution store', () => {
  it('bootstraps fail-closed controls and atomically deduplicates admission', async () => {
    const { store, firestore, enable } = await harness();
    expect(await store.getControls()).toMatchObject({
      global_pause: true,
      dispatch_enabled: false,
      worker_enabled: false,
      provider_enabled: false,
    });
    await expect(accept(store)).rejects.toMatchObject({ code: 'execution_paused', statusCode: 423 });
    await enable();
    const first = await accept(store);
    expect(first).toMatchObject({ job_id: 'job-1', task_id: 'task-1', packet_digest: 'd'.repeat(64) });
    const duplicate = await accept(store);
    expect(duplicate).toMatchObject({
      job_id: first.job_id,
      task_id: first.task_id,
      receipt_id: first.receipt_id,
      duplicate: true,
    });
    await store.setControls({ global_pause: true }, 'test');
    await expect(accept(store)).rejects.toMatchObject({ code: 'execution_paused', statusCode: 423 });
    await store.setControls({ global_pause: false }, 'test');
    await expect(accept(store, workEnvelope({ project_id: 'changed' }), {
      siteId: 'site-1',
    })).rejects.toMatchObject({ code: 'idempotency_conflict', statusCode: 409 });
    await expect(accept(store, workEnvelope(), { siteId: 'another-site' }))
      .rejects.toMatchObject({ code: 'work_envelope_binding_mismatch', statusCode: 409 });
    expect(await store.snapshotCounts()).toMatchObject({
      agentTaskLog: 1,
      executionJobs: 1,
      executionOutbox: 1,
      executionTaskEvents: 1,
    });
    const controls = firestore.read('executionControls/global');
    firestore.seed('executionControls/global', { ...controls, active_pilot_run_id: 'pilot-2' });
    expect(await store.listDispatchCandidates({ pilotRunId: 'pilot-2' })).toEqual([]);
    await expect(store.reserveDispatch({ intentId: first.intent_id, dispatcherId: 'dispatcher' }))
      .rejects.toMatchObject({ code: 'pilot_scope_conflict' });
    const budget = firestore.read('executionBudgets/pilot-1');
    firestore.seed('executionBudgets/pilot-2', { ...budget, pilot_run_id: 'pilot-2', accepted_jobs: 0 });
    const laterPilot = workEnvelope({ pilot_run_id: 'pilot-2', job_id: 'job-2', task_id: 'task-2' });
    await expect(store.reserveWorkAdmission(reservationFor(laterPilot)))
      .rejects.toMatchObject({ code: 'pilot_scope_conflict' });
  });

  it('converges dispatch release and completes one fenced cloud attempt', async () => {
    const { store, enable } = await harness();
    await enable();
    const accepted = await accept(store);
    const firstReservation = await store.reserveDispatch({ intentId: accepted.intent_id, dispatcherId: 'dispatcher-1' });
    await store.releaseDispatch({
      intentId: accepted.intent_id,
      dispatchGeneration: 1,
      reservationToken: firstReservation.reservation_token,
      error: 'definite create failure',
      baseBackoffMs: 0,
    });
    const { reservation, lease } = await dispatchAndClaim(store, accepted);
    expect(reservation.dispatch_generation).toBe(1);
    const call = await store.reserveModelCall({
      lease, model: VERTEX_GEMINI_MODEL, reservedCostMicros: 500,
      pricebookVersion: VERTEX_GEMINI_PRICEBOOK_VERSION, inputTokensEstimate: 100,
    });
    const output = providerOutput();
    await store.checkpointProviderSuccess({
      lease, modelCallId: call.model_call_id, output,
      providerRequestId: 'provider-request-1', inputTokens: 100,
      outputTokens: 50, thinkingTokens: 10, cachedInputTokens: 5,
      totalTokens: 160, latencyMs: 120, promptVersion: 'prompt-v1',
      inputSha256: 'e'.repeat(64), actualCostMicros: 300,
    });
    const completed = await store.completeJob({
      lease,
      modelCallId: call.model_call_id,
      artifact: {
        logical_key: 'shadow-result', version: 1,
        artifact_ref: `gs://pilot/${accepted.job_id}/shadow-result-v1.json`,
        sha256: canonicalDigest(output), bytes: Buffer.byteLength(canonicalJson(output)),
      },
    });
    expect(completed.state).toBe('awaiting_approval');
    expect(await store.getJob(accepted.job_id)).toMatchObject({
      state: 'awaiting_approval', reserved_cost_micros: 0, settled_cost_micros: 300,
    });
    expect(await store.getBudget('pilot-1')).toMatchObject({
      reserved_cost_micros: 0, settled_cost_micros: 300, uncertain_cost_micros: 0,
    });
    expect((await store.getTask(accepted.task_id)).output_refs).toHaveLength(2);
    expect(await store.getModelCall(call.model_call_id)).toMatchObject({
      thinking_tokens: 10, cached_input_tokens: 5, total_tokens: 160,
      prompt_version: 'prompt-v1', input_sha256: 'e'.repeat(64),
    });
  });

  it('enforces pause, provider, job, and pilot cost gates before a call', async () => {
    const { store, enable } = await harness({ maxTotalCostMicros: 100 });
    await enable();
    const accepted = await accept(store, workEnvelope(), { jobMaxCostMicros: 50 });
    await store.setControls({ global_pause: true }, 'test');
    await expect(store.reserveDispatch({ intentId: accepted.intent_id, dispatcherId: 'dispatcher' }))
      .rejects.toMatchObject({ code: 'execution_paused' });
    await enable();
    const { lease } = await dispatchAndClaim(store, accepted);
    await store.setControls({ provider_enabled: false }, 'test');
    await expect(store.reserveModelCall({
      lease, model: VERTEX_GEMINI_MODEL, reservedCostMicros: 1,
      pricebookVersion: VERTEX_GEMINI_PRICEBOOK_VERSION,
    })).rejects.toMatchObject({ code: 'provider_disabled' });
    await store.setControls({ provider_enabled: true }, 'test');
    await expect(store.reserveModelCall({
      lease, model: 'gemini-unpinned', reservedCostMicros: 1,
      pricebookVersion: VERTEX_GEMINI_PRICEBOOK_VERSION,
    })).rejects.toMatchObject({ code: 'model_denied' });
    await expect(store.reserveModelCall({
      lease, model: VERTEX_GEMINI_MODEL, reservedCostMicros: 1,
      pricebookVersion: 'unversioned',
    })).rejects.toMatchObject({ code: 'pricebook_version_mismatch' });
    await expect(store.reserveModelCall({
      lease, model: VERTEX_GEMINI_MODEL, reservedCostMicros: 0,
      pricebookVersion: VERTEX_GEMINI_PRICEBOOK_VERSION,
    })).rejects.toMatchObject({ code: 'execution_integer_invalid' });
    await expect(store.reserveModelCall({
      lease, model: VERTEX_GEMINI_MODEL, reservedCostMicros: 51,
      pricebookVersion: VERTEX_GEMINI_PRICEBOOK_VERSION,
    })).rejects.toMatchObject({ code: 'job_cost_cap_exceeded' });
  });

  it('records a bounded transient retry under a new dispatch generation', async () => {
    const { store, enable } = await harness();
    await enable();
    const accepted = await accept(store);
    const { lease } = await dispatchAndClaim(store, accepted);
    const call = await store.reserveModelCall({
      lease, model: VERTEX_GEMINI_MODEL, reservedCostMicros: 100,
      pricebookVersion: VERTEX_GEMINI_PRICEBOOK_VERSION,
    });
    const failed = await store.failJob({
      lease, modelCallId: call.model_call_id, retryable: true,
      failureClass: 'provider_rate_limited', reason: '429',
      inputTokens: 0, outputTokens: 0, latencyMs: 20, actualCostMicros: 0,
      baseBackoffMs: 0,
    });
    expect(failed.state).toBe('retry_wait');
    expect(await store.getOutbox(accepted.intent_id)).toMatchObject({
      state: 'pending', dispatch_generation: 2,
    });
    const second = await dispatchAndClaim(store, accepted, { generation: 2, workerId: 'worker-2' });
    expect(second.lease.attempt_number).toBe(2);
    expect(second.lease.fencing_token).toBe(2);
  });

  it('dead-letters an uncertain provider outcome and charges its reservation conservatively', async () => {
    const { store, enable } = await harness();
    await enable();
    const accepted = await accept(store);
    const { lease } = await dispatchAndClaim(store, accepted);
    const call = await store.reserveModelCall({
      lease, model: VERTEX_GEMINI_MODEL, reservedCostMicros: 700,
      pricebookVersion: VERTEX_GEMINI_PRICEBOOK_VERSION,
    });
    const result = await store.markUncertain({
      lease, modelCallId: call.model_call_id, reason: 'connection ended after request bytes were sent',
    });
    expect(result.state).toBe('dead_letter');
    expect(await store.getModelCall(call.model_call_id)).toMatchObject({
      state: 'uncertain', accounted_cost_micros: 700, actual_cost_micros: null,
    });
    expect(await store.getBudget('pilot-1')).toMatchObject({
      reserved_cost_micros: 0, settled_cost_micros: 0, uncertain_cost_micros: 700,
    });
    expect((await store.getTask(accepted.task_id)).cost_actual).toBeNull();
  });

  it('reconciles a missing intent and an expired pre-provider lease without external work', async () => {
    const { store, firestore, enable, advance } = await harness();
    await enable();
    const accepted = await accept(store);
    firestore.delete(`executionOutbox/${accepted.intent_id}`);
    const repaired = await store.reconcile({ pilotRunId: 'pilot-1', apply: true });
    expect(repaired.repaired_intents).toEqual([accepted.job_id]);
    const { lease } = await dispatchAndClaim(store, accepted, { leaseMs: 1_000 });
    advance(1_001);
    const recovered = await store.reconcile({ pilotRunId: 'pilot-1', apply: true });
    expect(recovered.recovered_leases).toEqual([{ job_id: accepted.job_id, state: 'retry_wait' }]);
    expect(await store.getJob(accepted.job_id)).toMatchObject({
      state: 'retry_wait', lease_owner: null, fencing_token: lease.fencing_token,
    });
    expect(await store.getOutbox(accepted.intent_id)).toMatchObject({
      state: 'pending', dispatch_generation: 2,
    });
  });

  it('rejects the wrong Cloud Task identity and requires a full name on crash recovery', async () => {
    const { store, enable } = await harness();
    await enable();
    const accepted = await accept(store);
    const reservation = await store.reserveDispatch({ intentId: accepted.intent_id, dispatcherId: 'dispatcher' });
    await expect(store.markDispatchDelivered({
      intentId: accepted.intent_id,
      dispatchGeneration: 1,
      reservationToken: reservation.reservation_token,
      taskName: 'projects/p/locations/l/queues/q/tasks/cloudtask_wrong',
    })).rejects.toMatchObject({ code: 'dispatch_identity_conflict' });
    await expect(store.claimJob({
      jobId: accepted.job_id,
      intentId: accepted.intent_id,
      dispatchGeneration: 1,
      pilotRunId: 'pilot-1',
      siteId: reservation.site_id,
      packetDigest: reservation.packet_digest,
      workerId: 'worker-1',
      leaseMs: 1_000,
    })).rejects.toMatchObject({ code: 'execution_string_invalid' });
  });

  it('reports non-pristine missing intents for manual recovery instead of resetting generation', async () => {
    const { store, firestore, enable } = await harness();
    await enable();
    const accepted = await accept(store);
    await store.reserveDispatch({ intentId: accepted.intent_id, dispatcherId: 'dispatcher' });
    firestore.delete(`executionOutbox/${accepted.intent_id}`);
    const result = await store.reconcile({ pilotRunId: 'pilot-1', apply: true });
    expect(result).toMatchObject({ repaired_intents: [], manual_orphans: [accepted.job_id] });
    expect(await store.getOutbox(accepted.intent_id)).toBeNull();
  });

  it('dead-letters an expired final attempt with a durable transition event', async () => {
    const { store, enable, advance } = await harness();
    await enable();
    const accepted = await accept(store, workEnvelope(), { maxAttempts: 1 });
    const { reservation } = await dispatchAndClaim(store, accepted, { leaseMs: 1_000 });
    advance(1_001);
    const result = await store.claimJob({
      jobId: accepted.job_id,
      intentId: accepted.intent_id,
      dispatchGeneration: 1,
      pilotRunId: 'pilot-1',
      siteId: reservation.site_id,
      packetDigest: reservation.packet_digest,
      workerId: 'worker-2',
      leaseMs: 1_000,
    });
    expect(result).toMatchObject({ terminal: true, state: 'dead_letter' });
    expect((await store.snapshotCounts()).executionTaskEvents).toBe(4);
  });

  it('linearizes admission, renews duplicate recovery, and permits tracked finalization after pause', async () => {
    const { store, advance } = await harness();
    const envelope = workEnvelope();
    await expect(store.reserveWorkAdmission(reservationFor(envelope)))
      .rejects.toMatchObject({ code: 'execution_paused' });
    expect(await store.snapshotCounts()).toMatchObject({ executionJobs: 0, agentTaskLog: 0 });
    await store.setControls({ global_pause: false }, 'intake-open');
    const reserved = await store.reserveWorkAdmission(reservationFor(envelope));
    expect(reserved.finalized).toBe(false);
    expect(await store.listReservedAdmissions({ pilotRunId: 'pilot-1' }))
      .toEqual([expect.objectContaining({ identity: expect.objectContaining({ job_id: 'job-1' }) })]);
    await store.setControls({ global_pause: true }, 'pause-after-reserve');
    const finalized = await store.finalizeWorkAdmission({
      envelope, siteId: 'site-1', pilotRunId: 'pilot-1', idempotencyKey: 'idem-1',
    });
    expect(finalized.state).toBe('accepted');
    await expect(store.bootstrapControls({ pilotRunId: 'pilot-1', maxJobs: 20, maxTotalCostMicros: 10_000 }))
      .rejects.toMatchObject({ code: 'bootstrap_budget_not_empty' });

    const second = workEnvelope({ job_id: 'job-2', task_id: 'task-2', idempotency_key: 'idem-2' });
    await store.setControls({ global_pause: false }, 'second-intake');
    const original = await store.reserveWorkAdmission(reservationFor(second));
    advance(15 * 60 * 1000 - 1);
    const renewed = await store.reserveWorkAdmission(reservationFor(second));
    expect(renewed).toMatchObject({ reservation_generation: 2, expires_at_ms: original.expires_at_ms + 15 * 60 * 1000 - 1 });
    advance(2);
    await expect(store.expireWorkAdmission({
      jobId: 'job-2', pilotRunId: 'pilot-1', sourceConfirmedMissing: true,
    })).rejects.toMatchObject({ code: 'admission_recovery_active' });
    expect((await store.finalizeWorkAdmission({
      envelope: second, siteId: 'site-1', pilotRunId: 'pilot-1', idempotencyKey: 'idem-2',
    })).state).toBe('accepted');
  });

  it('supports a billed transient provider failure followed by success within the job cap', async () => {
    const { store, enable } = await harness();
    await enable();
    const accepted = await accept(store, workEnvelope(), { jobMaxCostMicros: 1_000 });
    const first = await dispatchAndClaim(store, accepted);
    const firstCall = await store.reserveModelCall({
      lease: first.lease, model: VERTEX_GEMINI_MODEL, reservedCostMicros: 400,
      pricebookVersion: VERTEX_GEMINI_PRICEBOOK_VERSION,
    });
    await store.failJob({
      lease: first.lease, modelCallId: firstCall.model_call_id,
      retryable: true, failureClass: 'provider_transient', reason: 'retry',
      actualCostMicros: 100, baseBackoffMs: 0,
    });
    const second = await dispatchAndClaim(store, accepted, { generation: 2, workerId: 'worker-2' });
    const secondCall = await store.reserveModelCall({
      lease: second.lease, model: VERTEX_GEMINI_MODEL, reservedCostMicros: 400,
      pricebookVersion: VERTEX_GEMINI_PRICEBOOK_VERSION,
    });
    const output = providerOutput();
    await store.checkpointProviderSuccess({
      lease: second.lease, modelCallId: secondCall.model_call_id, output,
      providerRequestId: 'provider-2', inputTokens: 10, outputTokens: 10,
      thinkingTokens: 0, cachedInputTokens: 0, totalTokens: 20,
      latencyMs: 10, promptVersion: 'prompt-v1', inputSha256: 'f'.repeat(64),
      actualCostMicros: 200,
    });
    await store.completeJob({
      lease: second.lease, modelCallId: secondCall.model_call_id,
      artifact: {
        logical_key: 'shadow-result', version: 1, artifact_ref: 'gs://pilot/result.json#1',
        sha256: canonicalDigest(output), bytes: Buffer.byteLength(canonicalJson(output)),
      },
    });
    expect(await store.getJob(accepted.job_id)).toMatchObject({
      state: 'awaiting_approval', settled_cost_micros: 300, reserved_cost_micros: 0,
    });
  });

  it('terminalizes checkpoint redispatch exhaustion without rewriting provider success', async () => {
    const { store, enable, advance } = await harness();
    await enable();
    const accepted = await accept(store, workEnvelope(), { maxDispatchGenerations: 1 });
    const { lease } = await dispatchAndClaim(store, accepted, { leaseMs: 1_000 });
    const call = await store.reserveModelCall({
      lease, model: VERTEX_GEMINI_MODEL, reservedCostMicros: 500,
      pricebookVersion: VERTEX_GEMINI_PRICEBOOK_VERSION,
    });
    await store.checkpointProviderSuccess({
      lease, modelCallId: call.model_call_id, output: providerOutput(),
      providerRequestId: 'provider-1', inputTokens: 10, outputTokens: 10,
      thinkingTokens: 0, cachedInputTokens: 0, totalTokens: 20,
      latencyMs: 10, promptVersion: 'prompt-v1', inputSha256: 'e'.repeat(64),
      actualCostMicros: 200,
    });
    advance(1_001);
    const result = await store.reconcile({ pilotRunId: 'pilot-1', apply: true });
    expect(result.recovered_leases).toEqual([{ job_id: accepted.job_id, state: 'manual_review' }]);
    expect(await store.getOutbox(accepted.intent_id)).toMatchObject({ state: 'manual_review' });
    expect(await store.getModelCall(call.model_call_id)).toMatchObject({
      state: 'completed', outcome: 'success', workflow_terminal_reason: 'provider_resume_dispatch_exhausted',
    });
    expect(await store.getJob(accepted.job_id)).toMatchObject({
      state: 'dead_letter', settled_cost_micros: 200, reserved_cost_micros: 0,
    });
  });

  it('rejects a re-digested authoritative envelope whose stored identity was tampered', async () => {
    const { store, firestore, enable } = await harness();
    await enable();
    const accepted = await accept(store);
    const reservation = await store.reserveDispatch({ intentId: accepted.intent_id, dispatcherId: 'dispatcher' });
    await store.markDispatchDelivered({
      intentId: accepted.intent_id, dispatchGeneration: 1,
      reservationToken: reservation.reservation_token,
      taskName: `queues/pilot/tasks/${reservation.task_id}`,
    });
    const path = `executionJobs/${accepted.job_id}`;
    const original = firestore.read(path);
    const changes = [
      ['idempotency_key', 'other-key'], ['artifact_manifest_sha256', 'c'.repeat(64)],
      ['selected_direction_id', 'direction-2'], ['source.ref', 'gs://phase2-pilot/packets/other.json#2'],
      ['source.sha256', 'c'.repeat(64)], ['source.bytes', 21],
    ];
    for (const [key, value] of changes) {
      const envelope = JSON.parse(original.envelope_ref_json);
      if (key.startsWith('source.')) envelope.source[key.slice(7)] = value;
      else envelope[key] = value;
      firestore.seed(path, { ...original, envelope_ref_json: canonicalJson(envelope), envelope_digest: canonicalDigest(envelope) });
      await expect(store.claimJob({
        jobId: accepted.job_id, intentId: accepted.intent_id, dispatchGeneration: 1,
        pilotRunId: 'pilot-1', siteId: reservation.site_id,
        packetDigest: reservation.packet_digest, workerId: 'worker', leaseMs: 1_000,
        taskName: `queues/pilot/tasks/${reservation.task_id}`,
      })).rejects.toMatchObject({ code: 'work_envelope_corrupt' });
    }
  });
});
