import { createPhase2Handler, createPhase2Server, listenPhase2Server } from './phase2-http.js';

export const CONTROL_SCHEMA = 'famtastic.execution.control.v2';

function failure(code, message) {
  return Object.assign(new Error(message), { statusCode: 503, code });
}

function requireService(service, name) {
  if (typeof service !== 'function') throw failure(`${name}_required`, `An injected ${name} service is required`);
  return service;
}

function exactObject(body, allowed, label) {
  if (!body || typeof body !== 'object' || Array.isArray(body) || Object.getPrototypeOf(body) !== Object.prototype) {
    throw Object.assign(new Error(`${label} must be a JSON object`), { statusCode: 400, code: 'json_shape_invalid' });
  }
  const keys = Object.keys(body).sort();
  const expected = [...allowed].sort();
  if (keys.length !== expected.length || keys.some((key, index) => key !== expected[index])) {
    throw Object.assign(new Error(`${label} contains unknown or missing fields`), { statusCode: 422, code: 'json_fields_invalid' });
  }
  return body;
}

function controlOptions({ auth, intake, reconciler, config } = {}) {
  const accept = requireService(intake, 'intake');
  const reconcile = requireService(reconciler, 'reconciler');
  return {
    role: 'control',
    schema: CONTROL_SCHEMA,
    auth,
    config,
    routes: [
      {
        method: 'POST',
        path: '/v1/staging/accept',
        principalKey: 'accept',
        successStatus: 202,
        validate(body) {
          exactObject(body, ['packet'], 'staging intake body');
          if (!body.packet || typeof body.packet !== 'object' || Array.isArray(body.packet)) {
            throw Object.assign(new Error('packet must be a JSON object'), { statusCode: 422, code: 'packet_invalid' });
          }
        },
        invoke: ({ raw, body, headers, principal }) => accept({ raw, body, headers, principal }),
      },
      {
        method: 'POST',
        path: '/internal/reconcile',
        principalKey: 'reconcile',
        successStatus: 200,
        validate: (body) => exactObject(body, [], 'reconcile body'),
        invoke: ({ body, principal }) => reconcile({ body, principal }),
      },
    ],
  };
}

export function createControlHandler(options) {
  return createPhase2Handler(controlOptions(options));
}

export function createControlServer(options) {
  return createPhase2Server(controlOptions(options));
}

export async function startControlServer(options = {}) {
  const server = createControlServer(options);
  return listenPhase2Server({ server, config: options.config });
}
