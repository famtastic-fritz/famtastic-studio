import { canonicalDigest, canonicalJson } from './canonical.js';
import { phase2Failure } from './errors.js';

export const PHASE2_WORK_SCHEMA = 'famtastic.execution.phase2-work.v1';
export const PHASE2_WORK_TYPE = 'selected_direction_observation';
export const PHASE2_EXECUTION_MODE = 'cloud-shadow';
export const PHASE2_EXECUTION_SCOPE = 'phase2-pilot';

const MAX_SOURCE_BYTES = 1024 * 1024;
const ID_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const SITE_ID_RE = /^[a-z0-9][a-z0-9-]{0,62}$/;
const SHA256_RE = /^[a-f0-9]{64}$/;
const TOP_LEVEL_FIELDS = new Set([
  'schema', 'work_type', 'mode', 'scope', 'site_id', 'pilot_run_id',
  'job_id', 'task_id', 'packet_id', 'idempotency_key', 'request_id',
  'project_id', 'packet_digest', 'artifact_manifest_sha256',
  'selected_direction_id', 'source',
]);
const SOURCE_FIELDS = new Set(['ref', 'sha256', 'bytes']);
const FORBIDDEN_FIELDS = new Set([
  'callback', 'callback_url', 'deploy', 'deploy_authorized', 'url', 'worker_url',
  'model', 'model_override', 'provider', 'provider_override', 'repository',
  'repository_url', 'repo', 'repo_url',
]);

function isPlainObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function unknownFieldErrors(value, allowed, prefix) {
  if (!isPlainObject(value)) return [];
  return Object.keys(value)
    .filter((key) => !allowed.has(key))
    .map((key) => FORBIDDEN_FIELDS.has(key)
      ? `${prefix}${key}: forbidden in Phase 2 shadow work`
      : `${prefix}${key}: unknown field`);
}

function validGcsRef(value) {
  if (typeof value !== 'string' || value.length > 1024 || !value.startsWith('gs://')) return false;
  const match = /^gs:\/\/([^/]+)\/([^#]+)#([1-9][0-9]*)$/.exec(value);
  if (!match) return false;
  const [, bucket, objectName] = match;
  if (bucket.length < 3 || bucket.length > 63
    || !/^[a-z0-9][a-z0-9._-]*[a-z0-9]$/.test(bucket)
    || bucket.includes('..') || /^\d+(?:\.\d+){3}$/.test(bucket)) return false;
  return objectName.length <= 900
    && !/[?\\\0\r\n]/.test(objectName)
    && !objectName.split('/').some((part) => !part || part === '.' || part === '..');
}

export function validatePhase2WorkEnvelope(envelope) {
  const errors = [];
  if (!isPlainObject(envelope)) return { ok: false, errors: ['envelope: plain object required'] };
  errors.push(...unknownFieldErrors(envelope, TOP_LEVEL_FIELDS, 'envelope.'));
  if (envelope.schema !== PHASE2_WORK_SCHEMA) errors.push(`envelope.schema: must equal ${PHASE2_WORK_SCHEMA}`);
  if (envelope.work_type !== PHASE2_WORK_TYPE) errors.push(`envelope.work_type: must equal ${PHASE2_WORK_TYPE}`);
  if (envelope.mode !== PHASE2_EXECUTION_MODE) errors.push(`envelope.mode: must equal ${PHASE2_EXECUTION_MODE}`);
  if (envelope.scope !== PHASE2_EXECUTION_SCOPE) errors.push(`envelope.scope: must equal ${PHASE2_EXECUTION_SCOPE}`);
  if (typeof envelope.site_id !== 'string' || !SITE_ID_RE.test(envelope.site_id)) {
    errors.push('envelope.site_id: lowercase kebab-case identifier required');
  }
  for (const field of [
    'pilot_run_id', 'job_id', 'task_id', 'packet_id', 'idempotency_key',
    'request_id', 'project_id', 'selected_direction_id',
  ]) {
    if (typeof envelope[field] !== 'string' || !ID_RE.test(envelope[field])) {
      errors.push(`envelope.${field}: strict identifier required`);
    }
  }
  for (const field of ['packet_digest', 'artifact_manifest_sha256']) {
    if (typeof envelope[field] !== 'string' || !SHA256_RE.test(envelope[field])) {
      errors.push(`envelope.${field}: lowercase SHA-256 digest required`);
    }
  }
  if (!isPlainObject(envelope.source)) {
    errors.push('envelope.source: plain object required');
  } else {
    errors.push(...unknownFieldErrors(envelope.source, SOURCE_FIELDS, 'envelope.source.'));
    if (!validGcsRef(envelope.source.ref)) errors.push('envelope.source.ref: safe gs:// object reference required');
    if (typeof envelope.source.sha256 !== 'string' || !SHA256_RE.test(envelope.source.sha256)) {
      errors.push('envelope.source.sha256: lowercase SHA-256 digest required');
    }
    if (!Number.isInteger(envelope.source.bytes)
      || envelope.source.bytes < 1
      || envelope.source.bytes > MAX_SOURCE_BYTES) {
      errors.push(`envelope.source.bytes: integer from 1 through ${MAX_SOURCE_BYTES} required`);
    }
  }
  return { ok: errors.length === 0, errors };
}

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

export function assertPhase2WorkEnvelope(envelope) {
  const validation = validatePhase2WorkEnvelope(envelope);
  if (!validation.ok) {
    throw phase2Failure(422, 'phase2_work_envelope_invalid', 'Phase 2 work envelope was rejected', validation);
  }
  return deepFreeze(JSON.parse(canonicalJson(envelope)));
}

export function createPhase2WorkEnvelope(fields = {}) {
  return assertPhase2WorkEnvelope({
    ...fields,
    schema: PHASE2_WORK_SCHEMA,
    work_type: PHASE2_WORK_TYPE,
    mode: PHASE2_EXECUTION_MODE,
    scope: PHASE2_EXECUTION_SCOPE,
  });
}

export function phase2WorkEnvelopeDigest(envelope) {
  return canonicalDigest(assertPhase2WorkEnvelope(envelope));
}
