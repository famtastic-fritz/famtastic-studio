import { createPhase2Handler, createPhase2Server, listenPhase2Server } from './phase2-http.js';

export const TASK_SCHEMA = 'famtastic.execution.task.v2';
const TASK_FIELDS = Object.freeze([
  'schema',
  'job_id',
  'intent_id',
  'dispatch_generation',
  'pilot_run_id',
  'site_id',
  'packet_digest',
]);

function invalidTask(message) {
  return Object.assign(new Error(message), { statusCode: 422, code: 'task_invalid' });
}

function validateTask(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body) || Object.getPrototypeOf(body) !== Object.prototype) {
    throw invalidTask('Task body must be a JSON object');
  }
  const actual = Object.keys(body).sort();
  const expected = [...TASK_FIELDS].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    throw invalidTask('Task body contains unknown or missing fields');
  }
  if (body.schema !== TASK_SCHEMA) throw invalidTask('Task schema is not supported');
  for (const field of ['job_id', 'intent_id', 'pilot_run_id', 'site_id']) {
    if (typeof body[field] !== 'string' || !body[field] || body[field] !== body[field].trim() || body[field].length > 500) {
      throw invalidTask(`Task ${field} is invalid`);
    }
  }
  if (!Number.isSafeInteger(body.dispatch_generation) || body.dispatch_generation < 1) {
    throw invalidTask('Task dispatch_generation must be a positive integer');
  }
  if (typeof body.packet_digest !== 'string' || !/^[a-f0-9]{64}$/.test(body.packet_digest)) {
    throw invalidTask('Task packet_digest must be a lowercase SHA-256 digest');
  }
  return body;
}

function workerOptions({ auth, worker, config } = {}) {
  if (typeof worker !== 'function') {
    throw Object.assign(new Error('An injected worker service is required'), { statusCode: 503, code: 'worker_required' });
  }
  return {
    role: 'worker',
    schema: TASK_SCHEMA,
    auth,
    config,
    routes: [{
      method: 'POST',
      path: '/internal/tasks/execute',
      principalKey: 'execute',
      successStatus: 200,
      validate: validateTask,
      invoke: ({ body, principal }) => worker({ body, principal }),
    }],
  };
}

export function createWorkerHandler(options) {
  return createPhase2Handler(workerOptions(options));
}

export function createWorkerServer(options) {
  return createPhase2Server(workerOptions(options));
}

export async function startWorkerServer(options = {}) {
  const server = createWorkerServer(options);
  return listenPhase2Server({ server, config: options.config });
}
