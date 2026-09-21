import { canonicalDigest } from './canonical.js';
import { phase2CloudTaskId, phase2TaskSchema } from './cloud-tasks.js';
import { assertPhase2OperationAllowed } from './config.js';
import { PHASE2_EFFECT_POLICY } from './effects.js';
import { phase2Failure } from './errors.js';
import { PHASE2_PROVIDER_CALL_RESERVATION_MICROS } from './pricebook.js';

const ID_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const SITE_RE = /^[a-z0-9][a-z0-9-]{0,62}$/;
const SHA256_RE = /^[a-f0-9]{64}$/;
const TASK_FIELDS = [
  'schema', 'job_id', 'intent_id', 'dispatch_generation',
  'pilot_run_id', 'site_id', 'packet_digest',
];
const EFFECT_KEYS = Object.keys(PHASE2_EFFECT_POLICY).sort();

export { PHASE2_PROVIDER_CALL_RESERVATION_MICROS } from './pricebook.js';

export function runtimeFailure(statusCode, code, message, details) {
  return phase2Failure(statusCode, code, message, details);
}

function plainObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

export function requireRuntimeMethod(value, method, label) {
  if (!value || typeof value[method] !== 'function') {
    throw runtimeFailure(503, 'phase2_runtime_dependency_invalid', `${label} must provide ${method}()`);
  }
  return value;
}

export function assertRuntimeConfig(config) {
  assertPhase2OperationAllowed(config, {
    global_pause: false,
    dispatch_enabled: true,
    worker_enabled: true,
    provider_enabled: true,
  }, 'dispatch');
  if (!config.pilot_run_id || !config.cost || !config.provider || !config.gcp) {
    throw runtimeFailure(503, 'phase2_runtime_config_invalid', 'Phase 2 runtime configuration is incomplete');
  }
  return config;
}

export function runtimeMaxAttempts(config) {
  const attempts = Math.min(3, Math.floor(
    config.cost.max_job_cost_micros / PHASE2_PROVIDER_CALL_RESERVATION_MICROS,
  ));
  if (attempts < 1) {
    throw runtimeFailure(503, 'phase2_job_cost_cap_too_low', 'Job cost cap cannot fund one bounded provider call');
  }
  return attempts;
}

export function assertRuntimeStore(store) {
  for (const method of [
    'getControls', 'getBudget', 'reserveWorkAdmission', 'finalizeWorkAdmission',
    'listReservedAdmissions', 'expireWorkAdmission', 'failWorkAdmission',
    'reconcile', 'listDispatchCandidates', 'reserveDispatch',
    'markDispatchDelivered', 'releaseDispatch', 'claimJob',
    'assertRunnable', 'reserveModelCall', 'checkpointProviderSuccess',
    'completeJob', 'failJob', 'markUncertain',
  ]) requireRuntimeMethod(store, method, 'Phase 2 execution store');
  return store;
}

export function runtimeClockValue(clock) {
  const raw = clock();
  const value = raw instanceof Date ? raw.getTime() : Number(raw);
  if (!Number.isFinite(value)) {
    throw runtimeFailure(500, 'phase2_runtime_clock_invalid', 'Runtime clock returned an invalid value');
  }
  return Math.trunc(value);
}

export function defaultRuntimeIdFactory(kind, seed) {
  return `${kind}_${canonicalDigest(seed).slice(0, 40)}`;
}

export function generatedRuntimeId(idFactory, kind, seed) {
  const value = idFactory(kind, seed);
  if (typeof value !== 'string' || !ID_RE.test(value)) {
    throw runtimeFailure(500, 'phase2_runtime_id_invalid', `Runtime ${kind} identifier is invalid`);
  }
  return value;
}

export function runtimeSiteId(projectId) {
  const readable = `project-${String(projectId).toLowerCase()}`;
  return SITE_RE.test(readable)
    ? readable
    : `project-${canonicalDigest(String(projectId)).slice(0, 32)}`;
}

export async function persistentRuntimeScope(store, config) {
  const [controls, budget] = await Promise.all([
    store.getControls(),
    store.getBudget(config.pilot_run_id),
  ]);
  if (!controls || controls.active_pilot_run_id !== config.pilot_run_id
    || !budget || budget.pilot_run_id !== config.pilot_run_id
    || budget.max_jobs !== config.max_jobs
    || budget.max_total_cost_micros !== config.cost.max_total_cost_micros) {
    throw runtimeFailure(503, 'phase2_persistent_scope_mismatch', 'Persistent Phase 2 controls or budget do not match runtime configuration');
  }
  return { controls, budget };
}

export function exactRuntimeObject(value, fields, code) {
  if (!plainObject(value)) throw runtimeFailure(422, code, 'A plain JSON object is required');
  const actual = Object.keys(value).sort();
  const expected = [...fields].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    throw runtimeFailure(422, code, 'JSON fields do not match the Phase 2 contract');
  }
  return value;
}

export function runtimeAcceptanceBody(accepted) {
  return {
    accepted: true,
    status: 'accepted_waiting_callback',
    receipt: {
      receipt_id: accepted.receipt_id,
      packet_id: accepted.packet_id,
      idempotency_key: accepted.idempotency_key,
    },
    execution: {
      job_id: accepted.job_id,
      task_id: accepted.task_id,
      state: accepted.state,
      dispatch_state: accepted.dispatch_state,
      duplicate: accepted.duplicate,
      mode: 'cloud-shadow',
    },
  };
}

