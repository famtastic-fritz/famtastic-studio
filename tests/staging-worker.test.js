import crypto from 'node:crypto';
import fs from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import { fixture, packet, html } from './staging-worker-fixture.mjs';
import { createStagingWorker, materializeSelection } from '../server/kernel/staging-worker.js';
import { createStagingStore } from '../server/kernel/staging-store.js';
import { createCpanelReview } from '../server/kernel/cpanel-review.js';
import { appendCreatorCredit } from '../vendor/site-foundation/index.js';
let f;
afterEach(() => f?.cleanup());
describe('durable selected continuation', () => {
  it('real pipeline packages selected bytes with zero providers then mock cPanel and signed callback', async () => {
    f = fixture(); const job = f.store.accept(packet());
    const done = await f.worker().run(job.id);
    expect(done.failure).toBeUndefined();
    expect(done.state).toBe('complete');
    expect(f.counters).toMatchObject({ generation: 0, builds: 1, uploads: 2, callbacks: 1, backups: 1 });
    expect(f.remote.get('index.html').toString()).toBe(appendCreatorCredit(html));
    expect(done.packet.selected_artifacts[0].source_artifact_sha256).toBe(packet().artifacts[0].sha256);
    expect(done.qa.creator_credit_transform.original_approval_unchanged).toBe(true);
    expect(f.remote.has('.famtastic/creator-credit-transform.json')).toBe(false);
    const raw = f.callbackBodies[0];
    expect(raw.headers['X-FAMtastic-Signature']).toBe(`sha256=${crypto.createHmac('sha256', 'synthetic-callback-secret').update(raw.body).digest('hex')}`);
    expect(JSON.parse(raw.body)).toMatchObject({ customer_accepted: false, checkout_eligible: false, final_launch: false, customer_id: 'customer-1', selection_revision: 1 });
    expect(f.wire).toContain('execute/Fileman/upload_files');
    expect(f.dna.read(done.build.run_id).replay_manifest.source_commit).toBeTruthy();
    f.restart(); await f.worker().run(f.store.accept(packet()).id);
    expect(f.counters.builds).toBe(1); expect(f.counters.callbacks).toBe(1);
  });
  it('callback timeout resumes only callback with identical bytes after restart', async () => {
    f = fixture(); f.controls.callbackFails = true;
    const job = f.store.accept(packet()); expect((await f.worker().run(job.id)).state).toBe('retry');
    f.restart(); f.controls.callbackFails = false; expect((await f.worker().run(job.id)).state).toBe('complete');
    expect(f.counters.builds).toBe(1); expect(f.counters.uploads).toBe(2);
    expect(f.callbackBodies[0].body).toBe(f.callbackBodies[1].body);
  });
  it('rejects changed payload, stale revision, cross account and simultaneous project claim', () => {
    f = fixture(); const p = packet(), job = f.store.accept(p);
    expect(() => f.store.accept({ ...p, extra: true })).toThrow('idempotency_conflict');
    const next = structuredClone(p); next.packet_id = 'p2'; next.idempotency_key = 'i2';
    expect(() => f.store.accept(next)).toThrow('stale_selection_revision');
    next.continuation.selection_revision = 2; next.continuation.customer.id = 'other';
    expect(() => f.store.accept(next)).toThrow('identity_conflict');
    const claim = f.store.claim(job.id), other = createStagingStore({ paths: f.paths, journal: f.journal });
    expect(() => other.claim(job.id)).toThrow('project_busy'); other.close(); f.store.release(job, claim.token);
  });
  it('QA failures never upload or send success and retries do not rebuild', async () => {
    f = fixture(); f.controls.qaFails = true; const j = f.store.accept(packet());
    await f.worker().run(j.id); await f.worker().run(j.id); const done = await f.worker().run(j.id);
    expect(done.state).toBe('exception'); expect(f.counters.builds).toBe(1); expect(f.counters.uploads).toBe(0);
    expect(JSON.parse(f.callbackBodies[0].body).schema).toBe('famtastic.site-studio.staging-failure.v1');
  });
  it('failed HTTPS verification restores backup, then retries hosting only', async () => {
    f = fixture(); f.controls.probeFails = true; const j = f.store.accept(packet());
    expect((await f.worker().run(j.id)).state).toBe('retry'); expect(f.remote.size).toBe(0); expect(f.counters.callbacks).toBe(0);
    f.restart(); f.controls.probeFails = false; expect((await f.worker().run(j.id)).state).toBe('complete'); expect(f.counters.builds).toBe(1);
  });
  it('refuses unknown scope and stale bytes before any site write', async () => {
    f = fixture(); const p = packet(); p.continuation.spec.capability_class = 'application';
    const done = await f.worker().run(f.store.accept(p).id); expect(done.failure.code).toBe('continuation_not_executable'); expect(f.counters.builds).toBe(0);
    const opts = f.options(); opts.fetchArtifact = async () => Buffer.from('tampered');
    await expect(materializeSelection(packet(), opts)).rejects.toThrow('artifact_digest_mismatch');
  });
  it('does not replay an interrupted ambiguous build', async () => {
    f = fixture(); const j = f.store.accept(packet()), claim = f.store.claim(j.id);
    j.stage = 'build'; j.state = 'running'; f.store.checkpoint(j, claim.token); f.store.release(j, claim.token); f.restart();
    const done = await f.worker().run(j.id); expect(done.failure.code).toBe('interrupted_build_requires_reconciliation'); expect(f.counters.builds).toBe(0);
  });
  it('Studio-origin without an authority mapping never creates a second repository', async () => {
    f = fixture(); const p = packet(); p.continuation.initiating_system = 'studio';
    expect((await f.worker().run(f.store.accept(p).id)).failure.code).toBe('source_repository_mapping_required');
    expect(f.counters.generation).toBe(0); expect(f.counters.builds).toBe(0); expect(f.remote.size).toBe(0);
  });
  it('rejects a wrong host binding and missing source page', async () => {
    f = fixture(); expect(() => createCpanelReview({ paths: f.paths, journal: f.journal, transport: f.transport, binding: { ...f.binding, url: 'https://famtasticdesigns.com/' } })).toThrow('review_target_invalid');
    const p = packet(); p.continuation.required_pages.push('about.html');
    await expect(materializeSelection(p, f.options())).rejects.toThrow('continuation_not_executable');
  });
});

