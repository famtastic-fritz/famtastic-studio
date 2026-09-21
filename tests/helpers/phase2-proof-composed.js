import { PHASE2_PROVIDER_CALL_RESERVATION_MICROS } from '../../server/kernel/durable-execution/phase2/runtime.js';
import { PHASE2_SOURCE_SCHEMA } from '../../server/kernel/durable-execution/phase2/runtime-source.js';
import { assertPhase2ShadowProofReport } from './phase2-proof-assertions.js';
import {
  collectionRows,
  createComposedPhase2ProofHarness,
} from './phase2-proof-composed-harness.js';
import { phase2ProofPacket } from './phase2-proof-fixtures.js';
import { installProcessNetworkGuard } from './phase2-proof-fakes.js';

const TASK_BODY_KEYS = [
  'dispatch_generation', 'intent_id', 'job_id', 'packet_digest',
  'pilot_run_id', 'schema', 'site_id',
];
const TERMINAL_STATES = new Set(['awaiting_approval', 'dead_letter']);

function exactKeys(value, keys) {
  return JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...keys].sort());
}

function taskEntries(harness, processed) {
  return [...harness.taskClient.tasks.entries()]
    .filter(([name]) => !processed.has(name))
    .map(([name, task]) => ({
      name,
      body: JSON.parse(Buffer.from(task.httpRequest.body).toString('utf8')),
    }))
    .sort((left, right) => (
      left.body.dispatch_generation - right.body.dispatch_generation
      || left.body.job_id.localeCompare(right.body.job_id)
    ));
}

function countBy(items, key) {
  return Object.fromEntries([...new Set(items.map((item) => item[key]))]
    .sort()
    .map((value) => [value, items.filter((item) => item[key] === value).length]));
}

function sourceWrapperEvidence(memory) {
  const documents = [...memory.objects.values()].map((record) => (
    JSON.parse(record.body.toString('utf8'))
  ));
  return {
    count: documents.length,
    schema_count: documents.filter((document) => document.schema === PHASE2_SOURCE_SCHEMA).length,
    exact_contract: documents.every((document) => (
      exactKeys(document, ['schema', 'intake_packet_digest', 'packet'])
      && /^[a-f0-9]{64}$/.test(document.intake_packet_digest)
      && document.packet
      && !Object.hasOwn(document.packet, 'idempotency_key')
      && !Object.hasOwn(document.packet, 'boundary')
    )),
  };
}

function taskDeliveryEvidence(harness) {
  const tasks = [...harness.taskClient.tasks.values()];
  const requests = tasks.map((task) => task.httpRequest);
  return {
    count: tasks.length,
    exact_target_url: requests.every((request) => request?.url === harness.runtime.gcp.worker_url),
    post_method: requests.every((request) => request?.httpMethod === 'POST'),
    exact_oidc_service_account: requests.every((request) => (
      request?.oidcToken?.serviceAccountEmail === harness.runtime.gcp.task_invoker_service_account
    )),
    exact_oidc_audience: requests.every((request) => (
      request?.oidcToken?.audience === harness.runtime.gcp.worker_audience
    )),
  };
}

function gcsPrefixEvidence(harness) {
  const objectPrefix = `${harness.gcsPrefix}/jobs/`;
  return {
    prefix: harness.gcsPrefix,
    matches_pilot_run_id: harness.gcsPrefix === `phase2/${harness.runtime.pilot_run_id}`,
    source_objects_exact_prefix: [...harness.sourceMemory.objects.keys()].every((name) => (
      name.startsWith(objectPrefix)
    )),
    output_objects_exact_prefix: [...harness.artifactMemory.objects.keys()].every((name) => (
      name.startsWith(objectPrefix)
    )),
  };
}

