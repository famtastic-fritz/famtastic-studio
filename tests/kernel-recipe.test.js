import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createPaths, loadPathsConfig } from '../server/kernel/paths.js';
import { createDna } from '../server/kernel/dna.js';
import { createRecipe } from '../server/kernel/recipe.js';

let tmpRoot;
let prevEnvValue;
const config = loadPathsConfig();

beforeEach(() => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-next-recipe-'));
  prevEnvValue = process.env[config.data_root_env];
  process.env[config.data_root_env] = tmpRoot;
});

afterEach(() => {
  if (prevEnvValue === undefined) delete process.env[config.data_root_env];
  else process.env[config.data_root_env] = prevEnvValue;
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

function makeKernels() {
  const paths = createPaths();
  const dna = createDna({ paths });
  const recipe = createRecipe({ paths, dna });
  return { paths, dna, recipe };
}

const STAGE_GRAPH = [
  { stage: 'research', depends_on: [] },
  { stage: 'generate', depends_on: ['research'] },
  { stage: 'verify', depends_on: ['generate'] },
];

function runFullPipeline(dna, { site_id = 'site-a' } = {}) {
  const { run_id } = dna.startRun({
    site_id,
    recipe_ref: null,
    research_packet_ref: 'packet_1',
    source_commit: 'abc1234',
    tree_hash: 'tree5678',
    recipe_snapshot: { stack_directives: ['drupal+react-front'] },
    stage_graph: STAGE_GRAPH,
    model_tool_versions: { model: 'claude-sonnet-5' },
  });
  dna.recordStage({
    run_id,
    stage: 'research',
    prompt_template: 'research/v1',
    prompt_snapshot: 'Research {{topic}} for {{site}}',
    model: 'claude-sonnet-5',
    agent: 'research-agent',
    verification: { passed: true },
    status: 'success',
  });
  dna.recordStage({
    run_id,
    stage: 'generate',
    prompt_template: 'generate/v1',
    prompt_snapshot: 'Generate a page for {{site}} using {{packet}}',
    model: 'claude-sonnet-5',
    agent: 'generate-agent',
    verification: { passed: true },
    status: 'success',
  });
  dna.recordStage({
    run_id,
    stage: 'verify',
    prompt_template: 'verify/v1',
    prompt_snapshot: 'Verify the page for {{site}}',
    model: 'claude-sonnet-5',
    agent: 'verify-agent',
    verification: { passed: true },
    verifier_version: 'v1',
    status: 'success',
  });
  dna.finishRun({ run_id, outcome: 'success' });
  return run_id;
}

describe('createRecipe: fromRun ("save as recipe")', () => {
  it('derives a runnable recipe with ordered stages, prompt templates, and variables', () => {
    const { dna, recipe } = makeKernels();
    const run_id = runFullPipeline(dna);

    const saved = recipe.fromRun(run_id, { name: 'basic page recipe' });
    expect(saved.recipe_id).toBeTruthy();
    expect(saved.version).toBe(1);
    expect(saved.source_run_id).toBe(run_id);
    expect(saved.stages.map((s) => s.stage)).toEqual(['research', 'generate', 'verify']);
    expect(saved.stages[1].depends_on).toEqual(['research']);
    expect(saved.stages[1].variables).toEqual(expect.arrayContaining(['site', 'packet']));
    expect(saved.stages[0].model).toBe('claude-sonnet-5');
    expect(saved.stages[0].agent).toBe('research-agent');
    expect(saved.verification_requirements.length).toBe(3);
  });

  it('rejects a run with no stage_graph', () => {
    const { dna, recipe } = makeKernels();
    expect(() => recipe.fromRun('run_nonexistent')).toThrow();
  });
});

describe('createRecipe: versioning never overwrites', () => {
  it('write() always produces a new version file, never overwriting an existing one', () => {
    const { dna, recipe } = makeKernels();
    const run_id = runFullPipeline(dna);
    const v1 = recipe.fromRun(run_id, { name: 'iterated recipe' });
    expect(v1.version).toBe(1);

    const secondRunId = runFullPipeline(dna, { site_id: 'site-b' });
    const v2 = recipe.fromRun(secondRunId, { name: 'iterated recipe v2', recipe_id: v1.recipe_id });
    expect(v2.version).toBe(2);
    expect(v2.recipe_id).toBe(v1.recipe_id);

    // Both versions remain readable independently; v1's content is untouched.
    const readV1 = recipe.read(v1.recipe_id, 1);
    const readV2 = recipe.read(v1.recipe_id, 2);
    expect(readV1.name).toBe('iterated recipe');
    expect(readV2.name).toBe('iterated recipe v2');
    expect(readV1.source_run_id).toBe(run_id);
    expect(readV2.source_run_id).toBe(secondRunId);
  });

  it('read() with no version returns the latest version', () => {
    const { dna, recipe } = makeKernels();
    const run_id = runFullPipeline(dna);
    const v1 = recipe.fromRun(run_id);
    const secondRunId = runFullPipeline(dna, { site_id: 'site-b' });
    recipe.fromRun(secondRunId, { recipe_id: v1.recipe_id });

    const latest = recipe.read(v1.recipe_id);
    expect(latest.version).toBe(2);
  });

  it('list() reports every recipe with its version history', () => {
    const { dna, recipe } = makeKernels();
    const run_id = runFullPipeline(dna);
    recipe.fromRun(run_id, { name: 'listed recipe' });

    const listed = recipe.list();
    expect(listed.length).toBe(1);
    expect(listed[0].versions).toEqual([1]);
    expect(listed[0].latest_version).toBe(1);
    expect(listed[0].name).toBe('listed recipe');
  });

  it('write() requires recipe_id', () => {
    const { recipe } = makeKernels();
    expect(() => recipe.write({ name: 'no id' })).toThrow();
  });
});

describe('createRecipe: rerun contract is graph equality plus verification, never output equality', () => {
  it('accepts a rerun with the same stage graph, new inputs, and every stage verified', () => {
    const { dna, recipe } = makeKernels();
    const originalRunId = runFullPipeline(dna, { site_id: 'site-a' });
    const saved = recipe.fromRun(originalRunId, { name: 'rerun-checked recipe' });

    // A rerun against declared NEW inputs (different site, different prompt
    // content) but the identical stage graph shape.
    const { run_id: rerunId } = dna.startRun({
      site_id: 'site-c',
      recipe_ref: saved.recipe_id,
      research_packet_ref: 'packet_2',
      source_commit: 'def4567',
      tree_hash: 'tree8901',
      stage_graph: STAGE_GRAPH,
    });
    dna.recordStage({ run_id: rerunId, stage: 'research', prompt_snapshot: 'Research something entirely different', verification: { passed: true }, status: 'success' });
    dna.recordStage({ run_id: rerunId, stage: 'generate', prompt_snapshot: 'Generate a wholly different page', verification: { passed: true }, status: 'success' });
    dna.recordStage({ run_id: rerunId, stage: 'verify', verification: { passed: true }, status: 'success' });
    const rerunRecord = dna.read(rerunId);

    const result = recipe.isVerifiedRerun(saved, rerunRecord);
    expect(result.verified).toBe(true);
    // The whole point: different prompt content / model output between the
    // original run and the rerun is fine and is never compared.
    expect(rerunRecord.stages[0].prompt_snapshot).not.toBe(
      dna.read(originalRunId).stages[0].prompt_snapshot,
    );
  });

  it('rejects a rerun whose stage graph shape differs from the recipe', () => {
    const { dna, recipe } = makeKernels();
    const originalRunId = runFullPipeline(dna);
    const saved = recipe.fromRun(originalRunId);

    const { run_id: rerunId } = dna.startRun({
      site_id: 'site-c',
      source_commit: 'def4567',
      tree_hash: 'tree8901',
      stage_graph: [{ stage: 'research', depends_on: [] }, { stage: 'generate', depends_on: ['research'] }], // missing verify
    });
    dna.recordStage({ run_id: rerunId, stage: 'research', verification: { passed: true }, status: 'success' });
    dna.recordStage({ run_id: rerunId, stage: 'generate', verification: { passed: true }, status: 'success' });

    const result = recipe.isVerifiedRerun(saved, dna.read(rerunId));
    expect(result.verified).toBe(false);
    expect(result.reason).toBe('stage_graph_shape_mismatch');
  });

  it('rejects a rerun where a stage never reaches its verification requirement', () => {
    const { dna, recipe } = makeKernels();
    const originalRunId = runFullPipeline(dna);
    const saved = recipe.fromRun(originalRunId);

    const { run_id: rerunId } = dna.startRun({
      site_id: 'site-c',
      source_commit: 'def4567',
      tree_hash: 'tree8901',
      stage_graph: STAGE_GRAPH,
    });
    dna.recordStage({ run_id: rerunId, stage: 'research', verification: { passed: true }, status: 'success' });
    dna.recordStage({ run_id: rerunId, stage: 'generate', verification: { passed: false }, status: 'failed', error: 'quality gate failed' });
    dna.recordStage({ run_id: rerunId, stage: 'verify', verification: { passed: true }, status: 'success' });

    const result = recipe.isVerifiedRerun(saved, dna.read(rerunId));
    expect(result.verified).toBe(false);
    expect(result.reason, 'an explicit verification failure now reports as such').toBe('stage_verification_failed:generate');
  });
});

describe('a rerun cannot certify a stage that failed its own verifier', () => {
  // The check was verification.passed === true OR status === 'success', so a
  // contradictory record certified itself. Found by the M2 gate.
  const recipeOf = (stage) => ({ stages: [{ stage, depends_on: [] }] });
  const rerunOf = (stage, attempt) => ({
    replay_manifest: { stage_graph: [{ stage, depends_on: [] }] },
    stages: [{ stage, ...attempt }],
  });

  it('refuses when verification explicitly failed even though status says success', () => {
    const { recipe } = makeKernels();
    const result = recipe.isVerifiedRerun(
      recipeOf('compose'),
      rerunOf('compose', { status: 'success', verification: { passed: false } }),
    );
    expect(result.verified).toBe(false);
    expect(result.reason).toMatch(/verification_failed/);
  });

  it('refuses a stage whose status is failed', () => {
    const { recipe } = makeKernels();
    const result = recipe.isVerifiedRerun(
      recipeOf('compose'),
      rerunOf('compose', { status: 'failed', verification: { passed: true } }),
    );
    expect(result.verified).toBe(false);
  });

  it('still accepts a genuinely verified stage', () => {
    const { recipe } = makeKernels();
    const result = recipe.isVerifiedRerun(
      recipeOf('compose'),
      rerunOf('compose', { status: 'success', verification: { passed: true } }),
    );
    expect(result.verified).toBe(true);
  });
});
