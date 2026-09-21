import {
  PHASE_TAG,
  assertPhase2,
  boundedInteger,
  cleanReason,
  deterministicDocumentId,
  exactBoolean,
  requiredString,
  requireRunnableControls,
  snapshotData,
  storeFailure,
  validateControls,
} from './firestore-values.js';
import {
  VERTEX_GEMINI_MODEL,
  VERTEX_GEMINI_PRICEBOOK_VERSION,
} from './pricebook.js';
import {
  assertActiveLease,
  authoritativeEnvelope,
  callMetrics,
  settlement,
  validateArtifact,
  writeDeadLetter,
} from './firestore-worker-support.js';
import { createClaimOperation } from './firestore-claim.js';
import {
  prepareProviderCheckpoint,
  providerCheckpointFromCall,
  sameProviderCheckpoint,
} from './firestore-provider-checkpoint.js';

function assertAttemptOwnership(job, attempt, lease) {
  if (attempt.attempt_id !== lease.attempt_id
    || attempt.job_id !== job.job_id
    || attempt.task_id !== job.task_id
    || attempt.pilot_run_id !== job.pilot_run_id
    || attempt.packet_id !== job.packet_id
    || attempt.project_id !== job.project_id
    || attempt.intent_id !== job.intent_id
    || attempt.intent_id !== lease.intent_id
    || attempt.dispatch_generation !== lease.dispatch_generation
    || attempt.attempt_number !== lease.attempt_number
    || attempt.worker_id !== lease.worker_id
    || attempt.lease_token !== lease.lease_token
    || attempt.fencing_token !== lease.fencing_token
    || attempt.lease_expires_at_ms !== lease.lease_expires_at_ms
    || attempt.lease_expires_at_ms !== job.lease_expires_at_ms) {
    throw storeFailure(409, 'attempt_identity_conflict', 'Execution attempt is not bound to the active job and lease');
  }
}

function assertModelCallOwnership(job, attempt, call, modelCallId) {
  if (attempt.model_call_id !== modelCallId
    || call.model_call_id !== modelCallId
    || call.job_id !== job.job_id
    || call.attempt_id !== attempt.attempt_id) {
    throw storeFailure(409, 'model_call_identity_conflict', 'Model call is not bound to the active job and attempt');
  }
}

function assertOutboxOwnership(job, outbox, lease) {
  if (outbox.job_id !== job.job_id
    || outbox.pilot_run_id !== job.pilot_run_id
    || outbox.intent_id !== job.intent_id
    || lease.intent_id !== job.intent_id
    || outbox.dispatch_generation !== lease.dispatch_generation) {
    throw storeFailure(409, 'dispatch_identity_conflict', 'Dispatch intent is not bound to the active job and lease');
  }
}

