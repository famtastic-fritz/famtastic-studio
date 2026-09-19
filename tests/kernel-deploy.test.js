import { creditedHtml, writeFixtureLogo } from './helpers/credited-fixture.js';
// FAMtasticInc deploy adapter (ADR-0003, amendment A7): publishable-set
// filtering, copy-then-verify-then-publish deploys, rollback with a real
// manifest-hash oracle plus an active-pointer oracle, go-live recording
// (never mutating DNS, never fabricating evidence), the `live` denominator
// fed by real receipts, root containment, and cross-site isolation.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createPaths, loadPathsConfig } from '../server/kernel/paths.js';
import { createJournal } from '../server/kernel/journal.js';
import { createEvents } from '../server/kernel/events.js';
import { createDeploy } from '../server/kernel/deploy.js';
import { classify } from '../server/kernel/site.js';

let tmpRoot;
let prevEnvValue;
const config = loadPathsConfig();

beforeEach(() => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-next-deploy-'));
  prevEnvValue = process.env[config.data_root_env];
  process.env[config.data_root_env] = tmpRoot;
});

afterEach(() => {
  if (prevEnvValue === undefined) delete process.env[config.data_root_env];
  else process.env[config.data_root_env] = prevEnvValue;
  fs.rmSync(tmpRoot, { recursive: true, force: true });
  vi.restoreAllMocks();
});

function catchError(fn) {
  try {
    fn();
    return null;
  } catch (error) {
    return error;
  }
}

function setup() {
  const paths = createPaths();
  const journal = createJournal({ paths });
  const events = createEvents({ paths });
  const deploy = createDeploy({ paths, journal, events });
  return { paths, journal, events, deploy };
}

function makeSiteFiles(paths, siteId, spec, files = { 'index.html': '<title>Home</title><body>v1</body>' }) {
  const dir = paths.within('sites', siteId);
  fs.mkdirSync(dir, { recursive: true });
  if (spec !== undefined) {
    fs.writeFileSync(path.join(dir, 'spec.json'), JSON.stringify(spec, null, 2));
  }
  for (const [rel, contents] of Object.entries(files)) {
    const abs = path.join(dir, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, rel.endsWith('.html') && !rel.startsWith('docs/') ? creditedHtml(contents, rel) : contents);
  }
  if (Object.keys(files).some(file => file.endsWith('.html'))) writeFixtureLogo(dir);
  return dir;
}

describe('deploy publishable set', () => {
  it('excludes spec.json, conversation.jsonl, and dot-directory paths from the manifest and the copied bytes', () => {
    const { paths, deploy } = setup();
    makeSiteFiles(paths, 'site-a', { customer: { id: 'cust-1' } }, {
      'index.html': '<h1>home</h1>', 'conversation.jsonl': '{"role":"user"}\n', '.studio/notes.json': '{"internal":true}',
      'AGENTS.md': 'Private agent instructions', 'docs/research/proof.html': '<p>Not public</p>',
      'package.json': '{}', 'package-lock.json': '{}', 'design-dna.json': '{}', 'blueprint.json': '{}', 'backend/handler.php': '<?php',
    });
    const receipt = deploy.deploy({ site_id: 'site-a', initiator: 'operator' });
    const shipped = receipt.manifest.map((m) => m.path).sort();

    expect(shipped).toEqual(['assets/brand/famtastic-designs-logo-v1.png', 'index.html']);
    expect(fs.existsSync(path.join(receipt.target, 'spec.json'))).toBe(false);
    expect(fs.existsSync(path.join(receipt.target, 'conversation.jsonl'))).toBe(false);
    expect(fs.existsSync(path.join(receipt.target, '.studio'))).toBe(false);
  });
});

