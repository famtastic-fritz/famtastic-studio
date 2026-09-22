import crypto from 'node:crypto';
import fs from 'node:fs';
import { Readable } from 'node:stream';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createApp } from '../server/kernel/app.js';
import { createEvents } from '../server/kernel/events.js';
import module from '../server/modules/pipeline/index.js';
import { fixture, packet } from './staging-worker-fixture.mjs';

const route = '/api/pipeline/selected-staging/accept';
const secret = 'synthetic-separated-route-secret';
let f, app, wake;
beforeEach(() => {
  f = fixture(); app = createApp(); wake = vi.fn(async () => {});
  vi.stubEnv('FAMTASTIC_STUDIO_DISPATCH_SECRET', secret);
  vi.stubEnv('FAMTASTIC_EXECUTION_MODE', 'disabled');
  vi.stubEnv('FAMTASTIC_EXECUTION_SCOPE', 'disabled');
});
afterEach(() => { f.cleanup(); vi.unstubAllEnvs(); });
function register(enabled = true) {
  module.register({ app, paths: f.paths, journal: f.journal, events: createEvents({ paths: f.paths }),
    ...(enabled ? { stagingRuntime: { store: f.store, wake } } : {}) });
}
async function request({ body = { packet: packet() }, url = route, signature = true, split = false } = {}) {
  const raw = Buffer.from(JSON.stringify(body));
  const position = raw.indexOf(Buffer.from('💡')) + 1;
  const req = Readable.from(split ? [raw.subarray(0, position), raw.subarray(position)] : [raw]);
  Object.assign(req, { method: 'POST', url, headers: signature ? {
    'x-famtastic-signature': `sha256=${crypto.createHmac('sha256', secret).update(raw).digest('hex')}`,
  } : {} });
  return new Promise(resolve => app.handler(req, {
    writeHead(status) { this.status = status; },
    end(bytes) { resolve({ status: this.status, body: JSON.parse(bytes) }); },
  }));
}

it('does not let configured selected runtime bypass the Phase 1 mock firewall', async () => {
  register();
  expect(await request({ url: '/api/pipeline/staging/accept' })).toMatchObject({
    status: 503, body: { error: 'durable_execution_disabled' },
  });
  expect(wake).not.toHaveBeenCalled();
  expect(fs.existsSync(f.paths.root('execution'))).toBe(false);
});
it('fails closed without the selected capability instead of creating an orphan queue', async () => {
  register(false);
  expect(await request()).toMatchObject({ status: 503, body: { error: 'selected_staging_unconfigured' } });
  expect(wake).not.toHaveBeenCalled();
});
it.each([
  ['mock', 'phase1-disposable'], ['real', 'disabled'], ['disabled', 'phase1-disposable'],
])('rejects selected routing with conflicting execution configuration %s/%s', async (mode, scope) => {
  register(); vi.stubEnv('FAMTASTIC_EXECUTION_MODE', mode); vi.stubEnv('FAMTASTIC_EXECUTION_SCOPE', scope);
  expect(await request()).toMatchObject({ status: 503, body: { error: 'selected_staging_execution_mode_conflict' } });
  expect(wake).not.toHaveBeenCalled();
});
it('authenticates exact split UTF-8 bytes and preserves one durable identity through retries', async () => {
  register(); const body = { packet: { ...packet(), note: '💡' } };
  const first = await request({ body, split: true });
  expect(first.status).toBe(202);
  const duplicate = await request({ body });
  expect(duplicate.body.receipt).toEqual(first.body.receipt);
  expect(first.body).not.toHaveProperty('execution');
  expect(first.body.receipt).not.toHaveProperty('staging_url');
  expect(f.store.read(first.body.receipt.receipt_id).state).toBe('queued');
  expect(await request({ body: { packet: { ...body.packet, note: 'changed' } } })).toMatchObject({ status: 409 });
  await new Promise(resolve => setImmediate(resolve));
  expect(wake).toHaveBeenCalledTimes(2);
});
it('rejects unsigned, oversized and invalid selected packets before waking a worker', async () => {
  register();
  expect((await request({ signature: false })).status).toBe(401);
  expect((await request({ body: { padding: 'x'.repeat(1024 * 1024) } })).status).toBe(413);
  expect((await request({ body: { packet: { ...packet(), artifacts: [null] } } })).status).toBe(422);
  expect(wake).not.toHaveBeenCalled();
});