export function createWorkerOperations(context) {
  const { db, refs, at, iso } = context;

  async function assertRunnable(options = { worker: true }) {
    const controls = snapshotData(await refs.control().get());
    return requireRunnableControls(controls, options);
  }

  const claimJob = createClaimOperation(context);

  async function reserveModelCall({
    lease, provider = 'vertex-gemini', model, reservedCostMicros,
    pricebookVersion, inputTokensEstimate = 0,
  } = {}) {
    if (!lease) throw storeFailure(400, 'lease_required', 'A worker lease is required');
    if (provider !== 'vertex-gemini') throw storeFailure(403, 'provider_denied', 'Only the Phase 2 Vertex Gemini adapter is allowed');
    if (model !== VERTEX_GEMINI_MODEL) throw storeFailure(403, 'model_denied', 'Only the pinned Phase 2 Vertex Gemini model is allowed');
    if (pricebookVersion !== VERTEX_GEMINI_PRICEBOOK_VERSION) {
      throw storeFailure(409, 'pricebook_version_mismatch', 'Model-call reservation requires the pinned pricebook');
    }
    boundedInteger(reservedCostMicros, 'reservedCostMicros', { min: 1 });
    boundedInteger(inputTokensEstimate, 'inputTokensEstimate');
    const now = at();
    const modelCallId = deterministicDocumentId('call', lease.attempt_id, 1);
    return db.runTransaction(async (tx) => {
      const callRef = refs.call(modelCallId);
      const [jobSnapshot, attemptSnapshot, controlSnapshot, budgetSnapshot, callSnapshot] = await Promise.all([
        tx.get(refs.job(lease.job_id)), tx.get(refs.attempt(lease.attempt_id)), tx.get(refs.control()),
        tx.get(refs.budget(lease.pilot_run_id)), tx.get(callRef),
      ]);
      const job = assertPhase2(snapshotData(jobSnapshot), 'Execution job');
      const attempt = assertPhase2(snapshotData(attemptSnapshot), 'Execution attempt');
      const budget = assertPhase2(snapshotData(budgetSnapshot), 'Execution budget');
      const controls = requireRunnableControls(snapshotData(controlSnapshot), { worker: true, provider: true });
      if (controls.active_pilot_run_id !== job.pilot_run_id
        || budget.pilot_run_id !== job.pilot_run_id
        || lease.pilot_run_id !== job.pilot_run_id) {
        throw storeFailure(409, 'pilot_scope_conflict', 'Model-call reservation is outside the active pilot run');
      }
      assertActiveLease(job, lease, now);
      assertAttemptOwnership(job, attempt, lease);
      if (attempt.state !== 'running') throw storeFailure(409, 'attempt_not_running', 'Execution attempt is not running');
      const existing = snapshotData(callSnapshot);
      if (existing) {
        assertModelCallOwnership(job, attempt, existing, modelCallId);
        if (existing.provider !== provider
          || existing.model !== model || existing.reserved_cost_micros !== reservedCostMicros) {
          throw storeFailure(409, 'model_call_identity_conflict', 'Model call identity is bound to another reservation');
        }
        if (existing.state !== 'reserved') {
          throw storeFailure(409, 'provider_checkpoint_resume_required', 'Checkpointed provider work must resume without another model call');
        }
        return { ...existing, duplicate: true };
      }
      if (attempt.model_call_id !== null) {
        throw storeFailure(409, 'model_call_identity_conflict', 'Execution attempt references a different model call');
      }
      const jobCommitted = job.reserved_cost_micros + job.settled_cost_micros + (job.uncertain_cost_micros || 0);
      const pilotCommitted = budget.reserved_cost_micros + budget.settled_cost_micros + budget.uncertain_cost_micros;
      if (jobCommitted + reservedCostMicros > job.max_cost_micros) {
        throw storeFailure(402, 'job_cost_cap_exceeded', 'Model call would exceed the job cost cap');
      }
      if (pilotCommitted + reservedCostMicros > budget.max_total_cost_micros) {
        throw storeFailure(402, 'pilot_cost_cap_exceeded', 'Model call would exceed the pilot cost cap');
      }
      const call = {
        phase_tag: PHASE_TAG, model_call_id: modelCallId, job_id: job.job_id,
        attempt_id: lease.attempt_id, call_index: 1, provider, model,
        pricebook_version: pricebookVersion, state: 'reserved', outcome: null,
        provider_request_id: null, input_tokens_estimate: inputTokensEstimate,
        input_tokens: null, output_tokens: null, thinking_tokens: null,
        cached_input_tokens: null, total_tokens: null, latency_ms: null,
        prompt_version: null, input_sha256: null,
        reserved_cost_micros: reservedCostMicros, actual_cost_micros: null,
        failure_class: null, created_at_ms: now, completed_at_ms: null,
      };
      tx.create(callRef, call);
      tx.update(refs.job(job.job_id), { reserved_cost_micros: job.reserved_cost_micros + reservedCostMicros, updated_at_ms: now });
      tx.update(refs.budget(job.pilot_run_id), { reserved_cost_micros: budget.reserved_cost_micros + reservedCostMicros, updated_at_ms: now });
      tx.update(refs.attempt(lease.attempt_id), { model_call_id: modelCallId });
      return { ...call, duplicate: false };
    });
  }

  async function checkpointProviderSuccess({ lease, modelCallId, output, ...metrics } = {}) {
    if (!lease) throw storeFailure(400, 'lease_required', 'A worker lease is required');
    requiredString(modelCallId, 'modelCallId', { max: 200 });
    const now = at();
    return db.runTransaction(async (tx) => {
      const [jobSnapshot, attemptSnapshot, callSnapshot, controlSnapshot] = await Promise.all([
        tx.get(refs.job(lease.job_id)),
        tx.get(refs.attempt(lease.attempt_id)),
        tx.get(refs.call(modelCallId)),
        tx.get(refs.control()),
      ]);
      const job = assertPhase2(snapshotData(jobSnapshot), 'Execution job');
      const attempt = assertPhase2(snapshotData(attemptSnapshot), 'Execution attempt');
      const call = assertPhase2(snapshotData(callSnapshot), 'Execution model call');
      const controls = validateControls(snapshotData(controlSnapshot));
      if (controls.active_pilot_run_id !== job.pilot_run_id
        || lease.pilot_run_id !== job.pilot_run_id) {
        throw storeFailure(409, 'pilot_scope_conflict', 'Provider checkpoint is outside the active pilot run');
      }
      assertActiveLease(job, lease, now);
      assertAttemptOwnership(job, attempt, lease);
      assertModelCallOwnership(job, attempt, call, modelCallId);
      const prepared = prepareProviderCheckpoint(job, output, metrics, call.reserved_cost_micros);
      if (call.state === 'provider_succeeded') {
        if (attempt.state !== 'provider_succeeded' || !sameProviderCheckpoint(call, prepared)) {
          throw storeFailure(409, 'provider_checkpoint_conflict', 'Provider success checkpoint is bound to different output or metrics');
        }
        return { ...providerCheckpointFromCall(job, call), duplicate: true };
      }
      if (call.state !== 'reserved' || attempt.state !== 'running') {
        throw storeFailure(409, 'model_call_not_reserved', 'Provider success requires the active reserved model call');
      }
      const checkpointedCall = {
        ...call, ...prepared.metrics,
        state: 'provider_succeeded', outcome: 'success', failure_class: null,
        checkpoint_output_json: prepared.json,
        checkpoint_output_sha256: prepared.sha256,
        checkpoint_output_bytes: prepared.bytes,
        provider_completed_at_ms: now, checkpointed_at_ms: now,
      };
      tx.set(refs.call(modelCallId), checkpointedCall);
      tx.update(refs.attempt(lease.attempt_id), {
        state: 'provider_succeeded', provider_checkpointed_at_ms: now,
      });
      tx.update(refs.job(job.job_id), { execution_stage: 'provider_succeeded', updated_at_ms: now });
      return { ...providerCheckpointFromCall(job, checkpointedCall), duplicate: false };
    });
  }

  async function completeJob({ lease, modelCallId, artifact } = {}) {
    validateArtifact(artifact);
    requiredString(modelCallId, 'modelCallId', { max: 200 });
    const now = at();
    const artifactId = deterministicDocumentId('artifact', lease.job_id, artifact.logical_key, artifact.version);
    const approvalId = deterministicDocumentId('approval', lease.job_id, 'phase2-shadow');
    return db.runTransaction(async (tx) => {
      const artifactRef = refs.artifact(artifactId);
      const [jobSnapshot, attemptSnapshot, callSnapshot, budgetSnapshot, artifactSnapshot, controlSnapshot] = await Promise.all([
        tx.get(refs.job(lease.job_id)), tx.get(refs.attempt(lease.attempt_id)), tx.get(refs.call(modelCallId)),
        tx.get(refs.budget(lease.pilot_run_id)), tx.get(artifactRef), tx.get(refs.control()),
      ]);
      const job = assertPhase2(snapshotData(jobSnapshot), 'Execution job');
      const attempt = assertPhase2(snapshotData(attemptSnapshot), 'Execution attempt');
      const call = assertPhase2(snapshotData(callSnapshot), 'Execution model call');
      const budget = assertPhase2(snapshotData(budgetSnapshot), 'Execution budget');
      const controls = validateControls(snapshotData(controlSnapshot));
      if (controls.active_pilot_run_id !== job.pilot_run_id
        || budget.pilot_run_id !== job.pilot_run_id
        || lease.pilot_run_id !== job.pilot_run_id) {
        throw storeFailure(409, 'pilot_scope_conflict', 'Completion is outside the active pilot run');
      }
      assertActiveLease(job, lease, now);
      assertAttemptOwnership(job, attempt, lease);
      assertModelCallOwnership(job, attempt, call, modelCallId);
      if (attempt.state !== 'provider_succeeded' || call.state !== 'provider_succeeded'
      ) {
        throw storeFailure(409, 'provider_checkpoint_missing', 'Completion requires the active provider-success checkpoint');
      }
      const checkpoint = providerCheckpointFromCall(job, call);
      if (artifact.sha256 !== call.checkpoint_output_sha256
        || artifact.bytes !== call.checkpoint_output_bytes) {
        throw storeFailure(409, 'artifact_checkpoint_mismatch', 'Artifact bytes do not match the provider-success checkpoint');
      }
      const existingArtifact = snapshotData(artifactSnapshot);
      if (existingArtifact && (existingArtifact.sha256 !== artifact.sha256
        || existingArtifact.artifact_ref !== artifact.artifact_ref || existingArtifact.bytes !== artifact.bytes)) {
        throw storeFailure(409, 'artifact_identity_conflict', 'Artifact identity is bound to different bytes');
      }
      const costs = settlement(job, budget, call, checkpoint.metrics.actualCostMicros);
      if (!existingArtifact) tx.create(artifactRef, {
        phase_tag: PHASE_TAG, artifact_id: artifactId, job_id: job.job_id,
        ...artifact, created_at_ms: now,
      });
      tx.update(refs.call(modelCallId), {
        state: 'completed', outcome: 'success', failure_class: null, completed_at_ms: now,
      });
      tx.update(refs.attempt(lease.attempt_id), { state: 'succeeded', completed_at_ms: now });
      tx.update(refs.job(job.job_id), {
        ...costs.job, state: 'awaiting_approval', lease_owner: null, lease_token: null,
        lease_expires_at_ms: null, active_attempt_id: null, resume_attempt_id: null,
        execution_stage: 'awaiting_approval', updated_at_ms: now,
      });
      tx.update(refs.budget(job.pilot_run_id), { ...costs.budget, updated_at_ms: now });
      tx.set(refs.approval(approvalId), {
        phase_tag: PHASE_TAG, approval_id: approvalId, job_id: job.job_id,
        state: 'awaiting_approval', artifact_id: artifactId, artifact_sha256: artifact.sha256,
        review_scope: 'phase2-shadow-observation', created_at_ms: now,
      });
      tx.update(refs.task(job.task_id), {
        model_or_tool: `${call.provider}/${call.model}`,
        cost_actual: (costs.job.settled_cost_micros + costs.job.uncertain_cost_micros) / 1_000_000,
        output_refs: [artifact.artifact_ref, `sha256:${artifact.sha256}`],
        decision_summary: 'Cloud shadow execution completed and is awaiting pilot observation.',
        completed_at: iso(now),
      });
      const eventId = deterministicDocumentId('event', job.job_id, 'awaiting_approval');
      tx.create(refs.event(eventId), {
        phase_tag: PHASE_TAG, task_event_id: eventId, job_id: job.job_id,
        from_state: 'running', to_state: 'awaiting_approval', reason: 'cloud-shadow-artifact-ready', created_at_ms: now,
      });
      return { job_id: job.job_id, state: 'awaiting_approval', artifact_id: artifactId };
    });
  }

  async function failJob({
    lease, modelCallId = null, retryable, failureClass, reason,
    providerRequestId = null, inputTokens = 0, outputTokens = 0,
    thinkingTokens = 0, cachedInputTokens = 0, totalTokens = 0,
    latencyMs = 0, promptVersion = null, inputSha256 = null,
    actualCostMicros = 0, baseBackoffMs = 1_000,
    providerSubmissionConfirmedAbsent = false,
  } = {}) {
    if (typeof retryable !== 'boolean') throw storeFailure(400, 'retryable_invalid', 'retryable must be an exact boolean');
    if (modelCallId !== null) requiredString(modelCallId, 'modelCallId', { max: 200 });
    exactBoolean(providerSubmissionConfirmedAbsent, 'providerSubmissionConfirmedAbsent');
    requiredString(failureClass, 'failureClass', { max: 100 });
    boundedInteger(baseBackoffMs, 'baseBackoffMs', { max: 3_600_000 });
    const metrics = callMetrics({
      providerRequestId, inputTokens, outputTokens, thinkingTokens,
      cachedInputTokens, totalTokens, latencyMs, promptVersion,
      inputSha256, actualCostMicros,
    });
    const now = at();
    return db.runTransaction(async (tx) => {
      const jobRef = refs.job(lease.job_id);
      const baseReads = [
        tx.get(jobRef), tx.get(refs.attempt(lease.attempt_id)),
        tx.get(refs.budget(lease.pilot_run_id)), tx.get(refs.outbox(lease.intent_id || deterministicDocumentId('intent', lease.job_id))),
        tx.get(refs.control()),
      ];
      const reads = await Promise.all(baseReads);
      const job = assertPhase2(snapshotData(reads[0]), 'Execution job');
      const attempt = assertPhase2(snapshotData(reads[1]), 'Execution attempt');
      const budget = assertPhase2(snapshotData(reads[2]), 'Execution budget');
      const outbox = snapshotData(reads[3]);
      const controls = validateControls(snapshotData(reads[4]));
      assertAttemptOwnership(job, attempt, lease);
      assertPhase2(outbox, 'Dispatch intent');
      assertOutboxOwnership(job, outbox, lease);
      const durableModelCallId = attempt.model_call_id ?? null;
      if (durableModelCallId !== null) {
        requiredString(durableModelCallId, 'attempt.model_call_id', { max: 200 });
      }
      if (modelCallId !== null && modelCallId !== durableModelCallId) {
        throw storeFailure(409, 'model_call_identity_conflict', 'Failure call does not match the active attempt');
      }
      const recoveringLostReservation = modelCallId === null && durableModelCallId !== null;
      if (recoveringLostReservation && !providerSubmissionConfirmedAbsent) {
        throw storeFailure(
          409,
          'model_call_identity_required',
          'A durable model call cannot be settled without a proven pre-provider failure',
        );
      }
      const effectiveModelCallId = modelCallId ?? durableModelCallId;
      const call = effectiveModelCallId
        ? assertPhase2(snapshotData(await tx.get(refs.call(effectiveModelCallId))), 'Execution model call')
        : null;
      if (call) assertModelCallOwnership(job, attempt, call, effectiveModelCallId);
      if (recoveringLostReservation) {
        const noProviderEvidence = call.state === 'reserved'
          && providerRequestId === null
          && inputTokens === 0
          && outputTokens === 0
          && thinkingTokens === 0
          && cachedInputTokens === 0
          && totalTokens === 0
          && latencyMs === 0
          && promptVersion === null
          && inputSha256 === null
          && actualCostMicros === 0;
        if (!noProviderEvidence) {
          throw storeFailure(
            409,
            'pre_provider_settlement_invalid',
            'Lost model-call reservation recovery requires an unsubmitted zero-cost call',
          );
        }
      }
      if (controls.active_pilot_run_id !== job.pilot_run_id
        || budget.pilot_run_id !== job.pilot_run_id
        || lease.pilot_run_id !== job.pilot_run_id) {
        throw storeFailure(409, 'pilot_scope_conflict', 'Failure settlement is outside the active pilot run');
      }
      assertActiveLease(job, lease, now);
      if (!['running', 'provider_succeeded'].includes(attempt.state)) {
        throw storeFailure(409, 'attempt_not_running', 'Execution attempt is not active');
      }
      const message = cleanReason(reason);
      const checkpointed = call?.state === 'provider_succeeded';
      const canRetry = retryable
        && outbox.dispatch_generation < job.max_dispatch_generations
        && (checkpointed || job.attempts_started < job.max_attempts);
      let costs = { job: { reserved_cost_micros: job.reserved_cost_micros, settled_cost_micros: job.settled_cost_micros, uncertain_cost_micros: job.uncertain_cost_micros || 0 }, budget };
      if (call) {
        if (!['reserved', 'provider_succeeded'].includes(call.state)
          || call.attempt_id !== lease.attempt_id) {
          throw storeFailure(409, 'model_call_not_reserved', 'Failure requires the active model call');
        }
        if (checkpointed) {
          const checkpoint = providerCheckpointFromCall(job, call);
          if (!canRetry) {
            costs = settlement(job, budget, call, checkpoint.metrics.actualCostMicros);
            tx.update(refs.call(effectiveModelCallId), {
              state: 'completed', outcome: 'success', failure_class: null,
              workflow_terminal_reason: failureClass, completed_at_ms: now,
            });
          }
        } else {
          costs = settlement(job, budget, call, actualCostMicros);
          tx.update(refs.call(effectiveModelCallId), {
            ...metrics, state: 'completed', outcome: retryable ? 'transient_failure' : 'permanent_failure',
            failure_class: failureClass, completed_at_ms: now,
          });
        }
      } else if (actualCostMicros !== 0) {
        throw storeFailure(409, 'unreserved_cost_denied', 'Cost cannot be recorded without a model-call reservation');
      }
      tx.update(refs.attempt(lease.attempt_id), {
        state: canRetry ? (checkpointed ? 'resume_scheduled' : 'retry_scheduled') : 'failed_permanent',
        failure_class: failureClass, failure_reason: message,
        completed_at_ms: canRetry && checkpointed ? null : now,
      });
      tx.update(refs.budget(job.pilot_run_id), { ...costs.budget, updated_at_ms: now });
      if (canRetry) {
        const available = now + baseBackoffMs * (2 ** (job.attempts_started - 1));
        tx.update(jobRef, {
          ...costs.job, state: 'retry_wait', available_at_ms: available,
          lease_owner: null, lease_token: null, lease_expires_at_ms: null, active_attempt_id: null,
          resume_attempt_id: checkpointed ? lease.attempt_id : null,
          execution_stage: checkpointed ? 'provider_succeeded' : 'retry_wait',
          last_failure_class: failureClass, last_failure_reason: message, updated_at_ms: now,
        });
        tx.set(refs.outbox(job.intent_id), {
          ...outbox, state: 'pending', dispatch_generation: outbox.dispatch_generation + 1,
          available_at_ms: available, task_name: null, reservation_owner: null,
          reservation_token: null, reservation_expires_at_ms: null, last_error: null, updated_at_ms: now,
          claim_not_after_ms: null, worker_claimed_at_ms: null,
        });
        return { job_id: job.job_id, state: 'retry_wait', available_at_ms: available };
      }
      return writeDeadLetter(tx, { refs, job, costs, failureClass, message, now, iso });
    });
  }

  async function markUncertain({
    lease, modelCallId, reason, failureClass = 'provider_outcome_uncertain', ...metrics
  } = {}) {
    requiredString(modelCallId, 'modelCallId', { max: 200 });
    requiredString(failureClass, 'failureClass', { max: 100 });
    const measured = callMetrics(metrics, { allowUnknownCost: true });
    const now = at();
    return db.runTransaction(async (tx) => {
      const [jobSnapshot, attemptSnapshot, callSnapshot, budgetSnapshot, controlSnapshot] = await Promise.all([
        tx.get(refs.job(lease.job_id)), tx.get(refs.attempt(lease.attempt_id)),
        tx.get(refs.call(modelCallId)), tx.get(refs.budget(lease.pilot_run_id)), tx.get(refs.control()),
      ]);
      const job = assertPhase2(snapshotData(jobSnapshot), 'Execution job');
      const attempt = assertPhase2(snapshotData(attemptSnapshot), 'Execution attempt');
      const call = assertPhase2(snapshotData(callSnapshot), 'Execution model call');
      const budget = assertPhase2(snapshotData(budgetSnapshot), 'Execution budget');
      const controls = validateControls(snapshotData(controlSnapshot));
      if (controls.active_pilot_run_id !== job.pilot_run_id
        || budget.pilot_run_id !== job.pilot_run_id
        || lease.pilot_run_id !== job.pilot_run_id) {
        throw storeFailure(409, 'pilot_scope_conflict', 'Uncertain settlement is outside the active pilot run');
      }
      assertActiveLease(job, lease, now);
      assertAttemptOwnership(job, attempt, lease);
      assertModelCallOwnership(job, attempt, call, modelCallId);
      if (attempt.state !== 'running' || call.state !== 'reserved'
      ) {
        throw storeFailure(409, 'model_call_not_reserved', 'Uncertain outcome requires the active reserved model call');
      }
      const message = cleanReason(reason);
      const costs = settlement(job, budget, call, call.reserved_cost_micros, true);
      tx.update(refs.call(modelCallId), {
        ...measured, state: 'uncertain', outcome: 'uncertain', failure_class: failureClass,
        accounted_cost_micros: call.reserved_cost_micros, completed_at_ms: now,
      });
      tx.update(refs.attempt(lease.attempt_id), {
        state: 'uncertain_provider_outcome', failure_class: failureClass,
        failure_reason: message, completed_at_ms: now,
      });
      tx.update(refs.budget(job.pilot_run_id), { ...costs.budget, updated_at_ms: now });
      return writeDeadLetter(tx, { refs, job, costs, failureClass, message, now, iso, costActual: null });
    });
  }

  return {
    assertRunnable,
    claimJob,
    reserveModelCall,
    checkpointProviderSuccess,
    completeJob,
    failJob,
    markUncertain,
  };
}
