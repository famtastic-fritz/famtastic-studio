import { assertPhase2OperationAllowed } from './config.js';
import { canonicalDigest } from './canonical.js';
import {
  VERTEX_GEMINI_MODEL,
  VERTEX_GEMINI_PRICEBOOK_VERSION,
} from './pricebook.js';
import {
  assertRuntimeCallIdentity,
  assertRuntimeConfig,
  assertRuntimeEffectFirewall,
  assertRuntimeStore,
  assertRuntimeTask,
  defaultRuntimeIdFactory,
  definiteTaskCreateFailure,
  exactRuntimeObject,
  failRuntimeBeforeProvider,
  generatedRuntimeId,
  knownRuntimeMetrics,
  PHASE2_PROVIDER_CALL_RESERVATION_MICROS,
  persistentRuntimeScope,
  releaseRuntimeReservation,
  requireRuntimeMethod,
  runtimeAcceptanceBody,
  runtimeClockValue,
  runtimeFailure,
  runtimeMaxAttempts,
  runtimeSiteId,
  runtimeTaskName,
  transientRuntimeFailure,
  uncertainRuntimeMetrics,
} from './runtime-support.js';
import {
  assertPhase2RuntimeSource,
  createPhase2RuntimeSource,
  reconcilePhase2RuntimeSources,
} from './runtime-source.js';
import {
  assertVertexGeminiAdmissionFits,
  assertVertexGeminiProvider,
} from './vertex-gemini-provider.js';
import { createPhase2WorkEnvelope } from './work-envelope.js';

export { PHASE2_PROVIDER_CALL_RESERVATION_MICROS } from './runtime-support.js';

