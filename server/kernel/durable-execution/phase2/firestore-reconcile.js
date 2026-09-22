import {
  PHASE_TAG,
  assertPhase2,
  boundedInteger,
  deterministicDocumentId,
  exactBoolean,
  snapshotData,
  snapshotRows,
  storeFailure,
  requiredString,
  validateControls,
} from './firestore-values.js';
import { providerCheckpointFromCall } from './firestore-provider-checkpoint.js';
import {
  WORKER_CLAIM_ACK_MS,
  finalizeDispatchManual,
  loadDispatchTerminalContext,
} from './firestore-dispatch-support.js';
import { assertAttemptDispatchGeneration, assertDispatchBinding, assertStoredAttempt, assertStoredCall } from './firestore-bindings.js';

const STALE_ADMISSION_MS = 15 * 60 * 1000;

function deadLetter(tx, { refs, job, attempt, failureClass, reason, now, iso, costActual }) {
  const deadLetterId = deterministicDocumentId('deadletter', job.job_id);
  tx.update(refs.job(job.job_id), {
    state: 'dead_letter', lease_owner: null, lease_token: null,
    lease_expires_at_ms: null, active_attempt_id: null,
    last_failure_class: failureClass, last_failure_reason: reason, updated_at_ms: now,
  });
  if (attempt) tx.update(refs.attempt(attempt.attempt_id), {
    state: failureClass === 'provider_outcome_uncertain' ? 'uncertain_provider_outcome' : 'lease_expired',
    failure_class: failureClass, failure_reason: reason, completed_at_ms: now,
  });
  tx.set(refs.deadLetter(deadLetterId), {
    phase_tag: PHASE_TAG, dead_letter_id: deadLetterId, job_id: job.job_id,
    failure_class: failureClass, failure_reason: reason,
    attempts: job.attempts_started, created_at_ms: now,
  });
  tx.update(refs.task(job.task_id), {
    cost_actual: costActual === undefined
      ? ((job.settled_cost_micros || 0) + (job.uncertain_cost_micros || 0)) / 1_000_000
      : costActual,
    qa_result: 'fail',
    failure_reason: JSON.stringify({ code: failureClass, text: reason }),
    lesson_candidate: true, completed_at: iso(now),
  });
  const eventId = deterministicDocumentId('event', job.job_id, 'dead_letter');
  tx.set(refs.event(eventId), {
    phase_tag: PHASE_TAG, task_event_id: eventId, job_id: job.job_id,
    from_state: 'running', to_state: 'dead_letter', reason: failureClass, created_at_ms: now,
  });
}

