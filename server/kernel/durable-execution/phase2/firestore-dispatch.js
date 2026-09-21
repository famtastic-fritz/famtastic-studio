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
  snapshotRows,
  storeFailure,
  validateControls,
} from './firestore-values.js';
import {
  WORKER_CLAIM_ACK_MS,
  finalizeDispatchManual,
  loadDispatchTerminalContext,
} from './firestore-dispatch-support.js';
import { assertDispatchBinding } from './firestore-bindings.js';

const MAX_BACKOFF_MS = 300_000;

function dispatchBackoff(attempts, baseBackoffMs) {
  return Math.min(MAX_BACKOFF_MS, baseBackoffMs * (2 ** Math.max(0, attempts - 1)));
}

function taskEnvelope(job, outbox) {
  return {
    schema: 'famtastic.execution.task.v2',
    job_id: job.job_id,
    intent_id: outbox.intent_id,
    dispatch_generation: outbox.dispatch_generation,
    pilot_run_id: job.pilot_run_id,
    site_id: job.site_id,
    packet_digest: job.packet_digest,
  };
}

function reservationResult(job, outbox, duplicate = false) {
  const envelope = taskEnvelope(job, outbox);
  return {
    ...envelope,
    task_id: deterministicDocumentId('cloudtask', outbox.intent_id, outbox.dispatch_generation),
    reservation_token: outbox.reservation_token,
    available_at_ms: outbox.available_at_ms,
    duplicate,
  };
}

