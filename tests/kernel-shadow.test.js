// Shadow run kernel tests (ENDGAME items 24-25, amendment A12). Drives the
// REAL greenfield pipeline through server/kernel/shadow.js exactly as
// server/modules/shadow/index.js does -- no kernel logic reimplemented here.
//
// Two data roots are isolated per test, on purpose:
//   - `liveRoot`: stands in for the real greenfield data root. shadow.js's
//     own disjointness check compares its allocated run root against this.
//   - the run root shadow.js allocates internally (os.tmpdir()-based, or
//     SHADOW_DATA_ROOT-based) for the actual pipeline execution.
// Both are real temp directories, never the checked-out repo's own
// .studio-next-data.
import { stubResearchOptions } from './research-stub.mjs';
import { makeCopyStub } from './copy-stub.mjs';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadPathsConfig } from '../server/kernel/paths.js';
import { runShadow, list, read, SHADOW_CAVEATS } from '../server/kernel/shadow.js';

const config = loadPathsConfig();
const envKey = config.data_root_env;

let liveRoot;
let prevEnvValue;
let prevShadowDataRoot;
let ownedShadowRoot;

beforeEach(() => {
  liveRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-next-shadow-live-'));
  prevEnvValue = process.env[envKey];
  process.env[envKey] = liveRoot;
  // Each test gets its own SHADOW_DATA_ROOT base so runs from different tests
  // never share a parent directory, even transiently.
  prevShadowDataRoot = process.env.SHADOW_DATA_ROOT;
  ownedShadowRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-next-shadow-base-'));
  process.env.SHADOW_DATA_ROOT = ownedShadowRoot;
});

afterEach(() => {
  if (prevEnvValue === undefined) delete process.env[envKey];
  else process.env[envKey] = prevEnvValue;
  if (prevShadowDataRoot === undefined) delete process.env.SHADOW_DATA_ROOT;
  else process.env.SHADOW_DATA_ROOT = prevShadowDataRoot;
  fs.rmSync(liveRoot, { recursive: true, force: true });
  fs.rmSync(ownedShadowRoot, { recursive: true, force: true });
  expect(fs.existsSync(liveRoot)).toBe(false);
  expect(fs.existsSync(ownedShadowRoot)).toBe(false);
});

function honestBrief(overrides = {}) {
  return {
    business: { name: 'Shadow Bakery', description: 'A test bakery for shadow runs.' },
    site_needs: { pages: ['home', 'about', 'contact'], offers: ['Sourdough'], ctas: ['Order now'] },
    ...overrides,
  };
}

describe('shadow: a real run produces a real site inside an isolated root', () => {
  it('runs research -> spec -> compose -> build -> verify -> record and records a comparison', async () => {
    const record = await runShadow({ site_id: 'shadow-bakery', brief: honestBrief(), researchOptions: stubResearchOptions, copyOptions: makeCopyStub() });

    expect(record.shadow_id).toBeTruthy();
    expect(record.site_id).toBe('shadow-bakery');
    expect(record.dna_run_id).toBeTruthy();
    console.log('shadow_id:', record.shadow_id, 'dna_run_id:', record.dna_run_id, 'isolated_root:', record.isolated_root);

    // Boundary held for the whole run.
    expect(record.boundary_check.ok).toBe(true);
    for (const check of record.boundary_check.checks) expect(check.status).toBe('PASS');

    // The isolated root is real, and disjoint from the live root.
    expect(record.isolated_root.startsWith(os.tmpdir())).toBe(true);
    expect(record.isolated_root).not.toBe(liveRoot);
    expect(record.isolated_root.startsWith(liveRoot)).toBe(false);
    expect(liveRoot.startsWith(record.isolated_root)).toBe(false);

    // A real site landed on disk under the isolated root, not the live root.
    const siteDir = path.join(record.isolated_root, 'sites', 'shadow-bakery');
    const tree = fs.readdirSync(siteDir).sort();
    console.log('shadow-produced file tree:', tree);
    expect(tree).toContain('index.html');
    expect(tree).toContain('about.html');
    expect(tree).toContain('spec.json');
    expect(fs.existsSync(path.join(liveRoot, 'sites', 'shadow-bakery'))).toBe(false);

    // New-path comparison side is populated for real.
    expect(record.new_path.outcome).toBe('success');
    expect(record.new_path.page_count).toBe(3);
    expect(record.new_path.bytes_total).toBeGreaterThan(0);
    expect(record.new_path.verification.passed).toBe(true);
    expect(record.new_path.stage_timings.length).toBeGreaterThan(0);

    // Caveats travel on every record, verbatim from the module's own list.
    expect(record.caveats).toEqual(SHADOW_CAVEATS);
    expect(record.caveats.length).toBeGreaterThan(0);
  });
});

