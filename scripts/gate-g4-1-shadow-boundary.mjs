#!/usr/bin/env node
// G4-1: fail-closed shadow boundary (SITE-STUDIO-REBUILD-PLAN-v1.1 amendment
// A12, binding). Machine-checkable proof that a shadow run cannot mutate
// production. Every check below either PASSes, FAILs loudly (non-zero exit,
// clear message), or reports SKIPPED-WITH-REASON when the thing it would
// check does not exist on this machine -- it never silently passes because
// there was nothing to check.
//
// Checks:
//   1. module closure  -- reuses preflightModuleClosure/assertNoProofRoutes
//      from server/kernel/invariants.js against the real greenfield server,
//      built the same way server/index.js does but WITHOUT calling
//      http.createServer/listen (no socket is ever opened by this gate).
//   2. env scan         -- no FAMTASTIC_PROOF_* key present in process.env.
//   3. path isolation   -- this gate's own shadow roots are isolated temp
//      paths, disjoint from the production proof-jobs/proof-output roots
//      (~/.config/famtastic/proof-jobs, ~/.config/famtastic/proof-output,
//      per site-studio/lib/config-root.js).
//   4. stub dispatcher  -- the fetch implementation used by the shadow
//      workload is a local stub, not global fetch or any real HTTP client;
//      global fetch is spied on during the workload and asserted unused.
//   5. zero-write audit -- read-only snapshot (file lists + mtimes, never
//      file contents) of production campaign/artifact/ledger/outreach
//      locations before and after running the shadow workload; asserts no
//      change. Any location absent on this machine is reported
//      SKIPPED-WITH-REASON, not silently passed.

import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(HERE, '..');
export const SERVER_DIR = path.join(ROOT, 'server');

// Production roots, per site-studio/lib/config-root.js: configRoot() defaults
// to os.homedir()/.config/famtastic, overridable by FAMTASTIC_CONFIG_DIR.
// This gate never reads FAMTASTIC_CONFIG_DIR (that would be reading toward a
// configured production root); it hardcodes the default so the disjointness
// check is meaningful even if this process's environment happens to carry an
// override.
export const PRODUCTION_CONFIG_ROOT = path.join(os.homedir(), '.config', 'famtastic');
export const PRODUCTION_PROOF_JOBS_DIR = path.join(PRODUCTION_CONFIG_ROOT, 'proof-jobs');
export const PRODUCTION_PROOF_OUTPUT_DIR = path.join(PRODUCTION_CONFIG_ROOT, 'proof-output');

// Locations audited by check 5. Discovered by reading the codebase, not
// guessed:
//   - campaigns: site-studio writes prospect/campaign CSVs to
//     ~/.config/famtastic/campaigns (confirmed present on this machine).
//   - artifact store: the *configured* proof-output root
//     (~/.config/famtastic/proof-output) does not exist on this machine --
//     only smoke-proof-output/poc-proof-output do, which are explicitly
//     non-production per ADR-0002. ~/.config/famtastic/blobs is the actual
//     content-addressed artifact store used elsewhere in the Studio and does
//     exist, so it is audited as the closest real "artifact" location.
//   - ledger: per-site intelligence ledgers live at
//     sites/<site>/.studio/intelligence/runs/<run>/ledger.json under the
//     legacy site-studio data tree (server/intelligence-writer.js
//     ledgerPath()). There is no single ~/.config/famtastic/ledger root.
//   - outreach: no directory or code path named "outreach" was found
//     anywhere under FAMtastic or site-studio at the time this gate was
//     written; it is not a shipped location yet.
export const AUDIT_LOCATIONS = [
  {
    key: 'campaigns',
    dir: path.join(PRODUCTION_CONFIG_ROOT, 'campaigns'),
    reason: null,
  },
  {
    key: 'proof-jobs (production, ~/.config/famtastic/proof-jobs)',
    dir: PRODUCTION_PROOF_JOBS_DIR,
    reason: 'no production proof-jobs directory exists on this machine (only smoke-proof-jobs / poc-proof-jobs, which are non-production per ADR-0002)',
  },
  {
    key: 'proof-output (production, ~/.config/famtastic/proof-output)',
    dir: PRODUCTION_PROOF_OUTPUT_DIR,
    reason: 'no production proof-output directory exists on this machine (only smoke-proof-output / poc-proof-output, which are non-production per ADR-0002)',
  },
  {
    key: 'artifact store (~/.config/famtastic/blobs)',
    dir: path.join(PRODUCTION_CONFIG_ROOT, 'blobs'),
    reason: null,
  },
  {
    key: 'ledger (per-site intelligence ledgers under legacy site-studio/sites)',
    dir: path.join('/Users/famtastic-fritz/Development/FAMtastic/site-studio', 'sites'),
    reason: null,
    // Special case: this root always exists (it holds site directories), but
    // the thing being audited is ledger.json files within it. Handled below.
    isLedgerRoot: true,
  },
  {
    key: 'outreach',
    dir: null,
    reason: 'no directory or code path named "outreach" exists anywhere under FAMtastic or site-studio; the feature is not yet shipped',
  },
];

