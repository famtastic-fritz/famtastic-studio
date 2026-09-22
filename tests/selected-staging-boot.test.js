import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { WebSocket } from 'ws';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { createPaths, loadPathsConfig } from '../server/kernel/paths.js';
import { createJournal } from '../server/kernel/journal.js';
import { createStagingStore } from '../server/kernel/staging-store.js';
import { packet } from './staging-worker-fixture.mjs';
import { configuration, credentials } from './selected-staging-configuration-fixture.mjs';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const guard = path.join(repo, 'tests/selected-staging-boot-guard.mjs');
let root, file, data, calls, children, sockets, stores;
beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'selected-boot-'));
  file = path.join(root, 'runtime.json'); data = path.join(root, 'data'); calls = path.join(root, 'calls');
  fs.writeFileSync(file, JSON.stringify(configuration()), { mode: 0o600 });
  fs.writeFileSync(calls, ''); children = []; sockets = []; stores = [];
});
afterEach(async () => {
  for (const socket of sockets) socket.terminate();
  for (const child of children) if (child.process.exitCode === null && child.process.signalCode === null) child.process.kill('SIGKILL');
  await Promise.all(children.map(child => child.exited));
  for (const store of stores) store.close();
  fs.rmSync(root, { recursive: true, force: true });
});
function environment(extra = {}) {
  // Explicit allowlist: never inherit a workstation's provider credentials,
  // NODE_OPTIONS, data roots or opt-in configuration into a child process.
  return { PATH: process.env.PATH, HOME: root, TMPDIR: os.tmpdir(), NODE_ENV: 'test',
    PORT: '0', BIND_LAN: '0', STUDIO_DATA_ROOT: data, STUDIO_REPOSITORIES_ROOT: path.join(data, 'sites'),
    SELECTED_STAGING_CONFIG: file, STAGING_BOOT_CALLS: calls, ...credentials(), ...extra };
}
function childProcess(args, env, cwd = repo) {
  const proc = spawn(process.execPath, args, { cwd, env, stdio: ['pipe', 'pipe', 'pipe', 'ipc'] });
  const child = { process: proc, output: '', messages: [] };
  proc.stdout.on('data', bytes => { child.output += bytes; }); proc.stderr.on('data', bytes => { child.output += bytes; });
  proc.on('message', message => child.messages.push(message));
  child.exited = new Promise((resolve, reject) => { proc.once('error', reject); proc.once('exit', (code, signal) => resolve({ code, signal })); });
  children.push(child); return child;
}
async function until(check) { await expect.poll(check, { timeout: 5000, interval: 20 }).toBeTruthy(); }
async function boot(extra = {}, cwd = repo) {
  const child = childProcess(['--import', guard, 'server/index.js'], environment(extra), cwd);
  await until(() => child.output.includes('listening on') || child.process.exitCode !== null);
  expect(child.output).toContain('listening on');
  child.url = child.output.match(/listening on (http:\/\/127\.0\.0\.1:\d+)/)[1];
  return child;
}
async function post(child, route, body, headers = {}) {
  const result = await fetch(child.url + route, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) });
  return { status: result.status, body: await result.json() };
}
async function stop(child, signal = 'SIGTERM') {
  child.process.kill(signal);
  const result = await child.exited;
  expect(result, child.output).toEqual({ code: 0, signal: null });
}
function store() {
  const config = loadPathsConfig();
  config.data_root_env = 'SYNTHETIC_SELECTED_BOOT_ROOT'; config.data_root_default = data;
  config.source_root_default = null; config.portfolio_roots = {};
  const paths = createPaths(config), result = createStagingStore({ paths, journal: createJournal({ paths }) });
  stores.push(result); return result;
}
function callbackJob(storage) {
  const accepted = storage.accept(packet()); const { job, token } = storage.claim(accepted.id);
  // A persisted callback checkpoint avoids any site build, provider or hosting.
  job.stage = 'callback'; job.state = 'queued'; job.failure = { code: 'synthetic-test-only' };
  storage.checkpoint(job, token); storage.release(job, token); return job;
}
function noSecrets(child) {
  for (const secret of Object.values(credentials())) expect(child.output).not.toContain(secret);
  expect(child.output).not.toContain(file);
}

it('actual default boot ignores even invalid config/code and credentials, with no runtime or consumer', async () => {
  fs.writeFileSync(file, 'invalid private config with a synthetic secret');
  const arbitrary = path.join(root, 'untrusted.mjs');
  fs.writeFileSync(arbitrary, 'throw new Error("ARBITRARY_CONFIG_EXECUTED")');
  const child = await boot({ STAGING_BOOT_DENY_CREDENTIALS: '1', SELECTED_STAGING_RUNTIME: arbitrary });
  expect(child.output).toContain('selected staging: disabled');
  for (const route of ['association', 'associate']) {
    expect(await post(child, `/api/pipeline/source/${route}`, {})).toEqual({ status: 503, body: { error: 'source_association_unconfigured' } });
  }
  expect(fs.existsSync(path.join(data, '.studio/selected-staging/jobs.sqlite'))).toBe(false);
  expect(fs.readFileSync(calls, 'utf8')).toBe('');
  await stop(child); noSecrets(child);
});

