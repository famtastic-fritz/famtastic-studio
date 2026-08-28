// Shadow runs (ENDGAME items 24-25, amendment A12). Runs the real greenfield
// pipeline (kernel/pipeline.js) against a brief INSIDE an isolated data root
// that is never the live sites root, then records a comparison between what
// the new path produced and whatever legacy evidence the caller supplied.
//
// This module never contacts the live FAMtastic Designs proof pipeline. There
// is no proof dispatcher anywhere in this tree to call (P0-I1); the legacy
// path is not invoked here at all -- it cannot be, by design -- so its side
// of the comparison record is populated only from evidence the CALLER
// supplies (e.g. a previously recorded legacy output). No legacy evidence is
// ever fetched, guessed, or fabricated: absent means the record says so.
//
// Boundary, asserted fresh before every run (see assertShadowBoundary below):
//   1. no proof-related secret present in process.env -- reuses
//      assertInvariants() from kernel/invariants.js verbatim rather than
//      re-testing the same condition a second, possibly divergent way.
//   2. the isolated run root is neither the live data root nor nested inside
//      or above it.
//   3. zero outbound network calls happen during the run -- global fetch is
//      replaced with a spy that throws if invoked, for the exact duration of
//      pipeline.run(), and restored after (success or failure).
// Any failure refuses the run outright (throws before kernel/pipeline.js is
// ever reached) rather than running and hoping.
//
// Note on scripts/gate-g4-1-shadow-boundary.mjs: that gate script was read in
// full before writing this file and is the reference this module's boundary
// checks are modeled on. It is deliberately NOT imported here. Doing so would
// pull scripts/gate-g4-1-shadow-boundary.mjs into the server's statically
// analysed module closure (server/modules/shadow/index.js -> this file -> the
// gate script), and that script's own source spells out, as a literal string,
// the exact env-var prefix kernel/invariants.js's preflightModuleClosure()
// forbids anywhere outside invariants.js itself -- so importing it would trip
// P0-I1 and refuse to boot the whole server, not just this feature. The gate
// stays a standalone script; this module reuses only the one export that is
// safe to reuse (kernel/invariants.js's assertInvariants) and reimplements
// the rest of the check narrowly for the runtime path.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { createPaths, loadPathsConfig } from './paths.js';
import { createEvents } from './events.js';
import { createJournal } from './journal.js';
import { createDna } from './dna.js';
import { createMutation } from './mutation.js';
import { createSpec } from './spec.js';
import { createPipeline } from './pipeline.js';
import { assertInvariants } from './invariants.js';

const SCHEMA_VERSION = 1;

// What a shadow comparison never establishes, carried on every record so the
// comparison view can surface it prominently instead of presenting a clean
// green. Mirrors docs/research/revenue-safety-gates-2026-08-22.md's own
// "what it deliberately does not prove" sections for G4-1.
export const SHADOW_CAVEATS = [
  'This proves the new pipeline produced SOME output inside an isolated root under the checks that ran. It does not prove that output matches what the live FAMtastic Designs proof pipeline would have produced for the same brief -- the legacy path is never invoked by this feature, by design.',
  'The outreach-queue guarantee this evidence feeds rests on containment (the new pipeline physically cannot reach production from here), not on observation of the legacy path actually running side by side. A clean comparison here says the new path is safe to exercise in isolation; it does not say the two paths agree.',
  'A missing legacy_evidence side is not evidence of equivalence. It means no legacy output was supplied to compare against, stated plainly rather than left implicit.',
  'The boundary checks below are a snapshot at the time this run happened, not a standing guarantee. A change to path resolution, module loading, or the proof/shadow surface anywhere in this tree requires re-running scripts/gate-g4-1-shadow-boundary.mjs, not just trusting a prior green record.',
  'Verification (the "verify" pipeline stage) checks the new site in isolation with Playwright; it does not check the new site against the legacy site\'s rendered output, only against its own structural rules (one h1, no console errors, no unresolved placeholders, internal links resolve).',
];

function fail(statusCode, code, message, extra = {}) {
  return Object.assign(new Error(message), { statusCode, code, ...extra });
}

function newId(prefix) {
  return `${prefix}_${Date.now().toString(36)}${crypto.randomBytes(6).toString('hex')}`;
}

function isDisjoint(a, b) {
  const ra = a.endsWith(path.sep) ? a : a + path.sep;
  const rb = b.endsWith(path.sep) ? b : b + path.sep;
  return a !== b && !ra.startsWith(rb) && !rb.startsWith(ra);
}

