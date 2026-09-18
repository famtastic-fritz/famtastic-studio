import { execFileSync } from 'node:child_process';
import { afterEach, expect, it } from 'vitest';
import { shellFixture } from './legacy-shared-shell-fixture.mjs';
import { fixture } from './staging-worker-fixture.mjs';
import { createStagingWorker } from '../server/kernel/staging-worker.js';
import { digest } from '../server/kernel/staging-store.js';
import { decodeSourceExport } from '../server/kernel/source-export-wire.js';
import { createDeploy } from '../server/kernel/deploy.js';
import { createFamtasticIncAdapter } from '../server/kernel/famtasticinc-adapter.js';
const harness = process.env.NORMAL_SELECTED_RECORDS_HARNESS;
let f;
afterEach(() => { f?.cleanup(); f = null; });
it.skipIf(!harness)('actual owned upload permits exact protected reference reuse and rejects publication or withdrawn rights', async () => {
  const base64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
  const bytes = Buffer.from(base64, 'base64');
  const html = shellFixture().selected.replace('<nav ', '<img src="assets/logo.png" alt="Synthetic logo"><nav ');
  const input = { upload: { base64, fields: { ownership_confirmed: true, ai_use_consent: false } },
    raw_callback: JSON.stringify({ event_id: 'normal-event', campaign_id: 'pc-normal-proof', job_id: 'normal-job', variants: ['a', 'b', 'c'].map(direction_id => ({ direction_id, html, design_dna: {}, assets: [{ asset_id: 'logo', relative_path: 'logo.png', media_type: 'image/png', base64, sha256: digest(bytes) }] })) }),
    request: { project_name: 'Synthetic', business_name: 'Synthetic', action: 'save', page_count: 2, page_list: 'Home, About', page_content: [{ page_name: 'About', title: 'About us', heading: 'Our story', description: 'Our story', body: 'Actual customer copy with an unchanged shared logo.' }] },
    installation: { artifact_base_url: 'https://agency.example.invalid', authored_shell_policy: { status: 'approved', evidence_ref: 'synthetic-owned-code' }, targets: { '902': { customer_id: '903', staging_url: 'https://synthetic.famtasticinc.com/', target_path: '/home/nineoo/public_html/synthetic', remote_subdirectory: 'synthetic' } } } };
  const call = extra => JSON.parse(execFileSync('php', [harness], { input: JSON.stringify({ ...input, ...extra }), encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'], maxBuffer: 12 * 1024 * 1024 }));
  const produced = call({}), p = produced.packet;
  expect(produced.reader_negatives.public_reference_denied).toBe(true);
  for (const asset_changes of [{ customer_id: 999 }, { website_request_id: 999 }]) expect(call({ asset_changes }).reader_negatives.public_reference_denied).toBeUndefined();
  expect(p.schema, p.dispatch_issue).toBe('famtastic.site-studio.build-packet.v1');
  expect(p.continuation.files.find(f => f.path === 'assets/logo.png').rights).toMatchObject({ scope: 'protected_review_only', request_asset_id: 'normal-upload-1', publication_authorized: false, ai_transformation_authorized: false, legal_license_asserted: false });
  expect(produced.final_state.selected_source_intent.asset_authority.records[0].ai_use_consent).toBe(false);
  expect(call({ upload: { base64, fields: { ownership_confirmed: false, ai_use_consent: true } } }).packet.dispatch_issue).toContain('asset_reference_binding_missing');
  for (const asset_changes of [{ customer_id: 999 }, { website_request_id: 999 }, { status: 'withdrawn' }, { ownership_confirmed: 0 }, { sha256: 'e'.repeat(64) }, { size_bytes: bytes.length + 1 }]) {
    expect(call({ asset_changes }).packet.dispatch_issue).toContain('asset_reference_binding_missing');
  }
  f = fixture({ producerPacket: p });
  let rightsActive = true, revokeAfterHost = false;
  const options = f.options();
  const worker = createStagingWorker({ ...options, maxAttempts: 5,
    host: { deploy: async args => { const result = await options.host.deploy(args); if (revokeAfterHost) rightsActive = false; return result; } },
    fetchArtifact: async ({ url }) => {
      const hash = new URL(url).pathname.split('/').at(-1);
      if (hash === digest(bytes) && !rightsActive) throw Object.assign(new Error('reference_access_revoked'), { code: 'reference_access_revoked' });
      return Buffer.from(produced.artifact_bytes[hash], 'base64');
    } });
  const id = f.store.accept(p).id;
  for (const denied of ['anonymous_denied', 'aliases_denied']) {
    f.transport.verifyAccess = async () => ({ anonymous_denied: true, aliases_denied: true, noindex: true, [denied]: false });
    const refused = await worker.run(id);
    expect(refused.state, JSON.stringify({ failure: refused.failure, build: refused.build, qa: refused.qa })).toBe('retry'); expect(refused.history.at(-1).code).toBe('source_use_private_access_required');
    expect(f.counters.uploads).toBe(0);
  }
  f.transport.verifyAccess = async () => ({ anonymous_denied: true, aliases_denied: true, noindex: true });
  rightsActive = false;
  const revokedBeforeHost = await worker.run(id);
  expect(revokedBeforeHost.state).toBe('retry'); expect(revokedBeforeHost.history.at(-1).code).toBe('reference_access_revoked');
  expect(f.counters.uploads).toBe(0);
  rightsActive = true; revokeAfterHost = true;
  const revokedBeforeReceipt = await worker.run(id);
  expect(revokedBeforeReceipt.state).toBe('retry'); expect(revokedBeforeReceipt.stage).toBe('callback');
  expect(f.counters.callbacks).toBe(0); expect(revokedBeforeReceipt.callback_body).toBeUndefined();
  rightsActive = true; revokeAfterHost = false;
  const done = await worker.run(id);
  expect(done.state, JSON.stringify({ failure: done.failure, build: done.build?.error, qa: done.qa })).toBe('complete');
  expect(f.remote.get('assets/logo.png')).toEqual(bytes);
  expect(f.remote.get('index.html').toString()).toBe(html);
  expect(f.remote.get('about.html').toString()).toContain('Actual customer copy with an unchanged shared logo.');
  expect(done.selected.transformations.map(t => t.path)).toEqual(['about.html']);
  expect(f.counters.generation).toBe(0); expect(f.counters.builds).toBe(1);
  const restrictions = decodeSourceExport(done.source_export).use_restrictions;
  expect(restrictions.scope).toBe('protected_review_only'); expect(done.callback_body.use_restrictions).toEqual(restrictions);
  expect(call({ receipt: done.callback_body, accept_review: true }).final_row.staging_review_status).toBe('accepted');
  expect(() => call({ receipt: { ...done.callback_body, use_restrictions: null } })).toThrow();
  const revoked = call({ receipt: done.callback_body, accept_review: true, withdraw_after_receipt: true });
  expect(revoked.reader_negatives.asset_rights_changed).toBe(true);
  expect(revoked.reader_negatives.public_reference_denied).toBe(true);
  expect(revoked.final_row.staging_review_status).not.toBe('accepted');
  expect(revoked.final_packet.dispatch_issue).toContain('asset_reference_binding_missing');
  const deploy = createDeploy({ paths: f.paths, journal: f.journal });
  for (const method of ['plan', 'deploy', 'goLive', 'rollback']) expect(() => deploy[method]({ site_id: done.build.site_id, initiator: 'synthetic-owner', receipt_id: 'unused' })).toThrow('source_use_protected_review_only');
  expect(() => createFamtasticIncAdapter({ env: {} }).plan({ site_id: done.build.site_id, manifest_hash: 'synthetic', environment: 'production', source_export: done.source_export })).toThrow('protected review transport');
}, 20000);
