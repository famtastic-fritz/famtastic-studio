import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { Readable } from 'node:stream';
import fs from 'node:fs';
import { afterEach, expect, it } from 'vitest';
import { fixture } from './staging-worker-fixture.mjs';
import { shellFixture } from './legacy-shared-shell-fixture.mjs';
import { createArtifactBundle } from '../server/kernel/artifact-bundle.js';
import { createSourceAssociation, verifySourceAssociation } from '../server/kernel/source-association.js';
import { createSelectedReviewQa } from '../server/kernel/selected-review-qa.js';
import { createStagingWorker } from '../server/kernel/staging-worker.js';
import { digest } from '../server/kernel/staging-store.js';
import pipelineModule from '../server/modules/pipeline/index.js';
import { createEvents } from '../server/kernel/events.js';
const harness = process.env.NORMAL_SELECTED_RECORDS_HARNESS;
let f, child;
afterEach(() => { child?.stdin.end(); child?.kill(); child = null; f?.cleanup(); f = null; });
function agency(input) {
  child = spawn('php', [harness, '--association'], { stdio: ['pipe', 'pipe', 'pipe'] });
  let stderr = '', queue = [], pending = [];
  child.stderr.on('data', b => { stderr += b; });
  createInterface({ input: child.stdout }).on('line', line => { const value = JSON.parse(line); if (pending.length) pending.shift().resolve(value); else queue.push(value); });
  child.on('exit', code => { for (const p of pending) p.reject(new Error(`PHP exited ${code}: ${stderr}`)); pending = []; });
  const read = () => queue.length ? Promise.resolve(queue.shift()) : new Promise((resolve, reject) => pending.push({ resolve, reject }));
  child.stdin.write(JSON.stringify(input) + '\n');
  return { ready: read(), send: value => { child.stdin.write(JSON.stringify(value) + '\n'); return read(); } };
}
it.skipIf(!harness).each([[false, false], [true, false], [true, true]])('normal Studio source associates without seeded mapping (complete: %s, mismatched copy: %s)', async (complete, wrongCopy) => {
  const html = shellFixture().selected.replace('href="about.html"', 'href="index.html"');
  const copy = { page_name: 'About', title: 'About us', description: 'Our story', heading: 'Our story', body: 'Actual supplied page copy.' };
  const input = { raw_callback: JSON.stringify({ event_id: 'normal-event', campaign_id: 'normal-proof', job_id: 'normal-job', variants: ['a', 'b', 'c'].map(direction_id => ({ direction_id, html, design_dna: {} })) }),
    request: { project_name: 'Synthetic', business_name: 'Synthetic', action: 'save', page_count: 2, page_list: 'Home, About', page_content: [copy] },
    installation: { artifact_base_url: 'https://agency.example.invalid', authored_shell_policy: { status: 'approved', evidence_ref: 'synthetic-owned-code' }, targets: { '902': { customer_id: '903', staging_url: 'https://synthetic.famtasticinc.com/', target_path: '/home/nineoo/public_html/synthetic', remote_subdirectory: 'synthetic' } } } };
  const a = agency(input), initial = await a.ready;
  expect(initial.mapping_absent).toBe(true);
  f = fixture({ producerPacket: initial.packet, siteId: 'studio-authored-source' });
  const about = html.replace('Original home description', copy.description).replace('Original home</title>', copy.title + '</title>').replace('Original heading', copy.heading).replace('Original authored home paragraph.', wrongCopy ? 'Different source text.' : copy.body);
  const files = [{ path: 'index.html', contents: html }, ...(complete ? [{ path: 'about.html', contents: about }] : [])];
  const built = await f.pipeline.run({ site_id: f.binding.site_id, adapter: 'notebooklm-import', raw_import: 'Synthetic authored source supplied for local verification; no external research claims.', composer: 'artifact', initiator: 'studio-author', brief: {
    business: { name: 'Synthetic', description: 'Synthetic source association proof' }, site_needs: { pages: files.map(f => f.path) }, capability_class: 'static',
    artifact_bundle: createArtifactBundle(files), design_contract: { schema_version: 1, kind: 'selected-source-preservation-v1', source_sha256: digest(html), preservation: 'exact-source-and-marked-shell', asset_policy: { preserve: true, rights_safe_only: true } } } });
  expect(built.outcome, JSON.stringify(built)).toBe('success');
  expect(f.store.sourceMappings()).toEqual([]); expect(f.counters.builds).toBe(1);
  const issued = await a.send({ callback: { schema: 'famtastic.site-studio.association-request.v1', request_id: 'normal-request', project_id: '902', customer_id: '903' } });
  expect(issued.status, JSON.stringify(issued.response)).toBe(200);
  const grant = issued.response.association;
  expect(() => verifySourceAssociation({ ...grant, payload_json: grant.payload_json + ' ' }, 'synthetic-association-secret', 1789600000)).toThrow('signature');
  expect(() => verifySourceAssociation(grant, 'synthetic-association-secret', 1789603601)).toThrow('expired');
  let failCallback = true, acknowledged;
  const capabilities = () => ({ paths: f.paths, store: f.store, qa: createSelectedReviewQa({ paths: f.paths }), secret: 'synthetic-association-secret', now: () => 1789600000,
    callback: async body => { if (failCallback) throw new Error('synthetic_callback_delayed'); acknowledged = await a.send({ callback: body }); if (acknowledged.status !== 200) throw new Error(JSON.stringify(acknowledged.response)); return acknowledged.response; } });
  const args = { site_id: built.site_id, run_id: built.run_id, association: grant };
  if (wrongCopy) {
    await expect(createSourceAssociation(capabilities()).finalize(args)).rejects.toThrow('completed_content_changed');
    expect(f.store.sourceMappings()).toEqual([]); expect(f.counters.uploads).toBe(0);
    await a.send({ close: true }).catch(() => {}); return;
  }
  await expect(createSourceAssociation(capabilities()).finalize(args)).rejects.toThrow('synthetic_callback_delayed');
  expect(f.store.sourceMappings()).toHaveLength(1); expect(f.counters.uploads).toBe(0); expect(f.counters.builds).toBe(1);
  const envelope = f.store.readAssociation(JSON.parse(grant.payload_json).association_id).envelope;
  const homePath = f.paths.within('sites', built.site_id, 'index.html');
  fs.appendFileSync(homePath, '<p>Unverified change</p>');
  await expect(createSourceAssociation(capabilities()).deliver(envelope.source_completion.association_id)).rejects.toThrow('source_repository_changed');
  fs.writeFileSync(homePath, html);
  for (const row_change of [{ commerce_order_id: 9 }, { selected_proof_direction: 'b' }, { customer_id: 999 }]) {
    const rejected = await a.send({ row_change, callback: envelope }); expect(rejected.status).toBe(422);
    await a.send({ row_change: { commerce_order_id: null, selected_proof_direction: 'a', customer_id: 903 } });
  }
  expect((await a.send({ now: 1789603601, callback: envelope })).status).toBe(422);
  await a.send({ now: 1789600000 });
  expect((await a.send({ selected_html: html + '<!-- unrecorded change -->', callback: envelope })).response.message).toBe('source_association_current_source_changed');
  await a.send({ selected_html: html });
  const savedIntake = issued.row.intake_data;
  expect((await a.send({ row_change: { intake_data: JSON.stringify({ ...JSON.parse(savedIntake), page_list: 'Home, Team' }) }, callback: envelope })).response.message).toBe('source_association_current_input_changed');
  await a.send({ row_change: { intake_data: savedIntake } });
  expect((await a.send({ callback: { ...envelope, customer_id: '999' } })).status).toBe(422);
  expect((await a.send({ callback: { ...envelope, source_completion: { ...envelope.source_completion, repository_path: '/unrelated' } } })).status).toBe(422);
  if (complete) expect((await a.send({ callback: { ...envelope, content_evidence: { 'about.html': Buffer.from('incorrect content').toString('base64') } } })).status).toBe(422);
  f.restart(); failCallback = false;
  const routes = new Map();
  pipelineModule.register({ app: { route: (method, path, handler) => routes.set(path, handler) }, paths: f.paths, journal: f.journal, events: createEvents({ paths: f.paths }), stagingRuntime: { sourceAssociation: createSourceAssociation(capabilities()) } });
  const response = await routes.get('/api/pipeline/source/associate')({ req: Readable.from([JSON.stringify(args)]) });
  expect(response.status, JSON.stringify(response.body)).toBe(200);
  const registered = response.body;
  expect(registered.state).toBe('acknowledged');
  const duplicate = await a.send({ callback: envelope });
  expect(duplicate.status, JSON.stringify(duplicate.response)).toBe(200); expect(duplicate.response.newly_processed).toBe(false);
  expect(duplicate.state.selected_dispatch_packet).toEqual(acknowledged.state.selected_dispatch_packet);
  await expect(createSourceAssociation(capabilities()).finalize({ ...args, site_id: 'another-site' })).rejects.toThrow('conflicting_reuse');
  expect(acknowledged.state.selected_source_mapping.originating_system).toBe('studio');
  expect(acknowledged.row.staging_review_status).not.toBe('accepted');
  const p = acknowledged.state.selected_dispatch_packet;
  expect(p.schema, p.dispatch_issue).toBe('famtastic.site-studio.build-packet.v1');
  expect(p.continuation.operation).toBe(complete ? 'package_existing' : 'continue_build');
  const worker = createStagingWorker({ ...f.options(), fetchArtifact: async ({ url }) => Buffer.from(acknowledged.artifact_bytes[new URL(url).pathname.split('/').at(-1)], 'base64') });
  const done = await worker.run(f.store.accept(p).id);
  expect(done.state, JSON.stringify({ history: done.history, failure: done.failure, build: done.build?.error })).toBe('complete');
  expect(done.build.site_id).toBe(built.site_id); expect(done.build.repository.repository_path).toBe(built.repository.repository_path);
  expect(f.counters.builds).toBe(complete ? 1 : 2); expect(f.counters.generation).toBe(0);
  expect(f.remote.get('index.html').toString()).toBe(html);
  if (complete) expect(f.remote.get('about.html').toString()).toBe(about);
  expect(fs.readdirSync(f.paths.within('sites'))).toEqual([built.site_id]);
  const receipt = await a.send({ callback: done.callback_body });
  expect(receipt.status, JSON.stringify(receipt.response)).toBe(200);
  expect(receipt.row.staging_status).toBe('deployed');
  expect(receipt.row.staging_review_status).not.toBe('accepted');
  await a.send({ update: { ...input.request, page_content: [{ ...copy, body: 'Changed current customer copy.' }] } });
  expect((await a.send({ callback: envelope })).status).toBe(422);
  await a.send({ close: true }).catch(() => {});
}, 20000);