export function createDispatchOperations(context) {
  const { db, refs, at, iso, nextId } = context;

  async function listDispatchCandidates({ pilotRunId, limit = 25 } = {}) {
    requiredString(pilotRunId, 'pilotRunId', { max: 128 });
    boundedInteger(limit, 'limit', { min: 1, max: 100 });
    const now = at();
    const rows = snapshotRows(await refs.collection('outbox').get())
      .filter((row) => row.phase_tag === PHASE_TAG
        && row.pilot_run_id === pilotRunId
        && row.available_at_ms <= now
        && (row.state === 'pending' || (row.state === 'submitting'
          && !Number.isSafeInteger(row.claim_not_after_ms)
          && row.reservation_expires_at_ms <= now
          && (row.retry_not_before_ms === null || row.retry_not_before_ms <= now))))
      .sort((left, right) => left.available_at_ms - right.available_at_ms || left.intent_id.localeCompare(right.intent_id));
    return rows.slice(0, limit);
  }

  async function reserveDispatch({
    intentId, dispatcherId, reservationMs = 30_000, baseBackoffMs = 1_000,
  } = {}) {
    requiredString(intentId, 'intentId', { max: 200 });
    requiredString(dispatcherId, 'dispatcherId', { max: 200 });
    boundedInteger(reservationMs, 'reservationMs', { min: 1, max: 300_000 });
    boundedInteger(baseBackoffMs, 'baseBackoffMs', { min: 0, max: 60_000 });
    const reservationToken = nextId('dispatchlease');
    return db.runTransaction(async (tx) => {
      const now = at();
      const outboxRef = refs.outbox(intentId);
      const outbox = assertPhase2(snapshotData(await tx.get(outboxRef)), 'Dispatch intent');
      const [jobSnapshot, controlSnapshot] = await Promise.all([
        tx.get(refs.job(outbox.job_id)),
        tx.get(refs.control()),
      ]);
      const job = assertPhase2(snapshotData(jobSnapshot), 'Execution job');
      const controls = requireRunnableControls(snapshotData(controlSnapshot), { dispatch: true });
      assertDispatchBinding({ job, outbox, jobId: outbox.job_id, intentId, pilotRunId: controls.active_pilot_run_id });
      if (controls.active_pilot_run_id !== job.pilot_run_id
        || outbox.pilot_run_id !== job.pilot_run_id) {
        throw storeFailure(409, 'pilot_scope_conflict', 'Dispatch intent is outside the active pilot run');
      }
      if (outbox.state === 'delivered') return reservationResult(job, outbox, true);
      if (!['pending', 'submitting'].includes(outbox.state)) {
        throw storeFailure(409, 'dispatch_state_invalid', `Dispatch intent cannot be reserved from ${outbox.state}`);
      }
      if (outbox.available_at_ms > now) throw storeFailure(409, 'dispatch_not_ready', 'Dispatch intent is not yet eligible');
      if (outbox.state === 'submitting' && outbox.reservation_expires_at_ms > now) {
        throw storeFailure(409, 'dispatch_reservation_active', 'Dispatch intent already has an active reservation');
      }
      if (outbox.state === 'submitting' && outbox.retry_not_before_ms > now) {
        throw storeFailure(409, 'dispatch_not_ready', 'Dispatch retry backoff is still active');
      }
      if (outbox.dispatch_generation < 1 || outbox.dispatch_generation > job.max_dispatch_generations) {
        throw storeFailure(409, 'dispatch_generation_exhausted', 'Dispatch generation is outside its bounded range');
      }
      if (!['accepted', 'queued', 'retry_wait'].includes(job.state)) {
        throw storeFailure(409, 'job_not_dispatchable', `Job cannot be dispatched from ${job.state}`);
      }
      if (job.available_at_ms > now) throw storeFailure(409, 'job_not_ready', 'Job is not yet eligible for dispatch');
      const attempts = outbox.submission_attempts || 0;
      if (attempts >= job.max_dispatch_generations) {
        const terminalContext = await loadDispatchTerminalContext(tx, refs, job);
        return finalizeDispatchManual(tx, {
          refs, job, outbox, context: terminalContext,
          failureClass: 'dispatch_submission_unverified',
          reason: 'Cloud Task submission could not be verified within the configured bound',
          executionRisk: 'unknown', now, iso,
        });
      }
      const nextAttempts = attempts + 1;
      const claimNotAfter = Number.isSafeInteger(outbox.claim_not_after_ms)
        ? outbox.claim_not_after_ms
        : now + WORKER_CLAIM_ACK_MS;
      const reserved = {
        ...outbox,
        state: 'submitting',
        reservation_owner: dispatcherId,
        reservation_token: reservationToken,
        reservation_expires_at_ms: now + reservationMs,
        submission_attempts: nextAttempts,
        last_submission_at_ms: now,
        retry_not_before_ms: now + dispatchBackoff(nextAttempts, baseBackoffMs),
        claim_not_after_ms: claimNotAfter,
        worker_claimed_at_ms: null,
        updated_at_ms: now,
      };
      tx.set(outboxRef, reserved);
      if (job.state !== 'queued') {
        tx.update(refs.job(job.job_id), { state: 'queued', updated_at_ms: now });
        const eventId = deterministicDocumentId('event', job.job_id, 'queued', outbox.dispatch_generation);
        tx.create(refs.event(eventId), {
          phase_tag: PHASE_TAG, task_event_id: eventId, job_id: job.job_id,
          from_state: job.state, to_state: 'queued', reason: 'cloud-dispatch-reserved', created_at_ms: now,
        });
      }
      return reservationResult({ ...job, state: 'queued' }, reserved);
    });
  }

  async function markDispatchDelivered({
    intentId, dispatchGeneration, reservationToken, taskName,
  } = {}) {
    requiredString(intentId, 'intentId', { max: 200 });
    requiredString(reservationToken, 'reservationToken', { max: 200 });
    requiredString(taskName, 'taskName', { max: 1000 });
    boundedInteger(dispatchGeneration, 'dispatchGeneration', { min: 1, max: 50 });
    return db.runTransaction(async (tx) => {
      const now = at();
      const ref = refs.outbox(intentId);
      const outbox = assertPhase2(snapshotData(await tx.get(ref)), 'Dispatch intent');
      const [jobSnapshot, controlSnapshot] = await Promise.all([
        tx.get(refs.job(outbox.job_id)), tx.get(refs.control()),
      ]);
      const job = assertPhase2(snapshotData(jobSnapshot), 'Execution job');
      const controls = validateControls(snapshotData(controlSnapshot));
      assertDispatchBinding({ job, outbox, jobId: outbox.job_id, intentId, pilotRunId: controls.active_pilot_run_id });
      if (controls.active_pilot_run_id !== job.pilot_run_id
        || outbox.pilot_run_id !== job.pilot_run_id) {
        throw storeFailure(409, 'pilot_scope_conflict', 'Dispatch intent is outside the active pilot run');
      }
      if (outbox.dispatch_generation !== dispatchGeneration) {
        throw storeFailure(409, 'stale_dispatch_generation', 'Dispatch generation is no longer current');
      }
      const expectedTaskId = deterministicDocumentId('cloudtask', outbox.intent_id, outbox.dispatch_generation);
      if (taskName.split('/').at(-1) !== expectedTaskId) {
        throw storeFailure(409, 'dispatch_identity_conflict', 'Cloud task name does not end in the reserved task identity');
      }
      if (outbox.state === 'delivered') {
        if (outbox.task_name !== taskName) throw storeFailure(409, 'dispatch_identity_conflict', 'Dispatch identity is bound to another task');
        return { ...outbox, duplicate: true };
      }
      if (outbox.state !== 'submitting' || outbox.reservation_token !== reservationToken) {
        throw storeFailure(409, 'stale_dispatch_reservation', 'Dispatch reservation is no longer active');
      }
      const delivered = {
        ...outbox,
        state: 'delivered',
        task_name: taskName,
        delivery_count: outbox.delivery_count + 1,
        delivered_at_ms: now,
        claim_not_after_ms: Number.isSafeInteger(outbox.claim_not_after_ms)
          ? outbox.claim_not_after_ms
          : now + WORKER_CLAIM_ACK_MS,
        worker_claimed_at_ms: null,
        reservation_owner: null,
        reservation_token: null,
        reservation_expires_at_ms: null,
        retry_not_before_ms: null,
        last_error: null,
        updated_at_ms: now,
      };
      tx.set(ref, delivered);
      return { ...delivered, duplicate: false };
    });
  }

  async function releaseDispatch({
    intentId, dispatchGeneration, reservationToken, error,
    permanent = false, submissionAttempted = true, baseBackoffMs = 1_000,
  } = {}) {
    requiredString(intentId, 'intentId', { max: 200 });
    requiredString(reservationToken, 'reservationToken', { max: 200 });
    boundedInteger(dispatchGeneration, 'dispatchGeneration', { min: 1, max: 50 });
    exactBoolean(permanent, 'permanent');
    exactBoolean(submissionAttempted, 'submissionAttempted');
    boundedInteger(baseBackoffMs, 'baseBackoffMs', { min: 0, max: 60_000 });
    return db.runTransaction(async (tx) => {
      const now = at();
      const ref = refs.outbox(intentId);
      const outbox = assertPhase2(snapshotData(await tx.get(ref)), 'Dispatch intent');
      const [jobSnapshot, controlSnapshot] = await Promise.all([
        tx.get(refs.job(outbox.job_id)), tx.get(refs.control()),
      ]);
      const job = assertPhase2(snapshotData(jobSnapshot), 'Execution job');
      const controls = validateControls(snapshotData(controlSnapshot));
      assertDispatchBinding({ job, outbox, jobId: outbox.job_id, intentId, pilotRunId: controls.active_pilot_run_id });
      if (controls.active_pilot_run_id !== job.pilot_run_id
        || outbox.pilot_run_id !== job.pilot_run_id) {
        throw storeFailure(409, 'pilot_scope_conflict', 'Dispatch intent is outside the active pilot run');
      }
      if (outbox.dispatch_generation !== dispatchGeneration) {
        throw storeFailure(409, 'stale_dispatch_generation', 'Dispatch generation is no longer current');
      }
      if (outbox.state === 'delivered') return { ...outbox, duplicate: true };
      if (outbox.state !== 'submitting'
        || outbox.dispatch_generation !== dispatchGeneration
        || outbox.reservation_token !== reservationToken) {
        throw storeFailure(409, 'stale_dispatch_reservation', 'Dispatch reservation is no longer active');
      }
      const attempts = Math.max(0, (outbox.submission_attempts || 0) - (submissionAttempted ? 0 : 1));
      const message = cleanReason(
        error && typeof error === 'object' && typeof error.code === 'string'
          ? error.code
          : error,
      );
      if (permanent || attempts >= job.max_dispatch_generations) {
        const terminalContext = await loadDispatchTerminalContext(tx, refs, job);
        const executionRisk = ['cloud_task_existing_identity_conflict', 'cloud_task_identity_unverified'].includes(message)
          ? 'unknown'
          : (permanent ? 'none' : 'unknown');
        return finalizeDispatchManual(tx, {
          refs, job, outbox: { ...outbox, submission_attempts: attempts }, context: terminalContext,
          failureClass: permanent ? 'dispatch_permanent_failure' : 'dispatch_submission_exhausted',
          reason: message,
          executionRisk, now, iso,
        });
      }
      const availableAt = now + dispatchBackoff(Math.max(1, attempts), baseBackoffMs);
      const released = {
        ...outbox,
        state: 'pending',
        submission_attempts: attempts,
        available_at_ms: availableAt,
        retry_not_before_ms: availableAt,
        reservation_owner: null,
        reservation_token: null,
        reservation_expires_at_ms: null,
        claim_not_after_ms: submissionAttempted ? outbox.claim_not_after_ms : null,
        worker_claimed_at_ms: null,
        last_error: message,
        updated_at_ms: now,
      };
      tx.set(ref, released);
      return { ...released, duplicate: false };
    });
  }

  return { listDispatchCandidates, reserveDispatch, markDispatchDelivered, releaseDispatch };
}
