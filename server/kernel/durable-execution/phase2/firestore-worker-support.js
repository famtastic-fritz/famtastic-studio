import {
  PHASE_TAG,
  boundedInteger,
  deterministicDocumentId,
  envelopeDigest,
  requiredString,
  storeFailure,
} from './firestore-values.js';
import { assertPhase2WorkEnvelope } from './work-envelope.js';

export function authoritativeEnvelope(job) {
  try {
    const envelope = assertPhase2WorkEnvelope(JSON.parse(job.envelope_ref_json));
    if (envelopeDigest(envelope) !== job.envelope_digest
      || envelope.job_id !== job.job_id || envelope.task_id !== job.task_id
      || envelope.site_id !== job.site_id || envelope.pilot_run_id !== job.pilot_run_id
      || envelope.packet_id !== job.packet_id || envelope.packet_digest !== job.packet_digest
      || envelope.idempotency_key !== job.idempotency_key
      || envelope.request_id !== job.request_id || envelope.project_id !== job.project_id
      || envelope.artifact_manifest_sha256 !== job.artifact_manifest_sha256
      || envelope.selected_direction_id !== job.selected_direction_id
      || envelope.source.ref !== job.source_ref
      || envelope.source.sha256 !== job.source_sha256
      || envelope.source.bytes !== job.source_bytes) {
      throw new Error('identity mismatch');
    }
    return envelope;
  } catch {
    throw storeFailure(503, 'work_envelope_corrupt', 'Stored Phase 2 work envelope failed authoritative validation');
  }
}

export function assertActiveLease(job, lease, now) {
  if (job.job_id !== lease.job_id || job.task_id !== lease.task_id
    || job.pilot_run_id !== lease.pilot_run_id || job.packet_id !== lease.packet_id
    || job.project_id !== lease.project_id || job.intent_id !== lease.intent_id
    || job.state !== 'running'
    || job.active_attempt_id !== lease.attempt_id
    || job.lease_owner !== lease.worker_id
    || job.lease_token !== lease.lease_token
    || job.fencing_token !== lease.fencing_token
    || job.lease_expires_at_ms <= now) {
    throw storeFailure(409, 'stale_lease', 'The worker lease is no longer active');
  }
}

export function callMetrics(input, { allowUnknownCost = false, requireKnown = false } = {}) {
  const actual = input.actualCostMicros;
  if (!allowUnknownCost) boundedInteger(actual, 'actualCostMicros');
  const optionalInteger = (value, label, required = false) => {
    if (value === undefined || value === null) {
      if (required) boundedInteger(value, label);
      return null;
    }
    return boundedInteger(value, label);
  };
  const inputTokens = optionalInteger(input.inputTokens, 'inputTokens', !allowUnknownCost || requireKnown);
  const outputTokens = optionalInteger(input.outputTokens, 'outputTokens', !allowUnknownCost || requireKnown);
  const latencyMs = optionalInteger(input.latencyMs, 'latencyMs', !allowUnknownCost || requireKnown);
  const thinkingTokens = optionalInteger(input.thinkingTokens, 'thinkingTokens', requireKnown);
  const cachedInputTokens = optionalInteger(input.cachedInputTokens, 'cachedInputTokens', requireKnown);
  const totalTokens = optionalInteger(input.totalTokens, 'totalTokens', requireKnown);
  if (requireKnown && totalTokens < inputTokens + outputTokens + thinkingTokens) {
    throw storeFailure(400, 'provider_checkpoint_metrics_invalid', 'Provider token totals are inconsistent');
  }
  if (input.promptVersion !== undefined && input.promptVersion !== null) {
    requiredString(input.promptVersion, 'promptVersion', { max: 200 });
  } else if (requireKnown) {
    throw storeFailure(400, 'provider_checkpoint_metrics_invalid', 'Provider prompt version is required');
  }
  if (input.inputSha256 !== undefined && input.inputSha256 !== null) {
    requiredString(input.inputSha256, 'inputSha256', { max: 64, pattern: /^[a-f0-9]{64}$/ });
  } else if (requireKnown) {
    throw storeFailure(400, 'provider_checkpoint_metrics_invalid', 'Provider input digest is required');
  }
  if (input.providerRequestId !== undefined && input.providerRequestId !== null) {
    requiredString(input.providerRequestId, 'providerRequestId', {
      max: 200, pattern: /^[A-Za-z0-9._:/=-]+$/,
    });
  } else if (requireKnown) {
    throw storeFailure(400, 'provider_checkpoint_metrics_invalid', 'Provider request identity is required');
  }
  return {
    provider_request_id: input.providerRequestId || null,
    input_tokens: inputTokens,
    output_tokens: outputTokens,
    thinking_tokens: thinkingTokens,
    cached_input_tokens: cachedInputTokens,
    total_tokens: totalTokens,
    latency_ms: latencyMs,
    prompt_version: input.promptVersion || null,
    input_sha256: input.inputSha256 || null,
    actual_cost_micros: allowUnknownCost ? null : actual,
  };
}