async function acceptProofJobs(harness) {
  const intakePrincipal = harness.runtime.gcp.intake_service_account;
  const paused = await harness.call(harness.controlHandler, {
    url: '/v1/staging/accept',
    body: { packet: phase2ProofPacket(1) },
    principal: intakePrincipal,
  });
  const pausedCounts = await harness.store.snapshotCounts();
  const pausedLeftNoWork = pausedCounts.executionJobs === 0
    && pausedCounts.agentTaskLog === 0
    && harness.sourceMemory.objects.size === 0;
  await harness.store.setControls({ global_pause: false }, 'phase2-proof-admission');

  const accepted = [];
  for (let number = 1; number <= 20; number += 1) {
    accepted.push(await harness.call(harness.controlHandler, {
      url: '/v1/staging/accept',
      body: { packet: phase2ProofPacket(number) },
      principal: intakePrincipal,
    }));
  }
  const sourceObjectsAfterAdmissions = harness.sourceMemory.objects.size;
  const reservedBeforeRecovery = await harness.store.listReservedAdmissions({
    pilotRunId: harness.runtime.pilot_run_id,
    limit: 20,
  });
  const duplicates = [];
  for (const number of [9, 10]) {
    duplicates.push(await harness.call(harness.controlHandler, {
      url: '/v1/staging/accept',
      body: { packet: phase2ProofPacket(number) },
      principal: intakePrincipal,
    }));
  }
  const savesBeforeConflict = harness.sourceMemory.calls.save;
  const conflictPacket = { ...phase2ProofPacket(9), request_id: 'request-09-changed' };
  const conflict = await harness.call(harness.controlHandler, {
    url: '/v1/staging/accept',
    body: { packet: conflictPacket },
    principal: intakePrincipal,
  });
  const cap = await harness.call(harness.controlHandler, {
    url: '/v1/staging/accept',
    body: { packet: phase2ProofPacket(21) },
    principal: intakePrincipal,
  });
  return {
    paused,
    pausedLeftNoWork,
    accepted,
    sourceObjectsAfterAdmissions,
    reservedBeforeRecovery,
    duplicates,
    conflict,
    cap,
    conflictAndCapAvoidedWrites: harness.sourceMemory.calls.save === savesBeforeConflict,
  };
}

function exactPrincipals(harness) {
  const expected = {
    '/v1/staging/accept': harness.runtime.gcp.intake_service_account,
    '/internal/reconcile': harness.runtime.gcp.scheduler_service_account,
    '/internal/tasks/execute': harness.runtime.gcp.task_invoker_service_account,
  };
  const expectedAudience = {
    '/v1/staging/accept': harness.runtime.gcp.control_audience,
    '/internal/reconcile': harness.runtime.gcp.control_audience,
    '/internal/tasks/execute': harness.runtime.gcp.worker_audience,
  };
  return harness.routeTrace.length === harness.auth.calls.length
    && harness.routeTrace.every((call, index) => (
      call.principal === expected[call.url]
      && harness.auth.calls[index].email === expected[call.url]
      && harness.auth.calls[index].audience === expectedAudience[call.url]
    ));
}

async function runWorkersToTerminal(harness, initialReconcile) {
  const processed = new Set();
  const workerResponses = [];
  const reconciliations = [initialReconcile];
  let safety = 0;
  while (true) {
    for (const task of taskEntries(harness, processed)) {
      processed.add(task.name);
      const response = await harness.call(harness.workerHandler, {
        url: '/internal/tasks/execute',
        body: task.body,
        principal: harness.runtime.gcp.task_invoker_service_account,
      });
      workerResponses.push({
        job_id: task.body.job_id,
        generation: task.body.dispatch_generation,
        status: response.status,
        body: response.body,
      });
    }
    const jobs = await harness.store.listJobs();
    if (jobs.length === 20 && jobs.every((job) => TERMINAL_STATES.has(job.state))) break;
    harness.advance(240_001);
    reconciliations.push(await harness.call(harness.controlHandler, {
      url: '/internal/reconcile',
      body: {},
      principal: harness.runtime.gcp.scheduler_service_account,
    }));
    safety += 1;
    if (safety > 12) {
      const states = countBy(await harness.store.listJobs(), 'state');
      const last = reconciliations.at(-1);
      throw new Error(`Phase 2 composed proof exceeded its deterministic safety bound: ${JSON.stringify({
        states,
        reconcile: last?.body,
        tasks: harness.taskClient.tasks.size,
        workers: workerResponses.slice(-5),
      })}`);
    }
  }
  const finalReconcile = await harness.call(harness.controlHandler, {
    url: '/internal/reconcile',
    body: {},
    principal: harness.runtime.gcp.scheduler_service_account,
  });
  reconciliations.push(finalReconcile);
  return { workerResponses, reconciliations, processed };
}

