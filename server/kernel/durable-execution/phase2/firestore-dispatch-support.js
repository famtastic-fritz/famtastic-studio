import {
  PHASE_TAG,
  assertPhase2,
  deterministicDocumentId,
  snapshotData,
  storeFailure,
} from './firestore-values.js';
import { providerCheckpointFromCall } from './firestore-provider-checkpoint.js';
import { settlement } from './firestore-worker-support.js';
import { assertStoredAttempt, assertStoredCall } from './firestore-bindings.js';

export const WORKER_CLAIM_ACK_MS = 15 * 60 * 1000;

export async function loadDispatchTerminalContext(tx, refs, job) {
  const baseCosts = {
    job: {
      reserved_cost_micros: job.reserved_cost_micros,
      settled_cost_micros: job.settled_cost_micros,
      uncertain_cost_micros: job.uncertain_cost_micros || 0,
    },
    budget: null,
  };
  if (!job.resume_attempt_id) {
    if (job.reserved_cost_micros !== 0) {
      throw storeFailure(503, 'dispatch_cost_invariant', 'Dispatch terminal state would strand a cost reservation');
    }
    return { costs: baseCosts, attempt: null, call: null, budget: null };
  }
  const attempt = assertPhase2(
    snapshotData(await tx.get(refs.attempt(job.resume_attempt_id))),
    'Execution attempt',
  );
  const [callSnapshot, budgetSnapshot] = await Promise.all([
    tx.get(refs.call(attempt.model_call_id)),
    tx.get(refs.budget(job.pilot_run_id)),
  ]);
  const call = assertPhase2(snapshotData(callSnapshot), 'Execution model call');
  const budget = assertPhase2(snapshotData(budgetSnapshot), 'Execution budget');
  assertStoredAttempt(job, attempt, job.resume_attempt_id);
  assertStoredCall(job, attempt, call, attempt.model_call_id);
  if (budget.pilot_run_id !== job.pilot_run_id) {
    throw storeFailure(409, 'pilot_scope_conflict', 'Terminal settlement budget is outside the job pilot');
  }
  if (call.attempt_id !== attempt.attempt_id
    || !['provider_succeeded', 'resume_scheduled'].includes(attempt.state)) {
    throw storeFailure(503, 'provider_checkpoint_invariant', 'Dispatch terminal state has an invalid resume binding');
  }
  const checkpoint = providerCheckpointFromCall(job, call);
  return {
    costs: settlement(job, budget, call, checkpoint.metrics.actualCostMicros),
    attempt,
    call,
    budget,
  };
}

export function finalizeDispatchManual(tx, {
  refs, job, outbox, context, failureClass, reason,
  executionRisk, now, iso,
}) {
  const { costs, attempt, call, budget } = context;
  const deadLetterId = deterministicDocumentId('deadletter', job.job_id);
  const eventId = deterministicDocumentId('event', job.job_id, 'dead_letter');
  tx.set(refs.outbox(outbox.intent_id), {
    ...outbox,
    state: 'manual_review',
    reservation_owner: null,
    reservation_token: null,
    reservation_expires_at_ms: null,
    retry_not_before_ms: null,
    claim_not_after_ms: null,
    worker_claimed_at_ms: null,
    last_error: reason,
    terminal_failure_class: failureClass,
    execution_risk: executionRisk,
    requires_operator_review: true,
    manual_review_at_ms: now,
    updated_at_ms: now,
  });
  if (call) tx.update(refs.call(call.model_call_id), {
    state: 'completed', outcome: 'success', failure_class: null,
    workflow_terminal_reason: failureClass, completed_at_ms: now,
  });
  if (attempt) tx.update(refs.attempt(attempt.attempt_id), {
    state: 'failed_permanent', failure_class: failureClass,
    failure_reason: reason, completed_at_ms: now,
  });
  if (budget) tx.update(refs.budget(job.pilot_run_id), {
    ...costs.budget, updated_at_ms: now,
  });
  tx.update(refs.job(job.job_id), {
    ...costs.job,
    state: 'dead_letter', active_attempt_id: null, resume_attempt_id: null,
    lease_owner: null, lease_token: null, lease_expires_at_ms: null,
    execution_stage: 'manual_review',
    last_failure_class: failureClass, last_failure_reason: reason,
    updated_at_ms: now,
  });
  tx.set(refs.deadLetter(deadLetterId), {
    phase_tag: PHASE_TAG, dead_letter_id: deadLetterId, job_id: job.job_id,
    failure_class: failureClass, failure_reason: reason,
    attempts: job.attempts_started, execution_risk: executionRisk,
    requires_operator_review: true, created_at_ms: now,
  });
  tx.update(refs.task(job.task_id), {
    cost_actual: (costs.job.settled_cost_micros + costs.job.uncertain_cost_micros) / 1_000_000,
    qa_result: 'fail',
    failure_reason: JSON.stringify({ code: failureClass, text: reason }),
    lesson_candidate: true,
    human_review_required: true,
    decision_summary: `Cloud dispatch stopped for manual review: ${failureClass}.`,
    completed_at: iso(now),
  });
  tx.set(refs.event(eventId), {
    phase_tag: PHASE_TAG, task_event_id: eventId, job_id: job.job_id,
    from_state: job.state, to_state: 'dead_letter', reason: failureClass,
    created_at_ms: now,
  });
  return {
    terminal: true,
    intent_id: outbox.intent_id,
    job_id: job.job_id,
    state: 'manual_review',
    execution_risk: executionRisk,
  };
}