export function validateArtifact(artifact) {
  if (!artifact || typeof artifact !== 'object') throw storeFailure(400, 'artifact_invalid', 'Artifact metadata is required');
  requiredString(artifact.logical_key, 'artifact.logical_key', { max: 100, pattern: /^[A-Za-z0-9_-]+$/ });
  boundedInteger(artifact.version, 'artifact.version', { min: 1, max: 100 });
  requiredString(artifact.artifact_ref, 'artifact.artifact_ref', { max: 2000 });
  requiredString(artifact.sha256, 'artifact.sha256', { max: 64, pattern: /^[a-f0-9]{64}$/ });
  boundedInteger(artifact.bytes, 'artifact.bytes', { max: 10 * 1024 * 1024 });
  return artifact;
}

export function settlement(job, budget, call, chargedMicros, uncertain = false) {
  const reservation = call.reserved_cost_micros;
  if (!uncertain && chargedMicros > reservation) {
    throw storeFailure(409, 'cost_reservation_exceeded', 'Provider cost exceeded its reservation');
  }
  if (job.reserved_cost_micros < reservation || budget.reserved_cost_micros < reservation) {
    throw storeFailure(409, 'cost_ledger_invariant', 'Reserved cost ledger would become negative');
  }
  return {
    job: {
      reserved_cost_micros: job.reserved_cost_micros - reservation,
      settled_cost_micros: job.settled_cost_micros + (uncertain ? 0 : chargedMicros),
      uncertain_cost_micros: (job.uncertain_cost_micros || 0) + (uncertain ? reservation : 0),
    },
    budget: {
      reserved_cost_micros: budget.reserved_cost_micros - reservation,
      settled_cost_micros: budget.settled_cost_micros + (uncertain ? 0 : chargedMicros),
      uncertain_cost_micros: budget.uncertain_cost_micros + (uncertain ? reservation : 0),
    },
  };
}

export function writeDeadLetter(tx, {
  refs, job, costs, failureClass, message, now, iso, costActual,
} = {}) {
  const deadLetterId = deterministicDocumentId('deadletter', job.job_id);
  tx.update(refs.job(job.job_id), {
    ...costs.job, state: 'dead_letter', lease_owner: null, lease_token: null,
    lease_expires_at_ms: null, active_attempt_id: null,
    last_failure_class: failureClass, last_failure_reason: message, updated_at_ms: now,
  });
  tx.set(refs.deadLetter(deadLetterId), {
    phase_tag: PHASE_TAG, dead_letter_id: deadLetterId, job_id: job.job_id,
    failure_class: failureClass, failure_reason: message,
    attempts: job.attempts_started, created_at_ms: now,
  });
  tx.update(refs.task(job.task_id), {
    cost_actual: costActual === null ? null : (costs.job.settled_cost_micros + costs.job.uncertain_cost_micros) / 1_000_000,
    qa_result: 'fail', failure_reason: JSON.stringify({ code: failureClass, text: message }),
    lesson_candidate: true, decision_summary: `Cloud shadow execution stopped: ${failureClass}.`, completed_at: iso(now),
  });
  const eventId = deterministicDocumentId('event', job.job_id, 'dead_letter');
  tx.set(refs.event(eventId), {
    phase_tag: PHASE_TAG, task_event_id: eventId, job_id: job.job_id,
    from_state: 'running', to_state: 'dead_letter', reason: failureClass, created_at_ms: now,
  });
  return { job_id: job.job_id, state: 'dead_letter' };
}