describe('deploy.deploy', () => {
  it('produces a complete receipt and journals before the copy is visible', () => {
    const { paths, journal, deploy } = setup();
    makeSiteFiles(paths, 'site-a', { customer: { id: 'cust-1' } });

    const receipt = deploy.deploy({ site_id: 'site-a', initiator: 'operator' });

    expect(receipt.receipt_id).toBeTruthy();
    expect(receipt.site_id).toBe('site-a');
    expect(receipt.provider).toBe('famtasticinc');
    expect(receipt.target).toBeTruthy();
    expect(receipt.prior_target).toBeNull();
    expect(receipt.manifest.length).toBeGreaterThan(0);
    expect(receipt.manifest[0].sha256).toBeTruthy();
    expect(receipt.manifest_hash).toBeTruthy();
    expect(receipt.timestamp).toBeTruthy();
    expect(receipt.initiator).toBe('operator');
    expect(typeof receipt.source_revision).toBe('number');

    // journaled
    const entries = journal.read('site-a');
    const deployEntry = entries.find((e) => e.intent === 'deploy');
    expect(deployEntry).toBeTruthy();
    expect(deployEntry.result.receipt_id).toBe(receipt.receipt_id);

    // and the bytes actually landed at the target
    const deployedIndex = fs.readFileSync(path.join(receipt.target, 'index.html'), 'utf8');
    expect(deployedIndex).toContain('v1');
  });

  it('the published bytes hash to exactly the receipt manifest_hash', () => {
    const { paths, deploy } = setup();
    makeSiteFiles(paths, 'site-a', { customer: { id: 'cust-1' } }, { 'index.html': '<h1>home</h1>', 'assets/app.css': 'body{color:#111}' });
    const receipt = deploy.deploy({ site_id: 'site-a', initiator: 'operator' });
    const verification = deploy.verify('site-a', receipt.receipt_id);

    expect(verification.ok).toBe(true);
    expect(verification.actual_hash).toBe(receipt.manifest_hash);
    expect(verification.expected_hash).toBe(receipt.manifest_hash);
  });

  it('leaves no success receipt and journals the failure honestly when the copy fails partway through', () => {
    const { paths, journal, deploy } = setup();
    makeSiteFiles(paths, 'site-a', { customer: { id: 'cust-1' } }, { 'index.html': '<h1>home</h1>', 'about.html': '<h1>about</h1>' });

    // Fail the second file written into the temp copy target, simulating a
    // disk error partway through the copy.
    let calls = 0;
    const realWriteFileSync = fs.writeFileSync;
    const spy = vi.spyOn(fs, 'writeFileSync').mockImplementation((...args) => {
      calls += 1;
      if (calls === 2) throw new Error('simulated disk full');
      return realWriteFileSync(...args);
    });

    const caught = catchError(() => deploy.deploy({ site_id: 'site-a', initiator: 'operator' }));
    spy.mockRestore();

    expect(caught).not.toBeNull();
    expect(caught.code).toBe('deploy_copy_failed');

    // no receipt, and no leftover temp/final target dirs under famtasticinc
    expect(deploy.list('site-a').receipts).toHaveLength(0);
    expect(fs.existsSync(paths.within('deploys', 'site-a'))).toBe(false);
    const famRoot = paths.within('famtasticinc', 'site-a');
    if (fs.existsSync(famRoot)) expect(fs.readdirSync(famRoot)).toHaveLength(0);

    // the failure itself is journaled honestly, not as a success
    const entries = journal.read('site-a');
    const failureEntry = entries.find((e) => e.intent === 'deploy');
    expect(failureEntry).toBeTruthy();
    expect(failureEntry.result.status).toBe('deploy_failed');
    expect(failureEntry.result.status).not.toBe('deployed');
  });

  it('never writes the receipt or the target files when the journal is unavailable', () => {
    const { paths, events } = setup();
    makeSiteFiles(paths, 'site-a', { customer: { id: 'cust-1' } });
    const brokenJournal = { append() { throw new Error('disk full'); }, read() { return []; } };
    const deploy = createDeploy({ paths, journal: brokenJournal, events });

    const caught = catchError(() => deploy.deploy({ site_id: 'site-a', initiator: 'operator' }));

    expect(caught).not.toBeNull();
    expect(caught.statusCode).toBe(503);
    expect(caught.code).toBe('journal_unavailable');
    expect(fs.existsSync(paths.within('deploys', 'site-a'))).toBe(false);
    // The proven temp copy is cleaned up when the journal refuses; no named
    // receipt target directory is left behind under famtasticinc.
    const famRoot = paths.within('famtasticinc', 'site-a');
    const leftover = fs.existsSync(famRoot) ? fs.readdirSync(famRoot) : [];
    expect(leftover).toHaveLength(0);
  });

  it('sets spec.deploy.target so the site becomes deployable', () => {
    const { paths, deploy } = setup();
    makeSiteFiles(paths, 'site-a', { customer: { id: 'cust-1' } });

    expect(classify(paths.within('sites', 'site-a'))).toBe('customer');

    const receipt = deploy.deploy({ site_id: 'site-a', initiator: 'operator' });

    const spec = JSON.parse(fs.readFileSync(paths.within('sites', 'site-a', 'spec.json'), 'utf8'));
    expect(spec.deploy.target).toBe(receipt.target);
    expect(classify(paths.within('sites', 'site-a'))).toBe('deployable');
  });

  it('refuses a deploy target that would escape the famtasticinc root', () => {
    const { deploy } = setup();
    const caught = catchError(() => deploy.deploy({ site_id: '../../etc', initiator: 'operator' }));
    expect(caught).not.toBeNull();
    expect(caught.code).toBe('path_not_allowed');
  });

  it('throws 404 site_not_found for a site with no directory', () => {
    const { deploy } = setup();
    const caught = catchError(() => deploy.deploy({ site_id: 'ghost', initiator: 'operator' }));
    expect(caught).not.toBeNull();
    expect(caught.statusCode).toBe(404);
    expect(caught.code).toBe('site_not_found');
  });

  it('links a second deploy to the first via prior_target and prior_receipt_id', () => {
    const { paths, deploy } = setup();
    makeSiteFiles(paths, 'site-a', { customer: { id: 'cust-1' } });
    const first = deploy.deploy({ site_id: 'site-a', initiator: 'operator' });

    fs.writeFileSync(paths.within('sites', 'site-a', 'index.html'), creditedHtml('<title>Home</title><body>v2</body>'));
    const second = deploy.deploy({ site_id: 'site-a', initiator: 'operator' });

    expect(second.prior_target).toBe(first.target);
    expect(second.prior_receipt_id).toBe(first.receipt_id);
    expect(second.target).not.toBe(first.target);
  });

  it('never touches the active-release pointer', () => {
    const { paths, deploy } = setup();
    makeSiteFiles(paths, 'site-a', { customer: { id: 'cust-1' } });
    deploy.deploy({ site_id: 'site-a', initiator: 'operator' });
    expect(deploy.readActivePointer('site-a')).toBeNull();
  });
});