function recoveryEvidence(reconciliations) {
  const recovered = reconciliations.flatMap((response) => (
    response.body?.recovery?.recovered_leases || []
  ));
  return {
    admission_finalized: reconciliations[0].body?.admission_recovery?.finalized || [],
    provider_checkpoint_resumes: recovered.filter((entry) => entry.state === 'provider_resume').length,
    manual_reviews: recovered.filter((entry) => entry.state === 'manual_review').length,
    final_missing_intents: reconciliations.at(-1).body?.recovery?.missing_intents?.length,
    final_expired_leases: reconciliations.at(-1).body?.recovery?.expired_leases?.length,
    final_dispatch_considered: reconciliations.at(-1).body?.dispatch?.considered,
  };
}

export async function runComposedPhase2ShadowProof() {
  const network = installProcessNetworkGuard();
  try {
    const harness = await createComposedPhase2ProofHarness();
    const admission = await acceptProofJobs(harness);
    await harness.store.setControls({
      global_pause: false,
      dispatch_enabled: true,
      worker_enabled: true,
      provider_enabled: true,
    }, 'phase2-proof-run');
    const initialReconcile = await harness.call(harness.controlHandler, {
      url: '/internal/reconcile',
      body: {},
      principal: harness.runtime.gcp.scheduler_service_account,
    });
    const execution = await runWorkersToTerminal(harness, initialReconcile);
    await harness.store.setControls({
      global_pause: true,
      dispatch_enabled: false,
      worker_enabled: false,
      provider_enabled: false,
    }, 'phase2-proof-complete');

    const snapshot = await harness.store.snapshot({ pilotRunId: harness.runtime.pilot_run_id });
    const calls = collectionRows(harness.firestore, 'executionModelCalls');
    const attempts = collectionRows(harness.firestore, 'executionAttempts');
    const outbox = collectionRows(harness.firestore, 'executionOutbox');
    const deadLetters = collectionRows(harness.firestore, 'executionDeadLetters');
    const taskBodies = harness.taskBodies();
    const routeCounts = countBy(harness.routeTrace, 'url');
    const providerCounts = countBy(harness.fakeVertex.calls, 'job_id');
    const source = sourceWrapperEvidence(harness.sourceMemory);
    const recovery = recoveryEvidence(execution.reconciliations);
    const effectSnapshot = harness.effects.snapshot();
    const effectCounts = [
      ...Object.values(effectSnapshot.attempted),
      ...Object.values(effectSnapshot.completed),
    ];
    const job19 = snapshot.jobs.find((job) => job.job_id === 'job-19');
    const job19Outbox = outbox.find((intent) => intent.job_id === 'job-19');
    const job12Responses = execution.workerResponses.filter((item) => item.job_id === 'job-12');
    const report = {
      status: 'passed',
      proof_scope: 'phase2_composed_in_process_http_fixture',
      production_runtime_composed: true,
      fixture_level: 'hermetic_in_process',
      authoritative_cloud_touched: false,
      activation_evidence: false,
      end_to_end_activation_proven: false,
      firestore_emulator_concurrency_proven: false,
      gcp_canary_proven: false,
      pilot_run_id: harness.runtime.pilot_run_id,
      jobs: snapshot.jobs.length,
      states: countBy(snapshot.jobs, 'state'),
      counts: snapshot.counts,
      admission: {
        paused_status: admission.paused.status,
        paused_error: admission.paused.body.error,
        paused_left_no_work: admission.pausedLeftNoWork,
        accepted_202: admission.accepted.filter((response) => response.status === 202).length,
        finalize_interruption_status: admission.accepted[19].status,
        finalize_interruption_error: admission.accepted[19].body.error,
        source_objects_before_recovery: admission.sourceObjectsAfterAdmissions,
        reserved_job_visible: admission.reservedBeforeRecovery.some((item) => item.identity.job_id === 'job-20'),
        recovery_finalized_job: recovery.admission_finalized.includes('job-20'),
        exact_duplicates: admission.duplicates.filter((response) => (
          response.status === 202 && response.body.execution?.duplicate === true
        )).length,
        conflict_status: admission.conflict.status,
        cap_status: admission.cap.status,
        conflict_and_cap_avoided_writes: admission.conflictAndCapAvoidedWrites,
      },
      http: {
        exact_route_principals: exactPrincipals(harness),
        route_counts: routeCounts,
        worker_requests: execution.workerResponses.length,
      },
      source_wrapper: source,
      source_reads: harness.sourceStore.snapshot(),
      recovery,
      fake_provider_calls: harness.fakeVertex.calls.length,
      provider_calls_by_job: providerCounts,
      real_provider_calls: 0,
      model_call_reservation_micros: PHASE2_PROVIDER_CALL_RESERVATION_MICROS,
      all_model_calls_use_production_reservation: calls.every((call) => (
        call.reserved_cost_micros === PHASE2_PROVIDER_CALL_RESERVATION_MICROS
      )),
      provider_successes_checkpointed: calls.filter((call) => (
        call.checkpoint_output_sha256 && call.checkpoint_output_json
      )).length,
      crash_after_checkpoint: {
        first_status: job12Responses[0]?.status,
        first_error: job12Responses[0]?.body?.error,
        resumed_status: job12Responses[1]?.status,
        provider_calls_for_job: providerCounts['job-12'],
        artifact_fault: harness.artifactStore.snapshot().job12_crashed,
      },
      dispatch_bound: {
        terminal_state: job19?.state,
        configured_generations: job19?.max_dispatch_generations,
        observed_generation: job19Outbox?.dispatch_generation,
        outbox_state: job19Outbox?.state,
        dead_letter_visible: deadLetters.some((entry) => entry.job_id === 'job-19'),
        human_review_required: (await harness.store.getTask('task-19'))?.human_review_required === true,
        provider_calls_for_job: providerCounts['job-19'],
        artifact_failures: harness.artifactStore.snapshot().job19_crashes,
      },
      cloud_tasks: harness.taskClient.tasks.size,
      task_create_attempts: harness.taskClient.createAttempts,
      task_bodies_ids_only: taskBodies.every((body) => exactKeys(body, TASK_BODY_KEYS)),
      task_delivery: taskDeliveryEvidence(harness),
      gcs_namespace: gcsPrefixEvidence(harness),
      source_objects: harness.sourceMemory.objects.size,
      output_objects: harness.artifactMemory.objects.size,
      output_delete_attempts: harness.artifactMemory.calls.delete,
      output_public_attempts: harness.artifactMemory.calls.public,
      output_signed_url_attempts: harness.artifactMemory.calls.signed,
      max_attempts: Math.max(...snapshot.jobs.map((job) => job.attempts_started)),
      active_leases: snapshot.jobs.filter((job) => job.lease_token || job.state === 'running').length,
      costs: {
        reserved_micros: snapshot.budget.reserved_cost_micros,
        settled_micros: snapshot.budget.settled_cost_micros,
        uncertain_micros: snapshot.budget.uncertain_cost_micros,
      },
      external_effects_zero: effectCounts.every((count) => count === 0),
      effect_policy: effectSnapshot.policy,
      process_network_attempts: { ...network.attempts },
      final_controls: snapshot.controls,
      attempts: attempts.length,
      model_calls: calls.length,
    };
    return assertPhase2ShadowProofReport(report);
  } finally {
    network.restore();
  }
}