export function createReconcileOperations(context) {
  const { db, refs, at, iso } = context;

  async function reconcile({ pilotRunId, apply = false, limit = 100 } = {}) {
    requiredString(pilotRunId, 'pilotRunId', { max: 128 });
    exactBoolean(apply, 'apply');
    boundedInteger(limit, 'limit', { min: 1, max: 500 });
    const now = at();
    const [jobSnapshot, outboxSnapshot, controlSnapshot] = await Promise.all([
      refs.collection('jobs').get(), refs.collection('outbox').get(), refs.control().get(),
    ]);
    const controls = validateControls(snapshotData(controlSnapshot));
    if (controls.active_pilot_run_id !== pilotRunId) {
      throw storeFailure(409, 'pilot_scope_conflict', 'Reconciliation is outside the active pilot run');
    }
    const jobs = snapshotRows(jobSnapshot)
      .filter((row) => row.phase_tag === PHASE_TAG && row.pilot_run_id === pilotRunId);
    const outboxes = snapshotRows(outboxSnapshot)
      .filter((row) => row.phase_tag === PHASE_TAG && row.pilot_run_id === pilotRunId);
    const outboxIds = new Set(outboxes.map((row) => row.intent_id));
    const outboxByIntent = new Map(outboxes.map((row) => [row.intent_id, row]));
    const reservedAdmissions = jobs.filter((job) => job.state === 'admission_reserved');
    const missing = jobs.filter((job) => ![
      'admission_reserved', 'admission_expired', 'admission_failed',
      'awaiting_approval', 'dead_letter',
    ].includes(job.state)
      && !outboxIds.has(job.intent_id)).slice(0, limit);
    const reparableMissing = missing.filter((job) => job.state === 'accepted' && job.attempts_started === 0);
    const manualOrphans = missing.filter((job) => job.state !== 'accepted' || job.attempts_started !== 0);
    const expired = jobs.filter((job) => job.state === 'running'
      && Number.isFinite(job.lease_expires_at_ms) && job.lease_expires_at_ms <= now).slice(0, limit);
    const unclaimed = jobs.map((job) => ({ job, outbox: outboxByIntent.get(job.intent_id) }))
      .filter(({ job, outbox }) => job.state === 'queued'
        && outbox
        && ['submitting', 'delivered'].includes(outbox.state)
        && !Number.isSafeInteger(outbox.worker_claimed_at_ms)
        && Number.isSafeInteger(outbox.claim_not_after_ms)
        && outbox.claim_not_after_ms <= now)
      .slice(0, limit);
    const result = {
      dry_run: !apply,
      phase_tag: PHASE_TAG,
      pilot_run_id: pilotRunId,
      reserved_admissions: reservedAdmissions.map((job) => job.job_id),
      stale_reserved_admissions: reservedAdmissions
        .filter((job) => job.created_at_ms + STALE_ADMISSION_MS <= now)
        .map((job) => ({
          job_id: job.job_id,
          reserved_at_ms: job.created_at_ms,
          recovery_owner: 'intake_retry',
        })),
      missing_intents: missing.map((job) => job.job_id),
      manual_orphans: manualOrphans.map((job) => job.job_id),
      expired_leases: expired.map((job) => job.job_id),
      unclaimed_dispatches: unclaimed.map(({ job, outbox }) => ({
        job_id: job.job_id,
        dispatch_generation: outbox.dispatch_generation,
        claim_not_after_ms: outbox.claim_not_after_ms,
      })),
      repaired_intents: [],
      recovered_leases: [],
      redriven_unclaimed: [],
      unclaimed_manual_reviews: [],
      uncertain_dead_letters: [],
      schedules_considered: 0,
      legacy_jobs_considered: 0,
    };
    if (!apply) return result;

    for (const candidate of reparableMissing) {
      const repaired = await db.runTransaction(async (tx) => {
        const now = at();
        const [jobNow, controlsNow] = await Promise.all([
          tx.get(refs.job(candidate.job_id)), tx.get(refs.control()),
        ]);
        const job = snapshotData(jobNow);
        if (validateControls(snapshotData(controlsNow)).active_pilot_run_id !== pilotRunId) {
          throw storeFailure(409, 'pilot_scope_conflict', 'Reconciliation pilot changed during repair');
        }
        if (!job || job.phase_tag !== PHASE_TAG || ['awaiting_approval', 'dead_letter'].includes(job.state)) return false;
        if (job.job_id !== candidate.job_id || job.pilot_run_id !== pilotRunId
          || job.intent_id !== deterministicDocumentId('intent', job.job_id)) {
          throw storeFailure(409, 'dispatch_identity_conflict', 'Intent repair job identity changed');
        }
        const intentRef = refs.outbox(job.intent_id);
        if (snapshotData(await tx.get(intentRef))) return false;
        if (job.state !== 'accepted' || job.attempts_started !== 0) return 'manual';
        tx.create(intentRef, {
          phase_tag: PHASE_TAG, intent_id: job.intent_id, job_id: job.job_id,
          pilot_run_id: job.pilot_run_id, intent_type: 'dispatch', state: 'pending',
          dispatch_generation: 1, delivery_count: 0, available_at_ms: job.available_at_ms,
          submission_attempts: 0, retry_not_before_ms: null,
          claim_not_after_ms: null, worker_claimed_at_ms: null,
          created_at_ms: now, updated_at_ms: now, reconciliation_reason: 'missing-intent-repaired',
        });
        return true;
      });
      if (repaired === true) result.repaired_intents.push(candidate.job_id);
      if (repaired === 'manual' && !result.manual_orphans.includes(candidate.job_id)) {
        result.manual_orphans.push(candidate.job_id);
      }
    }

    for (const candidate of unclaimed) {
      const recovered = await db.runTransaction(async (tx) => {
        const now = at();
        const [jobSnapshotNow, outboxSnapshotNow, controlsNow] = await Promise.all([
          tx.get(refs.job(candidate.job.job_id)),
          tx.get(refs.outbox(candidate.outbox.intent_id)),
          tx.get(refs.control()),
        ]);
        if (validateControls(snapshotData(controlsNow)).active_pilot_run_id !== pilotRunId) {
          throw storeFailure(409, 'pilot_scope_conflict', 'Reconciliation pilot changed during unclaimed dispatch recovery');
        }
        const job = assertPhase2(snapshotData(jobSnapshotNow), 'Execution job');
        const outbox = assertPhase2(snapshotData(outboxSnapshotNow), 'Dispatch intent');
        assertDispatchBinding({ job, outbox, jobId: candidate.job.job_id,
          intentId: candidate.outbox.intent_id, pilotRunId });
        const bound = job.pilot_run_id === pilotRunId
          && outbox.pilot_run_id === pilotRunId
          && outbox.job_id === job.job_id
          && outbox.intent_id === job.intent_id;
        if (!bound) {
          throw storeFailure(409, 'dispatch_identity_conflict', 'Unclaimed dispatch is not bound to the queued job');
        }
        if (job.state !== 'queued'
          || !['submitting', 'delivered'].includes(outbox.state)
          || Number.isSafeInteger(outbox.worker_claimed_at_ms)
          || !Number.isSafeInteger(outbox.claim_not_after_ms)
          || outbox.claim_not_after_ms > now) {
          return 'stale';
        }
        if (outbox.dispatch_generation >= job.max_dispatch_generations) {
          const terminalContext = await loadDispatchTerminalContext(tx, refs, job);
          finalizeDispatchManual(tx, {
            refs,
            job,
            outbox,
            context: terminalContext,
            failureClass: 'worker_claim_ack_exhausted',
            reason: 'Cloud Task did not durably claim the job within the bounded dispatch generations',
            executionRisk: 'none',
            now,
            iso,
          });
          return 'manual_review';
        }
        const nextGeneration = outbox.dispatch_generation + 1;
        tx.update(refs.job(job.job_id), {
          state: 'retry_wait', available_at_ms: now,
          lease_owner: null, lease_token: null, lease_expires_at_ms: null,
          active_attempt_id: null,
          last_failure_class: 'worker_claim_timeout',
          last_failure_reason: 'Cloud Task did not durably claim the queued job',
          updated_at_ms: now,
        });
        tx.set(refs.outbox(job.intent_id), {
          ...outbox,
          state: 'pending',
          dispatch_generation: nextGeneration,
          available_at_ms: now,
          task_name: null,
          reservation_owner: null,
          reservation_token: null,
          reservation_expires_at_ms: null,
          retry_not_before_ms: null,
          claim_not_after_ms: null,
          worker_claimed_at_ms: null,
          last_error: 'worker_claim_timeout',
          updated_at_ms: now,
        });
        const eventId = deterministicDocumentId('event', job.job_id, 'worker_claim_timeout', nextGeneration);
        tx.create(refs.event(eventId), {
          phase_tag: PHASE_TAG,
          task_event_id: eventId,
          job_id: job.job_id,
          from_state: 'queued',
          to_state: 'retry_wait',
          reason: 'worker-claim-timeout',
          created_at_ms: now,
        });
        return nextGeneration;
      });
      if (recovered === 'manual_review') {
        result.unclaimed_manual_reviews.push(candidate.job.job_id);
      } else if (Number.isSafeInteger(recovered)) {
        result.redriven_unclaimed.push({
          job_id: candidate.job.job_id,
          dispatch_generation: recovered,
        });
      }
    }

    for (const candidate of expired) {
      const recovered = await db.runTransaction(async (tx) => {
        const now = at();
        const [jobSnapshotNow, attemptSnapshot, outboxSnapshotNow, controlsNow] = await Promise.all([
          tx.get(refs.job(candidate.job_id)),
          tx.get(refs.attempt(candidate.active_attempt_id)),
          tx.get(refs.outbox(candidate.intent_id)),
          tx.get(refs.control()),
        ]);
        if (validateControls(snapshotData(controlsNow)).active_pilot_run_id !== pilotRunId) {
          throw storeFailure(409, 'pilot_scope_conflict', 'Reconciliation pilot changed during recovery');
        }
        const job = snapshotData(jobSnapshotNow);
        if (!job || job.phase_tag !== PHASE_TAG || job.state !== 'running' || job.lease_expires_at_ms > now) return 'stale';
        if (job.active_attempt_id !== candidate.active_attempt_id || job.intent_id !== candidate.intent_id) return 'stale';
        const attempt = assertPhase2(snapshotData(attemptSnapshot), 'Execution attempt');
        const outbox = assertPhase2(snapshotData(outboxSnapshotNow), 'Dispatch intent');
        assertDispatchBinding({ job, outbox, jobId: candidate.job_id, intentId: candidate.intent_id, pilotRunId });
        assertStoredAttempt(job, attempt, candidate.active_attempt_id);
        assertAttemptDispatchGeneration(job, attempt, outbox);
        let call = null;
        let budget = null;
        if (attempt.model_call_id) {
          [call, budget] = (await Promise.all([
            tx.get(refs.call(attempt.model_call_id)),
            tx.get(refs.budget(job.pilot_run_id)),
          ])).map(snapshotData);
          assertStoredCall(job, attempt, call, attempt.model_call_id);
          if (assertPhase2(budget, 'Execution budget').pilot_run_id !== pilotRunId) {
            throw storeFailure(409, 'pilot_scope_conflict', 'Recovery budget is outside the job pilot');
          }
        }
        if (call) {
          assertPhase2(call, 'Execution model call');
          assertPhase2(budget, 'Execution budget');
          if (call.state === 'provider_succeeded') {
            if (call.attempt_id !== attempt.attempt_id || attempt.state !== 'provider_succeeded') {
              throw storeFailure(409, 'provider_checkpoint_invariant', 'Provider checkpoint is not bound to the expired attempt');
            }
            providerCheckpointFromCall(job, call);
            if (outbox.dispatch_generation >= job.max_dispatch_generations) {
              const terminalContext = await loadDispatchTerminalContext(tx, refs, {
                ...job, resume_attempt_id: attempt.attempt_id,
              });
              finalizeDispatchManual(tx, {
                refs, job, outbox, context: terminalContext,
                failureClass: 'provider_resume_dispatch_exhausted',
                reason: 'Provider checkpoint could not be redispatched within the configured bound',
                executionRisk: 'none', now, iso,
              });
              return 'manual_review';
            }
            const nextGeneration = outbox.dispatch_generation + 1;
            tx.update(refs.attempt(attempt.attempt_id), {
              state: 'resume_scheduled', failure_class: null, failure_reason: null,
              completed_at_ms: null,
            });
            tx.update(refs.job(job.job_id), {
              state: 'retry_wait', available_at_ms: now,
              lease_owner: null, lease_token: null, lease_expires_at_ms: null,
              active_attempt_id: null, resume_attempt_id: attempt.attempt_id,
              execution_stage: 'provider_succeeded', updated_at_ms: now,
            });
            tx.set(refs.outbox(job.intent_id), {
              ...outbox, state: 'pending', dispatch_generation: nextGeneration,
              available_at_ms: now, task_name: null, reservation_owner: null,
              reservation_token: null, reservation_expires_at_ms: null,
              claim_not_after_ms: null, worker_claimed_at_ms: null,
              last_error: null, updated_at_ms: now,
            });
            const eventId = deterministicDocumentId('event', job.job_id, 'provider_resume_scheduled', nextGeneration);
            tx.create(refs.event(eventId), {
              phase_tag: PHASE_TAG, task_event_id: eventId, job_id: job.job_id,
              from_state: 'running', to_state: 'retry_wait',
              reason: 'provider-checkpoint-resume', created_at_ms: now,
            });
            return 'provider_resume';
          }
          if (call.state !== 'reserved') {
            throw storeFailure(409, 'expired_call_invariant', 'Expired running job has an unsupported model-call state');
          }
          if (job.reserved_cost_micros < call.reserved_cost_micros
            || budget.reserved_cost_micros < call.reserved_cost_micros) {
            throw storeFailure(409, 'cost_ledger_invariant', 'Reserved cost ledger would become negative');
          }
          const jobUncertain = (job.uncertain_cost_micros || 0) + call.reserved_cost_micros;
          const budgetUncertain = budget.uncertain_cost_micros + call.reserved_cost_micros;
          tx.update(refs.call(call.model_call_id), {
            state: 'uncertain', outcome: 'uncertain', failure_class: 'provider_outcome_uncertain',
            actual_cost_micros: null, accounted_cost_micros: call.reserved_cost_micros, completed_at_ms: now,
          });
          tx.update(refs.job(job.job_id), {
            reserved_cost_micros: job.reserved_cost_micros - call.reserved_cost_micros,
            uncertain_cost_micros: jobUncertain,
          });
          tx.update(refs.budget(job.pilot_run_id), {
            reserved_cost_micros: budget.reserved_cost_micros - call.reserved_cost_micros,
            uncertain_cost_micros: budgetUncertain, updated_at_ms: now,
          });
          deadLetter(tx, {
            refs, job, attempt, failureClass: 'provider_outcome_uncertain',
            reason: 'Worker lease expired after a provider call may have begun',
            now, iso, costActual: null,
          });
          return 'uncertain';
        }
        const canRetry = job.attempts_started < job.max_attempts
          && outbox.dispatch_generation < job.max_dispatch_generations;
        if (!canRetry) {
          deadLetter(tx, {
            refs, job, attempt, failureClass: 'lease_expired',
            reason: 'Worker lease expired at a configured retry limit', now, iso,
          });
          return 'dead_letter';
        }
        tx.update(refs.attempt(attempt.attempt_id), {
          state: 'lease_expired', failure_class: 'lease_expired',
          failure_reason: 'Worker lease expired', completed_at_ms: now,
        });
        tx.update(refs.job(job.job_id), {
          state: 'retry_wait', available_at_ms: now, lease_owner: null, lease_token: null,
          lease_expires_at_ms: null, active_attempt_id: null,
          last_failure_class: 'lease_expired', last_failure_reason: 'Worker lease expired', updated_at_ms: now,
        });
        tx.set(refs.outbox(job.intent_id), {
          ...outbox, state: 'pending', dispatch_generation: outbox.dispatch_generation + 1,
          available_at_ms: now, task_name: null, reservation_owner: null,
          reservation_token: null, reservation_expires_at_ms: null,
          claim_not_after_ms: null, worker_claimed_at_ms: null,
          last_error: null, updated_at_ms: now,
        });
        const eventId = deterministicDocumentId('event', job.job_id, 'retry_wait', outbox.dispatch_generation + 1);
        tx.create(refs.event(eventId), {
          phase_tag: PHASE_TAG, task_event_id: eventId, job_id: job.job_id,
          from_state: 'running', to_state: 'retry_wait', reason: 'lease-expired', created_at_ms: now,
        });
        return 'retry_wait';
      });
      if (recovered === 'uncertain') result.uncertain_dead_letters.push(candidate.job_id);
      if (!['stale', 'uncertain'].includes(recovered)) result.recovered_leases.push({ job_id: candidate.job_id, state: recovered });
    }
    return result;
  }

  return { reconcile };
}

export { WORKER_CLAIM_ACK_MS };