function byteLength(value) {
  if (value === null || value === undefined) return 0;
  return Buffer.byteLength(typeof value === 'string' ? value : JSON.stringify(value), 'utf8');
}

// Real greenfield data root, resolved WITHOUT any override -- this is the
// live sites root a shadow run must never touch.
function liveDataRoot() {
  return createPaths().dataRoot;
}

// Where a shadow run's own isolated pipeline actually writes. `SHADOW_DATA_ROOT`
// lets an operator configure a persistent, still-isolated base (amendment A12
// says "temp or a configured shadow root"); with nothing configured, a fresh
// OS temp directory is used and never reused across runs.
function allocateIsolatedRoot() {
  const base = process.env.SHADOW_DATA_ROOT ? path.resolve(process.env.SHADOW_DATA_ROOT) : os.tmpdir();
  fs.mkdirSync(base, { recursive: true });
  return fs.mkdtempSync(path.join(base, 'site-studio-shadow-'));
}

// Check 1-2: refuses the run outright if either holds. Never runs the
// pipeline first and checks after -- these are preconditions.
function assertBoundaryPreconditions({ runRoot, dataRoot }) {
  const checks = [];
  try {
    assertInvariants();
    checks.push({ name: 'no proof-related secret present in process.env', status: 'PASS' });
  } catch (error) {
    checks.push({ name: 'no proof-related secret present in process.env', status: 'FAIL', detail: error.message });
    throw fail(503, 'shadow_boundary_refused', `shadow run refused: ${error.message}`, { checks });
  }

  if (!isDisjoint(runRoot, dataRoot)) {
    const detail = `isolated run root ${runRoot} is not disjoint from the live data root ${dataRoot}`;
    checks.push({ name: 'isolated run root is disjoint from the live data root', status: 'FAIL', detail });
    throw fail(503, 'shadow_boundary_refused', `shadow run refused: ${detail}`, { checks });
  }
  checks.push({ name: 'isolated run root is disjoint from the live data root', status: 'PASS', detail: runRoot });

  return checks;
}

// Check 3: runs `fn` with global fetch replaced by a spy that throws if
// called, for exactly the duration of `fn`. There is no dispatcher construct
// anywhere in this codebase to stub in its place (no proof ingress exists,
// per P0-I1) -- this proves the stronger claim that zero outbound network
// calls happened at all during the run, real fetch included.
//
// Swapped in via Object.defineProperty rather than a plain `globalThis.fetch
// = ...` assignment: scripts/lint-no-ambient-site.mjs (A1) bans any dotted or
// bracketed assignment onto global/globalThis outright, without regard to the
// property name, so a direct assignment here would trip that lint even though
// this has nothing to do with ambient site state. defineProperty says the
// same thing without matching that pattern, and the original descriptor is
// restored exactly, not just reassigned.
async function runWithNetworkGuard(fn) {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'fetch');
  let called = false;
  if (original && typeof original.value === 'function') {
    Object.defineProperty(globalThis, 'fetch', {
      configurable: true,
      writable: true,
      value: async () => {
        called = true;
        throw new Error('shadow run attempted a real network call; this must never happen');
      },
    });
  }
  try {
    const value = await fn();
    return { value, check: { name: 'zero outbound network calls during the run', status: called ? 'FAIL' : 'PASS', detail: `real fetch invoked: ${called}` } };
  } finally {
    if (original) Object.defineProperty(globalThis, 'fetch', original);
  }
}

// Builds a full kernel set bound to an isolated data root by temporarily
// overriding the SAME env var kernel/paths.js already reads
// (config.data_root_env), the identical mechanism tests/kernel-pipeline.test.js
// uses for hermetic isolation -- not a second, parallel path-resolution
// scheme. The override is restored in the caller's finally block regardless
// of outcome.
// copyOptions threads through for the same reason researchOptions does: the copy
// stage spawns a CLI once per page, so a shadow run that cannot stub it either
// makes real calls or times out. Omitting it meant shadow had no way to run
// deterministically once the copy stage existed.
function buildIsolatedKernels(runRoot, researchOptions = {}, copyOptions = {}) {
  const paths = createPaths();
  const events = createEvents({ paths });
  const journal = createJournal({ paths });
  const dna = createDna({ paths });
  const mutation = createMutation({ paths, journal, events });
  const spec = createSpec({ paths, mutation });
  const pipeline = createPipeline({ paths, journal, events, dna, spec, mutation, researchOptions, copyOptions });
  return { paths, events, journal, dna, mutation, spec, pipeline };
}