it.each(['embedded', 'external'])('actual enabled %s boot injects association capability and preserves dispatch and legacy-route boundaries', async mode => {
  const config = configuration(mode);
  if (mode === 'external') config.callbackEndpoint = 'https://designs.example.invalid/web/api/pipeline/site-studio/callback';
  fs.writeFileSync(file, JSON.stringify(config));
  const child = await boot({ SELECTED_STAGING_ENABLED: '1', STAGING_BOOT_CALLBACK: '1', FAMTASTIC_STUDIO_DISPATCH_SECRET: 'synthetic-dispatch' });
  expect(child.output).toContain(`selected staging: ${mode}`);
  const requested = await post(child, '/api/pipeline/source/association', { project_id: '42', customer_id: 'customer-1', request_id: 'request-1' });
  expect(requested).toEqual({ status: 200, body: { ok: true, association: { fixture: 'synthetic-grant' } } });
  const invalid = await post(child, '/api/pipeline/source/associate', {});
  expect(invalid.status).toBe(422); expect(invalid.body.error).toBe('source_association_payload_invalid');
  const badSignature = await post(child, '/api/pipeline/source/associate', { association: {
    payload_json: JSON.stringify({ schema: 'famtastic.source-association.v2', intent: {} }), signature: '0'.repeat(64),
  } });
  expect(badSignature).toEqual({ status: 422, body: { error: 'source_association_signature_invalid', message: 'source_association_signature_invalid' } });
  expect((await post(child, '/api/pipeline/selected-staging/accept', { packet: packet() })).status).toBe(401);
  expect((await post(child, '/api/integrations/famtastic/proof-jobs', {})).status).toBe(404);
  const socket = new WebSocket(child.url.replace('http:', 'ws:') + '/events?site_id=project-42'); sockets.push(socket);
  await new Promise((resolve, reject) => { socket.once('open', resolve); socket.once('error', reject); });
  await stop(child, mode === 'external' ? 'SIGINT' : 'SIGTERM');
  expect(fs.readFileSync(calls, 'utf8')).toBe('synthetic-callback\n'); noSecrets(child);
});

it('startup and periodic wake resume durable callbacks without another HTTP acceptance', async () => {
  const storage = store(), job = callbackJob(storage);
  const child = await boot({ SELECTED_STAGING_ENABLED: '1', STAGING_BOOT_CALLBACK: '1' });
  await until(() => storage.read(job.id).state === 'exception');
  const nextPacket = packet(); nextPacket.project_id = '43'; nextPacket.request_id = 'request-2'; nextPacket.packet_id = 'packet-2'; nextPacket.idempotency_key = 'idem-2';
  const next = storage.accept(nextPacket), held = storage.claim(next.id);
  held.job.stage = 'callback'; held.job.state = 'queued'; held.job.failure = { code: 'synthetic-test-only' };
  storage.checkpoint(held.job, held.token); storage.release(held.job, held.token);
  await until(() => storage.read(next.id).state === 'exception');
  // Failed synthetic jobs end in exception after their acknowledged callback.
  expect(storage.read(job.id).state).toBe('exception');
  expect(fs.readFileSync(calls, 'utf8')).toBe('synthetic-callback\nsynthetic-callback\n');
  await stop(child);
});

it('external worker mode queues signed acceptance without consuming or looking up a provider', async () => {
  fs.writeFileSync(file, JSON.stringify(configuration('external')));
  const child = await boot({ SELECTED_STAGING_ENABLED: '1', FAMTASTIC_STUDIO_DISPATCH_SECRET: 'synthetic-dispatch' });
  const body = { packet: packet() }, signature = 'sha256=' + crypto.createHmac('sha256', 'synthetic-dispatch').update(JSON.stringify(body)).digest('hex');
  const accepted = await post(child, '/api/pipeline/selected-staging/accept', body, { 'x-famtastic-signature': signature });
  expect(accepted.status).toBe(202);
  const storage = store();
  expect(storage.read(accepted.body.receipt.receipt_id).state).toBe('queued');
  await stop(child);
  expect(storage.read(accepted.body.receipt.receipt_id).state).toBe('queued'); expect(fs.readFileSync(calls, 'utf8')).toBe('');
});

it('server polling respects a claim held by the separate actual CLI worker', async () => {
  const storage = store(), job = callbackJob(storage);
  const cli = childProcess(['scripts/selected-staging-worker.mjs', path.join(repo, 'tests/selected-staging-cli-fixture.mjs'), '--once'], environment());
  await until(() => cli.messages.some(message => message.fixture === 'claim-held'));
  const child = await boot({ SELECTED_STAGING_ENABLED: '1' });
  await new Promise(resolve => setTimeout(resolve, 1100));
  expect(storage.read(job.id).attempts.callback).toBe(1); expect(fs.readFileSync(calls, 'utf8')).toBe('');
  cli.process.send('release'); expect(await cli.exited).toEqual({ code: 0, signal: null });
  await stop(child);
  expect(storage.read(job.id).state).toBe('exception'); expect(storage.read(job.id).attempts.callback).toBe(1);
  expect(fs.readFileSync(calls, 'utf8')).toBe('');
});

