import { execFileSync } from 'node:child_process';
import { afterEach, expect, it } from 'vitest';
import { fixture } from './staging-worker-fixture.mjs';
import { stagingPacketErrors } from '../server/kernel/staging-contract.js';
// Explicit cross-repository source pin supplied by the test command. No
// customer database, installed Drupal runtime or network is used.
const harness = process.env.SELECTED_STAGING_AGENCY_HARNESS;
let f;
afterEach(() => f?.cleanup());
it.skipIf(!harness)('actual agency producer serialization crosses builder and actual receipt service', async () => {
  const envelope = JSON.parse(execFileSync('php', [harness, '--packet'], { encoding: 'utf8' }));
  const bytes = execFileSync('php', [harness, '--html']);
  expect(stagingPacketErrors(envelope.packet)).toEqual([]);
  let agency;
  f = fixture({ producerPacket: envelope.packet, artifactBytes: bytes, receiptRequest: request => {
    agency = JSON.parse(execFileSync('php', [harness, '--validate-receipt'], { input: request.body, encoding: 'utf8' }));
    return { status: 200, body: { ok: agency.accepted } };
  } });
  const result = await f.worker().run(f.store.accept(envelope.packet).id);
  expect(result.failure).toBeUndefined(); expect(result.state).toBe('complete');
  expect(agency).toEqual({ accepted: true, notifications: 1, checkout: false });
  expect(f.counters.generation).toBe(0); expect(f.remote.get('index.html')).toEqual(bytes);
});
