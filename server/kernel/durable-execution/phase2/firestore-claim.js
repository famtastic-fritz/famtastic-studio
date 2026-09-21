import {
  PHASE_TAG,
  assertPhase2,
  boundedInteger,
  deterministicDocumentId,
  requiredString,
  requireRunnableControls,
  snapshotData,
  storeFailure,
} from './firestore-values.js';
import { providerCheckpointFromCall } from './firestore-provider-checkpoint.js';
import { authoritativeEnvelope, settlement, writeDeadLetter } from './firestore-worker-support.js';
import { assertDispatchBinding, assertStoredAttempt, assertStoredCall } from './firestore-bindings.js';

function deliverArrivingTask(tx, { refs, outboxRef, outbox, taskName, intentId, generation, now }) {
  if (!['submitting', 'delivered'].includes(outbox.state)) {
    throw storeFailure(409, 'dispatch_state_invalid', 'Cloud task arrived without a durable dispatch reservation');
  }
  requiredString(taskName, 'taskName', { max: 1000 });
  const expectedTaskId = deterministicDocumentId('cloudtask', intentId, generation);
  if (taskName.split('/').at(-1) !== expectedTaskId
    || (outbox.state === 'delivered' && outbox.task_name !== taskName)) {
    throw storeFailure(409, 'dispatch_identity_conflict', 'Cloud task name does not match the current dispatch');
  }
  tx.update(outboxRef, {
    state: 'delivered', task_name: taskName,
    delivery_count: outbox.delivery_count + (outbox.state === 'submitting' ? 1 : 0),
    delivered_at_ms: outbox.delivered_at_ms || now,
    worker_claimed_at_ms: now, claim_not_after_ms: null,
    reservation_owner: null, reservation_token: null,
    reservation_expires_at_ms: null, updated_at_ms: now,
  });
}

function leaseShape({ job, attemptId, attemptNumber, workerId, leaseToken, fencingToken, leaseMs, now, intentId, generation }) {
  return {
    job_id: job.job_id, task_id: job.task_id, attempt_id: attemptId,
    attempt_number: attemptNumber, worker_id: workerId, lease_token: leaseToken,
    fencing_token: fencingToken, lease_expires_at_ms: now + leaseMs,
    pilot_run_id: job.pilot_run_id, packet_id: job.packet_id, project_id: job.project_id,
    intent_id: intentId, dispatch_generation: generation,
  };
}