it('SIGTERM drains an active HTTP association callback before closing the runtime', async () => {
  const child = await boot({ SELECTED_STAGING_ENABLED: '1', STAGING_BOOT_CALLBACK: '1', STAGING_BOOT_HOLD: '1' });
  const request = post(child, '/api/pipeline/source/association', { project_id: '42' });
  await until(() => child.messages.some(message => message.fixture === 'callback-held'));
  child.process.kill('SIGTERM');
  await new Promise(resolve => setTimeout(resolve, 50)); expect(child.process.exitCode).toBeNull();
  child.process.send('release');
  expect((await request).status).toBe(200);
  expect(await child.exited).toEqual({ code: 0, signal: null });
  noSecrets(child);
});

it('SIGTERM drains an active worker callback, or exits bounded with its durable checkpoint intact', async () => {
  const storage = store(), job = callbackJob(storage);
  const child = await boot({ SELECTED_STAGING_ENABLED: '1', STAGING_BOOT_CALLBACK: '1', STAGING_BOOT_HOLD: '1' });
  await until(() => child.messages.some(message => message.fixture === 'callback-held'));
  child.process.kill('SIGTERM');
  expect(await child.exited).toEqual({ code: 1, signal: null });
  expect(child.output).toContain('"phase":"shutdown_timeout"');
  const checkpoint = storage.read(job.id);
  expect(checkpoint).toMatchObject({ stage: 'callback', state: 'running', attempts: { callback: 1 } });
  const recovered = await boot({ SELECTED_STAGING_ENABLED: '1', STAGING_BOOT_CALLBACK: '1', STAGING_BOOT_HOLD: '1' });
  await until(() => recovered.messages.some(message => message.fixture === 'callback-held'));
  recovered.process.kill('SIGTERM');
  await new Promise(resolve => setTimeout(resolve, 50)); expect(recovered.process.exitCode).toBeNull();
  recovered.process.send('release');
  expect(await recovered.exited).toEqual({ code: 0, signal: null });
  expect(storage.read(job.id)).toMatchObject({ state: 'exception', attempts: { callback: 2 }, callback_body: checkpoint.callback_body });
});

it.each(['malformed', 'missing-credential', 'unknown-field', 'code-file'])('enabled boot fails closed for %s with a useful nonsecret error and no listener', async failure => {
  const env = environment({ SELECTED_STAGING_ENABLED: '1' });
  if (failure === 'malformed') fs.writeFileSync(file, '{ "SENSITIVE":');
  if (failure === 'missing-credential') delete env.SITE_STUDIO_CALLBACK_SECRET;
  if (failure === 'unknown-field') fs.writeFileSync(file, JSON.stringify({ ...configuration(), arbitraryModule: 'SENSITIVE' }));
  if (failure === 'code-file') { env.SELECTED_STAGING_CONFIG = path.join(root, 'runtime.mjs'); fs.writeFileSync(env.SELECTED_STAGING_CONFIG, 'throw new Error("EXECUTED")'); }
  const child = childProcess(['--import', guard, 'server/index.js'], env);
  expect(await child.exited).toEqual({ code: 1, signal: null });
  expect(child.output).toContain('"phase":"boot"'); expect(child.output).toContain('"field":');
  expect(child.output).not.toMatch(/listening on|SENSITIVE|EXECUTED/); noSecrets(child);
  expect(fs.readFileSync(calls, 'utf8')).toBe(''); expect(fs.existsSync(path.join(data, '.studio/selected-staging/jobs.sqlite'))).toBe(false);
});

it.each(['configuration', 'lifecycle', 'assembly'])('P0-I1 scans selected-staging-%s before any forbidden code can execute', async helper => {
  const copy = path.join(root, 'copy'); fs.mkdirSync(copy);
  fs.cpSync(path.join(repo, 'server'), path.join(copy, 'server'), { recursive: true });
  fs.cpSync(path.join(repo, 'config'), path.join(copy, 'config'), { recursive: true });
  fs.cpSync(path.join(repo, 'vendor'), path.join(copy, 'vendor'), { recursive: true });
  fs.writeFileSync(path.join(copy, 'package.json'), '{"type":"module"}');
  fs.symlinkSync(fs.realpathSync(path.join(repo, 'node_modules')), path.join(copy, 'node_modules'));
  fs.appendFileSync(path.join(copy, `server/kernel/selected-staging-${helper}.js`), '\nimport "./famtastic-proof-job-routes.js";\n');
  fs.writeFileSync(path.join(copy, 'server/kernel/famtastic-proof-job-routes.js'), 'console.error("FORBIDDEN_EXECUTED");');
  const child = childProcess(['--import', guard, 'server/index.js'], environment(), copy);
  expect(await child.exited).toEqual({ code: 1, signal: null });
  expect(child.output).toContain('forbidden module in closure'); expect(child.output).not.toContain('FORBIDDEN_EXECUTED');
  expect(fs.readFileSync(calls, 'utf8')).toBe('');
});
