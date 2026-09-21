import fs from 'node:fs';
import { decodeSourceExport, sourceExportDigest } from '../server/kernel/source-export-wire.js';
import { exportFinalizedSource } from '../server/kernel/source-finalization.js';
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
  const exported = decodeSourceExport(first.source_export);
  const scope = exported.scope;
  expect(exported.scope_complete).toBe(true);
  const authority = { evidence_ref: 'synthetic-existing-project-source-binding', project_id: '902', customer_id: '903', request_id: 'request-1',
    site_id: exported.site_id, repository_path: exported.repository.repository_path, source_export_sha256: exported.sha256,
    scope_evidence_ref: scope.evidence_ref, request_scope_sha256: digest({ page_count: 1, page_list: 'Home' }), hosting_target: packet().continuation.hosting_target,
    files: { 'index.html': { source_path: 'proofs/index.html', url: 'https://assets.example.invalid/proof/index.html', rights: { status: 'approved', evidence_ref: 'synthetic-original-authored-source-rights' } } } };
  const produced = JSON.parse(execFileSync('php', [harness, '--export-packet'], { input: JSON.stringify({ source_export: first.source_export, html_base64: Buffer.from(html).toString('base64'), authority }), encoding: 'utf8' })).packet;
  for (const extra of [{ empty: {}, list: [] }, { numeric: 1e-7, large: 1e30, boundary: 1e21, integer: 9007199254740991 }, { text: 'Café 雪 😀', escaped: '\\n\"' }]) {
    const wire = exportFinalizedSource({ paths: f.paths, result: { ...first.build, spec: { ...first.build.spec, extra } }, brief: { completion_scope: scope }, reviewQa: first.qa });
    const input = { source_export: wire, html_base64: Buffer.from(html).toString('base64'), authority: { ...authority, source_export_sha256: wire.sha256 } };
    const call = value => JSON.parse(execFileSync('php', [harness, '--export-packet'], { input: JSON.stringify(value), encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }));
    const registered = call(input);
    expect(registered.packet.schema).toBe('famtastic.site-studio.build-packet.v1');
    expect(registered.stored_source_export).toEqual(wire);
    expect(decodeSourceExport(registered.stored_source_export).spec_snapshot.extra).toEqual(extra);
    expect(call({ ...input, source_export: { sha256: wire.sha256, payload_json: wire.payload_json, schema: wire.schema } }).stored_source_export).toEqual(wire);
    for (const payload_json of [wire.payload_json + ' ', wire.payload_json.replace('spec_snapshot', 'changed_snapshot'), JSON.stringify(Object.fromEntries(Object.entries(JSON.parse(wire.payload_json)).reverse()))]) {
      expect(() => call({ ...input, source_export: { ...wire, payload_json } })).toThrow();
      expect(() => decodeSourceExport({ ...wire, payload_json })).toThrow('source_export_digest_mismatch');
    }
    if (extra.empty) {
      const changed = wire.payload_json.replace('"empty":{}', '"empty":[]');
      expect(() => call({ ...input, source_export: { ...wire, payload_json: changed } })).toThrow();
    }
    // Reordering or alternate numeric spelling is a NEW byte identity, accepted
    // only when the installation-owned mapping binds that new digest.
    const payload_json = JSON.stringify(Object.fromEntries(Object.entries(JSON.parse(wire.payload_json)).reverse())).replace('1e-7', '0.0000001').replace('1e+30', '1.0e+30');
    const alternate = { ...wire, payload_json, sha256: sourceExportDigest(payload_json) };
    expect(call({ ...input, source_export: alternate, authority: { ...input.authority, source_export_sha256: alternate.sha256 } }).stored_source_export).toEqual(alternate);
  }
  for (const mutate of [a => { a.files['index.html'].rights = { ai_use_consent: true }; }, a => { a.customer_id = '999'; }, a => { a.source_export_sha256 = '0'.repeat(64); }, a => { a.request_scope_sha256 = digest({ page_count: 1, page_list: 'Different page' }); }]) {
    const invalid = structuredClone(authority); mutate(invalid);
    let rejected;
    try { rejected = JSON.parse(execFileSync('php', [harness, '--export-packet'], { input: JSON.stringify({ source_export: first.source_export, html_base64: Buffer.from(html).toString('base64'), authority: invalid }), encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] })); }
    catch (error) { expect(String(error.stderr)).toMatch(/selected_continuation_source_(mapping|export)/); continue; }
    expect(rejected.packet.schema).toBe('famtastic.site-studio.planning-packet.v1');
    expect(rejected.packet.dispatch_issue).toBeTruthy();
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