describe('deploy.rollback', () => {
  it('restores the prior target exactly, verified by a recomputed manifest hash', () => {
    const { paths, journal, deploy } = setup();
    makeSiteFiles(paths, 'site-a', { customer: { id: 'cust-1' } });
    const first = deploy.deploy({ site_id: 'site-a', initiator: 'operator' });

    fs.writeFileSync(paths.within('sites', 'site-a', 'index.html'), creditedHtml('<title>Home</title><body>v2 broken</body>'));
    const second = deploy.deploy({ site_id: 'site-a', initiator: 'operator' });

    const result = deploy.rollback({ site_id: 'site-a', receipt_id: second.receipt_id, initiator: 'operator' });

    expect(result.restored_receipt_id).toBe(first.receipt_id);
    expect(result.verification.ok).toBe(true);
    expect(result.verification.actual_hash).toBe(first.manifest_hash);

    const restored = fs.readFileSync(path.join(first.target, 'index.html'), 'utf8');
    expect(restored).toContain('v1');

    const entries = journal.read('site-a');
    const rollbackEntry = entries.find((e) => e.intent === 'deploy.rollback');
    expect(rollbackEntry).toBeTruthy();
    expect(rollbackEntry.result.restored_receipt_id).toBe(first.receipt_id);
  });

  it('switches the active pointer back to the restored receipt and verifies it landed', () => {
    const { paths, deploy } = setup();
    makeSiteFiles(paths, 'site-a', { customer: { id: 'cust-1' } });
    const first = deploy.deploy({ site_id: 'site-a', initiator: 'operator' });
    fs.writeFileSync(paths.within('sites', 'site-a', 'index.html'), creditedHtml('<title>Home</title><body>v2</body>'));
    const second = deploy.deploy({ site_id: 'site-a', initiator: 'operator' });

    deploy.goLive({ site_id: 'site-a', receipt_id: second.receipt_id, dns_evidence: 'operator confirmed A record', initiator: 'operator' });
    expect(deploy.readActivePointer('site-a').receipt_id).toBe(second.receipt_id);

    const result = deploy.rollback({ site_id: 'site-a', receipt_id: second.receipt_id, initiator: 'operator' });

    expect(result.active_pointer.receipt_id).toBe(first.receipt_id);
    const pointer = deploy.readActivePointer('site-a');
    expect(pointer.receipt_id).toBe(first.receipt_id);
    // rollback does not fabricate a fresh DNS check
    expect(pointer.verified_at).toBeNull();
    expect(pointer.environment).toBeNull();
  });

  it('fails the manifest-hash check when a file is tampered with after rollback', () => {
    const { paths, deploy } = setup();
    makeSiteFiles(paths, 'site-a', { customer: { id: 'cust-1' } });
    const first = deploy.deploy({ site_id: 'site-a', initiator: 'operator' });
    fs.writeFileSync(paths.within('sites', 'site-a', 'index.html'), creditedHtml('<title>Home</title><body>v2</body>'));
    const second = deploy.deploy({ site_id: 'site-a', initiator: 'operator' });

    deploy.rollback({ site_id: 'site-a', receipt_id: second.receipt_id, initiator: 'operator' });

    // tamper the just-restored file directly on disk
    fs.writeFileSync(path.join(first.target, 'index.html'), 'TAMPERED, does not match the receipt');

    const verification = deploy.verify('site-a', first.receipt_id);
    expect(verification.ok).toBe(false);
    expect(verification.mismatches.some((m) => m.reason === 'content_mismatch')).toBe(true);
    expect(verification.actual_hash).not.toBe(verification.expected_hash);
  });

  it('throws 422 no_prior_deploy when the receipt has no earlier deploy to roll back to', () => {
    const { paths, deploy } = setup();
    makeSiteFiles(paths, 'site-a', { customer: { id: 'cust-1' } });
    const only = deploy.deploy({ site_id: 'site-a', initiator: 'operator' });

    const caught = catchError(() => deploy.rollback({ site_id: 'site-a', receipt_id: only.receipt_id, initiator: 'operator' }));
    expect(caught).not.toBeNull();
    expect(caught.statusCode).toBe(422);
    expect(caught.code).toBe('no_prior_deploy');
  });
});

