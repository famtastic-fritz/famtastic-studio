import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import { afterEach, expect, it } from 'vitest';
import { fixture, packet, html } from './staging-worker-fixture.mjs';
import { createSelectedSourceResolver } from '../server/kernel/selected-source-binding.js';
import { createStagingWorker } from '../server/kernel/staging-worker.js';
import { createCpanelReview } from '../server/kernel/cpanel-review.js';
import { digest } from '../server/kernel/staging-store.js';
const harness = process.env.SELECTED_SOURCE_INTENT_HARNESS;
const receipts = process.env.SELECTED_STAGING_AGENCY_HARNESS;
let f;
afterEach(() => { f?.cleanup(); f = null; });
it.skipIf(!harness || !receipts)('actual completed pipeline export crosses portal selection and reuses one repository through receipt/retry', async () => {
  const sourcePacket = packet(); sourcePacket.request_id = 'source-origin-request'; sourcePacket.continuation.customer.id = '903';
  f = fixture({ producerPacket: sourcePacket });
  const first = await f.worker().run(f.store.accept(sourcePacket).id);
  const exported = first.source_export;
  const scope = exported.scope;
  expect(exported.scope_complete).toBe(true);
  const authority = { evidence_ref: 'synthetic-existing-project-source-binding', project_id: '902', customer_id: '903', request_id: 'request-1',
    site_id: exported.site_id, repository_path: exported.repository.repository_path, source_export_sha256: exported.sha256,
    scope_evidence_ref: scope.evidence_ref, request_scope_sha256: digest({ page_count: 1, page_list: 'Home' }), hosting_target: packet().continuation.hosting_target,
    files: { 'index.html': { source_path: 'proofs/index.html', url: 'https://assets.example.invalid/proof/index.html', rights: { status: 'approved', evidence_ref: 'synthetic-original-authored-source-rights' } } } };
  const produced = JSON.parse(execFileSync('php', [harness, '--export-packet'], { input: JSON.stringify({ source_export: exported, html_base64: Buffer.from(html).toString('base64'), authority }), encoding: 'utf8' })).packet;
  for (const mutate of [a => { a.files['index.html'].rights = { ai_use_consent: true }; }, a => { a.customer_id = '999'; }, a => { a.source_export_sha256 = '0'.repeat(64); }, a => { a.request_scope_sha256 = digest({ page_count: 1, page_list: 'Different page' }); }]) {
    const invalid = structuredClone(authority); mutate(invalid);
    expect(() => execFileSync('php', [harness, '--export-packet'], { input: JSON.stringify({ source_export: exported, html_base64: Buffer.from(html).toString('base64'), authority: invalid }), encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] })).toThrow();
  }
  expect(produced.continuation.initiating_system).toBe('studio');
  expect(produced.continuation.source_export_sha256).toBe(exported.sha256);
  const resolveSource = createSelectedSourceResolver({ paths: f.paths, mappings: [{ ...authority, run_id: exported.run_id }] });
  let accepted;
  const host = createCpanelReview({ paths: f.paths, journal: f.journal, binding: { ...f.binding, customer_id: '903' }, transport: f.transport });
  const worker = createStagingWorker({ ...f.options(), resolveSource, host, callback: async receipt => {
    accepted = JSON.parse(execFileSync('php', [receipts, '--validate-source-receipt'], { input: JSON.stringify({ packet: produced, receipt }), encoding: 'utf8' }));
    return { ok: accepted.accepted };
  } });
  const id = f.store.accept(produced).id;
  const done = await worker.run(id);
  expect(done.failure).toBeUndefined(); expect(done.state).toBe('complete');
  expect(done.build.repository.repository_path).toBe(first.build.repository.repository_path);
  expect(done.build.repository.commit).toBe(first.build.repository.commit);
  expect(f.counters.builds).toBe(1); expect(f.counters.generation).toBe(0);
  expect(fs.existsSync(f.paths.within('sites', 'project-902'))).toBe(false);
  expect(accepted).toEqual({ accepted: true, notifications: 1, checkout: false });
  expect((await worker.run(id)).state).toBe('complete'); expect(f.counters.builds).toBe(1);
  await expect(createSelectedSourceResolver({ paths: f.paths, mappings: [] })(produced)).rejects.toThrow('source_repository_mapping_required');
  const wrong = structuredClone(produced); wrong.continuation.customer.id = '999';
  await expect(resolveSource(wrong)).rejects.toThrow('source_repository_mapping_required');
});
