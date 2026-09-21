import { phase2Failure } from './errors.js';
import {
  PHASE2_PROVIDER_CALL_RESERVATION_MICROS,
  VERTEX_GEMINI_MODEL,
  VERTEX_GEMINI_PRICEBOOK_VERSION,
} from './pricebook.js';
import {
  VERTEX_GEMINI_API_IDENTITY,
  VERTEX_GEMINI_THINKING_LEVEL,
} from './vertex-gemini-provider.js';
import { PHASE2_EXECUTION_MODE, PHASE2_EXECUTION_SCOPE } from './work-envelope.js';

export const PHASE2_MAX_JOBS = 20;
export const PHASE2_ENV = Object.freeze({
  mode: 'FAMTASTIC_EXECUTION_MODE',
  scope: 'FAMTASTIC_EXECUTION_SCOPE',
  runtime: 'FAMTASTIC_PHASE2_RUNTIME',
  maxJobs: 'FAMTASTIC_PHASE2_MAX_JOBS',
  pilotRunId: 'FAMTASTIC_PHASE2_PILOT_RUN_ID',
  maxJobCostMicros: 'FAMTASTIC_PHASE2_MAX_JOB_COST_MICROS',
  maxTotalCostMicros: 'FAMTASTIC_PHASE2_MAX_TOTAL_COST_MICROS',
  model: 'FAMTASTIC_PHASE2_MODEL',
  pricebookVersion: 'FAMTASTIC_PHASE2_PRICEBOOK_VERSION',
  vertexLocation: 'FAMTASTIC_PHASE2_VERTEX_LOCATION',
  projectId: 'GOOGLE_CLOUD_PROJECT',
  region: 'FAMTASTIC_PHASE2_REGION',
  queueId: 'FAMTASTIC_PHASE2_QUEUE',
  workerUrl: 'FAMTASTIC_PHASE2_WORKER_URL',
  workerAudience: 'FAMTASTIC_PHASE2_WORKER_AUDIENCE',
  controlAudience: 'FAMTASTIC_PHASE2_CONTROL_AUDIENCE',
  intakeServiceAccount: 'FAMTASTIC_PHASE2_INTAKE_SERVICE_ACCOUNT',
  schedulerServiceAccount: 'FAMTASTIC_PHASE2_SCHEDULER_SERVICE_ACCOUNT',
  taskInvokerServiceAccount: 'FAMTASTIC_PHASE2_TASK_INVOKER_SERVICE_ACCOUNT',
  firestoreDatabase: 'FAMTASTIC_PHASE2_FIRESTORE_DATABASE',
  sourceBucket: 'FAMTASTIC_PHASE2_SOURCE_BUCKET',
  artifactBucket: 'FAMTASTIC_PHASE2_ARTIFACT_BUCKET',
});

const CONFIG_BRAND = Symbol('famtastic.phase2.config');
const PROJECT_RE = /^[a-z][a-z0-9-]{4,28}[a-z0-9]$/;
const REGION_RE = /^[a-z]+(?:-[a-z0-9]+)+[0-9]$/;
const RESOURCE_ID_RE = /^[a-z][a-z0-9_-]{0,99}$/;
const DATABASE_RE = /^[a-z][a-z0-9-]{2,61}[a-z0-9]$/;
const BUCKET_RE = /^[a-z0-9][a-z0-9._-]{1,61}[a-z0-9]$/;

function safeBucket(value) {
  return typeof value === 'string'
    && BUCKET_RE.test(value)
    && !value.includes('..')
    && !value.startsWith('goog')
    && !/^\d+(?:\.\d+){3}$/.test(value);
}

function strictHttpsUrl(value, { audience = false } = {}) {
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.search || parsed.hash) return null;
    if (!parsed.hostname.endsWith('.run.app')) return null;
    if (audience && (parsed.pathname !== '/' || value !== parsed.origin)) return null;
    return parsed;
  } catch {
    return null;
  }
}