describe('shadow: fail-closed boundary refusal', () => {
  it('refuses to run when a proof-related env var is present, before touching the pipeline', async () => {
    const forbiddenKey = ['FAMTASTIC', 'PROOF_TEST'].join('_');
    process.env[forbiddenKey] = 'x';
    try {
      await expect(runShadow({ site_id: 'shadow-refused', brief: honestBrief(), researchOptions: stubResearchOptions, copyOptions: makeCopyStub() }))
        .rejects.toMatchObject({ code: 'shadow_boundary_refused' });
    } finally {
      delete process.env[forbiddenKey];
    }

    // Nothing was recorded -- the refusal happened before any run started.
    expect(list().find((r) => r.site_id === 'shadow-refused')).toBeUndefined();
  });

  it('requires site_id and a brief object', async () => {
    await expect(runShadow({ brief: honestBrief() })).rejects.toMatchObject({ code: 'identity_required' });
    await expect(runShadow({ site_id: 'x' })).rejects.toMatchObject({ code: 'brief_required' });
  });
});

describe('shadow: legacy_evidence honesty', () => {
  it('records legacy_evidence: absent with a reason when none is supplied', async () => {
    const record = await runShadow({ site_id: 'shadow-no-legacy', brief: honestBrief(), researchOptions: stubResearchOptions, copyOptions: makeCopyStub() });
    expect(record.legacy_path.legacy_evidence).toBe('absent');
    expect(record.legacy_path.reason).toBeTruthy();
    expect(record.differences).toEqual([{ field: 'all', note: expect.stringContaining('no legacy evidence') }]);
  });

  it('never fabricates a legacy side to make the comparison look complete', async () => {
    // No legacy_evidence is EVER derived from the run itself -- confirm the
    // legacy side carries none of the new side's own values as if they were
    // independently observed.
    const record = await runShadow({ site_id: 'shadow-no-legacy-2', brief: honestBrief(), researchOptions: stubResearchOptions, copyOptions: makeCopyStub() });
    expect(record.legacy_path.page_count).toBeUndefined();
    expect(record.legacy_path.bytes_total).toBeUndefined();
    expect(record.legacy_path.outcome).toBeUndefined();
  });

  it('records legacy_evidence: supplied and computes real differences when evidence is given', async () => {
    const record = await runShadow({
      site_id: 'shadow-with-legacy',
      brief: honestBrief(),
      legacy_evidence: { page_count: 2, bytes_total: 500, outcome: 'success', source: 'recorded prior legacy output (test fixture)' },
      researchOptions: stubResearchOptions,
      copyOptions: makeCopyStub(),
    });
    expect(record.legacy_path.legacy_evidence).toBe('supplied');
    expect(record.legacy_path.page_count).toBe(2);

    const pageCountDiff = record.differences.find((d) => d.field === 'page_count');
    expect(pageCountDiff).toBeTruthy();
    expect(pageCountDiff.note).toMatch(/differs/);

    const outcomeDiff = record.differences.find((d) => d.field === 'outcome');
    expect(outcomeDiff).toBeFalsy(); // both sides report 'success'
  });
});

describe('shadow: list() and read()', () => {
  it('lists recorded runs and reads one back by id, refusing an unsafe id', async () => {
    const record = await runShadow({ site_id: 'shadow-listed', brief: honestBrief(), researchOptions: stubResearchOptions, copyOptions: makeCopyStub() });

    const summaries = list();
    const found = summaries.find((r) => r.shadow_id === record.shadow_id);
    expect(found).toBeTruthy();
    expect(found.site_id).toBe('shadow-listed');
    expect(found.legacy_evidence).toBe('absent');

    const full = read(record.shadow_id);
    expect(full.dna_run_id).toBe(record.dna_run_id);
    expect(full.new_path.page_count).toBe(record.new_path.page_count);

    expect(read('not-a-real-id')).toBeNull();
    expect(read('../../etc/passwd')).toBeNull();
  });
});
