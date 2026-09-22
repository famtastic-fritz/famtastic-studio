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
import { createArtifactBundle } from '../server/kernel/artifact-bundle.js';
import { createSelectedReviewQa } from '../server/kernel/selected-review-qa.js';
import { appendCreatorCredit, creatorLogoAsset } from '../vendor/site-foundation/index.js';
const harness = process.env.SELECTED_SOURCE_INTENT_HARNESS;
const receipts = process.env.SELECTED_STAGING_AGENCY_HARNESS;
let f;
afterEach(() => { f?.cleanup(); f = null; });
it.skipIf(!harness || !receipts)('actual completed pipeline export crosses portal selection and reuses one repository through receipt/retry', async () => {
  const sourcePacket = packet(); sourcePacket.project_id = '902'; sourcePacket.continuation.customer.id = '903';
  f = fixture({ producerPacket: sourcePacket, siteId: 'completed-source-fixture' });
  const brandedHome = appendCreatorCredit(html), logo = creatorLogoAsset();
  expect(logo.contents.length).toBe(2020725);
  expect(digest(logo.contents)).toBe('ebb0477344132d32e449ba19e2b622921585aa71af0decdbcf8abfbe033fa950');
  const bundle = createArtifactBundle([{ path: 'index.html', contents: brandedHome }, { path: logo.path, bytes: logo.contents }]);
  expect(bundle.files.find(file => file.path === logo.path).sha256).toBe(digest(logo.contents));
  const homeUrl = 'https://assets.example.invalid/proof/index.html', logoUrl = `https://assets.example.invalid/proof/${logo.path}`;
  const deliveries = {
    'index.html': { source_path: 'proofs/index.html', url: homeUrl, rights: { status: 'approved', evidence_ref: 'synthetic-original-authored-source-rights' } },
    [logo.path]: { source_path: `proofs/${logo.path}`, url: logoUrl, rights: { status: 'approved', scope: 'creator_attribution_only', evidence_ref: 'synthetic-owner-canonical-creator-credit', publication_authorized: false } },
  };
  // A normal, unassociated pipeline result: no first staging job or competing
  // project/request mapping is seeded just to obtain a completed source export.
  const build = await f.pipeline.run({ site_id: f.binding.site_id, adapter: 'notebooklm-import', raw_import: 'Synthetic authored complete source; no external research or provider claims.',
    composer: 'artifact', initiator: 'synthetic-studio-author', brief: {
      business: { name: 'Synthetic', description: 'Completed source adoption fixture' }, site_needs: { pages: ['index.html'] }, capability_class: 'static',
      artifact_bundle: bundle, design_contract: sourcePacket.continuation.brand.design_contract } });
  expect(build.outcome, build.error?.message || build.error?.code).toBe('success');
  expect(f.store.sourceMappings()).toEqual([]); expect(f.store.list()).toEqual([]);
  const review = await createSelectedReviewQa({ paths: f.paths })({ job: { id: 'complete-source-qa', build,
    packet: { project_id: '902', continuation: { required_pages: ['index.html'], files: Object.entries(deliveries).map(([path, file]) => ({ path, ...file })) } },
    selected: { artifact_bundle: bundle } } });
  expect(review.passed, JSON.stringify(review.problems)).toBe(true);
  const completion_scope = { site_id: build.site_id, evidence_ref: 'synthetic-complete-source-scope', required_pages: ['index.html'], features: ['static_navigation'], pending_revisions: [] };
  const first = { build, qa: review, source_export: exportFinalizedSource({ paths: f.paths, result: build, brief: { completion_scope }, reviewQa: review }) };
  const exported = decodeSourceExport(first.source_export);
  const scope = exported.scope;
  expect(exported.scope_complete).toBe(true);
  const authority = { evidence_ref: 'synthetic-existing-project-source-binding', project_id: '902', customer_id: '903', request_id: 'request-1',
    site_id: exported.site_id, repository_path: exported.repository.repository_path, source_export_sha256: exported.sha256,
    scope_evidence_ref: scope.evidence_ref, request_scope_sha256: digest({ project_type: '', page_count: 1, page_list: 'Home' }), hosting_target: packet().continuation.hosting_target,
    files: deliveries };
  const complete_source_files = [{ path: logo.path, content_base64: logo.contents.toString('base64') }];
  const baseInput = { source_export: first.source_export, html_base64: Buffer.from(brandedHome).toString('base64'), complete_source_files, authority };
  // The wire deliberately retains an inline original bundle. Bound stdout for
  // this local fixture without weakening any production transport budget.
  const call = value => JSON.parse(execFileSync('php', [harness, '--export-packet'], { input: JSON.stringify(value), encoding: 'utf8', maxBuffer: 16 * 1024 * 1024, stdio: ['pipe', 'pipe', 'pipe'] }));
  const produced = call(baseInput).packet;
  expect(produced.schema, produced.dispatch_issue).toBe('famtastic.site-studio.build-packet.v1');
  expect(produced.artifacts.map(a => ({ path: a.path, sha256: a.sha256, bytes: a.bytes }))).toEqual([
    { path: 'proofs/index.html', sha256: digest(brandedHome), bytes: Buffer.byteLength(brandedHome) },
    { path: `proofs/${logo.path}`, sha256: digest(logo.contents), bytes: logo.contents.length },
  ]);
  expect(produced.continuation.files.find(file => file.path === logo.path).rights).toEqual(deliveries[logo.path].rights);
  for (const extra of [{ empty: {}, list: [] }, { numeric: 1e-7, large: 1e30, boundary: 1e21, integer: 9007199254740991 }, { text: 'Café 雪 😀', escaped: '\\n\"' }]) {
    const wire = exportFinalizedSource({ paths: f.paths, result: { ...first.build, spec: { ...first.build.spec, extra } }, brief: { completion_scope: scope }, reviewQa: first.qa });
    const input = { ...baseInput, source_export: wire, authority: { ...authority, source_export_sha256: wire.sha256 } };
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
  for (const mutate of [a => { a.files['index.html'].rights = { ai_use_consent: true }; }, a => { delete a.files[logo.path]; }, a => { delete a.files[logo.path].rights; }, a => { a.files[logo.path].rights = { ai_use_consent: true }; }, a => { a.customer_id = '999'; }, a => { a.source_export_sha256 = '0'.repeat(64); }, a => { a.request_scope_sha256 = digest({ page_count: 1, page_list: 'Different page' }); }]) {
    const invalid = structuredClone(authority); mutate(invalid);
    let rejected;
    try { rejected = call({ ...baseInput, authority: invalid }); }
    catch (error) { expect(String(error.stderr)).toMatch(/selected_continuation_source_(mapping|export)/); continue; }
    expect(rejected.packet.schema).toBe('famtastic.site-studio.planning-packet.v1');
    expect(rejected.packet.dispatch_issue).toBeTruthy();
  }
  for (const input of [
    { ...baseInput, html_base64: Buffer.from(html).toString('base64') },
    { ...baseInput, complete_source_files: [] },
    { ...baseInput, complete_source_files: [{ path: logo.path, content_base64: Buffer.from('wrong PNG bytes').toString('base64') }] },
  ]) {
    const rejected = call(input).packet;
    expect(rejected.schema).toBe('famtastic.site-studio.planning-packet.v1');
    expect(rejected.dispatch_issue).toContain('file_authority_binding_required');
  }
  // Fixture input itself is bounded, path-confined and cannot duplicate assets.
  for (const complete_source_files of [[...baseInput.complete_source_files, ...baseInput.complete_source_files], [{ path: '../outside.png', content_base64: 'eA==' }]]) {
    expect(() => call({ ...baseInput, complete_source_files })).toThrow(/synthetic_complete_source/);
  }
  expect(produced.continuation.initiating_system).toBe('studio');
  expect(produced.continuation.source_export_sha256).toBe(exported.sha256);
  const resolveSource = createSelectedSourceResolver({ paths: f.paths, mappings: [{ ...authority, run_id: exported.run_id }] });
  let accepted;
  const bytesByUrl = new Map([[homeUrl, Buffer.from(brandedHome)], [logoUrl, logo.contents]]), fetched = [];
  const host = createCpanelReview({ paths: f.paths, journal: f.journal, binding: { ...f.binding, customer_id: '903' }, transport: f.transport });
  const worker = createStagingWorker({ ...f.options(), resolveSource, host, fetchArtifact: async ({ url, maxBytes }) => {
    const bytes = bytesByUrl.get(url); if (!bytes || bytes.length > maxBytes) throw new Error('synthetic_source_delivery_mismatch');
    fetched.push(url); return bytes;
  }, callback: async receipt => {
    accepted = JSON.parse(execFileSync('php', [receipts, '--validate-source-receipt'], { input: JSON.stringify({ packet: produced, receipt }), encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 }));
    return { ok: accepted.accepted };
  } });
  const id = f.store.accept(produced).id;
  expect(f.store.accept(produced).id).toBe(id);
  expect(() => f.store.accept({ ...produced, created_at: 'conflicting-duplicate' })).toThrow('idempotency_conflict');
  const done = await worker.run(id);
  expect(done.failure).toBeUndefined(); expect(done.state).toBe('complete');
  expect(done.build.repository.repository_path).toBe(first.build.repository.repository_path);
  expect(done.build.repository.commit).toBe(first.build.repository.commit);
  expect(f.counters.builds).toBe(1); expect(f.counters.generation).toBe(0);
  expect(new Set(fetched)).toEqual(new Set([homeUrl, logoUrl]));
  expect(f.remote.get('index.html')).toEqual(Buffer.from(brandedHome)); expect(f.remote.get(logo.path)).toEqual(logo.contents);
  expect(f.store.sourceMappings()).toHaveLength(1);
  expect(f.store.sourceMappings()[0]).toMatchObject({ project_id: '902', customer_id: '903', request_id: 'request-1', site_id: build.site_id });
  expect(fs.existsSync(f.paths.within('sites', 'project-902'))).toBe(false);
  expect(accepted).toEqual({ accepted: true, notifications: 1, checkout: false });
  expect((await worker.run(id)).state).toBe('complete'); expect(f.counters.builds).toBe(1);
  await expect(createSelectedSourceResolver({ paths: f.paths, mappings: [] })(produced)).rejects.toThrow('source_repository_mapping_required');
  const wrong = structuredClone(produced); wrong.continuation.customer.id = '999';
  await expect(resolveSource(wrong)).rejects.toThrow('source_repository_mapping_required');
});
