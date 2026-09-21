import crypto from 'node:crypto';

const TASK_SCHEMA = 'famtastic.execution.task.v2';
const RESERVATION_KEYS = new Set([
  'schema',
  'job_id',
  'intent_id',
  'dispatch_generation',
  'task_id',
  'task_name',
  'pilot_run_id',
  'site_id',
  'packet_digest',
  'available_at_ms',
  'reservation_token',
  'duplicate',
]);
const ID_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const SITE_ID_RE = /^[a-z0-9][a-z0-9-]{0,62}$/;
const SHA256_RE = /^[a-f0-9]{64}$/;
const PROJECT_RE = /^[a-z][a-z0-9-]{4,28}[a-z0-9]$/;
const LOCATION_RE = /^[a-z][a-z0-9-]{0,62}$/;
const QUEUE_RE = /^[A-Za-z][A-Za-z0-9_-]{0,99}$/;
const SERVICE_ACCOUNT_RE = /^[a-z][a-z0-9-]{4,28}[a-z0-9]@[a-z][a-z0-9-]{4,28}[a-z0-9]\.iam\.gserviceaccount\.com$/;

function failure(statusCode, code, message, cause) {
  return Object.assign(new Error(message, cause ? { cause } : undefined), { statusCode, code });
}

function requiredString(value, name, pattern) {
  if (typeof value !== 'string' || !pattern.test(value)) {
    throw failure(400, 'cloud_task_config_invalid', `${name} is invalid`);
  }
  return value;
}

function reservationString(value, name, pattern) {
  if (typeof value !== 'string' || !pattern.test(value)) {
    throw failure(400, 'cloud_task_reservation_invalid', `${name} is invalid`);
  }
  return value;
}

function runAppUrl(value, { serviceOnly = false } = {}) {
  let parsed;
  try { parsed = new URL(value); } catch {
    throw failure(400, 'cloud_task_target_invalid', 'Cloud Tasks target must be a valid URL');
  }
  if (parsed.protocol !== 'https:'
    || !parsed.hostname.endsWith('.run.app')
    || parsed.hostname === 'run.app'
    || parsed.username
    || parsed.password
    || parsed.port
    || parsed.search
    || parsed.hash
    || (serviceOnly && parsed.pathname !== '/')) {
    throw failure(400, 'cloud_task_target_invalid', 'Cloud Tasks target must be an exact HTTPS run.app URL');
  }
  return serviceOnly ? parsed.origin : parsed.toString();
}

function taskEnvelope(reservation) {
  if (!reservation || typeof reservation !== 'object' || Array.isArray(reservation)
    || ![Object.prototype, null].includes(Object.getPrototypeOf(reservation))) {
    throw failure(400, 'cloud_task_reservation_invalid', 'A dispatcher reservation is required');
  }
  const unknown = Object.keys(reservation).filter((key) => !RESERVATION_KEYS.has(key));
  if (unknown.length) {
    throw failure(400, 'cloud_task_reservation_invalid', `Reservation contains unsupported fields: ${unknown.join(', ')}`);
  }
  if (reservation.schema !== TASK_SCHEMA) {
    throw failure(400, 'cloud_task_reservation_invalid', 'Reservation schema is not supported');
  }
  const jobId = reservationString(reservation.job_id, 'job_id', ID_RE);
  const intentId = reservationString(reservation.intent_id, 'intent_id', ID_RE);
  const pilotRunId = reservationString(reservation.pilot_run_id, 'pilot_run_id', ID_RE);
  const siteId = reservationString(reservation.site_id, 'site_id', SITE_ID_RE);
  const packetDigest = reservationString(reservation.packet_digest, 'packet_digest', SHA256_RE);
  const generation = reservation.dispatch_generation;
  if (!Number.isSafeInteger(generation) || generation < 1) {
    throw failure(400, 'cloud_task_reservation_invalid', 'dispatch_generation must be a positive safe integer');
  }
  if (!Number.isSafeInteger(reservation.available_at_ms) || reservation.available_at_ms < 0) {
    throw failure(400, 'cloud_task_reservation_invalid', 'available_at_ms must be a nonnegative safe integer');
  }
  if (reservation.reservation_token !== undefined && reservation.reservation_token !== null
    && (typeof reservation.reservation_token !== 'string' || !ID_RE.test(reservation.reservation_token))) {
    throw failure(400, 'cloud_task_reservation_invalid', 'reservation_token must be a strict identifier when supplied');
  }
  if (reservation.duplicate !== undefined && typeof reservation.duplicate !== 'boolean') {
    throw failure(400, 'cloud_task_reservation_invalid', 'duplicate must be boolean when supplied');
  }
  return {
    schema: TASK_SCHEMA,
    job_id: jobId,
    intent_id: intentId,
    dispatch_generation: generation,
    pilot_run_id: pilotRunId,
    site_id: siteId,
    packet_digest: packetDigest,
  };
}

function taskIdFor(intentId, generation) {
  const hash = crypto.createHash('sha256')
    .update(JSON.stringify([intentId, generation]), 'utf8')
    .digest('hex')
    .slice(0, 40);
  return `cloudtask_${hash}`;
}

function bytesOf(value) {
  if (Buffer.isBuffer(value)) return value;
  if (value instanceof Uint8Array) return Buffer.from(value);
  if (typeof value === 'string'
    && /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) {
    const bytes = Buffer.from(value, 'base64');
    return bytes.toString('base64') === value ? bytes : null;
  }
  return null;
}