export function createPhase2ControlService({
  config,
  store,
  sourceStore,
  dispatcher,
  clock = () => Date.now(),
  idFactory = defaultRuntimeIdFactory,
} = {}) {
  const runtime = assertRuntimeConfig(config);
  const maxAttempts = runtimeMaxAttempts(runtime);
  const executionStore = assertRuntimeStore(store);
  requireRuntimeMethod(sourceStore, 'write', 'Phase 2 source store');
  requireRuntimeMethod(sourceStore, 'readDeterministic', 'Phase 2 source store');
  requireRuntimeMethod(dispatcher, 'create', 'Phase 2 Cloud Tasks dispatcher');
  if (sourceStore.bucket_name !== runtime.gcp.source_bucket
    || dispatcher.parent !== `projects/${runtime.gcp.project_id}/locations/${runtime.gcp.region}/queues/${runtime.gcp.queue_id}`
    || dispatcher.target_url !== runtime.gcp.worker_url
    || dispatcher.audience !== new URL(runtime.gcp.worker_audience).origin) {
    throw runtimeFailure(503, 'phase2_control_boundary_mismatch', 'Control service cloud boundaries do not match runtime configuration');
  }
  if (typeof clock !== 'function' || typeof idFactory !== 'function') {
    throw runtimeFailure(503, 'phase2_runtime_dependency_invalid', 'Control clock and ID factory must be functions');
  }

  async function accept({ body } = {}) {
    exactRuntimeObject(body, ['packet'], 'phase2_intake_invalid');
    const packet = body.packet;
    const preparedSource = createPhase2RuntimeSource(packet);
    const packetDigest = preparedSource.packet_digest;
    const siteId = runtimeSiteId(packet.project_id);
    const scope = await persistentRuntimeScope(executionStore, runtime);
    if (scope.controls.global_pause !== false) {
      throw runtimeFailure(423, 'execution_paused', 'Durable execution admission is globally paused');
    }
    const seed = {
      pilot_run_id: runtime.pilot_run_id,
      site_id: siteId,
      idempotency_key: packet.idempotency_key,
      packet_digest: packetDigest,
    };
    const jobId = generatedRuntimeId(idFactory, 'job', seed);
    const taskId = generatedRuntimeId(idFactory, 'task', seed);
    assertVertexGeminiAdmissionFits({
      jobId,
      taskId,
      packetId: packet.packet_id,
      projectId: packet.project_id,
      packetRef: preparedSource.output.packet,
    });
    runtimeClockValue(clock);
    const identityWithoutSource = {
      site_id: siteId,
      pilot_run_id: runtime.pilot_run_id,
      job_id: jobId,
      task_id: taskId,
      packet_id: packet.packet_id,
      idempotency_key: packet.idempotency_key,
      request_id: packet.request_id,
      project_id: packet.project_id,
      packet_digest: packetDigest,
      artifact_manifest_sha256: packet.artifact_manifest_sha256,
      selected_direction_id: packet.selected_direction_ids[0],
    };
    const reservation = await executionStore.reserveWorkAdmission({
      identityWithoutSource,
      siteId,
      pilotRunId: runtime.pilot_run_id,
      idempotencyKey: packet.idempotency_key,
      maxAttempts,
      jobMaxCostMicros: runtime.cost.max_job_cost_micros,
    });
    if (reservation.finalized) {
      return { status: 202, body: runtimeAcceptanceBody(reservation.acceptance) };
    }
    const source = await sourceStore.write({
      jobId: reservation.identity.job_id,
      logicalKey: 'staging-packet',
      version: 1,
      output: preparedSource.output,
    });
    if (source.sha256 !== preparedSource.sha256 || source.bytes !== preparedSource.bytes
      || !source.artifact_ref.startsWith(`gs://${runtime.gcp.source_bucket}/`)) {
      throw runtimeFailure(503, 'phase2_source_persistence_unverified', 'Source store did not confirm the projected source identity');
    }
    const envelope = createPhase2WorkEnvelope({
      ...reservation.identity,
      source: {
        ref: source.artifact_ref,
        sha256: source.sha256,
        bytes: source.bytes,
      },
    });
    const accepted = await executionStore.finalizeWorkAdmission({
      envelope,
      siteId,
      pilotRunId: runtime.pilot_run_id,
      idempotencyKey: packet.idempotency_key,
    });
    return { status: 202, body: runtimeAcceptanceBody(accepted) };
  }

  async function reconcile() {
    const initial = await persistentRuntimeScope(executionStore, runtime);
    const admissionRecovery = await reconcilePhase2RuntimeSources({
      store: executionStore,
      sourceStore,
      pilotRunId: runtime.pilot_run_id,
      limit: runtime.max_jobs,
    });
    const recovery = await executionStore.reconcile({
      pilotRunId: runtime.pilot_run_id,
      apply: true,
      limit: runtime.max_jobs,
    });
    assertPhase2OperationAllowed(runtime, initial.controls, 'dispatch');
    const candidates = await executionStore.listDispatchCandidates({
      pilotRunId: runtime.pilot_run_id,
      limit: runtime.max_jobs,
    });
    const deliveries = [];
    for (const candidate of candidates) {
      let reservation;
      try {
        reservation = await executionStore.reserveDispatch({
          intentId: candidate.intent_id,
          dispatcherId: 'phase2-control',
        });
      } catch (error) {
        deliveries.push({ intent_id: candidate.intent_id, state: 'skipped', error: error?.code || 'reservation_failed' });
        continue;
      }
      if (reservation.terminal) {
        deliveries.push({ intent_id: candidate.intent_id, state: reservation.state });
        continue;
      }
      let stage = 'gate';
      try {
        const latest = await persistentRuntimeScope(executionStore, runtime);
        assertPhase2OperationAllowed(runtime, latest.controls, 'dispatch');
        stage = 'create';
        const created = await dispatcher.create(reservation);
        stage = 'mark';
        await executionStore.markDispatchDelivered({
          intentId: reservation.intent_id,
          dispatchGeneration: reservation.dispatch_generation,
          reservationToken: reservation.reservation_token,
          taskName: created.task_name,
        });
        deliveries.push({
          intent_id: reservation.intent_id,
          task_name: created.task_name,
          state: 'delivered',
          deduplicated: created.deduplicated,
        });
      } catch (error) {
        const releasable = stage === 'gate' || (stage === 'create' && definiteTaskCreateFailure(error));
        let released = null;
        if (releasable) {
          try {
            released = await releaseRuntimeReservation(executionStore, reservation, error, {
              permanent: stage === 'create',
              submissionAttempted: stage === 'create',
            });
          } catch { /* reconcile will revisit */ }
        }
        if (stage === 'gate') throw error;
        deliveries.push({
          intent_id: reservation.intent_id,
          state: released?.state || (releasable ? 'released' : 'submission_unknown'),
          error: error?.code || 'dispatch_submission_unknown',
        });
      }
    }
    return {
      status: 200,
      body: {
        ok: true,
        mode: 'cloud-shadow',
        admission_recovery: admissionRecovery,
        recovery,
        dispatch: { considered: candidates.length, deliveries },
      },
    };
  }

  return Object.freeze({ accept, reconcile });
}

