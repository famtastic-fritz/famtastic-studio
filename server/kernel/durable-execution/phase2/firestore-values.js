import crypto from 'node:crypto';

export const PHASE_TAG = 'phase2_cloud_shadow';

export const COLLECTIONS = Object.freeze({
  controls: 'executionControls',
  budgets: 'executionBudgets',
  idempotency: 'executionIdempotency',
  tasks: 'agentTaskLog',
  jobs: 'executionJobs',
  outbox: 'executionOutbox',
  attempts: 'executionAttempts',
  calls: 'executionModelCalls',
  artifacts: 'executionArtifacts',
  approvals: 'executionApprovals',
  deadLetters: 'executionDeadLetters',
  events: 'executionTaskEvents',
});

export const JOB_STATES = new Set([
  'admission_reserved', 'admission_expired', 'admission_failed', 'accepted', 'queued', 'running',
  'retry_wait', 'awaiting_approval', 'dead_letter',
]);

export function storeFailure(statusCode, code, message) {
  return Object.assign(new Error(message), { statusCode, code });
}

function normalize(value) {
  if (Array.isArray(value)) return value.map(normalize);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, normalize(value[key])]));
  }
  return value === undefined ? null : value;
}

export function canonicalJson(value) {
  return JSON.stringify(normalize(value));
}

export function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

export function envelopeDigest(envelope) {
  return sha256(canonicalJson(envelope));
}

export function idempotencyDocumentId(siteId, idempotencyKey) {
  return sha256(canonicalJson([siteId, idempotencyKey]));
}

export function deterministicDocumentId(kind, ...parts) {
  return `${kind}_${sha256(canonicalJson(parts)).slice(0, 40)}`;
}

export function exactBoolean(value, label) {
  if (typeof value !== 'boolean') {
    throw storeFailure(400, 'execution_boolean_invalid', `${label} must be an exact boolean`);
  }
  return value;
}

export function boundedInteger(value, label, { min = 0, max = Number.MAX_SAFE_INTEGER } = {}) {
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    throw storeFailure(400, 'execution_integer_invalid', `${label} must be an integer from ${min} through ${max}`);
  }
  return value;
}

export function requiredString(value, label, { max = 500, pattern = null } = {}) {
  if (typeof value !== 'string' || !value || value !== value.trim() || value.length > max || (pattern && !pattern.test(value))) {
    throw storeFailure(400, 'execution_string_invalid', `${label} is invalid`);
  }
  return value;
}

export function cleanReason(value) {
  return String(value || 'unspecified failure').slice(0, 1000);
}

export function snapshotData(snapshot) {
  if (!snapshot || snapshot.exists === false || (typeof snapshot.exists === 'function' && !snapshot.exists())) return null;
  return typeof snapshot.data === 'function' ? snapshot.data() : null;
}

export function snapshotRows(snapshot) {
  const docs = snapshot?.docs || [];
  return docs.map((doc) => ({ id: doc.id, ...snapshotData(doc) }));
}

export function validateControls(controls) {
  if (!controls || controls.phase_tag !== PHASE_TAG) {
    throw storeFailure(503, 'execution_controls_invalid', 'Phase 2 execution controls are missing or invalid');
  }
  for (const key of ['global_pause', 'dispatch_enabled', 'worker_enabled', 'provider_enabled']) {
    if (typeof controls[key] !== 'boolean') {
      throw storeFailure(503, 'execution_controls_invalid', `Execution control ${key} is not an exact boolean`);
    }
  }
  return controls;
}

export function requireRunnableControls(controls, { dispatch = false, worker = false, provider = false } = {}) {
  validateControls(controls);
  if (controls.global_pause !== false) throw storeFailure(423, 'execution_paused', 'Durable execution is globally paused');
  if (dispatch && controls.dispatch_enabled !== true) throw storeFailure(503, 'dispatch_disabled', 'Cloud dispatch is disabled');
  if (worker && controls.worker_enabled !== true) throw storeFailure(503, 'worker_disabled', 'Cloud worker execution is disabled');
  if (provider && controls.provider_enabled !== true) throw storeFailure(503, 'provider_disabled', 'Cloud model execution is disabled');
  return controls;
}

export function assertPhase2(record, label) {
  if (!record || record.phase_tag !== PHASE_TAG) {
    throw storeFailure(409, 'phase_scope_mismatch', `${label} is not a Phase 2 cloud shadow record`);
  }
  return record;
}

export function defaultIdFactory(kind) {
  return `${kind}_${crypto.randomUUID()}`;
}

export function milliseconds(clock) {
  const value = clock();
  const numeric = value instanceof Date ? value.getTime() : Number(value);
  if (!Number.isFinite(numeric)) throw storeFailure(500, 'execution_clock_invalid', 'Execution clock returned an invalid value');
  return Math.trunc(numeric);
}