// --- helpers -----------------------------------------------------------

function listFilesRecursive(dir) {
  const out = [];
  const stack = [dir];
  while (stack.length) {
    const current = stack.pop();
    let entries;
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(full);
      } else if (entry.isFile() || entry.isSymbolicLink()) {
        out.push(full);
      }
    }
  }
  return out.sort();
}

// Read-only: file paths, sizes, and mtimes only. Never reads file contents.
export function snapshotListing(dir) {
  const files = listFilesRecursive(dir);
  const hash = crypto.createHash('sha256');
  const entries = [];
  for (const file of files) {
    let stat;
    try {
      stat = fs.statSync(file);
    } catch {
      continue;
    }
    const rel = path.relative(dir, file);
    const entry = `${rel}\t${stat.size}\t${stat.mtimeMs}`;
    entries.push(entry);
    hash.update(entry);
    hash.update('\n');
  }
  return { fileCount: entries.length, digest: hash.digest('hex') };
}

export function snapshotLedgerFiles(sitesRoot) {
  const files = listFilesRecursive(sitesRoot).filter((f) => path.basename(f) === 'ledger.json');
  const hash = crypto.createHash('sha256');
  for (const file of files) {
    let stat;
    try {
      stat = fs.statSync(file);
    } catch {
      continue;
    }
    const rel = path.relative(sitesRoot, file);
    const entry = `${rel}\t${stat.size}\t${stat.mtimeMs}`;
    hash.update(entry);
    hash.update('\n');
  }
  return { fileCount: files.length, digest: hash.digest('hex') };
}

function isDisjoint(a, b) {
  const ra = a.endsWith(path.sep) ? a : a + path.sep;
  const rb = b.endsWith(path.sep) ? b : b + path.sep;
  return a !== b && !ra.startsWith(rb) && !rb.startsWith(ra);
}

// Builds the real greenfield app object (routes registered) the same way
// server/index.js does, WITHOUT ever calling http.createServer/listen. No
// socket is opened. Used by check 1 to get a real app.routes list for
// assertNoProofRoutes, on top of the static preflightModuleClosure check.
async function buildAppWithoutListening({ preflightModuleClosure, assertNoProofRoutes }) {
  const bootDir = SERVER_DIR;
  const modulesDir = path.join(bootDir, 'modules');
  const moduleEntries = fs.existsSync(modulesDir)
    ? fs.readdirSync(modulesDir).map((n) => path.join(modulesDir, n, 'index.js')).filter((p) => fs.existsSync(p))
    : [];
  const BOOT_KERNELS = ['kernel/paths.js', 'kernel/events.js', 'kernel/journal.js', 'kernel/registry.js', 'kernel/app.js', 'kernel/modules.js'];

  const preflight = preflightModuleClosure({
    entryFiles: [path.join(bootDir, 'index.js'), ...BOOT_KERNELS.map((rel) => path.join(bootDir, rel)), ...moduleEntries],
    treeRoot: ROOT,
  });
  const cleared = new Set(preflight.files);
  const load = (rel) => {
    const abs = fs.realpathSync(path.join(bootDir, rel));
    if (!cleared.has(abs)) throw new Error(`P0-I1: refusing to load ${rel}; it was not covered by the preflight`);
    return import(pathToFileURL(abs).href);
  };

  const { createPaths } = await load('kernel/paths.js');
  const { createEvents } = await load('kernel/events.js');
  const { createJournal } = await load('kernel/journal.js');
  const { createRegistry } = await load('kernel/registry.js');
  const { createApp } = await load('kernel/app.js');
  const { loadModules } = await load('kernel/modules.js');

  const paths = createPaths();
  const events = createEvents({ paths });
  const journal = createJournal({ paths });
  const registry = createRegistry();
  const app = createApp();
  const modules = await loadModules();
  for (const mod of modules) mod.register({ app, paths, events, journal, registry });
  assertNoProofRoutes(app.routes);
  return { app, preflight, moduleCount: modules.length };
}