describe('deploy.goLive', () => {
  it('switches the active pointer, records real evidence, and makes classify() report live when dns_evidence is supplied', () => {
    const { paths, deploy } = setup();
    makeSiteFiles(paths, 'site-a', { customer: { id: 'cust-1' } });
    const receipt = deploy.deploy({ site_id: 'site-a', initiator: 'operator' });

    expect(classify(paths.within('sites', 'site-a'))).toBe('deployable');
    expect(deploy.readActivePointer('site-a')).toBeNull();

    const result = deploy.goLive({
      site_id: 'site-a',
      receipt_id: receipt.receipt_id,
      dns_evidence: 'A record acme.com -> 203.0.113.10, confirmed by operator',
      initiator: 'operator',
    });

    expect(result.canonical_target).toBe(receipt.target);
    expect(result.receipt_id).toBe(receipt.receipt_id);
    expect(result.verification.ok).toBe(true);
    expect(result.verified_at).toBeTruthy();
    expect(result.environment).toBe('production');
    expect(result.active_pointer.receipt_id).toBe(receipt.receipt_id);

    const spec = JSON.parse(fs.readFileSync(paths.within('sites', 'site-a', 'spec.json'), 'utf8'));
    expect(spec.deploy.canonical_target).toBe(receipt.target);
    expect(spec.deploy.receipt.target).toBe(receipt.target);
    expect(spec.deploy.receipt.environment).toBe('production');
    expect(spec.deploy.receipt.verified_at).toBeTruthy();
    expect(spec.deploy.receipt.dns_evidence).toBe('A record acme.com -> 203.0.113.10, confirmed by operator');

    const pointer = deploy.readActivePointer('site-a');
    expect(pointer.receipt_id).toBe(receipt.receipt_id);
    expect(pointer.environment).toBe('production');

    expect(classify(paths.within('sites', 'site-a'))).toBe('live');
  });

  it('records dns_evidence as absent honestly, switches the pointer, but never fabricates environment or verified_at', () => {
    const { paths, deploy } = setup();
    makeSiteFiles(paths, 'site-a', { customer: { id: 'cust-1' } });
    const receipt = deploy.deploy({ site_id: 'site-a', initiator: 'operator' });

    const result = deploy.goLive({ site_id: 'site-a', receipt_id: receipt.receipt_id, initiator: 'operator' });

    expect(result.dns_evidence).toBe('absent');
    expect(result.environment).toBeNull();
    expect(result.verified_at).toBeNull();

    const spec = JSON.parse(fs.readFileSync(paths.within('sites', 'site-a', 'spec.json'), 'utf8'));
    expect(spec.deploy.receipt.dns_evidence).toBe('absent');
    expect(spec.deploy.receipt.environment).toBeNull();
    expect(spec.deploy.receipt.verified_at).toBeNull();
    expect(spec.deploy.receipt.dns_evidence_reason).toBeTruthy();

    const pointer = deploy.readActivePointer('site-a');
    expect(pointer.receipt_id).toBe(receipt.receipt_id);
    expect(pointer.dns_evidence).toBe('absent');

    // honest classification: not live without genuine DNS evidence, even
    // though the release is the active pointer
    expect(classify(paths.within('sites', 'site-a'))).not.toBe('live');
  });

  it('writes only the site spec.json plus append-only journal/pointer artifacts as a side effect -- never mutates DNS', () => {
    const { paths, deploy } = setup();
    makeSiteFiles(paths, 'site-a', { customer: { id: 'cust-1' } });
    const receipt = deploy.deploy({ site_id: 'site-a', initiator: 'operator' });
    const before = fs.readdirSync(paths.dataRoot, { recursive: true }).sort();

    deploy.goLive({ site_id: 'site-a', receipt_id: receipt.receipt_id, dns_evidence: 'manual check', initiator: 'operator' });

    const after = fs.readdirSync(paths.dataRoot, { recursive: true }).sort();
    const added = after.filter((p) => !before.includes(p));
    expect(added.every((p) => p.endsWith('.jsonl') || p.endsWith('.lock') || p.endsWith('active.json'))).toBe(true);
  });

  it('throws 404 deploy_receipt_not_found when receipt_id does not match a real receipt', () => {
    const { paths, deploy } = setup();
    makeSiteFiles(paths, 'site-a', { customer: { id: 'cust-1' } });
    deploy.deploy({ site_id: 'site-a', initiator: 'operator' });

    const caught = catchError(() => deploy.goLive({ site_id: 'site-a', receipt_id: 'dep_does_not_exist', initiator: 'operator' }));
    expect(caught).not.toBeNull();
    expect(caught.statusCode).toBe(404);
    expect(caught.code).toBe('deploy_receipt_not_found');
  });

  it('refuses go-live when the deployed target has drifted from its receipt', () => {
    const { paths, deploy } = setup();
    makeSiteFiles(paths, 'site-a', { customer: { id: 'cust-1' } });
    const receipt = deploy.deploy({ site_id: 'site-a', initiator: 'operator' });

    fs.writeFileSync(path.join(receipt.target, 'index.html'), 'drifted after deploy, before go-live');

    const caught = catchError(() => deploy.goLive({ site_id: 'site-a', receipt_id: receipt.receipt_id, dns_evidence: 'manual check', initiator: 'operator' }));
    expect(caught).not.toBeNull();
    expect(caught.statusCode).toBe(409);
    expect(caught.code).toBe('go_live_verification_failed');
  });
});

