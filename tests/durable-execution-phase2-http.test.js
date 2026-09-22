import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  CONTROL_SCHEMA,
  createControlHandler,
  createControlServer,
  startControlServer,
} from '../server/cloud/control-server.js';
import {
  TASK_SCHEMA,
  createWorkerServer,
} from '../server/cloud/worker-server.js';

const openServers = [];
const ACCEPT_EMAIL = 'intake@example.test';
const RECONCILE_EMAIL = 'scheduler@example.test';
const WORKER_EMAIL = 'worker@example.test';

function config(maxJsonBytes = 4096) {
  return {
    audience: 'phase2-test-audience',
    maxJsonBytes,
    allowedPrincipals: {
      accept: [ACCEPT_EMAIL],
      reconcile: [RECONCILE_EMAIL],
      execute: [WORKER_EMAIL],
    },
  };
}

function auth(email) {
  return { verify: vi.fn(async () => ({ email })) };
}

function workerBody(overrides = {}) {
  return {
    schema: TASK_SCHEMA,
    job_id: 'job_1',
    intent_id: 'intent_1',
    dispatch_generation: 1,
    pilot_run_id: 'pilot_1',
    site_id: 'site_1',
    packet_digest: 'a'.repeat(64),
    ...overrides,
  };
}

async function listen(server) {
  openServers.push(server);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return server.address().port;
}

function request(port, { method = 'POST', requestPath, body, headers = {} }) {
  const bytes = Buffer.isBuffer(body) ? body : Buffer.from(body === undefined ? '' : JSON.stringify(body));
  return new Promise((resolve, reject) => {
    const req = http.request({
      host: '127.0.0.1',
      port,
      method,
      path: requestPath,
      headers: {
        ...(method === 'POST' ? { 'content-type': 'application/json', 'content-length': bytes.length } : {}),
        ...headers,
      },
    }, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => {
        const raw = Buffer.concat(chunks).toString('utf8');
        resolve({ status: res.statusCode, body: JSON.parse(raw), headers: res.headers });
      });
    });
    req.on('error', reject);
    if (bytes.length) req.write(bytes);
    req.end();
  });
}

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(openServers.splice(0).map((server) => new Promise((resolve) => server.close(resolve))));
});