function configErrors(env) {
  const errors = [];
  if (env[PHASE2_ENV.mode] !== PHASE2_EXECUTION_MODE) errors.push(`${PHASE2_ENV.mode} must equal ${PHASE2_EXECUTION_MODE}`);
  if (env[PHASE2_ENV.scope] !== PHASE2_EXECUTION_SCOPE) errors.push(`${PHASE2_ENV.scope} must equal ${PHASE2_EXECUTION_SCOPE}`);
  if (env[PHASE2_ENV.runtime] !== '1') errors.push(`${PHASE2_ENV.runtime} must equal 1`);
  if (env[PHASE2_ENV.maxJobs] !== undefined && env[PHASE2_ENV.maxJobs] !== String(PHASE2_MAX_JOBS)) {
    errors.push(`${PHASE2_ENV.maxJobs} must equal ${PHASE2_MAX_JOBS} when set`);
  }
  if (typeof env[PHASE2_ENV.pilotRunId] !== 'string'
    || !/^[a-z0-9][a-z0-9-]{0,62}$/.test(env[PHASE2_ENV.pilotRunId])) {
    errors.push(`${PHASE2_ENV.pilotRunId} is invalid`);
  }
  const maxJobCostMicros = Number(env[PHASE2_ENV.maxJobCostMicros]);
  const maxTotalCostMicros = Number(env[PHASE2_ENV.maxTotalCostMicros]);
  if (!Number.isSafeInteger(maxJobCostMicros)
    || maxJobCostMicros < PHASE2_PROVIDER_CALL_RESERVATION_MICROS
    || maxJobCostMicros > 250_000) {
    errors.push(`${PHASE2_ENV.maxJobCostMicros} must be an integer from ${PHASE2_PROVIDER_CALL_RESERVATION_MICROS} through 250000`);
  }
  if (!Number.isSafeInteger(maxTotalCostMicros) || maxTotalCostMicros < maxJobCostMicros
    || maxTotalCostMicros > 5_000_000) {
    errors.push(`${PHASE2_ENV.maxTotalCostMicros} must cover one job and be no greater than 5000000`);
  }
  if (env[PHASE2_ENV.model] !== VERTEX_GEMINI_MODEL) errors.push(`${PHASE2_ENV.model} is not the pinned model`);
  if (env[PHASE2_ENV.pricebookVersion] !== VERTEX_GEMINI_PRICEBOOK_VERSION) {
    errors.push(`${PHASE2_ENV.pricebookVersion} is not the pinned pricebook`);
  }
  if (env[PHASE2_ENV.vertexLocation] !== 'global') errors.push(`${PHASE2_ENV.vertexLocation} must equal global`);
  const projectId = env[PHASE2_ENV.projectId];
  if (typeof projectId !== 'string' || !PROJECT_RE.test(projectId)) errors.push(`${PHASE2_ENV.projectId} is invalid`);
  if (typeof env[PHASE2_ENV.region] !== 'string' || !REGION_RE.test(env[PHASE2_ENV.region])) {
    errors.push(`${PHASE2_ENV.region} is invalid`);
  }
  if (typeof env[PHASE2_ENV.queueId] !== 'string' || !RESOURCE_ID_RE.test(env[PHASE2_ENV.queueId])) {
    errors.push(`${PHASE2_ENV.queueId} is invalid`);
  }
  const workerUrl = strictHttpsUrl(env[PHASE2_ENV.workerUrl]);
  const audience = strictHttpsUrl(env[PHASE2_ENV.workerAudience], { audience: true });
  if (!workerUrl) errors.push(`${PHASE2_ENV.workerUrl} must be an HTTPS run.app URL`);
  if (!audience) errors.push(`${PHASE2_ENV.workerAudience} must be an HTTPS run.app origin`);
  if (workerUrl && audience && workerUrl.origin !== audience.origin) {
    errors.push(`${PHASE2_ENV.workerAudience} must match the worker URL origin`);
  }
  if (workerUrl && workerUrl.pathname !== '/internal/tasks/execute') {
    errors.push(`${PHASE2_ENV.workerUrl} must target /internal/tasks/execute`);
  }
  const controlAudience = strictHttpsUrl(env[PHASE2_ENV.controlAudience], { audience: true });
  if (!controlAudience) errors.push(`${PHASE2_ENV.controlAudience} must be an HTTPS run.app origin`);
  if (controlAudience && audience && controlAudience.origin === audience.origin) {
    errors.push('Phase 2 control and worker services must use different origins');
  }
  const expectedSuffix = typeof projectId === 'string' ? `@${projectId}.iam.gserviceaccount.com` : '';
  const serviceAccountKeys = [
    PHASE2_ENV.intakeServiceAccount,
    PHASE2_ENV.schedulerServiceAccount,
    PHASE2_ENV.taskInvokerServiceAccount,
  ];
  for (const key of serviceAccountKeys) {
    const serviceAccount = env[key];
    if (typeof serviceAccount !== 'string'
      || !/^[a-z][a-z0-9-]{4,28}[a-z0-9]@[a-z][a-z0-9-]{4,28}[a-z0-9]\.iam\.gserviceaccount\.com$/.test(serviceAccount)
      || !serviceAccount.endsWith(expectedSuffix)) {
      errors.push(`${key} must belong to the configured project`);
    }
  }
  const serviceAccounts = serviceAccountKeys.map((key) => env[key]);
  if (serviceAccounts.every((value) => typeof value === 'string')
    && new Set(serviceAccounts).size !== serviceAccounts.length) {
    errors.push('Phase 2 route callers must use distinct service accounts');
  }
  if (typeof env[PHASE2_ENV.firestoreDatabase] !== 'string'
    || !DATABASE_RE.test(env[PHASE2_ENV.firestoreDatabase])) {
    errors.push(`${PHASE2_ENV.firestoreDatabase} is invalid`);
  }
  const sourceBucket = env[PHASE2_ENV.sourceBucket];
  const artifactBucket = env[PHASE2_ENV.artifactBucket];
  if (!safeBucket(sourceBucket)) errors.push(`${PHASE2_ENV.sourceBucket} is invalid`);
  if (!safeBucket(artifactBucket)) errors.push(`${PHASE2_ENV.artifactBucket} is invalid`);
  if (safeBucket(sourceBucket) && sourceBucket === artifactBucket) {
    errors.push('Phase 2 source and artifact buckets must be different');
  }
  return errors;
}

