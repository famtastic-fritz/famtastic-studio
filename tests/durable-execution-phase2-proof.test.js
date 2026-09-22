import { describe, expect, it } from 'vitest';
import {
  assertPhase2ShadowProofReport,
  runPhase2ShadowProof,
} from './helpers/durable-execution-phase2-proof.js';
import {
  assertPhase2HttpCheckpointProofReport,
  runPhase2HttpCheckpointProof,
} from './helpers/phase2-proof-http.js';

describe('Phase 2 deterministic 20-job cloud-shadow proof', () => {
  it('converges admission, dispatch, recovery, cost, and terminal states without external effects', async () => {
    const report = await runPhase2ShadowProof();
    expect(() => assertPhase2ShadowProofReport(report)).not.toThrow();
    expect(report).toMatchObject({
      status: 'passed',
      proof_scope: 'phase2_composed_in_process_http_fixture',
      production_runtime_composed: true,
      jobs: 20,
      states: { awaiting_approval: 18, dead_letter: 2 },
      authoritative_cloud_touched: false,
      activation_evidence: false,
      real_provider_calls: 0,
      external_effects_zero: true,
      pilot_run_id: 'pilot-composed-proof',
      admission: {
        paused_status: 423,
        paused_left_no_work: true,
        accepted_202: 19,
        finalize_interruption_status: 503,
        source_objects_before_recovery: 20,
        reserved_job_visible: true,
        recovery_finalized_job: true,
        exact_duplicates: 2,
        conflict_status: 409,
        cap_status: 429,
      },
      recovery: {
        provider_checkpoint_resumes: 10,
        manual_reviews: 1,
        final_missing_intents: 0,
        final_expired_leases: 0,
      },
      source_wrapper: { count: 20, schema_count: 20, exact_contract: true },
      provider_successes_checkpointed: 19,
      crash_after_checkpoint: {
        first_status: 503,
        resumed_status: 200,
        provider_calls_for_job: 1,
      },
      dispatch_bound: {
        terminal_state: 'dead_letter',
        configured_generations: 10,
        observed_generation: 10,
        outbox_state: 'manual_review',
        dead_letter_visible: true,
        human_review_required: true,
        provider_calls_for_job: 1,
        artifact_failures: 10,
      },
      costs: { reserved_micros: 0, settled_micros: 10450, uncertain_micros: 80000 },
      task_delivery: {
        count: 35,
        exact_target_url: true,
        post_method: true,
        exact_oidc_service_account: true,
        exact_oidc_audience: true,
      },
      gcs_namespace: {
        prefix: 'phase2/pilot-composed-proof',
        matches_pilot_run_id: true,
        source_objects_exact_prefix: true,
        output_objects_exact_prefix: true,
      },
    });

    for (const field of [
      'exact_target_url',
      'post_method',
      'exact_oidc_service_account',
      'exact_oidc_audience',
    ]) {
      const tampered = structuredClone(report);
      tampered.task_delivery[field] = false;
      expect(() => assertPhase2ShadowProofReport(tampered))
        .toThrow(/Cloud Task delivery metadata/);
    }
    const wrongPrefix = structuredClone(report);
    wrongPrefix.gcs_namespace.prefix = 'phase2-pilot';
    expect(() => assertPhase2ShadowProofReport(wrongPrefix))
      .toThrow(/production pilot namespace/);
  });

  it('produces the same evidence report on repeated hermetic runs', async () => {
    const first = await runPhase2ShadowProof();
    const second = await runPhase2ShadowProof();
    expect(second).toEqual(first);
  });

  it('resumes a checkpoint through composed services and HTTP without another provider call', async () => {
    const report = await runPhase2HttpCheckpointProof();
    expect(report).toEqual({
      proof_scope: 'phase2_in_process_http_fixture',
      activation_evidence: false,
      firestore_emulator_concurrency_proven: false,
      gcp_canary_proven: false,
      admission_status: 202,
      crash_status: 503,
      crash_error: 'phase2_artifact_persistence_pending',
      checkpoint_state_before_recovery: 'provider_succeeded',
      recovery_status: 200,
      recovery_state: 'provider_resume',
      dispatch_generations: [1, 2],
      completion_status: 200,
      final_state: 'awaiting_approval',
      provider_calls: 1,
      artifact_write_attempts: 2,
      external_effects_zero: true,
      process_network_attempts: { fetch: 0, http: 0, https: 0, net: 0, tls: 0 },
    });
  });

  it('rejects tampered checkpoint recovery evidence before it can be reported as passed', async () => {
    const report = await runPhase2HttpCheckpointProof();
    const mutations = [
      (value) => ({ ...value, recovery_status: 503 }),
      (value) => ({ ...value, provider_calls: 2 }),
      (value) => ({ ...value, final_state: 'running' }),
      (value) => ({ ...value, external_effects_zero: false }),
      (value) => ({
        ...value,
        process_network_attempts: { ...value.process_network_attempts, https: 1 },
      }),
    ];
    for (const mutate of mutations) {
      expect(() => assertPhase2HttpCheckpointProofReport(mutate(report)))
        .toThrow(/Phase 2 HTTP checkpoint proof failed/);
    }
  });
});