describe('Phase 2 isolated HTTP factories', () => {
  it('fails closed without injected services, auth, configuration, or listen configuration', async () => {
    expect(() => createControlHandler()).toThrowError(expect.objectContaining({ code: 'intake_required' }));
    expect(() => createControlHandler({ intake: () => {}, reconciler: () => {}, config: config() }))
      .toThrowError(expect.objectContaining({ code: 'http_auth_required' }));
    expect(() => createControlHandler({ intake: () => {}, reconciler: () => {}, auth: auth(ACCEPT_EMAIL) }))
      .toThrowError(expect.objectContaining({ code: 'http_config_required' }));
    const incomplete = config();
    delete incomplete.allowedPrincipals.execute;
    expect(() => createControlHandler({
      intake: () => {}, reconciler: () => {}, auth: auth(ACCEPT_EMAIL), config: incomplete,
    })).toThrowError(expect.objectContaining({ code: 'http_config_invalid' }));
    await expect(startControlServer({
      intake: () => {}, reconciler: () => {}, auth: auth(ACCEPT_EMAIL), config: config(),
    })).rejects.toMatchObject({ code: 'http_config_invalid' });
  });

  it('does not listen when a factory is imported or a server is created', () => {
    const server = createControlServer({
      auth: auth(ACCEPT_EMAIL), config: config(), intake: () => ({}), reconciler: () => ({}),
    });
    openServers.push(server);
    expect(server.listening).toBe(false);
  });

  it('exposes a minimal unauthenticated health response and no other GET surface', async () => {
    const verifier = auth(ACCEPT_EMAIL);
    const server = createControlServer({
      auth: verifier, config: config(), intake: () => ({}), reconciler: () => ({}),
    });
    const port = await listen(server);
    expect(await request(port, { method: 'GET', requestPath: '/healthz' })).toMatchObject({
      status: 200,
      body: { status: 'ok', role: 'control', schema: CONTROL_SCHEMA },
    });
    expect(Object.keys((await request(port, { method: 'GET', requestPath: '/healthz' })).body).sort())
      .toEqual(['role', 'schema', 'status']);
    expect((await request(port, { method: 'GET', requestPath: '/' })).status).toBe(404);
    expect(verifier.verify).not.toHaveBeenCalled();
  });

  it('authenticates and authorizes each control route before its service mutates state', async () => {
    const intake = vi.fn(async ({ raw, body, headers, principal }) => ({
      status: 202,
      body: { accepted: true, bytes: raw.length, packet: body.packet.id, token: headers.authorization, principal: principal.email },
    }));
    const reconciler = vi.fn(async () => ({ body: { reconciled: true } }));
    const server = createControlServer({ auth: auth(ACCEPT_EMAIL), config: config(), intake, reconciler });
    const port = await listen(server);
    const accepted = await request(port, {
      requestPath: '/v1/staging/accept',
      body: { packet: { id: 'packet-1' } },
      headers: { authorization: 'Bearer test' },
    });
    expect(accepted).toMatchObject({
      status: 202,
      body: { accepted: true, packet: 'packet-1', token: 'Bearer test', principal: ACCEPT_EMAIL },
    });
    expect(intake).toHaveBeenCalledOnce();

    expect((await request(port, { requestPath: '/internal/reconcile', body: {} }))).toMatchObject({
      status: 403, body: { error: 'principal_forbidden' },
    });
    expect(reconciler).not.toHaveBeenCalled();
  });

  it('turns verifier failures into closed authentication failures before reading services', async () => {
    const intake = vi.fn();
    const verifier = { verify: vi.fn(async () => { throw new Error('credential detail'); }) };
    const server = createControlServer({ auth: verifier, config: config(), intake, reconciler: () => ({}) });
    const port = await listen(server);
    expect(await request(port, { requestPath: '/v1/staging/accept', body: { packet: {} } })).toMatchObject({
      status: 401, body: { error: 'authentication_failed' },
    });
    expect(verifier.verify).toHaveBeenCalledWith(expect.objectContaining({ audience: 'phase2-test-audience' }));
    expect(intake).not.toHaveBeenCalled();
  });

  it('rejects unknown fields, malformed JSON, wrong content type, and unknown routes before services', async () => {
    const intake = vi.fn();
    const reconciler = vi.fn();
    const server = createControlServer({ auth: auth(ACCEPT_EMAIL), config: config(), intake, reconciler });
    const port = await listen(server);
    expect((await request(port, { requestPath: '/v1/staging/accept', body: { packet: {}, extra: true } })).status).toBe(422);
    expect((await request(port, { requestPath: '/v1/staging/accept', body: Buffer.from('{') })).status).toBe(400);
    expect((await request(port, {
      requestPath: '/v1/staging/accept', body: Buffer.from([0x7b, 0x22, 0x78, 0x22, 0x3a, 0x22, 0xff, 0x22, 0x7d]),
    })).status).toBe(400);
    expect((await request(port, {
      requestPath: '/v1/staging/accept', body: {}, headers: { 'content-type': 'text/plain' },
    })).status).toBe(415);
    expect((await request(port, { requestPath: '/v1/other', body: {} })).status).toBe(404);
    expect(intake).not.toHaveBeenCalled();
    expect(reconciler).not.toHaveBeenCalled();
  });

  it('accepts exactly the configured JSON byte limit and rejects one byte more', async () => {
    const exact = Buffer.from(JSON.stringify({ packet: {} }));
    const intake = vi.fn(() => ({ accepted: true }));
    const server = createControlServer({
      auth: auth(ACCEPT_EMAIL), config: config(exact.length), intake, reconciler: () => ({}),
    });
    const port = await listen(server);
    expect((await request(port, { requestPath: '/v1/staging/accept', body: exact })).status).toBe(202);
    expect((await request(port, { requestPath: '/v1/staging/accept', body: Buffer.concat([exact, Buffer.from(' ')]) })).status).toBe(413);
    expect(intake).toHaveBeenCalledOnce();
  });

  it('allows only the exact authenticated worker task schema', async () => {
    const execute = vi.fn(async ({ body, principal }) => ({ body: { job_id: body.job_id, principal: principal.email } }));
    const server = createWorkerServer({ auth: auth(WORKER_EMAIL), config: config(), worker: execute });
    const port = await listen(server);
    expect(await request(port, { requestPath: '/internal/tasks/execute', body: workerBody() })).toMatchObject({
      status: 200, body: { job_id: 'job_1', principal: WORKER_EMAIL },
    });
    expect((await request(port, {
      requestPath: '/internal/tasks/execute', body: workerBody({ schema: 'famtastic.execution.task.v1' }),
    })).status).toBe(422);
    expect((await request(port, {
      requestPath: '/internal/tasks/execute', body: { ...workerBody(), callback_url: 'https://example.invalid' },
    })).status).toBe(422);
    expect(execute).toHaveBeenCalledOnce();
  });
});

describe('Phase 2 HTTP source boundary', () => {
  it('keeps the static import closure isolated from the Studio server and effect surfaces', () => {
    const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
    const entries = ['server/cloud/control-server.js', 'server/cloud/worker-server.js'];
    const pending = entries.map((entry) => path.join(repoRoot, entry));
    const files = new Set();
    const imports = new Set();
    while (pending.length) {
      const file = pending.pop();
      if (files.has(file)) continue;
      files.add(file);
      const source = fs.readFileSync(file, 'utf8');
      for (const match of source.matchAll(/(?:import|export)\s+(?:[^'";]+?\s+from\s+)?['"]([^'"]+)['"]/g)) {
        const specifier = match[1];
        imports.add(specifier);
        if (specifier.startsWith('.')) pending.push(path.resolve(path.dirname(file), specifier));
      }
    }
    const relativeFiles = [...files].map((file) => path.relative(repoRoot, file)).sort();
    expect(relativeFiles).toEqual([
      'server/cloud/control-server.js',
      'server/cloud/phase2-http.js',
      'server/cloud/worker-server.js',
    ]);
    expect([...imports].filter((specifier) => !specifier.startsWith('.'))).toEqual(['node:http']);
    const boundaryText = [...relativeFiles, ...imports].join('\n').toLowerCase();
    for (const forbidden of [
      'server/index.js', 'server/modules', 'child_process', '/deploy', '/git', '/browser', '/outreach', '/callback',
    ]) {
      expect(boundaryText, `forbidden Phase 2 HTTP dependency: ${forbidden}`).not.toContain(forbidden);
    }
  });
});