export function createPhase2WorkerService({
  config,
  store,
  sourceStore,
  artifactStore,
  provider,
  effects,
  clock = () => Date.now(),
} = {}) {
  const runtime = assertRuntimeConfig(config);
  runtimeMaxAttempts(runtime);
  const executionStore = assertRuntimeStore(store);
  requireRuntimeMethod(sourceStore, 'readExact', 'Phase 2 source store');
  requireRuntimeMethod(artifactStore, 'write', 'Phase 2 artifact store');
  const modelProvider = assertVertexGeminiProvider(provider);
  assertRuntimeEffectFirewall(effects);
  if (typeof clock !== 'function'
    || sourceStore.bucket_name !== runtime.gcp.source_bucket
    || artifactStore.bucket_name !== runtime.gcp.artifact_bucket
    || modelProvider.model !== VERTEX_GEMINI_MODEL
    || modelProvider.pricing_version !== VERTEX_GEMINI_PRICEBOOK_VERSION) {
    throw runtimeFailure(503, 'phase2_worker_boundary_mismatch', 'Worker service boundaries do not match runtime configuration');
  }

  async function execute({ body } = {}) {
    const task = assertRuntimeTask(body, runtime);
    const initial = await persistentRuntimeScope(executionStore, runtime);
    assertPhase2OperationAllowed(runtime, initial.controls, 'worker');
    assertPhase2OperationAllowed(runtime, initial.controls, 'provider');
    await executionStore.assertRunnable({ worker: true, provider: true });
    const workerId = `worker_${canonicalDigest([task, runtimeClockValue(clock)]).slice(0, 40)}`;
    const lease = await executionStore.claimJob({
      jobId: task.job_id,
      intentId: task.intent_id,
      dispatchGeneration: task.dispatch_generation,
      pilotRunId: task.pilot_run_id,
      siteId: task.site_id,
      packetDigest: task.packet_digest,
      workerId,
      leaseMs: 240_000,
      taskName: runtimeTaskName(runtime, task),
    });
    if (lease.terminal) return { status: 204, body: {} };

    let checkpoint = lease.provider_checkpoint || null;
    if (!checkpoint) {
      let safePacket;
      try {
        const envelope = lease.work_envelope;
        const source = await sourceStore.readExact({
          artifactRef: envelope.source.ref,
          sha256: envelope.source.sha256,
          bytes: envelope.source.bytes,
        });
        const sourceDocument = JSON.parse(source.body.toString('utf8'));
        safePacket = assertPhase2RuntimeSource(sourceDocument, envelope);
      } catch (error) {
        const failed = await failRuntimeBeforeProvider(executionStore, lease, error);
        return { status: 200, body: { ok: false, mode: 'cloud-shadow', ...failed } };
      }

      let call;
      try {
        call = await executionStore.reserveModelCall({
          lease,
          provider: 'vertex-gemini',
          model: runtime.provider.model,
          pricebookVersion: runtime.provider.pricebook_version,
          reservedCostMicros: PHASE2_PROVIDER_CALL_RESERVATION_MICROS,
          inputTokensEstimate: lease.work_envelope.source.bytes,
        });
        const latest = await persistentRuntimeScope(executionStore, runtime);
        assertPhase2OperationAllowed(runtime, latest.controls, 'worker');
        assertPhase2OperationAllowed(runtime, latest.controls, 'provider');
        await executionStore.assertRunnable({ worker: true, provider: true });
      } catch (error) {
        const failed = await executionStore.failJob({
          lease,
          modelCallId: call?.model_call_id || null,
          retryable: transientRuntimeFailure(error),
          failureClass: 'phase2_provider_gate_closed',
          reason: error?.code || 'provider gate closed before submission',
          actualCostMicros: 0,
          providerSubmissionConfirmedAbsent: true,
        });
        return { status: 200, body: { ok: false, mode: 'cloud-shadow', ...failed } };
      }

      let result;
      try {
        result = await modelProvider.execute({ ...lease, packet_ref: safePacket });
      } catch (error) {
        const knownPreflight = typeof error?.code === 'string'
          && ['vertex_input_invalid', 'vertex_override_denied', 'vertex_input_too_large', 'vertex_request_aborted'].includes(error.code);
        if (!knownPreflight) {
          const failed = await executionStore.markUncertain({
            lease, modelCallId: call.model_call_id,
            reason: error?.code || 'provider execution outcome is unknown',
          });
          return { status: 200, body: { ok: false, mode: 'cloud-shadow', ...failed } };
        }
        const failed = await executionStore.failJob({
          lease, modelCallId: call.model_call_id, retryable: false,
          failureClass: error.code, reason: error.code, actualCostMicros: 0,
        });
        return { status: 200, body: { ok: false, mode: 'cloud-shadow', ...failed } };
      }

      try { assertRuntimeCallIdentity(result.call, runtime); } catch (error) {
        const failed = await executionStore.markUncertain({
          lease, modelCallId: call.model_call_id, reason: error.code,
        });
        return { status: 200, body: { ok: false, mode: 'cloud-shadow', ...failed } };
      }
      if (result.uncertain) {
        const failed = await executionStore.markUncertain({
          lease, modelCallId: call.model_call_id,
          reason: result.reason, failureClass: result.failureClass,
          ...uncertainRuntimeMetrics(result.call),
        });
        return { status: 200, body: { ok: false, mode: 'cloud-shadow', ...failed } };
      }
      if (!result.ok) {
        const failed = await executionStore.failJob({
          lease, modelCallId: call.model_call_id,
          retryable: result.retryable,
          failureClass: result.failureClass,
          reason: result.reason,
          ...knownRuntimeMetrics(result.call),
        });
        return { status: 200, body: { ok: false, mode: 'cloud-shadow', ...failed } };
      }

      try {
        checkpoint = await executionStore.checkpointProviderSuccess({
          lease,
          modelCallId: call.model_call_id,
          output: result.output,
          ...knownRuntimeMetrics(result.call),
        });
      } catch {
        throw runtimeFailure(503, 'phase2_provider_checkpoint_pending', 'Provider result checkpoint could not be confirmed');
      }
    }

    const latest = await persistentRuntimeScope(executionStore, runtime);
    assertPhase2OperationAllowed(runtime, latest.controls, 'worker');
    assertPhase2OperationAllowed(runtime, latest.controls, 'provider');
    assertRuntimeEffectFirewall(effects);

    let artifact;
    try {
      artifact = await artifactStore.write({
        jobId: lease.job_id,
        logicalKey: 'shadow-observation',
        version: 1,
        output: checkpoint.output,
      });
    } catch {
      throw runtimeFailure(503, 'phase2_artifact_persistence_pending', 'Checkpointed shadow observation could not be persisted');
    }
    const completed = await executionStore.completeJob({
      lease,
      modelCallId: checkpoint.model_call_id,
      artifact,
    });
    return {
      status: 200,
      body: {
        ok: true,
        mode: 'cloud-shadow',
        review_scope: 'phase2-shadow-observation',
        ...completed,
      },
    };
  }

  return Object.freeze({ execute });
}
