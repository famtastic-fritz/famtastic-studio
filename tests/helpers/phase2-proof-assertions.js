const EXPECTED_SETTLED_COST_MICROS = 19 * 550;
const PRODUCTION_RESERVATION_MICROS = 80_000;

function requireProof(condition, message) {
  if (!condition) throw new Error(`Phase 2 composed proof failed: ${message}`);
}

export function assertPhase2ShadowProofReport(report) {
  requireProof(report.proof_scope === 'phase2_composed_in_process_http_fixture'
    && report.production_runtime_composed === true, 'scope is not the composed production runtime fixture');
  requireProof(report.fixture_level === 'hermetic_in_process'
    && report.authoritative_cloud_touched === false
    && report.real_provider_calls === 0, 'fixture crossed a real cloud or provider boundary');
  requireProof(report.activation_evidence === false
    && report.end_to_end_activation_proven === false
    && report.firestore_emulator_concurrency_proven === false
    && report.gcp_canary_proven === false, 'hermetic evidence was overstated');
  requireProof(report.jobs === 20, 'job count is not 20');
  requireProof(report.states?.awaiting_approval === 18
    && report.states?.dead_letter === 2, 'terminal states differ from 18/2');
  const expectedCounts = {
    agentTaskLog: 20,
    executionJobs: 20,
    executionOutbox: 20,
    executionAttempts: 25,
    executionModelCalls: 23,
    executionArtifacts: 18,
    executionApprovals: 18,
    executionDeadLetters: 2,
  };
  for (const [collection, expected] of Object.entries(expectedCounts)) {
    requireProof(report.counts?.[collection] === expected, `${collection} count is not ${expected}`);
  }
  requireProof(report.admission?.paused_status === 423
    && report.admission?.paused_error === 'execution_paused'
    && report.admission?.paused_left_no_work, 'paused admission was not fail-closed');
  requireProof(report.admission?.accepted_202 === 19
    && report.admission?.finalize_interruption_status === 503
    && report.admission?.finalize_interruption_error === 'synthetic_finalize_interruption',
  'admission interruption was not exercised');
  requireProof(report.admission?.source_objects_before_recovery === 20
    && report.admission?.reserved_job_visible
    && report.admission?.recovery_finalized_job, 'reserved admission did not recover from durable source');
  requireProof(report.admission?.exact_duplicates === 2
    && report.admission?.conflict_status === 409
    && report.admission?.cap_status === 429
    && report.admission?.conflict_and_cap_avoided_writes, 'admission convergence or cap proof failed');
  requireProof(report.http?.exact_route_principals
    && report.http?.route_counts?.['/v1/staging/accept'] === 25
    && report.http?.route_counts?.['/internal/reconcile'] === 12
    && report.http?.route_counts?.['/internal/tasks/execute'] === 35
    && report.http?.worker_requests === 35, 'production HTTP route proof failed');
  requireProof(report.source_wrapper?.count === 20
    && report.source_wrapper?.schema_count === 20
    && report.source_wrapper?.exact_contract, 'source objects do not use the production wrapper');
  requireProof(report.source_reads?.read_exact_attempts === 25
    && report.source_reads?.read_deterministic_attempts === 1
    && JSON.stringify(report.source_reads?.faulted_jobs) === JSON.stringify(['job-13', 'job-14']),
  'source recovery boundary was not exercised');
  requireProof(report.recovery?.provider_checkpoint_resumes === 10
    && report.recovery?.manual_reviews === 1
    && report.recovery?.final_missing_intents === 0
    && report.recovery?.final_expired_leases === 0
    && report.recovery?.final_dispatch_considered === 0, 'reconciliation did not converge');
  requireProof(report.fake_provider_calls === 23
    && report.model_calls === 23
    && report.model_call_reservation_micros === PRODUCTION_RESERVATION_MICROS
    && report.all_model_calls_use_production_reservation,
  'production model-call reservation proof failed');
  requireProof(report.provider_successes_checkpointed === 19, 'successful provider outcomes were not checkpointed');
  requireProof(report.crash_after_checkpoint?.first_status === 503
    && report.crash_after_checkpoint?.first_error === 'phase2_artifact_persistence_pending'
    && report.crash_after_checkpoint?.resumed_status === 200
    && report.crash_after_checkpoint?.provider_calls_for_job === 1
    && report.crash_after_checkpoint?.artifact_fault, 'checkpoint crash repeated provider work');
  requireProof(report.dispatch_bound?.terminal_state === 'dead_letter'
    && report.dispatch_bound?.configured_generations === 10
    && report.dispatch_bound?.observed_generation === 10
    && report.dispatch_bound?.outbox_state === 'manual_review'
    && report.dispatch_bound?.dead_letter_visible
    && report.dispatch_bound?.human_review_required
    && report.dispatch_bound?.provider_calls_for_job === 1
    && report.dispatch_bound?.artifact_failures === 10, 'bounded dispatch did not reach visible manual review');
  requireProof(report.cloud_tasks === 35
    && report.task_create_attempts === 35
    && report.task_bodies_ids_only, 'Cloud Task evidence failed');
  requireProof(report.task_delivery?.count === report.cloud_tasks
    && report.task_delivery?.exact_target_url
    && report.task_delivery?.post_method
    && report.task_delivery?.exact_oidc_service_account
    && report.task_delivery?.exact_oidc_audience,
  'Cloud Task delivery metadata did not match the production contract');
  requireProof(report.gcs_namespace?.prefix === `phase2/${report.pilot_run_id}`
    && report.gcs_namespace?.matches_pilot_run_id
    && report.gcs_namespace?.source_objects_exact_prefix
    && report.gcs_namespace?.output_objects_exact_prefix,
  'GCS objects did not use the production pilot namespace');
  requireProof(report.source_objects === 20 && report.output_objects === 18, 'artifact counts differ');
  requireProof(report.output_delete_attempts === 0
    && report.output_public_attempts === 0
    && report.output_signed_url_attempts === 0, 'artifact boundary was violated');
  requireProof(report.attempts === 25
    && report.max_attempts === 2
    && report.active_leases === 0, 'execution bounds failed');
  requireProof(report.costs?.reserved_micros === 0
    && report.costs?.settled_micros === EXPECTED_SETTLED_COST_MICROS
    && report.costs?.uncertain_micros === PRODUCTION_RESERVATION_MICROS, 'cost ledger did not settle exactly');
  requireProof(report.external_effects_zero, 'an external customer effect occurred');
  requireProof(Object.values(report.process_network_attempts || {}).every((value) => value === 0),
    'a process network hook was invoked');
  requireProof(report.final_controls?.global_pause === true
    && report.final_controls?.dispatch_enabled === false
    && report.final_controls?.worker_enabled === false
    && report.final_controls?.provider_enabled === false, 'controls were not returned to fail-closed');
  return report;
}