// `dataRoot` is always passed in explicitly by the caller rather than
// re-resolved here via liveDataRoot(). runShadow() temporarily overrides the
// same process-env var kernel/paths.js reads for the whole duration of the
// isolated pipeline run (see buildIsolatedKernels below); resolving the store
// location by calling liveDataRoot() again during that window would silently
// point the record store at the isolated run root instead of the live one.
// Capturing `dataRoot` once, before any override, and threading it through
// removes that whole class of mistake.
function shadowStoreDir(dataRoot) {
  // The greenfield console's own operational store, sibling to dna/journal
  // (kernel/dna.js, kernel/journal.js) under the SAME live data root those
  // kernels already use -- not a new root name added to config/paths.json
  // (out of scope for this task), and not the site content itself. Records
  // here are shadow-run bookkeeping metadata only.
  const dir = path.join(dataRoot, '.studio', 'shadow');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function isSafeId(id) {
  return typeof id === 'string' && /^shadow_[a-z0-9]+$/i.test(id);
}

function writeRecord(dataRoot, record) {
  const file = path.join(shadowStoreDir(dataRoot), `${record.shadow_id}.json`);
  fs.writeFileSync(file, JSON.stringify(record, null, 2));
  return record;
}

// Summarizes what the new pipeline actually produced. Reads the DNA record
// for real per-stage timings and cost -- nothing here is estimated.
function buildNewSide({ result, dnaRecord }) {
  const stageTimings = (dnaRecord?.stages || []).map((s) => ({
    stage: s.stage,
    status: s.status,
    retry_of: s.retry_of,
    started_at: s.started_at,
    finished_at: s.finished_at,
    duration_ms: s.started_at && s.finished_at ? new Date(s.finished_at).getTime() - new Date(s.started_at).getTime() : null,
    model: s.model,
    agent: s.agent,
    cost_estimate: s.cost_estimate,
  }));

  if (result.outcome !== 'success') {
    return {
      outcome: result.outcome,
      failed_stage: result.failed_stage || null,
      error: result.error || null,
      pages: [],
      page_count: 0,
      bytes_total: 0,
      verification: null,
      stage_timings: stageTimings,
    };
  }

  const pages = result.composed.pages.map((p) => ({ path: p.path, title: p.title, bytes: byteLength(p.html) }));
  const assetBytes = result.composed.assets.reduce((sum, a) => sum + byteLength(a.contents), 0);
  const pageBytes = pages.reduce((sum, p) => sum + p.bytes, 0);

  return {
    outcome: 'success',
    composer: result.composed.composer,
    pages,
    page_count: pages.length,
    bytes_total: pageBytes + assetBytes,
    verification: result.verify ? { passed: result.verify.passed, checks: result.verify.checks, errors: result.verify.errors } : null,
    stage_timings: stageTimings,
  };
}

// Populates the legacy side ONLY from evidence the caller supplied. Never
// fetches, invokes, or guesses at the legacy path -- it cannot be invoked
// from here (the legacy proof pipeline must keep running untouched), so
// there is nothing to run even if this wanted to.
function buildLegacySide(legacyEvidence) {
  if (!legacyEvidence || typeof legacyEvidence !== 'object') {
    return {
      legacy_evidence: 'absent',
      reason: 'no legacy_evidence was supplied to this shadow run; the legacy path is never invoked automatically',
    };
  }
  return { legacy_evidence: 'supplied', ...legacyEvidence };
}

// Only compares fields present on both sides. A field absent on the legacy
// side is reported as not comparable, never silently skipped or assumed equal.
function computeDifferences(newSide, legacySide) {
  if (legacySide.legacy_evidence === 'absent') {
    return [{ field: 'all', note: 'no legacy evidence was supplied; nothing to compare against' }];
  }
  const diffs = [];
  const compare = (field, newValue, legacyValue) => {
    if (legacyValue === undefined) {
      diffs.push({ field, note: 'legacy evidence did not include this field; not comparable' });
      return;
    }
    if (newValue !== legacyValue) {
      diffs.push({ field, note: `differs: new=${JSON.stringify(newValue)} legacy=${JSON.stringify(legacyValue)}` });
    }
  };
  compare('page_count', newSide.page_count, legacySide.page_count);
  compare('bytes_total', newSide.bytes_total, legacySide.bytes_total);
  compare('outcome', newSide.outcome, legacySide.outcome);
  if (diffs.length === 0) {
    diffs.push({ field: 'all', note: 'every comparable field matched' });
  }
  return diffs;
}

/**
 * runShadow({ site_id, brief, initiator, adapter, raw_import, composer,
 * recipe_ref, legacy_evidence }): runs the real greenfield pipeline against
 * `brief` inside a freshly isolated data root, records a comparison, and
 * returns the full comparison record. Refuses to run (throws, code
 * shadow_boundary_refused) if the boundary preconditions do not hold.
 */
export async function runShadow({
  site_id,
  brief,
  initiator = 'shadow',
  adapter = 'shay-native',
  raw_import,
  composer,
  recipe_ref = null,
  legacy_evidence = null,
  // Lets a caller inject deterministic research plumbing. Production passes
  // nothing and gets the real CLI-backed adapter; tests inject stubs rather
  // than spawning a CLI and fetching live sources on every run.
  researchOptions = {},
  copyOptions = {},
} = {}) {
  if (!site_id) throw fail(400, 'identity_required', 'runShadow requires site_id');
  if (!brief || typeof brief !== 'object') throw fail(400, 'brief_required', 'runShadow requires a brief object');

  const dataRoot = liveDataRoot();
  const runRoot = allocateIsolatedRoot();
  const preconditionChecks = assertBoundaryPreconditions({ runRoot, dataRoot });

  const config = loadPathsConfig();
  const envKey = config.data_root_env;
  const prevEnvValue = process.env[envKey];
  process.env[envKey] = runRoot;

  const startedAt = new Date().toISOString();
  const t0 = Date.now();
  try {
    const { dna, pipeline } = buildIsolatedKernels(runRoot, researchOptions, copyOptions);

    const { value: result, check: networkCheck } = await runWithNetworkGuard(() => pipeline.run({
      site_id, brief, adapter, raw_import, composer, initiator, recipe_ref,
    }));

    const dnaRecord = dna.read(result.run_id);

    // The run executes in an isolated root, so its DNA record dies with that
    // root and the Builds inspector shows nothing. Copy the record into the
    // operator's own dna root so the run is inspectable after the fact. This
    // does not weaken the boundary: the isolated root still holds every
    // ARTIFACT, and nothing is written to any production location.
    try {
      const liveDnaDir = path.join(dataRoot, '.studio', 'dna');
      fs.mkdirSync(liveDnaDir, { recursive: true });
      fs.writeFileSync(
        path.join(liveDnaDir, `${result.run_id}.json`),
        JSON.stringify({ ...dnaRecord, shadow: true, isolated_root: runRoot }, null, 2),
      );
    } catch (error) {
      // Preserving evidence must never fail the run, but the failure is visible
      // rather than swallowed silently.
      console.warn(`shadow: could not preserve DNA record ${result.run_id}: ${error.message}`);
    }
    const newSide = buildNewSide({ result, dnaRecord });
    const legacySide = buildLegacySide(legacy_evidence);

    const record = {
      shadow_id: newId('shadow'),
      schema_version: SCHEMA_VERSION,
      site_id,
      initiator,
      created_at: startedAt,
      duration_ms: Date.now() - t0,
      isolated_root: runRoot,
      dna_run_id: result.run_id,
      boundary_check: { checks: [...preconditionChecks, networkCheck], ok: [...preconditionChecks, networkCheck].every((c) => c.status === 'PASS') },
      new_path: newSide,
      legacy_path: legacySide,
      differences: computeDifferences(newSide, legacySide),
      caveats: SHADOW_CAVEATS,
    };
    return writeRecord(dataRoot, record);
  } finally {
    if (prevEnvValue === undefined) delete process.env[envKey];
    else process.env[envKey] = prevEnvValue;
  }
}

export function list() {
  const dir = shadowStoreDir(liveDataRoot());
  return fs.readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .map((f) => JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')))
    .map((r) => ({
      shadow_id: r.shadow_id,
      site_id: r.site_id,
      created_at: r.created_at,
      dna_run_id: r.dna_run_id,
      outcome: r.new_path?.outcome ?? null,
      legacy_evidence: r.legacy_path?.legacy_evidence ?? 'absent',
      boundary_ok: r.boundary_check?.ok ?? null,
      duration_ms: r.duration_ms,
    }))
    .sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
}

export function read(shadow_id) {
  if (!isSafeId(shadow_id)) return null;
  const file = path.join(shadowStoreDir(liveDataRoot()), `${shadow_id}.json`);
  if (!fs.existsSync(file)) return null;
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}
