import { execFileSync } from 'node:child_process';
import { Readable } from 'node:stream';
import { afterEach, expect, it } from 'vitest';
import { fixture } from './staging-worker-fixture.mjs';
import { createStagingWorker } from '../server/kernel/staging-worker.js';
import { createApp } from '../server/kernel/app.js';
import module from '../server/modules/pipeline/index.js';
import { createEvents } from '../server/kernel/events.js';
import { planningPacketErrors } from '../server/kernel/selected-planning-contract.js';
const harness = process.env.SELECTED_SOURCE_INTENT_HARNESS;
let f;
afterEach(() => { f?.cleanup(); f = null; delete process.env.FAMTASTIC_STUDIO_DISPATCH_SECRET; });
it.skipIf(!harness)('real selection and ledger dispatch reach durable planner and matched agency state without staging readiness', async () => {
  const produced = JSON.parse(execFileSync('php', [harness, '--planning-dispatch'], { encoding: 'utf8' }));
  const p = JSON.parse(produced.wire.body).packet;
  expect(planningPacketErrors(p)).toEqual([]);
  expect(produced.jobs).toHaveLength(2); // Two changed selections, identical retry adds no job.
  f = fixture(); process.env.FAMTASTIC_STUDIO_DISPATCH_SECRET = 'synthetic-planning-secret';
  let rejectCallback = true, agency, callbacks = [], running;
  const worker = () => createStagingWorker({ ...f.options(), callback: async result => {
    callbacks.push(JSON.stringify(result));
    if (rejectCallback) return { ok: false };
    agency = JSON.parse(execFileSync('php', [harness, '--planning-result'], { input: JSON.stringify(result), encoding: 'utf8' }));
    return { ok: true };
  } });
  const app = createApp();
  module.register({ app, paths: f.paths, journal: f.journal, events: createEvents({ paths: f.paths }), stagingRuntime: { store: f.store, wake: () => running ||= worker().tick() } });
  async function dispatch() {
    const req = Readable.from([produced.wire.body]); req.method = 'POST'; req.url = '/api/pipeline/staging/accept';
    req.headers = { 'x-famtastic-signature': produced.wire.headers['X-FAMtastic-Signature'] };
    return new Promise(resolve => app.handler(req, { writeHead(status) { this.status = status; }, end(body) { resolve({ status: this.status, body: JSON.parse(body) }); } }));
  }
  const response = await dispatch(); expect(response.status).toBe(202);
  expect((await dispatch()).body.receipt.receipt_id).toBe(response.body.receipt.receipt_id);
  await new Promise(resolve => setImmediate(resolve)); await running;
  expect(f.store.read(response.body.receipt.receipt_id).stage).toBe('callback');
  f.restart(); rejectCallback = false;
  const done = await worker().run(response.body.receipt.receipt_id);
  expect(done.state).toBe('complete'); expect(done.plan.ready).toBe(false);
  expect(callbacks[0]).toBe(callbacks[1]);
  expect(agency.accepted).toEqual({ newly_processed: true, ready: false });
  expect(agency.duplicate).toEqual({ newly_processed: false, ready: false }); expect(agency.build_packet).toBe(false);
  expect(agency.planning).not.toHaveProperty('staging_url'); expect(agency.planning.checkout_eligible).toBe(false);
  expect(f.counters.builds).toBe(0); expect(f.counters.generation).toBe(0); expect(f.counters.uploads).toBe(0);
  expect(f.store.accept(p).id).toBe(done.id);
  expect(() => f.store.accept(produced.jobs[0].payload.packet)).toThrow('stale_selection_revision');
  const wrong = structuredClone(p); wrong.packet_id += '-other'; wrong.idempotency_key += '-other'; wrong.continuation.customer.id = '999';
  expect(() => f.store.accept(wrong)).toThrow('identity_conflict');
  const changed = structuredClone(p); changed.intent.requested_changes.push({ text: 'changed' });
  expect(() => f.store.accept(changed)).toThrow('idempotency_conflict');
  for (const change of [{ customer_id: '999' }, { selection_revision: 1 }, { ready: true }, { staging_url: 'https://not-ready.example.test/' }]) {
    expect(() => execFileSync('php', [harness, '--planning-result'], { input: JSON.stringify({ ...done.callback_body, ...change }), encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] })).toThrow();
  }
});
