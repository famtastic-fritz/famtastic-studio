import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { Readable } from 'node:stream';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { afterEach, expect, it } from 'vitest';
import { fixture } from './staging-worker-fixture.mjs';
import { shellFixture } from './legacy-shared-shell-fixture.mjs';
import { createArtifactBundle } from '../server/kernel/artifact-bundle.js';
import { createSourceAssociation, verifySourceAssociation } from '../server/kernel/source-association.js';
import { createSelectedReviewQa } from '../server/kernel/selected-review-qa.js';
import { digest } from '../server/kernel/staging-store.js';
import { createStagingRuntime } from '../server/kernel/staging-runtime.js';
import { createSelectedSourceResolver } from '../server/kernel/selected-source-binding.js';
import pipelineModule from '../server/modules/pipeline/index.js';
import { createEvents } from '../server/kernel/events.js';
import { git, appendCreatorCredit, CREATOR_LOGO_PATH, creatorLogoAsset } from '../vendor/site-foundation/index.js';
const harness = process.env.NORMAL_SELECTED_RECORDS_HARNESS;
let f, child, runtime;
afterEach(() => { child?.stdin.end(); child?.kill(); child = null; runtime?.close(); runtime = null; f?.cleanup(); f = null; });
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
it.skipIf(!harness).each([[false, false, null], [true, false, null], [true, true, null], [true, false, 'cross_customer'], ...['expired', 'paid', 'reselected', 'ack_mismatch', 'bytes', 'callback_delay', 'upload_failure', 'transport_recovery'].map(mode => [false, false, mode])])('normal Studio source associates without seeded mapping (complete: %s, mismatched copy: %s, outbox: %s)', async (complete, wrongCopy, pendingCase) => {
  const delayed = ['callback_delay', 'upload_failure'].includes(pendingCase);
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
  const routes = new Map();
  pipelineModule.register({ app: { route: (method, path, handler) => routes.set(`${method} ${path}`, handler) }, paths: f.paths, journal: f.journal, events: createEvents({ paths: f.paths }) });
  const countBefore = f.dna.list().length;
  for (const body of [{ site_id: built.site_id, association: grant }, { site_id: 'conflicting-source', association: grant }]) {
    const responses = await Promise.all([1, 2].map(() => routes.get('POST /api/pipeline/run')({ req: Readable.from([JSON.stringify(body)]) })));
    for (const response of responses) expect(response).toMatchObject({ status: 409, body: { error: 'source_association_separate_handoff_required' } });
  }
  expect(f.dna.list()).toHaveLength(countBefore); expect(git(built.repository.repository_path, ['rev-parse', 'HEAD'])).toBe(built.repository.commit);
  expect(() => verifySourceAssociation({ ...grant, payload_json: grant.payload_json + ' ' }, 'synthetic-association-secret', 1789600000)).toThrow('signature');
  expect(() => verifySourceAssociation(grant, 'synthetic-association-secret', 1789603601)).toThrow('expired');
  let failCallback = true, acknowledged, localNow = 1789600000;
  const transient = pendingCase === 'transport_recovery' ? [503, 429, 503] : [];
  const capabilities = () => ({ paths: f.paths, store: f.store, qa: createSelectedReviewQa({ paths: f.paths }), secret: 'synthetic-association-secret', now: () => localNow,
    callback: async body => { if (failCallback) throw new Error('synthetic_callback_delayed'); if (transient.length) throw Object.assign(new Error('temporary upstream failure'), { code: 'callback_rejected', responseStatus: transient.shift() }); acknowledged = await a.send({ callback: body }); if (acknowledged.status !== 200) throw Object.assign(new Error(JSON.stringify(acknowledged.response)), { code: 'callback_rejected', responseStatus: acknowledged.status, reasonCode: acknowledged.response.message }); return pendingCase === 'ack_mismatch' ? { ...acknowledged.response, association_id: 'wrong-association' } : acknowledged.response; } });
  const args = { site_id: built.site_id, run_id: built.run_id, association: grant };
  if (pendingCase === 'cross_customer') {
    const payload = JSON.parse(grant.payload_json);
    payload.intent.authored_content.pages[0].customer_id = 'another-customer';
    const payload_json = JSON.stringify(payload);
    const signature = crypto.createHmac('sha256', 'synthetic-association-secret').update(`${payload.schema}\n${payload_json}`).digest('hex');
    await expect(createSourceAssociation(capabilities()).finalize({ ...args, association: { ...grant, payload_json, signature } })).rejects.toThrow('content_customer_changed');
    expect(f.store.sourceMappings()).toEqual([]); expect(f.store.listAssociations()).toEqual([]);
    expect(f.counters.uploads).toBe(0); expect(acknowledged).toBeUndefined();
    await a.send({ close: true }).catch(() => {}); return;
  }
  if (wrongCopy) {
    await expect(createSourceAssociation(capabilities()).finalize(args)).rejects.toThrow('completed_content_changed');
    expect(f.store.sourceMappings()).toEqual([]); expect(f.counters.uploads).toBe(0);
    await a.send({ close: true }).catch(() => {}); return;
  }
  await expect(createSourceAssociation(capabilities()).finalize(args)).rejects.toThrow('synthetic_callback_delayed');
  expect(f.store.sourceMappings()).toHaveLength(1); expect(f.counters.uploads).toBe(0); expect(f.counters.builds).toBe(1);
  const envelope = f.store.readAssociation(JSON.parse(grant.payload_json).association_id).envelope;
  if (pendingCase === 'bytes') fs.appendFileSync(f.paths.within('sites', built.site_id, 'index.html'), '<p>Unverified change</p>');
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
  localNow = f.store.readAssociation(envelope.source_completion.association_id).next_attempt_at;
  const normal = f.options();
  const makeRuntime = () => createStagingRuntime({ paths: f.paths, journal: f.journal, ...normal, associationSecret: 'synthetic-association-secret', associationNow: () => pendingCase === 'expired' ? 1789603601 : localNow,
    fetchArtifact: async ({ url }) => Buffer.from(acknowledged.artifact_bytes[new URL(url).pathname.split('/').at(-1)], 'base64'),
    callback: body => body.schema === 'famtastic.site-studio.source-finalized.v1' ? capabilities().callback(body) : normal.callback(body) });
  runtime = makeRuntime();
  if (pendingCase === 'transport_recovery') {
    const unrelated = runtime.store.accept({ ...initial.packet, schema: 'famtastic.site-studio.planning-packet.v1', project_id: '998', request_id: 'backoff-unrelated', packet_id: 'backoff-packet', idempotency_key: 'backoff-idem', intent: { ...JSON.parse(grant.payload_json).intent, project_id: '998', request_id: 'backoff-unrelated' } });
    for (let attempt = 0; attempt < 3; attempt++) {
      await runtime.wake();
      expect(runtime.store.read(unrelated.id).state).toBe('complete');
      const pending = runtime.store.readAssociation(envelope.source_completion.association_id);
      expect(pending.state).toBe('callback_pending'); expect(pending.attempts).toBe(attempt + 2);
      expect(pending.next_attempt_at).toBeGreaterThan(localNow); expect(pending.envelope).toEqual(envelope);
      await runtime.wake(); expect(runtime.store.readAssociation(pending.id).attempts).toBe(pending.attempts);
      localNow = pending.next_attempt_at;
    }
    runtime.close(); runtime = null; f.restart(); runtime = makeRuntime();
    expect(f.counters.builds).toBe(1); expect(f.counters.uploads).toBe(0);
  }
  if (pendingCase && !delayed && pendingCase !== 'transport_recovery') {
    if (pendingCase === 'paid') await a.send({ row_change: { commerce_order_id: 9 } });
    if (pendingCase === 'reselected') await a.send({ row_change: { selected_proof_direction: 'b' } });
    const waiting = runtime.store.accept(initial.packet);
    const unrelated = runtime.store.accept({ ...initial.packet, schema: 'famtastic.site-studio.planning-packet.v1', project_id: '999', request_id: 'unrelated-request', packet_id: 'unrelated-packet', idempotency_key: 'unrelated-idem', intent: { ...JSON.parse(grant.payload_json).intent, project_id: '999', request_id: 'unrelated-request' } });
    if (pendingCase === 'expired') {
      const held = runtime.store.claimAssociation(envelope.source_completion.association_id);
      const busy = await runtime.wake();
      expect(busy.some(r => r.id === envelope.source_completion.association_id && r.state === 'busy')).toBe(true);
      expect(runtime.store.read(unrelated.id).state).toBe('complete');
      runtime.store.releaseAssociation(envelope.source_completion.association_id, held.token);
    }
    const refused = await runtime.wake();
    const entry = runtime.store.readAssociation(envelope.source_completion.association_id);
    expect(entry.state, JSON.stringify(refused)).toBe('reconciliation_required');
    expect(entry.envelope).toEqual(envelope); expect(entry.action).toContain('Reconcile');
    expect(runtime.store.read(waiting.id).stage).toBe('materialize');
    expect(runtime.store.read(unrelated.id).state).toBe('complete');
    expect(f.counters.builds).toBe(1); expect(f.counters.uploads).toBe(0);
    await runtime.wake(); expect(runtime.store.readAssociation(entry.id).attempts).toBe(entry.attempts);
    await a.send({ close: true }).catch(() => {}); return;
  }
  const wake = await runtime.wake();
  const registered = wake.find(r => r.id === envelope.source_completion.association_id);
  expect(registered, JSON.stringify(wake)).toBeDefined();
  expect(registered.state).toBe('acknowledged');
  const duplicate = await a.send({ callback: envelope });
  expect(duplicate.status, JSON.stringify(duplicate.response)).toBe(200); expect(duplicate.response.newly_processed).toBe(false);
  expect(duplicate.state.selected_dispatch_packet).toEqual(acknowledged.state.selected_dispatch_packet);
  await expect(createSourceAssociation(capabilities()).finalize({ ...args, site_id: 'another-site' })).rejects.toThrow('conflicting_reuse');
  expect(acknowledged.state.selected_source_mapping.originating_system).toBe('studio');
  expect(acknowledged.row.staging_review_status).not.toBe('accepted');
  let p = acknowledged.state.selected_dispatch_packet;
  expect(p.schema, p.dispatch_issue).toBe('famtastic.site-studio.build-packet.v1');
  expect(p.continuation.operation).toBe(complete ? 'package_existing' : 'continue_build');
  const job = runtime.store.accept(p);
  if (delayed) f.controls[pendingCase === 'callback_delay' ? 'callbackFails' : 'uploadFails'] = true;
  let done = (await runtime.wake()).find(r => r.id === job.id);
  if (delayed) {
    expect(done.state).toBe('retry'); expect(f.counters.builds).toBe(2);
    const savedAbout = fs.readFileSync(f.paths.within('sites', built.site_id, 'about.html'));
    const team = { ...copy, page_name: 'Team', title: 'Our team', heading: 'Our team', body: 'Actual supplied team copy.' };
    acknowledged = await a.send({ update: { ...input.request, page_count: 3, page_list: 'Home, About, Team', page_content: [copy, team] } });
    p = acknowledged.state.selected_dispatch_packet;
    expect(p.continuation.source_export_sha256).toBe(envelope.source_export.sha256);
    const mapping = runtime.store.sourceMappings()[0];
    for (const change of [{ association_id: 'unrelated-association' }, { association_scope_sha256: '0'.repeat(64) }]) await expect(createSelectedSourceResolver({ paths: f.paths, mappings: [{ ...mapping, ...change }] })(p, { reconcile: true })).rejects.toThrow('ancestor_mismatch');
    await expect(runtime.store.resolveSource({ ...p, continuation: { ...p.continuation, source_export_sha256: '0'.repeat(64) } }, { reconcile: true })).rejects.toThrow('mapping_stale');
    await expect(runtime.store.resolveSource({ ...p, continuation: { ...p.continuation, customer: { ...p.continuation.customer, id: '999' } } }, { reconcile: true })).rejects.toThrow('mapping_required');
    const oldWirePath = f.paths.within('dna', built.run_id, `source-${envelope.source_export.sha256}.json`);
    const oldWire = fs.readFileSync(oldWirePath);
    fs.writeFileSync(oldWirePath, JSON.stringify({ ...envelope.source_export, payload_json: envelope.source_export.payload_json + ' ' }));
    await expect(runtime.store.resolveSource(p, { reconcile: true })).rejects.toThrow('digest_mismatch');
    fs.writeFileSync(oldWirePath, oldWire);
    runtime.close(); runtime = null; f.restart(); f.controls.callbackFails = false; f.controls.uploadFails = false;
    runtime = makeRuntime();
    const next = runtime.store.accept(p);
    done = (await runtime.wake()).find(r => r.id === next.id);
    expect(done.selected?.transformations.map(t => t.path)).toEqual(['team.html']);
    expect(fs.readFileSync(f.paths.within('sites', built.site_id, 'about.html'))).toEqual(savedAbout);
    expect(f.counters.builds).toBe(3);
    await runtime.wake(); expect(f.counters.builds).toBe(3);
  }
  expect(done.state, JSON.stringify({ history: done.history, failure: done.failure, build: done.build?.error })).toBe('complete');
  expect(done.build.site_id).toBe(built.site_id); expect(done.build.repository.repository_path).toBe(built.repository.repository_path);
  expect(f.counters.builds).toBe(delayed ? 3 : complete ? 1 : 2); expect(f.counters.generation).toBe(0);
  expect(f.remote.get('index.html').toString()).toBe(appendCreatorCredit(html));
  expect(f.remote.get(CREATOR_LOGO_PATH)).toEqual(creatorLogoAsset().contents);
  expect(done.packet.selected_artifacts[0].source_artifact_sha256).toBe(digest(html));
  expect(done.source_mapping.creator_credit_projection).toEqual(JSON.parse(grant.payload_json).creator_credit_projection);
  if (complete) expect(f.remote.get('about.html').toString()).toBe(appendCreatorCredit(about, { page: 'about.html' }));
  expect(fs.readdirSync(f.paths.within('sites'))).toEqual([built.site_id]);
  const receipt = await a.send({ callback: done.callback_body });
  expect(receipt.status, JSON.stringify(receipt.response)).toBe(200);
  expect(receipt.row.staging_status).toBe('deployed');
  expect(receipt.row.staging_review_status).not.toBe('accepted');
  await a.send({ update: { ...input.request, page_content: [{ ...copy, body: 'Changed current customer copy.' }] } });
  expect((await a.send({ callback: envelope })).status).toBe(422);
  await a.send({ close: true }).catch(() => {});
}, 20000);