export function definiteTaskCreateFailure(error) {
  if (error?.code === 'cloud_task_identity_unverified') return true;
  return Number(error?.statusCode) < 500
    && typeof error?.code === 'string'
    && (error.code.startsWith('cloud_task_config_')
      || error.code.startsWith('cloud_task_reservation_')
      || error.code.startsWith('cloud_task_target_')
      || error.code === 'cloud_task_audience_mismatch'
      || error.code === 'cloud_task_identity_conflict'
      || error.code === 'cloud_task_existing_identity_conflict');
}

const TRANSIENT_GRPC_CODES = new Set([4, 8, 10, 13, 14]);
const TRANSIENT_GRPC_NAMES = new Set([
  'ABORTED',
  'DEADLINE_EXCEEDED',
  'INTERNAL',
  'RESOURCE_EXHAUSTED',
  'UNAVAILABLE',
]);

export function transientRuntimeFailure(error) {
  const httpStatus = Number(error?.statusCode ?? error?.status);
  if (httpStatus === 408 || httpStatus === 423 || httpStatus === 429 || httpStatus >= 500) {
    return true;
  }
  if (TRANSIENT_GRPC_CODES.has(error?.code)) return true;
  return typeof error?.code === 'string'
    && TRANSIENT_GRPC_NAMES.has(error.code.toUpperCase());
}

export function releaseRuntimeReservation(store, reservation, error, {
  permanent = false,
  submissionAttempted = true,
} = {}) {
  return store.releaseDispatch({
    intentId: reservation.intent_id,
    dispatchGeneration: reservation.dispatch_generation,
    reservationToken: reservation.reservation_token,
    error: error?.code || 'dispatch_failed_before_submission',
    permanent,
    submissionAttempted,
  });
}

export function assertRuntimeTask(body, config) {
  exactRuntimeObject(body, TASK_FIELDS, 'phase2_task_invalid');
  for (const key of ['job_id', 'intent_id', 'pilot_run_id']) {
    if (typeof body[key] !== 'string' || !ID_RE.test(body[key])) {
      throw runtimeFailure(422, 'phase2_task_invalid', `${key} is invalid`);
    }
  }
  if (!SITE_RE.test(body.site_id || '') || !SHA256_RE.test(body.packet_digest || '')
    || body.schema !== phase2TaskSchema
    || body.pilot_run_id !== config.pilot_run_id
    || !Number.isSafeInteger(body.dispatch_generation)
    || body.dispatch_generation < 1 || body.dispatch_generation > 50) {
    throw runtimeFailure(422, 'phase2_task_invalid', 'Task identity does not match the Phase 2 runtime');
  }
  return body;
}

export function runtimeTaskName(config, task) {
  const taskId = phase2CloudTaskId(task.intent_id, task.dispatch_generation);
  return `projects/${config.gcp.project_id}/locations/${config.gcp.region}/queues/${config.gcp.queue_id}/tasks/${taskId}`;
}

export function assertRuntimeEffectFirewall(effects) {
  requireRuntimeMethod(effects, 'snapshot', 'Phase 2 effects firewall');
  const snapshot = effects.snapshot();
  const policyKeys = Object.keys(snapshot?.policy || {}).sort();
  if (JSON.stringify(policyKeys) !== JSON.stringify(EFFECT_KEYS)
    || EFFECT_KEYS.some((key) => snapshot.policy[key] !== 'deny' || snapshot.completed?.[key] !== 0)) {
    throw runtimeFailure(503, 'phase2_effect_firewall_invalid', 'Phase 2 effects firewall is not closed');
  }
  return snapshot;
}

export function knownRuntimeMetrics(call = {}) {
  return {
    providerRequestId: call.provider_request_id || null,
    inputTokens: call.input_tokens ?? 0,
    outputTokens: call.output_tokens ?? 0,
    thinkingTokens: call.thinking_tokens ?? 0,
    cachedInputTokens: call.cached_input_tokens ?? 0,
    totalTokens: call.total_tokens ?? 0,
    latencyMs: call.latency_ms ?? 0,
    promptVersion: call.prompt_version || null,
    inputSha256: call.input_sha256 || null,
    actualCostMicros: call.actual_cost_micros ?? 0,
  };
}

export function uncertainRuntimeMetrics(call = {}) {
  return {
    providerRequestId: call.provider_request_id || null,
    inputTokens: call.input_tokens ?? null,
    outputTokens: call.output_tokens ?? null,
    thinkingTokens: call.thinking_tokens ?? null,
    cachedInputTokens: call.cached_input_tokens ?? null,
    totalTokens: call.total_tokens ?? null,
    latencyMs: call.latency_ms ?? null,
    promptVersion: call.prompt_version || null,
    inputSha256: call.input_sha256 || null,
  };
}

export function assertRuntimeCallIdentity(call, config) {
  if (!call || call.provider !== 'vertex-gemini'
    || call.model !== config.provider.model
    || call.pricing_version !== config.provider.pricebook_version) {
    throw runtimeFailure(502, 'phase2_provider_receipt_invalid', 'Provider receipt identity did not match the reserved model call');
  }
}

export async function failRuntimeBeforeProvider(store, lease, error) {
  const retryable = transientRuntimeFailure(error);
  return store.failJob({
    lease,
    retryable,
    failureClass: retryable ? 'phase2_source_transient' : 'phase2_source_invalid',
    reason: error?.code || 'source packet could not be verified',
    actualCostMicros: 0,
  });
}