describe('cross-site isolation of receipts', () => {
  it('keeps deploy.list scoped to one site', () => {
    const { paths, deploy } = setup();
    makeSiteFiles(paths, 'site-a', { customer: { id: 'cust-1' } });
    makeSiteFiles(paths, 'site-b', { customer: { id: 'cust-2' } });
    const receiptA = deploy.deploy({ site_id: 'site-a', initiator: 'operator' });
    const receiptB = deploy.deploy({ site_id: 'site-b', initiator: 'operator' });

    const listA = deploy.list('site-a');
    const listB = deploy.list('site-b');
    expect(listA.receipts.map((r) => r.receipt_id)).toEqual([receiptA.receipt_id]);
    expect(listB.receipts.map((r) => r.receipt_id)).toEqual([receiptB.receipt_id]);
  });

  it('refuses to rollback or read a receipt across a site boundary', () => {
    const { paths, deploy } = setup();
    makeSiteFiles(paths, 'site-a', { customer: { id: 'cust-1' } });
    makeSiteFiles(paths, 'site-b', { customer: { id: 'cust-2' } });
    const receiptA = deploy.deploy({ site_id: 'site-a', initiator: 'operator' });

    const caught = catchError(() => deploy.read(receiptA.receipt_id, { site_id: 'site-b' }));
    expect(caught).not.toBeNull();
    expect(caught.statusCode).toBe(404);
    expect(caught.code).toBe('deploy_receipt_not_found');

    const caughtRollback = catchError(() => deploy.rollback({ site_id: 'site-b', receipt_id: receiptA.receipt_id, initiator: 'operator' }));
    expect(caughtRollback).not.toBeNull();
    expect(caughtRollback.statusCode).toBe(404);
    expect(caughtRollback.code).toBe('deploy_receipt_not_found');
  });

  it('finds a receipt by id without a site_id hint, scanning every site directory', () => {
    const { paths, deploy } = setup();
    makeSiteFiles(paths, 'site-a', { customer: { id: 'cust-1' } });
    const receiptA = deploy.deploy({ site_id: 'site-a', initiator: 'operator' });

    const found = deploy.read(receiptA.receipt_id);
    expect(found.receipt_id).toBe(receiptA.receipt_id);
    expect(found.site_id).toBe('site-a');
  });
});