export function createClaimOperation(context) {
  const { db, refs, at, iso, nextId } = context;

  return async function claimJob({
    jobId, intentId, dispatchGeneration, pilotRunId, siteId, packetDigest,
    workerId, leaseMs = 120_000, taskName = null,
  } = {}) {
    for (const [value, label] of [
      [jobId, 'jobId'], [intentId, 'intentId'], [pilotRunId, 'pilotRunId'],
      [siteId, 'siteId'], [packetDigest, 'packetDigest'], [workerId, 'workerId'],
    ]) requiredString(value, label, { max: 200 });
    boundedInteger(dispatchGeneration, 'dispatchGeneration', { min: 1, max: 50 });
    boundedInteger(leaseMs, 'leaseMs', { min: 1_000, max: 3_600_000 });
    const freshAttemptId = nextId('attempt');
    const leaseToken = nextId('lease');

    return db.runTransaction(async (tx) => {
      const now = at();
      const jobRef = refs.job(jobId);
      const outboxRef = refs.outbox(intentId);
      const [jobSnapshot, outboxSnapshot, controlSnapshot] = await Promise.all([
        tx.get(jobRef), tx.get(outboxRef), tx.get(refs.control()),
      ]);
      let job = assertPhase2(snapshotData(jobSnapshot), 'Execution job');
      const outbox = assertPhase2(snapshotData(outboxSnapshot), 'Dispatch intent');
      const controls = requireRunnableControls(snapshotData(controlSnapshot), { worker: true });
      if (controls.active_pilot_run_id !== pilotRunId) {
        throw storeFailure(409, 'pilot_scope_conflict', 'Worker claim is outside the active pilot run');
      }
      if (job.pilot_run_id !== pilotRunId || outbox.job_id !== jobId
        || outbox.dispatch_generation !== dispatchGeneration
        || job.site_id !== siteId || job.packet_digest !== packetDigest) {
        throw storeFailure(409, 'task_identity_mismatch', 'Cloud task identity does not match the current job dispatch');
      }
      assertDispatchBinding({ job, outbox, jobId, intentId, pilotRunId });
      if (['awaiting_approval', 'dead_letter'].includes(job.state)) {
        return { terminal: true, job_id: jobId, state: job.state };
      }
      if (job.state === 'running' && job.lease_expires_at_ms > now) {
        throw storeFailure(409, 'lease_conflict', 'Job already has an active worker lease');
      }

      const resumeAttemptId = job.state === 'running'
        ? job.active_attempt_id
        : (['queued', 'retry_wait'].includes(job.state) ? job.resume_attempt_id : null);
      let priorAttempt = null;
      let priorCall = null;
      let budget = null;
      if (resumeAttemptId) {
        priorAttempt = snapshotData(await tx.get(refs.attempt(resumeAttemptId)));
        assertStoredAttempt(job, priorAttempt, resumeAttemptId);
        if (priorAttempt?.model_call_id) {
          [priorCall, budget] = (await Promise.all([
            tx.get(refs.call(priorAttempt.model_call_id)),
            tx.get(refs.budget(job.pilot_run_id)),
          ])).map(snapshotData);
          assertStoredCall(job, priorAttempt, priorCall, priorAttempt.model_call_id);
          if (assertPhase2(budget, 'Execution budget').pilot_run_id !== job.pilot_run_id) {
            throw storeFailure(409, 'pilot_scope_conflict', 'Resume budget is outside the job pilot');
          }
        }
      }
      if (job.state === 'running' && !priorAttempt) {
        throw storeFailure(503, 'attempt_record_missing', 'Running job has no durable active attempt');
      }
      if (priorAttempt?.model_call_id && !priorCall) {
        throw storeFailure(503, 'model_call_record_missing', 'Execution attempt references a missing model call');
      }
      if (job.available_at_ms > now) throw storeFailure(409, 'job_not_ready', 'Job is not yet eligible for execution');
      if (!['queued', 'retry_wait', 'running'].includes(job.state)) {
        throw storeFailure(409, 'job_not_claimable', `Job cannot be claimed from ${job.state}`);
      }

      if (priorAttempt && priorCall?.state === 'provider_succeeded') {
        assertPhase2(priorAttempt, 'Execution attempt');
        assertPhase2(priorCall, 'Execution model call');
        if (priorCall.attempt_id !== priorAttempt.attempt_id
          || !['provider_succeeded', 'resume_scheduled'].includes(priorAttempt.state)) {
          throw storeFailure(409, 'provider_checkpoint_invariant', 'Provider checkpoint is not bound to the resumable attempt');
        }
        const providerCheckpoint = providerCheckpointFromCall(job, priorCall);
        const fencingToken = job.fencing_token + 1;
        const lease = leaseShape({
          job, attemptId: priorAttempt.attempt_id, attemptNumber: priorAttempt.attempt_number,
          workerId, leaseToken, fencingToken, leaseMs, now, intentId, generation: dispatchGeneration,
        });
        job = {
          ...job, state: 'running', resume_attempt_id: null,
          lease_owner: workerId, lease_token: leaseToken, lease_expires_at_ms: now + leaseMs,
          fencing_token: fencingToken, active_attempt_id: priorAttempt.attempt_id, updated_at_ms: now,
        };
        tx.set(jobRef, job);
        tx.update(refs.attempt(priorAttempt.attempt_id), {
          ...lease, state: 'provider_succeeded',
          resume_count: (priorAttempt.resume_count || 0) + 1, resumed_at_ms: now,
          failure_class: null, failure_reason: null, completed_at_ms: null,
        });
        deliverArrivingTask(tx, {
          refs, outboxRef, outbox, taskName, intentId, generation: dispatchGeneration, now,
        });
        const eventId = deterministicDocumentId('event', jobId, 'provider_resume_claimed', fencingToken);
        tx.create(refs.event(eventId), {
          phase_tag: PHASE_TAG, task_event_id: eventId, job_id: jobId,
          from_state: jobSnapshot.data().state, to_state: 'running',
          reason: 'provider-checkpoint-resumed', created_at_ms: now,
        });
        return {
          ...lease, work_envelope: authoritativeEnvelope(job),
          provider_checkpoint: providerCheckpoint, resumed: true, terminal: false,
        };
      }

      if (job.resume_attempt_id) {
        throw storeFailure(503, 'provider_checkpoint_corrupt', 'Resume marker has no provider-success checkpoint');
      }
      if (job.state === 'running' && priorAttempt) {
        assertPhase2(priorAttempt, 'Execution attempt');
        if (priorCall) {
          assertPhase2(priorCall, 'Execution model call');
          const activeBudget = assertPhase2(budget, 'Execution budget');
          if (priorCall.state !== 'reserved') {
            throw storeFailure(409, 'expired_call_invariant', 'Expired running job has an unsupported model-call state');
          }
          const message = 'Worker lease expired after a provider call may have begun';
          const costs = settlement(job, activeBudget, priorCall, priorCall.reserved_cost_micros, true);
          tx.update(refs.call(priorCall.model_call_id), {
            state: 'uncertain', outcome: 'uncertain', failure_class: 'provider_outcome_uncertain',
            actual_cost_micros: null, accounted_cost_micros: priorCall.reserved_cost_micros,
            completed_at_ms: now,
          });
          tx.update(refs.attempt(priorAttempt.attempt_id), {
            state: 'uncertain_provider_outcome', failure_class: 'provider_outcome_uncertain',
            failure_reason: message, completed_at_ms: now,
          });
          tx.update(refs.budget(job.pilot_run_id), { ...costs.budget, updated_at_ms: now });
          return { terminal: true, ...writeDeadLetter(tx, {
            refs, job, costs, failureClass: 'provider_outcome_uncertain',
            message, now, iso, costActual: null,
          }) };
        }
        tx.update(refs.attempt(priorAttempt.attempt_id), {
          state: 'lease_expired', failure_class: 'lease_expired',
          failure_reason: 'Worker lease expired', completed_at_ms: now,
        });
      }

      if (job.attempts_started >= job.max_attempts) {
        const message = 'Worker lease expired at the attempt limit';
        const costs = { job: {
          reserved_cost_micros: job.reserved_cost_micros,
          settled_cost_micros: job.settled_cost_micros,
          uncertain_cost_micros: job.uncertain_cost_micros || 0,
        } };
        return { terminal: true, ...writeDeadLetter(tx, {
          refs, job, costs, failureClass: 'lease_expired', message, now, iso,
        }) };
      }

      requireRunnableControls(controls, { worker: true, provider: true });
      const attemptNumber = job.attempts_started + 1;
      const fencingToken = job.fencing_token + 1;
      const lease = leaseShape({
        job, attemptId: freshAttemptId, attemptNumber, workerId, leaseToken,
        fencingToken, leaseMs, now, intentId, generation: dispatchGeneration,
      });
      const previousState = job.state;
      job = {
        ...job, state: 'running', attempts_started: attemptNumber, resume_attempt_id: null,
        lease_owner: workerId, lease_token: leaseToken, lease_expires_at_ms: now + leaseMs,
        fencing_token: fencingToken, active_attempt_id: freshAttemptId, updated_at_ms: now,
      };
      tx.set(jobRef, job);
      tx.create(refs.attempt(freshAttemptId), {
        phase_tag: PHASE_TAG, ...lease, state: 'running', model_call_id: null,
        resume_count: 0, started_at_ms: now,
      });
      const eventId = deterministicDocumentId('event', jobId, 'running', attemptNumber);
      tx.create(refs.event(eventId), {
        phase_tag: PHASE_TAG, task_event_id: eventId, job_id: jobId,
        from_state: previousState, to_state: 'running', reason: 'worker-lease-acquired', created_at_ms: now,
      });
      deliverArrivingTask(tx, {
        refs, outboxRef, outbox, taskName, intentId, generation: dispatchGeneration, now,
      });
      return { ...lease, work_envelope: authoritativeEnvelope(job), terminal: false };
    });
  };
}
