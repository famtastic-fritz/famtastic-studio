import { describe, expect, it, vi } from 'vitest';
import { createComposedPhase2ProofHarness } from './helpers/phase2-proof-composed-harness.js';
import { phase2ProofPacket } from './helpers/phase2-proof-fixtures.js';

describe('Phase 2 existing Cloud Task ambiguity', () => {
  it('parks an unverified ALREADY_EXISTS task with unknown execution risk end to end', async () => {
    const harness = await createComposedPhase2ProofHarness();
    await harness.store.setControls({ global_pause: false }, 'dispatch-ambiguity-admission');
    const admission = await harness.call(harness.controlHandler, {
      url: '/v1/staging/accept',
      body: { packet: phase2ProofPacket(1) },
      principal: harness.runtime.gcp.intake_service_account,
    });
    expect(admission.status).toBe(202);
    await harness.store.setControls({
      global_pause: false,
      dispatch_enabled: true,
      worker_enabled: true,
      provider_enabled: true,
    }, 'dispatch-ambiguity-run');
    harness.taskClient.createTask = vi.fn(async () => {
      throw Object.assign(new Error('task exists'), { code: 6 });
    });
    harness.taskClient.getTask = vi.fn(async () => {
      throw Object.assign(new Error('lookup unavailable'), { code: 14 });
    });

    const reconciled = await harness.call(harness.controlHandler, {
      url: '/internal/reconcile',
      body: {},
      principal: harness.runtime.gcp.scheduler_service_account,
    });
    expect(reconciled).toMatchObject({
      status: 200,
      body: {
        dispatch: {
          deliveries: [{
            state: 'manual_review',
            error: 'cloud_task_identity_unverified',
          }],
        },
      },
    });
    const [job] = await harness.store.listJobs();
    expect(job).toMatchObject({
      state: 'dead_letter',
      last_failure_class: 'dispatch_permanent_failure',
      last_failure_reason: 'cloud_task_identity_unverified',
    });
    expect(await harness.store.getOutbox(job.intent_id)).toMatchObject({
      state: 'manual_review',
      execution_risk: 'unknown',
      requires_operator_review: true,
      claim_not_after_ms: null,
    });
    expect(harness.taskClient.createTask).toHaveBeenCalledTimes(1);
    expect(harness.taskClient.getTask).toHaveBeenCalledTimes(1);
    expect(harness.fakeVertex.calls).toHaveLength(0);
  });
});