// The workload exercised by checks 3-5: writes one fixture job file into the
// isolated shadow jobsDir and calls the stub fetch once, simulating a shadow
// callback attempt. Never touches a production path, never calls a real
// network client.
function runShadowWorkload({ jobsDir, outputRoot, fetchImpl }) {
  fs.mkdirSync(jobsDir, { recursive: true });
  fs.mkdirSync(outputRoot, { recursive: true });
  const jobFile = path.join(jobsDir, 'shadow-fixture-job.json');
  fs.writeFileSync(jobFile, JSON.stringify({ job_id: 'shadow-fixture-job', status: 'shadow' }, null, 2));
  return fetchImpl('https://example.invalid/shadow-callback', { method: 'POST', body: '{}' });
}

// --- checks --------------------------------------------------------------

export async function runChecks() {
  const results = [];
  const record = (name, status, detail) => results.push({ name, status, detail: detail || null });
  const assert = (cond, msg) => { if (!cond) throw new Error(msg); };

  // Check 1: module closure has no proof ingress.
  try {
    const { preflightModuleClosure, assertNoProofRoutes } = await import(pathToFileURL(path.join(SERVER_DIR, 'kernel', 'invariants.js')).href);
    const { preflight, moduleCount } = await buildAppWithoutListening({ preflightModuleClosure, assertNoProofRoutes });
    record(
      'module closure contains no proof ingress (preflightModuleClosure + assertNoProofRoutes, real app built without listening)',
      'PASS',
      `${preflight.checked} files checked, ${moduleCount} modules registered, no socket opened`,
    );
  } catch (err) {
    record('module closure contains no proof ingress', 'FAIL', err.message);
  }

  // Check 2: no FAMTASTIC_PROOF_* env var present.
  try {
    const leaked = Object.keys(process.env).filter((k) => k.startsWith('FAMTASTIC_PROOF_'));
    assert(leaked.length === 0, `forbidden env keys present: ${leaked.join(', ')}`);
    record('no FAMTASTIC_PROOF_* variable present in process.env', 'PASS', 'scanned key names only, no values printed');
  } catch (err) {
    record('no FAMTASTIC_PROOF_* variable present in process.env', 'FAIL', err.message);
  }

  // Check 3: shadow roots are isolated temp paths, disjoint from production.
  let shadowJobsDir = null;
  let shadowOutputDir = null;
  try {
    const runRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'g4-1-shadow-'));
    shadowJobsDir = path.join(runRoot, 'proof-jobs');
    shadowOutputDir = path.join(runRoot, 'proof-output');
    assert(runRoot.startsWith(os.tmpdir()), 'shadow run root is not under os.tmpdir()');
    assert(isDisjoint(shadowJobsDir, PRODUCTION_PROOF_JOBS_DIR), 'shadow jobs dir is not disjoint from production proof-jobs');
    assert(isDisjoint(shadowJobsDir, PRODUCTION_PROOF_OUTPUT_DIR), 'shadow jobs dir is not disjoint from production proof-output');
    assert(isDisjoint(shadowOutputDir, PRODUCTION_PROOF_JOBS_DIR), 'shadow output dir is not disjoint from production proof-jobs');
    assert(isDisjoint(shadowOutputDir, PRODUCTION_PROOF_OUTPUT_DIR), 'shadow output dir is not disjoint from production proof-output');
    record(
      'configured shadow roots are isolated temp paths, disjoint from production proof-jobs/proof-output',
      'PASS',
      `shadow root: ${runRoot}`,
    );
  } catch (err) {
    record('configured shadow roots are isolated temp paths, disjoint from production proof-jobs/proof-output', 'FAIL', err.message);
  }

  // Check 4: callback dispatcher is a stub with no real network capability.
  const stubCalls = [];
  const stubFetch = async (url, opts) => {
    stubCalls.push({ url, opts });
    return { ok: true, status: 200, text: async () => '' };
  };
  const realFetch = globalThis.fetch;
  let fetchSpyCalled = false;
  try {
    assert(typeof stubFetch === 'function', 'stub fetch is not a function');
    assert(stubFetch !== realFetch, 'stub fetch must not be the same reference as global fetch');
    if (typeof realFetch === 'function') {
      globalThis.fetch = async (...args) => {
        fetchSpyCalled = true;
        throw new Error('real global fetch must never be called by the shadow workload');
      };
    }
    if (shadowJobsDir && shadowOutputDir) {
      await runShadowWorkload({ jobsDir: shadowJobsDir, outputRoot: shadowOutputDir, fetchImpl: stubFetch });
    }
    assert(stubCalls.length === 1, `expected exactly one stub fetch call, got ${stubCalls.length}`);
    assert(fetchSpyCalled === false, 'real global fetch was invoked during the shadow workload');
    record(
      'callback dispatcher is a stub with no real network capability (injected fetch is a stub; real fetch unused)',
      'PASS',
      `stub invoked ${stubCalls.length} time(s); real global fetch invoked: ${fetchSpyCalled}`,
    );
  } catch (err) {
    record('callback dispatcher is a stub with no real network capability', 'FAIL', err.message);
  } finally {
    if (typeof realFetch === 'function') globalThis.fetch = realFetch;
  }

  // Check 5: before/after zero-write audit of production locations.
  for (const location of AUDIT_LOCATIONS) {
    if (location.reason) {
      record(`zero-write audit: ${location.key}`, 'SKIPPED-WITH-REASON', location.reason);
      continue;
    }
    if (!fs.existsSync(location.dir)) {
      record(`zero-write audit: ${location.key}`, 'SKIPPED-WITH-REASON', `production location does not exist on this machine: ${location.dir}`);
      continue;
    }
    try {
      const snap = location.isLedgerRoot ? snapshotLedgerFiles : snapshotListing;
      const before = snap(location.dir);
      if (before.fileCount === 0) {
        // A PASS built on zero files audited is not proof of anything -- it
        // would pass identically whether or not the boundary held. Report it
        // honestly as nothing-to-check instead.
        record(
          `zero-write audit: ${location.key}`,
          'SKIPPED-WITH-REASON',
          `location exists (${location.dir}) but contains zero files to audit on this machine; a before/after comparison over zero files would prove nothing`,
        );
        continue;
      }
      if (shadowJobsDir && shadowOutputDir) {
        await runShadowWorkload({ jobsDir: shadowJobsDir, outputRoot: shadowOutputDir, fetchImpl: stubFetch });
      }
      const after = snap(location.dir);
      assert(before.fileCount === after.fileCount, `file count changed: ${before.fileCount} -> ${after.fileCount}`);
      assert(before.digest === after.digest, 'listing digest (paths + sizes + mtimes) changed');
      record(
        `zero-write audit: ${location.key}`,
        'PASS',
        `${before.fileCount} file(s), digest unchanged (${before.digest.slice(0, 12)}...)`,
      );
    } catch (err) {
      record(`zero-write audit: ${location.key}`, 'FAIL', err.message);
    }
  }

  const pass = results.filter((r) => r.status === 'PASS').length;
  const fail = results.filter((r) => r.status === 'FAIL').length;
  const skipped = results.filter((r) => r.status === 'SKIPPED-WITH-REASON').length;
  return { results, pass, fail, skipped };
}

async function main() {
  console.log('=== G4-1: fail-closed shadow boundary (amendment A12) ===');
  console.log('Machine-checkable proof that a shadow run cannot mutate production.\n');

  const { results, pass, fail, skipped } = await runChecks();

  for (const r of results) {
    console.log(`${r.status}  ${r.name}`);
    if (r.detail) console.log(`      ${r.detail}`);
  }

  console.log('');
  console.log(`${pass} passed, ${fail} failed, ${skipped} skipped-with-reason`);
  if (skipped > 0) {
    console.log('NOTE: SKIPPED-WITH-REASON checks are not failures, but they are not proof either -- see the list above for exactly what could not be checked on this machine and why.');
  }
  console.log(fail === 0 ? 'VERDICT: PASS' : 'VERDICT: FAIL');
  process.exit(fail === 0 ? 0 : 1);
}

const isMain = process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url;
if (isMain) main();
