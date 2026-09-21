import { assertPhase2, deterministicDocumentId, storeFailure } from './firestore-values.js';

/** Bind requested document IDs before a transaction writes through stored IDs. */
export function assertDispatchBinding({ job, outbox, jobId, intentId, pilotRunId }) {
  assertPhase2(job, 'Execution job');
  assertPhase2(outbox, 'Dispatch intent');
  if (job.pilot_run_id !== pilotRunId || outbox.pilot_run_id !== pilotRunId) {
    throw storeFailure(409, 'pilot_scope_conflict', 'Dispatch documents are outside the active pilot');
  }
  if (!jobId || !intentId || !pilotRunId
    || job.job_id !== jobId || outbox.job_id !== jobId
    || job.intent_id !== intentId || outbox.intent_id !== intentId
    || job.pilot_run_id !== pilotRunId || outbox.pilot_run_id !== pilotRunId
    || !Number.isSafeInteger(outbox.dispatch_generation)
    || outbox.dispatch_generation < 1
    || !Number.isSafeInteger(job.max_dispatch_generations)
    || outbox.dispatch_generation > job.max_dispatch_generations) {
    throw storeFailure(409, 'dispatch_identity_conflict', 'Dispatch documents are not bound to the requested job, intent, pilot and generation');
  }
}

export function assertStoredAttempt(job, attempt, attemptId) {
  assertPhase2(attempt, 'Execution attempt');
  if (!attemptId || attempt.attempt_id !== attemptId
    || attempt.job_id !== job.job_id || attempt.task_id !== job.task_id
    || attempt.pilot_run_id !== job.pilot_run_id || attempt.packet_id !== job.packet_id
    || attempt.project_id !== job.project_id || attempt.intent_id !== job.intent_id
    || attempt.attempt_number !== job.attempts_started
    || attempt.fencing_token !== job.fencing_token
    || !Number.isSafeInteger(attempt.dispatch_generation) || attempt.dispatch_generation < 1
    || attempt.dispatch_generation > job.max_dispatch_generations) {
    throw storeFailure(409, 'attempt_identity_conflict', 'Stored attempt is not bound to the requested job and attempt');
  }
}

export function assertStoredCall(job, attempt, call, callId) {
  assertPhase2(call, 'Execution model call');
  if (!callId || call.model_call_id !== callId || attempt.model_call_id !== callId
    || callId !== deterministicDocumentId('call', attempt.attempt_id, 1)
    || call.job_id !== job.job_id || call.attempt_id !== attempt.attempt_id) {
    throw storeFailure(409, 'model_call_identity_conflict', 'Stored model call is not bound to the requested job and attempt');
  }
}