export function loadPhase2Config(env = process.env) {
  const errors = configErrors(env);
  if (errors.length) {
    throw phase2Failure(503, 'phase2_config_invalid', 'Phase 2 cloud-shadow configuration is incomplete or invalid', { errors });
  }
  const config = {
    mode: PHASE2_EXECUTION_MODE,
    scope: PHASE2_EXECUTION_SCOPE,
    runtime_enabled: true,
    max_jobs: PHASE2_MAX_JOBS,
    pilot_run_id: env[PHASE2_ENV.pilotRunId],
    cost: {
      max_job_cost_micros: Number(env[PHASE2_ENV.maxJobCostMicros]),
      max_total_cost_micros: Number(env[PHASE2_ENV.maxTotalCostMicros]),
    },
    provider: {
      kind: 'vertex-gemini',
      model: VERTEX_GEMINI_MODEL,
      pricebook_version: VERTEX_GEMINI_PRICEBOOK_VERSION,
      location: 'global',
      sdk: VERTEX_GEMINI_API_IDENTITY.sdk,
      vertexai: VERTEX_GEMINI_API_IDENTITY.vertexai,
      api_version: VERTEX_GEMINI_API_IDENTITY.api_version,
      thinking_level: VERTEX_GEMINI_THINKING_LEVEL,
    },
    gcp: {
      project_id: env[PHASE2_ENV.projectId],
      region: env[PHASE2_ENV.region],
      queue_id: env[PHASE2_ENV.queueId],
      worker_url: env[PHASE2_ENV.workerUrl],
      worker_audience: env[PHASE2_ENV.workerAudience],
      control_audience: env[PHASE2_ENV.controlAudience],
      intake_service_account: env[PHASE2_ENV.intakeServiceAccount],
      scheduler_service_account: env[PHASE2_ENV.schedulerServiceAccount],
      task_invoker_service_account: env[PHASE2_ENV.taskInvokerServiceAccount],
      firestore_database: env[PHASE2_ENV.firestoreDatabase],
      source_bucket: env[PHASE2_ENV.sourceBucket],
      artifact_bucket: env[PHASE2_ENV.artifactBucket],
    },
  };
  Object.defineProperty(config, CONFIG_BRAND, { value: true });
  Object.freeze(config.gcp);
  Object.freeze(config.cost);
  Object.freeze(config.provider);
  return Object.freeze(config);
}

function assertControls(controls) {
  const keys = ['global_pause', 'dispatch_enabled', 'worker_enabled', 'provider_enabled'];
  if (!controls || typeof controls !== 'object' || Array.isArray(controls)
    || keys.some((key) => typeof controls[key] !== 'boolean')) {
    throw phase2Failure(500, 'phase2_controls_invalid', 'All Phase 2 controls must be independent exact booleans');
  }
}

export function assertPhase2OperationAllowed(config, controls, operation) {
  if (!config || config[CONFIG_BRAND] !== true || config.runtime_enabled !== true) {
    throw phase2Failure(503, 'phase2_runtime_disabled', 'Phase 2 runtime is not explicitly enabled');
  }
  assertControls(controls);
  if (!['dispatch', 'worker', 'provider'].includes(operation)) {
    throw phase2Failure(400, 'phase2_operation_invalid', 'Phase 2 operation must be dispatch, worker, or provider');
  }
  if (controls.global_pause) throw phase2Failure(423, 'phase2_execution_paused', 'Phase 2 execution is globally paused');
  const required = operation === 'dispatch'
    ? 'dispatch_enabled'
    : operation === 'worker' ? 'worker_enabled' : 'provider_enabled';
  if (!controls[required]) {
    throw phase2Failure(503, `phase2_${operation}_disabled`, `Phase 2 ${operation} is disabled`);
  }
  return true;
}
