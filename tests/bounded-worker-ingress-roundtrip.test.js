import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { Readable } from 'node:stream';
import { afterEach, expect, it, vi } from 'vitest';
import { createApp } from '../server/kernel/app.js';
import { createEvents } from '../server/kernel/events.js';
import { createStagingIngressProxy } from '../server/kernel/staging-ingress-proxy.js';
import pipelineModule from '../server/modules/pipeline/index.js';
import { fixture, packet } from './staging-worker-fixture.mjs';

// Executes the existing Designs CLI, not a replacement dispatch implementation.
// Drupal authority and hosting remain explicit doubles; no customer is contacted.
const runner = process.env.SELECTED_DISPATCH_WORKER;
const workerSecret = 'synthetic-worker-secret-not-for-production';
const dispatchSecret = 'synthetic-dispatch-secret-not-for-production';
const sha256 = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const hmac = (secret, bytes) => crypto.createHmac('sha256', secret).update(bytes).digest('hex');
let f, server, running;
afterEach(async () => {
  if (server) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
  await running;
  f?.cleanup(); f = server = running = null;
  vi.unstubAllEnvs();
});

async function setup({ configured = true, loseFirstFinish = false } = {}) {
  f = fixture();
  vi.stubEnv('FAMTASTIC_STUDIO_DISPATCH_SECRET', dispatchSecret);
  vi.stubEnv('FAMTASTIC_EXECUTION_MODE', 'disabled');
  vi.stubEnv('FAMTASTIC_EXECUTION_SCOPE', 'disabled');
  const app = createApp();
  pipelineModule.register({ app, paths: f.paths, journal: f.journal, events: createEvents({ paths: f.paths }),
    ...(configured ? { stagingRuntime: { store: f.store, wake: () => running ||= f.worker().tick() } } : {}) });
  const operations = [], bodies = [], upstreamRoutes = [], failures = [], nonces = new Set();
  let dispatches = 0, finishes = 0;
  const proxy = createStagingIngressProxy({ secret: dispatchSecret, fetchImpl: async (url, options) => {
    upstreamRoutes.push(url.pathname);
    expect(url.origin).toBe('http://127.0.0.1:3400');
    // Feed the actual internal route without connecting to the installed service.
    const request = Readable.from([options.body]);
    Object.assign(request, { method: options.method, url: url.pathname,
      headers: Object.fromEntries(Object.entries(options.headers).map(([key, value]) => [key.toLowerCase(), value])) });
    return new Promise(resolve => app.handler(request, {
      writeHead(status) { this.status = status; },
      end(body) { resolve(new Response(body, { status: this.status })); },
    }));
  } });
  const payload_wire = JSON.stringify({ packet: packet() });
  const claim = { job_id: 991, capability: 'selected-static-dispatch-v1', policy_version: 'bounded-workers-v1',
    lease_token: 'a'.repeat(64), payload_wire, payload_sha256: sha256(payload_wire),
    lease_until: Math.floor(Date.now() / 1000) + 90, execution_deadline: Math.floor(Date.now() / 1000) + 300 };
  server = http.createServer(async (request, response) => {
    try {
      if (request.url === '/api/pipeline/staging/accept') { dispatches++; return await proxy(request, response); }
      expect(request.method).toBe('POST');
      expect(request.url).toMatch(/^\/web\/api\/pipeline\/worker\/(claim|finish|fail)$/);
      const chunks = [];
      for await (const chunk of request) chunks.push(chunk);
      const raw = Buffer.concat(chunks), headers = request.headers;
      const action = request.url.split('/').at(-1), signedPath = request.url.slice('/web'.length);
      expect(headers['x-famtastic-worker']).toBe('synthetic-mac');
      const nonce = headers['x-famtastic-nonce'];
      expect(nonces.has(nonce)).toBe(false); nonces.add(nonce);
      expect(headers['x-famtastic-signature']).toBe(`sha256=${hmac(workerSecret,
        ['POST', signedPath, 'synthetic-mac', headers['x-famtastic-timestamp'], nonce, sha256(raw)].join('\n'))}`);
      operations.push(action); bodies.push(JSON.parse(raw));
      let body = { result: {} }, status = 200;
      if (action === 'claim') { expect(JSON.parse(raw)).toEqual({}); body = { claim }; }
      else {
        expect(JSON.parse(raw)).toMatchObject({ job_id: claim.job_id, lease_token: claim.lease_token });
        if (action === 'finish' && ++finishes === 1 && loseFirstFinish) status = 503;
      }
      response.writeHead(status, { 'Content-Type': 'application/json' }); response.end(JSON.stringify(body));
    } catch (error) {
      failures.push(error.message);
      response.writeHead(500, { 'Content-Type': 'application/json' }); response.end('{}');
    }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const workerFile = path.join(f.root, 'synthetic-worker.secret');
  const dispatchFile = path.join(f.root, 'synthetic-dispatch.secret');
  fs.writeFileSync(workerFile, workerSecret, { mode: 0o600 });
  fs.writeFileSync(dispatchFile, dispatchSecret, { mode: 0o600 });
  const execute = () => new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [runner], { env: { PATH: process.env.PATH, CI: '1',
      FAMTASTIC_WORKER_ID: 'synthetic-mac', FAMTASTIC_WORKER_ALLOW_LOOPBACK: '1',
      FAMTASTIC_WORKER_API_BASE: `${base}/web`, SITE_STUDIO_STAGING_URL: `${base}/api/pipeline/staging/accept`,
      FAMTASTIC_WORKER_SECRET_FILE: workerFile, STUDIO_DISPATCH_SECRET_FILE: dispatchFile },
    stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '', stderr = '';
    child.stdout.on('data', bytes => { stdout += bytes; }); child.stderr.on('data', bytes => { stderr += bytes; });
    const timeout = setTimeout(() => child.kill('SIGKILL'), 15000);
    child.once('error', error => { clearTimeout(timeout); reject(error); });
    child.once('close', code => { clearTimeout(timeout); resolve({ code, stdout, stderr }); });
  });
  return { execute, operations, bodies, upstreamRoutes, failures, dispatches: () => dispatches };
}

it.skipIf(!runner)('runs the actual bounded CLI through signed ingress with one build after lost finish acknowledgement and replay', async () => {
  const t = await setup({ loseFirstFinish: true });
  const first = await t.execute();
  expect(first.code, first.stderr).toBe(0);
  expect(JSON.parse(first.stdout)).toMatchObject({ state: 'handoff_completed', staging_ready: false });
  expect(t.operations).toEqual(['claim', 'finish', 'finish']);
  expect(t.bodies[1]).toEqual(t.bodies[2]);
  await new Promise(resolve => setImmediate(resolve)); await running;
  const id = t.bodies[1].result.receipt_id;
  expect(f.store.read(id).state).toBe('complete');
  expect((await t.execute()).code).toBe(0);
  expect(t.bodies.at(-1).result.receipt_id).toBe(id);
  expect(t.dispatches()).toBe(2);
  expect(t.upstreamRoutes).toEqual(['/api/pipeline/selected-staging/accept', '/api/pipeline/selected-staging/accept']);
  expect(f.counters.builds).toBe(1); expect(f.counters.callbacks).toBe(1); expect(f.counters.generation).toBe(0);
  expect(t.failures).toEqual([]);
  expect(first.stdout + first.stderr).not.toContain(workerSecret);
  expect(first.stdout + first.stderr).not.toContain(dispatchSecret);
}, 30000);

it.skipIf(!runner)('does not mistake an unconfigured selected runtime for the mock queue or a successful handoff', async () => {
  const t = await setup({ configured: false });
  const result = await t.execute();
  expect(result.code).toBe(1);
  expect(result.stdout).toBe('');
  expect(result.stderr).toContain('bounded_worker_failed');
  expect(t.operations).toEqual(['claim', 'fail']);
  expect(t.failures).toEqual([]); expect(t.dispatches()).toBe(1);
  expect(f.counters.builds).toBe(0); expect(f.counters.callbacks).toBe(0); expect(f.counters.generation).toBe(0);
  expect(fs.existsSync(f.paths.root('execution'))).toBe(false);
}, 30000);
