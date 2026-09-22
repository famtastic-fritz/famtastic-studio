#!/usr/bin/env node
// Explicit hosted transport smoke. Uses a wholly synthetic customer/source and
// captures callbacks locally. Never registers a production request or sends mail.
import fs from 'node:fs';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fixture, packet } from '../tests/staging-worker-fixture.mjs';
import { createCpanelHttpTransport } from '../server/kernel/cpanel-http-transport.js';
import { createCpanelReview } from '../server/kernel/cpanel-review.js';
import { createStagingWorker } from '../server/kernel/staging-worker.js';

if (!process.argv.includes('--apply')) {
  console.log('No changes. --apply creates only selected-handoff-smoke-20260918 under famtasticinc.com, protected before synthetic content. Callback capture only; no agency request/mail.');
  process.exit(0);
}
const name = 'selected-handoff-smoke-20260918';
const dir = `/home/nineoo/public_html/${name}`;
const authFile = `/home/nineoo/.famtastic-review/${name}.htpasswd`;
const credentialProvider = async () => execFileSync('security', ['find-generic-password', '-s', 'famtastic-platform', '-a', 'studio.cpanel.api_token', '-w'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
async function api(route, params = {}, body) {
  const url = new URL(`https://famtasticinc.com:2083/${route}`);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, String(value));
  const response = await fetch(url, { method: body ? 'POST' : 'GET', body, redirect: 'error', signal: AbortSignal.timeout(45000), headers: { Authorization: `cpanel nineoo:${await credentialProvider()}` } });
  if (response.status !== 200) throw new Error('smoke_api_http_failed');
  const value = await response.json(); return value.cpanelresult || value;
}
const parent = await api('execute/Fileman/list_files', { dir: '/home/nineoo/public_html', show_hidden: 1 });
if (parent.status !== 1 || parent.data.some(row => row.file === name)) throw new Error('smoke_target_exists_requires_reconciliation');
const authParent = await api('execute/Fileman/list_files', { dir: '/home/nineoo/.famtastic-review', show_hidden: 1 });
if (authParent.status !== 1 || authParent.data.some(row => row.file === `${name}.htpasswd`)) throw new Error('smoke_auth_exists_requires_reconciliation');
const f = fixture();
const password = crypto.randomBytes(32).toString('base64url');
const hash = execFileSync('openssl', ['passwd', '-apr1', '-stdin'], { input: password, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
const reviewAuthorization = `Basic ${Buffer.from(`review:${password}`).toString('base64')}`;
fs.writeFileSync(`${f.root}/hosted-access.json`, JSON.stringify({ reviewAuthorization, authFile, target: dir }), { mode: 0o600, flag: 'wx' });
console.log(JSON.stringify({ phase: 'private_evidence_root', path: f.root, synthetic: true }));
const mkdir = await api('json-api/cpanel', { cpanel_jsonapi_user: 'nineoo', cpanel_jsonapi_apiversion: 2, cpanel_jsonapi_module: 'Fileman', cpanel_jsonapi_func: 'mkdir', path: '/home/nineoo/public_html', name, permissions: '0755' });
if (mkdir.event?.result !== 1) throw new Error('smoke_mkdir_failed');
const authForm = new FormData(); authForm.set('dir', '/home/nineoo/.famtastic-review'); authForm.set('overwrite', '0'); authForm.set('file-1', new Blob([`review:${hash}\n`]), `${name}.htpasswd`);
const uploaded = await api('execute/Fileman/upload_files', {}, authForm);
if (uploaded.status !== 1 || uploaded.data?.failed) throw new Error('smoke_auth_upload_failed');
const binding = { ...f.binding, url: `https://famtasticinc.com/${name}/`, target_path: dir, remote_subdirectory: name, host_aliases: ['www.famtasticinc.com', 'mbsh96reunion.com'] };
const transport = createCpanelHttpTransport({ paths: f.paths, journal: f.journal, binding, credentialProvider, reviewAuthorization, authFile });
const host = createCpanelReview({ paths: f.paths, journal: f.journal, binding, transport });
const p = packet();
p.continuation.hosting_target = { staging_url: binding.url, target_path: dir, remote_subdirectory: name };
const job = f.store.accept(p);
const callbacks = [];
const worker = createStagingWorker({ ...f.options(), host, callback: async receipt => { callbacks.push(receipt); return { ok: true }; } });
try {
  const result = await worker.run(job.id);
  const evidence = { schema: 'famtastic.selected-hosting-smoke.v1', classification: 'synthetic-source-real-cpanel-transport', provider_calls: true, customer_data: false, agency_callback: false, mail: false, result, callbacks };
  fs.writeFileSync(`${f.root}/hosted-proof.json`, JSON.stringify(evidence, null, 2), { mode: 0o600 });
  console.log(JSON.stringify({ evidence: `${f.root}/hosted-proof.json`, state: result.state, stage: result.stage, failure: result.failure || null, last: result.history.at(-1), hosted: result.host?.verified === true, source_builds: f.counters.builds, callbacks_captured: callbacks.length }));
  if (result.state !== 'complete' || result.failure || result.host?.verified !== true) process.exitCode = 1;
} finally { f.store.close(); }
// Retain the scoped source, private access data and journal for browser proof
// and recovery. Do not call fixture.cleanup(): a hosted receipt needs its source.