describe('confirmation without dispatch (PROVE item 8)', () => {
  it('plan reports what would happen and writes nothing at all', () => {
    const { paths, deploy } = setup();
    const siteId = 'site-plan';
    makeSiteFiles(paths, siteId, undefined, { 'index.html': '<h1>hi</h1>', 'a.css': 'body{}' });

    const rootBefore = fs.existsSync(paths.root('famtasticinc'))
      ? fs.readdirSync(paths.root('famtasticinc')).sort().join(',') : '(absent)';
    const plan = deploy.plan({ site_id: siteId });
    const rootAfter = fs.existsSync(paths.root('famtasticinc'))
      ? fs.readdirSync(paths.root('famtasticinc')).sort().join(',') : '(absent)';

    expect(plan.would_deploy).toBe(true);
    expect(plan.dispatched, 'a plan must never dispatch').toBe(false);
    expect(plan.file_count).toBe(3); // HTML, CSS and exact creator PNG.
    expect(plan.manifest_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(rootAfter, 'planning must leave the deploy root untouched').toBe(rootBefore);
    expect(deploy.list(siteId).receipts, 'a plan must not create a receipt').toHaveLength(0);
  });

  it('the plan hash matches what the real deploy then produces', () => {
    const { paths, deploy } = setup();
    const siteId = 'site-plan-match';
    makeSiteFiles(paths, siteId, undefined, { 'index.html': '<h1>hi</h1>' });
    const plan = deploy.plan({ site_id: siteId });
    const receipt = deploy.deploy({ site_id: siteId, initiator: 'test' });
    expect(receipt.manifest_hash, 'a plan that predicts a different result is worthless').toBe(plan.manifest_hash);
  });

  it('reports honestly when there is nothing to deploy', () => {
    const { paths, deploy } = setup();
    makeSiteFiles(paths, 'site-empty-plan', undefined, {});
    const plan = deploy.plan({ site_id: 'site-empty-plan' });
    expect(plan.would_deploy).toBe(false);
    expect(plan.reason).toMatch(/no built output/);
  });

  it('plan also honestly reports nothing to deploy for a site with only operational files', () => {
    const { paths, deploy } = setup();
    makeSiteFiles(paths, 'site-only-operational', { customer: { id: 'cust-1' } }, {});
    const plan = deploy.plan({ site_id: 'site-only-operational' });
    expect(plan.would_deploy).toBe(false);
  });
});
