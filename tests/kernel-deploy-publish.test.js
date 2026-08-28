// Deploy publish-failure cases. Split from kernel-deploy.test.js for the size rule.
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
    fs.writeFileSync(abs, contents);
  }
  return dir;
}

describe('a publish failure leaves no evidence of a deploy that did not land', () => {
  // The success journal and receipt were persisted BEFORE the final rename, so a
  // rename or receipt-write failure left durable "deployed" evidence with no
  // published target. Found by the M2 gate, round 2.
  it('journals deploy_failed and persists no receipt when the publish rename fails', () => {
    const { paths, deploy, journal } = setup();
    makeSiteFiles(paths, 'site-pub', undefined, { 'index.html': '<h1>v1</h1>' });

    const spy = vi.spyOn(fs, 'renameSync').mockImplementation(() => {
      throw new Error('simulated rename failure');
    });
    let threw = false;
    try { deploy.deploy({ site_id: 'site-pub', initiator: 'test' }); } catch { threw = true; }
    spy.mockRestore();

    expect(threw, 'a failed publish must throw, not return quietly').toBe(true);
    expect(deploy.list('site-pub').receipts, 'no receipt may survive a failed publish').toHaveLength(0);

    const entries = journal.read('site-pub');
    const statuses = entries.map((e) => e.result?.status);
    expect(statuses, 'the failure must be recorded').toContain('deploy_failed');
    expect(statuses, 'nothing may claim deployed when nothing was published').not.toContain('deployed');
  });

  it('a successful deploy still journals deployed exactly once, after the bytes land', () => {
    const { paths, deploy, journal } = setup();
    makeSiteFiles(paths, 'site-ok', undefined, { 'index.html': '<h1>v1</h1>' });
    const receipt = deploy.deploy({ site_id: 'site-ok', initiator: 'test' });
    const deployed = journal.read('site-ok').filter((e) => e.result?.status === 'deployed');
    expect(deployed).toHaveLength(1);
    expect(fs.existsSync(receipt.target), 'the target must exist when deployed is recorded').toBe(true);
  });
});

describe('a receipt-write failure is cleaned up, not swallowed', () => {
  // The gate found removeReceipt calling a helper that does not exist, with the
  // error swallowed, so a partially written receipt could survive a failed
  // publish. The rename-only test could not reach that path.
  it('leaves no receipt and no deployed claim when persisting the receipt throws', () => {
    const { paths, deploy, journal } = setup();
    makeSiteFiles(paths, 'site-rw', undefined, { 'index.html': '<h1>v1</h1>' });

    const realWrite = fs.writeFileSync;
    const spy = vi.spyOn(fs, 'writeFileSync').mockImplementation((file, data, opts) => {
      if (String(file).includes('receipt') || String(file).endsWith('.json')) {
        // Simulate a receipt that starts landing and then fails.
        realWrite(file, '{"partial":true');
        throw new Error('simulated receipt write failure');
      }
      return realWrite(file, data, opts);
    });
    let threw = false;
    try { deploy.deploy({ site_id: 'site-rw', initiator: 'test' }); } catch { threw = true; }
    spy.mockRestore();

    expect(threw).toBe(true);
    expect(deploy.list('site-rw').receipts, 'a partial receipt must not survive').toHaveLength(0);
    const statuses = journal.read('site-rw').map((e) => e.result?.status);
    expect(statuses).toContain('deploy_failed');
    expect(statuses, 'nothing may claim deployed').not.toContain('deployed');
  });

  it('a failure while journaling success is also cleaned up', () => {
    const { paths, deploy, journal } = setup();
    makeSiteFiles(paths, 'site-jf', undefined, { 'index.html': '<h1>v1</h1>' });
    let calls = 0;
    const realAppend = journal.append.bind(journal);
    const spy = vi.spyOn(journal, 'append').mockImplementation((entry) => {
      calls += 1;
      if (entry.result?.status === 'deployed') throw new Error('simulated success journal failure');
      return realAppend(entry);
    });
    let threw = false;
    try { deploy.deploy({ site_id: 'site-jf', initiator: 'test' }); } catch { threw = true; }
    spy.mockRestore();
    expect(threw, 'a failure recording success must not be silently ignored').toBe(true);
    expect(deploy.list('site-jf').receipts).toHaveLength(0);
    expect(calls).toBeGreaterThan(0);
  });
});