function normalizedHeaders(headers = {}) {
  return Object.fromEntries(Object.entries(headers)
    .map(([key, value]) => [key.toLowerCase(), String(value)])
    .sort(([left], [right]) => left.localeCompare(right)));
}

function exactTaskIdentity(existing, expected) {
  const request = existing?.httpRequest;
  const existingBody = bytesOf(request?.body);
  const expectedBody = bytesOf(expected.httpRequest.body);
  const methodMatches = request?.httpMethod === 'POST' || request?.httpMethod === 1;
  return existing?.name === expected.name
    && methodMatches
    && request?.url === expected.httpRequest.url
    && JSON.stringify(normalizedHeaders(request?.headers)) === JSON.stringify(normalizedHeaders(expected.httpRequest.headers))
    && request?.oidcToken?.serviceAccountEmail === expected.httpRequest.oidcToken.serviceAccountEmail
    && request?.oidcToken?.audience === expected.httpRequest.oidcToken.audience
    && Boolean(existingBody && expectedBody && existingBody.equals(expectedBody));
}

function alreadyExists(error) {
  return error?.code === 6
    || error?.code === 409
    || error?.code === 'ALREADY_EXISTS'
    || error?.status === 'ALREADY_EXISTS';
}

function firstResponse(value) {
  return Array.isArray(value) ? value[0] : value;
}

export function phase2CloudTaskId(intentId, dispatchGeneration) {
  reservationString(intentId, 'intent_id', ID_RE);
  if (!Number.isSafeInteger(dispatchGeneration) || dispatchGeneration < 1) {
    throw failure(400, 'cloud_task_reservation_invalid', 'dispatch_generation must be a positive safe integer');
  }
  return taskIdFor(intentId, dispatchGeneration);
}

export function createCloudTasksDispatcher({
  client,
  projectId,
  location,
  queueId,
  targetUrl,
  serviceAccountEmail,
  audience,
} = {}) {
  if (!client || typeof client.createTask !== 'function' || typeof client.getTask !== 'function') {
    throw failure(500, 'cloud_tasks_client_invalid', 'Cloud Tasks client must provide createTask and getTask');
  }
  const project = requiredString(projectId, 'projectId', PROJECT_RE);
  const region = requiredString(location, 'location', LOCATION_RE);
  const queue = requiredString(queueId, 'queueId', QUEUE_RE);
  const target = runAppUrl(targetUrl);
  const tokenAudience = runAppUrl(audience, { serviceOnly: true });
  if (new URL(target).origin !== tokenAudience) {
    throw failure(400, 'cloud_task_audience_mismatch', 'OIDC audience must be the exact target Cloud Run service origin');
  }
  const invoker = requiredString(serviceAccountEmail, 'serviceAccountEmail', SERVICE_ACCOUNT_RE);
  if (!invoker.endsWith(`@${project}.iam.gserviceaccount.com`)) {
    throw failure(400, 'cloud_task_config_invalid', 'serviceAccountEmail must belong to the configured project');
  }
  const parent = `projects/${project}/locations/${region}/queues/${queue}`;

  async function create(reservation) {
    const body = taskEnvelope(reservation);
    const taskId = taskIdFor(body.intent_id, body.dispatch_generation);
    const name = `${parent}/tasks/${taskId}`;
    if (reservation.task_id !== undefined && reservation.task_id !== taskId) {
      throw failure(409, 'cloud_task_identity_conflict', 'Reserved task_id does not match the deterministic task identity');
    }
    if (reservation.task_name !== undefined && reservation.task_name !== name) {
      throw failure(409, 'cloud_task_identity_conflict', 'Reserved task_name does not match the deterministic task identity');
    }
    const task = {
      name,
      httpRequest: {
        httpMethod: 'POST',
        url: target,
        headers: { 'Content-Type': 'application/json; charset=utf-8' },
        body: Buffer.from(JSON.stringify(body), 'utf8'),
        oidcToken: {
          serviceAccountEmail: invoker,
          audience: tokenAudience,
        },
      },
    };

    try {
      const created = firstResponse(await client.createTask({ parent, task }));
      if (!created || created.name !== name) {
        throw failure(503, 'cloud_task_create_unverified', 'Cloud Tasks did not return the expected task identity');
      }
      return {
        task_id: taskId,
        task_name: name,
        job_id: body.job_id,
        intent_id: body.intent_id,
        dispatch_generation: body.dispatch_generation,
        deduplicated: false,
      };
    } catch (error) {
      if (!alreadyExists(error)) throw error;
      let existing;
      try {
        existing = firstResponse(await client.getTask({ name, responseView: 'FULL' }));
      } catch (lookupError) {
        throw failure(503, 'cloud_task_identity_unverified', 'Existing Cloud Task identity could not be verified', lookupError);
      }
      if (!exactTaskIdentity(existing, task)) {
        throw failure(
          409,
          'cloud_task_existing_identity_conflict',
          'Existing Cloud Task does not match the reserved intent',
        );
      }
      return {
        task_id: taskId,
        task_name: name,
        job_id: body.job_id,
        intent_id: body.intent_id,
        dispatch_generation: body.dispatch_generation,
        deduplicated: true,
      };
    }
  }

  return Object.freeze({ create, parent, target_url: target, audience: tokenAudience });
}

export const phase2TaskSchema = TASK_SCHEMA;
