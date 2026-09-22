import { phase2Failure } from './errors.js';
import { VERTEX_GEMINI_REQUEST_TIMEOUT_MS } from './vertex-gemini-provider-support.js';

// Timeout plus headroom for local preparation and checkpoint handling, not a
// guarantee that an already submitted remote request has stopped at timeout.
export const PHASE2_PROVIDER_MIN_REMAINING_LEASE_MS = VERTEX_GEMINI_REQUEST_TIMEOUT_MS + 5_000;

export function assertProviderLeaseWindow(lease, now) {
  if (!Number.isSafeInteger(now) || !Number.isSafeInteger(lease.lease_expires_at_ms)
    || lease.lease_expires_at_ms - now < PHASE2_PROVIDER_MIN_REMAINING_LEASE_MS) {
    throw phase2Failure(503, 'phase2_provider_lease_insufficient', 'Provider submission requires its full timeout plus lease headroom');
  }
}

export function assertProviderSubmissionAuthorization(lease, modelCallId, authorization, now) {
  if (!authorization || authorization.model_call_id !== modelCallId
    || ['job_id', 'attempt_id', 'pilot_run_id', 'intent_id', 'dispatch_generation',
      'fencing_token', 'lease_token', 'lease_expires_at_ms'].some((key) => authorization[key] !== lease[key])
    || !Number.isSafeInteger(authorization.authorized_at_ms) || now < authorization.authorized_at_ms) {
    throw phase2Failure(409, 'phase2_provider_authorization_invalid', 'Provider authorization is not bound to the current lease and clock');
  }
  assertProviderLeaseWindow(lease, now);
}