it('rejects stale completion evidence and incomplete revision intent', async () => {
  f = fixture(); const p = packet(); p.continuation.completed_stages = [{ stage: 'source_build', artifact_manifest_sha256: '0'.repeat(64), design_contract_sha256: '0'.repeat(64), evidence_ref: 'stale' }];
  await expect(materializeSelection(p, f.options())).rejects.toThrow('continuation_not_executable');
  p.continuation.completed_stages = []; p.continuation.operation = 'continue_build'; p.continuation.requested_changes = ['Add working booking'];
  await expect(materializeSelection(p, f.options())).rejects.toThrow('continuation_not_executable');
  expect(f.counters.generation).toBe(0);
});
it('new revision suppresses queued prior callback and retains independent source', async () => {
  f = fixture(); f.controls.callbackFails = true; const one = f.store.accept(packet()); await f.worker().run(one.id);
  const p = packet(); p.packet_id = 'packet-2'; p.idempotency_key = 'idem-2'; p.continuation.selection_revision = 2; p.continuation.operation = 'package_existing';
  const two = f.store.accept(p); f.controls.callbackFails = false;
  expect((await f.worker().run(one.id)).state).toBe('superseded');
  const next = await f.worker().run(two.id);
  expect(next.state, JSON.stringify({ failure: next.failure, history: next.history, qa: next.qa?.problems })).toBe('complete');
  expect(f.remote.get('index.html').toString()).toBe(appendCreatorCredit(html)); expect(f.counters.generation).toBe(0);
});
it('partial upload failure retains no ready claim and resumes without another build', async () => {
  f = fixture(); f.controls.uploadFails = true; const job = f.store.accept(packet());
  expect((await f.worker().run(job.id)).state).toBe('retry'); expect(f.counters.callbacks).toBe(0);
  f.controls.uploadFails = false; expect((await f.worker().run(job.id)).state).toBe('complete'); expect(f.counters.builds).toBe(1);
});
