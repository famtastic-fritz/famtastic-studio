import {
  assertPhase2, requiredString, requireRunnableControls, snapshotData, storeFailure,
} from './firestore-values.js';
import { assertActiveLease } from './firestore-worker-support.js';
import { assertAttemptOwnership, assertOutboxOwnership, assertStoredCall } from './firestore-bindings.js';
import { assertProviderLeaseWindow } from './provider-submission.js';
import {
  PHASE2_PROVIDER_CALL_RESERVATION_MICROS, VERTEX_GEMINI_MODEL, VERTEX_GEMINI_PRICEBOOK_VERSION,
} from './pricebook.js';

export function createProviderSubmissionOperation({ db, refs, at }) {
  return async function authorizeProviderSubmission({ lease, modelCallId } = {}) {
    if (!lease) throw storeFailure(400, 'lease_required', 'Provider submission requires a worker lease');
    requiredString(modelCallId, 'modelCallId', { max: 200 });
    return db.runTransaction(async (tx) => {
      const now = at();
      const [job, attempt, call, outbox, control, budget] = (await Promise.all([
        tx.get(refs.job(lease.job_id)), tx.get(refs.attempt(lease.attempt_id)),
        tx.get(refs.call(modelCallId)), tx.get(refs.outbox(lease.intent_id)),
        tx.get(refs.control()), tx.get(refs.budget(lease.pilot_run_id)),
      ])).map(snapshotData);
      assertPhase2(job, 'Execution job');
      assertPhase2(budget, 'Execution budget');
      const controls = requireRunnableControls(control, { worker: true, provider: true });
      if (controls.active_pilot_run_id !== lease.pilot_run_id || budget.pilot_run_id !== lease.pilot_run_id) {
        throw storeFailure(409, 'pilot_scope_conflict', 'Provider submission is outside the active pilot');
      }
      assertActiveLease(job, lease, now);
      assertAttemptOwnership(job, attempt, lease);
      assertOutboxOwnership(job, outbox, lease);
      assertStoredCall(job, attempt, call, modelCallId);
      if (attempt.state !== 'running' || call.state !== 'reserved') {
        throw storeFailure(409, 'model_call_not_reserved', 'Provider submission requires the active reserved call');
      }
      if (call.provider !== 'vertex-gemini' || call.model !== VERTEX_GEMINI_MODEL
        || call.pricebook_version !== VERTEX_GEMINI_PRICEBOOK_VERSION
        || call.reserved_cost_micros !== PHASE2_PROVIDER_CALL_RESERVATION_MICROS
        || job.reserved_cost_micros < call.reserved_cost_micros
        || budget.reserved_cost_micros < call.reserved_cost_micros) {
        throw storeFailure(409, 'model_call_identity_conflict', 'Provider submission is not covered by the pinned call reservation');
      }
      assertProviderLeaseWindow(lease, now);
      // Authorization is evidence of a checked boundary, never proof of HTTP
      // submission. Firestore cannot atomically commit with the provider call.
      tx.update(refs.call(modelCallId), { provider_submission_authorized_at_ms: now });
      return {
        job_id: lease.job_id, attempt_id: lease.attempt_id, pilot_run_id: lease.pilot_run_id,
        intent_id: lease.intent_id, dispatch_generation: lease.dispatch_generation,
        fencing_token: lease.fencing_token, lease_token: lease.lease_token,
        lease_expires_at_ms: lease.lease_expires_at_ms, model_call_id: modelCallId, authorized_at_ms: now,
      };
    });
  };
}
