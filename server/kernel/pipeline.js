// The pipeline (ENDGAME items 8-12, plan 2.1): research -> spec -> compose ->
// build -> verify -> record. Orchestrates the existing kernels
// (kernel/research.js, kernel/dna.js, kernel/recipe.js, kernel/spec.js,
// kernel/mutation.js) plus compose.js/verify.js. Does not reimplement any of them.
//
// DNA recording is unconditional (D7): every stage, success or failure, goes
// through dna.recordStage(). A failed stage never aborts the run silently --
// finishRun() is always called with an honest outcome, and the failed stage
// stays inspectable and retryable via retryStage() (recordStage's retry_of).
//
// Model routing (item 8): MODEL_ROUTING is DATA, not branching logic. With no
// provider connected, every stage honestly records model: 'none'; compose
// additionally records which composer ran (agent). SEAM: wire a provider by
// editing this table and the relevant executor, never the stage sequence.
//
// Amendment A4 (replay manifest): a successful run's DNA record must be a
// real replay manifest, not a plausible-looking shell -- content-derived
// tree_hash, real digests on every artifact ref, a real research_packet_ref
// the moment the packet exists, a resolved recipe snapshot or an explicit
// null-with-reason, and explicit zero usage/cost for the no-provider stages
// this build runs. A run never finishes success with any of that missing;
// assertManifestComplete() below fails the run loudly instead.
import path from 'node:path';
import { slugify, titleCase } from './pipeline-text.js';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { runResearch } from './research.js';
import { runBatch as runBatchImpl } from './pipeline-batch.js';
import { makeExecutors } from './pipeline-executors.js';
import { DEFAULT_BATCH_CONCURRENCY, MAX_BATCH_CONCURRENCY } from './pipeline-constants.js';
import { createRepositoryLifecycle } from './repository-lifecycle.js';
import { exportFinalizedSource } from './source-finalization.js';

// Re-exported so existing importers of pipeline.js keep working.
export { DEFAULT_BATCH_CONCURRENCY, MAX_BATCH_CONCURRENCY };
import { readPacket } from './packet.js';
import { composeSite, DEFAULT_COMPOSER } from './compose.js';
import { verifySite } from './verify.js';

// Imported for local use AND re-exported: `export ... from` alone creates no
// local binding, so the call site below had nothing to call.
import { deriveSpecFromPacket } from './spec-derive.js';

export { deriveSpecFromPacket };

export const STAGES = ['research', 'spec', 'compose', 'build', 'verify', 'record'];

export const MODEL_ROUTING = {
  // The claude CLI IS connected and does real live lookups (WebSearch/WebFetch,
  // roughly 100-120s per run). Recording model 'none' here was true when written
  // and became a false claim on the DNA proof surface the moment research went
  // live. The CLI selects and does not report back its own model, so that is
  // recorded as 'cli-selected' rather than guessed or flattened to 'none' --
  // the same honest-non-reporting discipline A4 already requires for usage/cost.
  research: { model: 'cli-selected', agent: 'claude-cli', note: 'the shay-native adapter spawns the claude CLI with WebSearch and WebFetch and independently re-fetches every cited source; the CLI selects its own model and does not report it' },
  // The spec STAGE is no longer model-free, even though spec DERIVATION still is.
  // The copy stage and the imagery adapter both run inside it, and the copy
  // stage spawns a CLI once per page. Recording model 'none' here was true when
  // written and became a false claim on the DNA proof surface the moment copy
  // was wired -- the identical failure already corrected for research, and it
  // means every cost and premium-brain-share figure computed from this field has
  // been understated. 'cli-selected' is the same honest-non-reporting form:
  // the CLI picks its own model and does not report it back.
  spec: { model: 'cli-selected', agent: 'claude-cli', note: 'spec derivation itself is deterministic, but the copy stage inside this stage spawns the claude CLI once per page (bounded fan-out) and the imagery adapter runs here too; the CLI selects its own model and does not report it' },
  compose: { model: 'none', agent: 'deterministic', note: 'no model-backed composer is connected; deterministic templates only. SEAM: add a composer name to compose.js COMPOSERS plus a branch in composeSite() to plug one in' },
  build: { model: 'none', agent: null, note: 'file writes only, no generation' },
  verify: { model: 'none', agent: null, note: 'Playwright browser verification, no model' },
  record: { model: 'none', agent: null, note: 'DNA bookkeeping only' },
};

function fail(statusCode, code, message) {
  return Object.assign(new Error(message), { statusCode, code });
}



function buildStageGraph() {
  return STAGES.map((stage, i) => ({ stage, depends_on: i === 0 ? [] : [STAGES[i - 1]] }));
}

const treeRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

// Content-derived tree identity for the DNA replay manifest (A4). The prior
// version hashed `git status --porcelain`, a SUMMARY of what changed --
// two dirty trees with different edits to the same files produce an
// IDENTICAL porcelain summary (same paths, same status letters), so they
// hashed the same. This hashes the actual working-tree bytes of every
// tracked file (plus untracked-but-not-ignored files, real content too), in
// path order, so any content difference produces a different hash. Falls
// back to a clearly-labeled, honestly non-content hash only when git itself
// is unavailable (e.g. a hermetic temp root with no .git).
export function resolveTreeIdentity() {
  let source_commit = 'unknown-commit';
  try {
    source_commit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: treeRoot, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim() || 'unknown-commit';
  } catch {
    // not a git repo, or git unavailable here; the fallback below is honest, not guessed.
  }

  let tree_hash;
  try {
    const tracked = execFileSync('git', ['ls-files', '-z'], { cwd: treeRoot, stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 1024 * 1024 * 64 })
      .toString('utf8').split('\0').filter(Boolean);
    const untracked = execFileSync('git', ['ls-files', '-z', '--others', '--exclude-standard'], { cwd: treeRoot, stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 1024 * 1024 * 64 })
      .toString('utf8').split('\0').filter(Boolean);
    const allPaths = [...new Set([...tracked, ...untracked])].sort();

    const hash = crypto.createHash('sha256');
    for (const relPath of allPaths) {
      const absPath = path.join(treeRoot, relPath);
      let content;
      try {
        content = fs.readFileSync(absPath);
      } catch {
        // Tracked path no longer exists on disk (deleted but not yet staged);
        // record that as content, not as a skip, so a delete still changes
        // the hash the same way a content edit would.
        content = Buffer.from(`__missing_on_disk__`);
      }
      hash.update(relPath, 'utf8');
      hash.update('\0');
      hash.update(content);
      hash.update('\0');
    }
    tree_hash = hash.digest('hex');
  } catch {
    // git itself unavailable (e.g. a hermetic temp root with no .git): an
    // honest, clearly non-content fallback rather than a value that looks
    // like a real content hash but is not one.
    tree_hash = crypto.createHash('sha256').update(`no-git-tree-identity:${source_commit}:${treeRoot}`).digest('hex');
  }

  return { source_commit, tree_hash };
}

// resolveRecipeSnapshot (A4): a resolved snapshot when recipe_ref names a
// real, readable recipe, or an EXPLICIT null-with-reason object otherwise.
// Never a bare null -- a bare null cannot be told apart from "we forgot to
// look this up" by anything reading the DNA record later.
function resolveRecipeSnapshot({ recipe, recipe_ref }) {
  if (!recipe_ref) {
    return { snapshot: null, reason: 'no recipe_ref was supplied; this run was started ad hoc, not from a saved recipe' };
  }
  if (!recipe || typeof recipe.read !== 'function') {
    return { snapshot: null, reason: `recipe_ref '${recipe_ref}' was supplied but no recipe kernel is available to resolve it in this pipeline instance` };
  }
  const resolved = recipe.read(recipe_ref);
  if (!resolved) {
    return { snapshot: null, reason: `recipe_ref '${recipe_ref}' does not resolve to a stored recipe` };
  }
  return resolved;
}

// Explicit zero usage/cost (A4): every stage this build runs has model:
// 'none' -- no provider is connected, so usage and cost ARE zero, a known
// fact, not an unknown one. null claims "we don't know"; an explicit zero
// object claims the true, checkable fact. Once a provider is wired,
// routing.model stops being 'none' and these fall through to the executor's
// real measured values (or null, honestly, if it has none yet).
// A stage whose brain is an installed CLI on a subscription genuinely cannot
// report tokens or dollars: the CLI does not hand them back. That is a KNOWN
// UNKNOWN and must not be flattened to zero, which would claim the run was
// free, nor to null, which assertManifestComplete correctly rejects as missing.
// It is recorded as an explicit did-not-report, the same discipline the prior
// system used (provider_did_not_report / provider_did_not_report_currency_cost).
function isCliManagedRouting(routing) {
  return routing.model === 'cli-selected';
}

function explicitUsage(routing, resultUsage) {
  if (resultUsage !== undefined) return resultUsage;
  if (routing.model === 'none') {
    return { input_tokens: 0, output_tokens: 0, note: 'no model provider is connected for this stage' };
  }
  if (isCliManagedRouting(routing)) {
    return {
      input_tokens: null,
      output_tokens: null,
      status: 'provider_did_not_report',
      note: 'the CLI runs on a subscription and does not report token usage back to the caller',
    };
  }
  return null;
}

function explicitCost(routing, resultCost) {
  if (resultCost !== undefined) return resultCost;
  if (routing.model === 'none') {
    return { amount_usd: 0, currency: 'usd', note: 'no model provider is connected for this stage' };
  }
  if (isCliManagedRouting(routing)) {
    return {
      amount_usd: null,
      currency: null,
      status: 'provider_did_not_report_currency_cost',
      note: 'subscription-backed CLI; there is no per-call dollar cost to report',
    };
  }
  return null;
}

// assertManifestComplete (A4, binding): a run must not finish with outcome
// success while any required replay-manifest field is null or missing.
// Checked against the REAL persisted DNA record, so it verifies what
// actually got written. Throws loudly rather than letting finishRun record a
// hollow success.
export function assertManifestComplete(record) {
  const problems = [];
  const manifest = record?.replay_manifest || {};

  if (!record?.research_packet_ref) problems.push('research_packet_ref is missing at the top of the DNA record');
  if (!manifest.source_commit) problems.push('replay_manifest.source_commit is missing');
  if (!manifest.tree_hash) problems.push('replay_manifest.tree_hash is missing');
  if (manifest.recipe_snapshot === undefined || manifest.recipe_snapshot === null) {
    problems.push('replay_manifest.recipe_snapshot is missing (must be a resolved snapshot or an explicit null-with-reason object)');
  }
  if (!Array.isArray(manifest.stage_graph) || manifest.stage_graph.length === 0) {
    problems.push('replay_manifest.stage_graph is missing or empty');
  }

  for (const attempt of record?.stages || []) {
    if (attempt.status !== 'success') continue;
    if (attempt.usage === undefined || attempt.usage === null) problems.push(`stage '${attempt.stage}': usage is missing`);
    if (attempt.cost_estimate === undefined || attempt.cost_estimate === null) problems.push(`stage '${attempt.stage}': cost_estimate is missing`);
    for (const output of attempt.outputs || []) {
      if (!output.sha256) problems.push(`stage '${attempt.stage}': output '${output.ref}' has no digest`);
    }
    for (const input of attempt.inputs || []) {
      if (!input.sha256) problems.push(`stage '${attempt.stage}': input '${input.ref}' has no digest`);
    }
  }

  if (problems.length) {
    throw fail(500, 'dna_manifest_incomplete', `refusing to record a successful run with an incomplete replay manifest: ${problems.join('; ')}`);
  }
}

// Structural scaffolding only -- page names, section shape. Never a business
// fact (a number, a claim, a testimonial). Facts come only from packet.facts
// or brief.business/site_needs; when there is nothing to say, the copy says
// so plainly rather than inventing something plausible.
// Shared by runStage() (below) and run()'s pre-startRun research call: given
// a stage outcome ({ ok: true, result } or { ok: false, error }), records it
// through dna.recordStage with explicit usage/cost (A4) and returns the
// { ok, value|error } shape every caller in this file expects.
// The recipe is authoritative for per-stage model and agent when one is
// resolved. MODEL_ROUTING is the DEFAULT, not the policy: a recipe exists
// precisely so different stages can run on different brains, and reading a
// module constant instead would make one global provider for the whole build.
// Provenance is recorded so a DNA record says WHERE its routing came from.
export function resolveStageRouting(stageName, recipeSnapshot) {
  const fallback = MODEL_ROUTING[stageName] || { model: 'none', agent: null, note: 'no routing entry for this stage' };
  const stages = recipeSnapshot && Array.isArray(recipeSnapshot.stages) ? recipeSnapshot.stages : null;
  const fromRecipe = stages ? stages.find((st) => st.stage === stageName) : null;
  if (!fromRecipe) return { ...fallback, routing_source: 'default' };
  const model = fromRecipe.model === undefined || fromRecipe.model === null ? fallback.model : fromRecipe.model;
  const agent = fromRecipe.agent === undefined ? fallback.agent : fromRecipe.agent;
  return { model, agent, note: fallback.note, routing_source: 'recipe' };
}

function recordStageOutcome(dna, run_id, stageName, retryOf, startedAt, finishedAt, outcome, recipeSnapshot = null) {
  const routing = resolveStageRouting(stageName, recipeSnapshot);
  if (outcome.ok) {
    const result = outcome.result;
    dna.recordStage({
      run_id, stage: stageName, retry_of: retryOf, status: 'success',
      started_at: startedAt, finished_at: finishedAt,
      inputs: result.inputs || [], outputs: result.outputs || [],
      evidence_ref: result.evidence_ref || null,
      verification: result.verification || null,
      verifier_version: result.verifier_version || null,
      model: routing.model, agent: result.agent !== undefined ? result.agent : routing.agent,
      routing_source: routing.routing_source,
      usage: explicitUsage(routing, result.usage),
      cost_estimate: explicitCost(routing, result.cost_estimate),
    });
    return { ok: true, value: result.value };
  }
  const error = outcome.error;
  dna.recordStage({
    run_id, stage: stageName, retry_of: retryOf, status: 'failed',
    started_at: startedAt, finished_at: finishedAt,
    error: { message: error.message, code: error.code || null },
    verification: error.verification ? { passed: false, checks: error.verification.checks, errors: error.verification.errors } : null,
    model: routing.model, agent: routing.agent,
    usage: explicitUsage(routing, undefined),
    cost_estimate: explicitCost(routing, undefined),
  });
  return { ok: false, error };
}

async function runStage(dna, run_id, stageName, retryOf, fn, recipeSnapshot = null) {
  const started_at = new Date().toISOString();
  try {
    const result = await fn();
    return recordStageOutcome(dna, run_id, stageName, retryOf, started_at, new Date().toISOString(), { ok: true, result }, recipeSnapshot);
  } catch (error) {
    return recordStageOutcome(dna, run_id, stageName, retryOf, started_at, new Date().toISOString(), { ok: false, error }, recipeSnapshot);
  }
}

export function createPipeline({ paths, journal, events, dna, spec, mutation, recipe = null, researchOptions = {}, imageryOptions = {}, copyOptions = {} }) {
  const repositories = createRepositoryLifecycle({ paths, journal });
  const executors = makeExecutors({ paths, journal, events, mutation, spec, researchOptions, imageryOptions, copyOptions, repositories });
  function finalizeFailed(run_id, stageName, error) {
    dna.finishRun({ run_id, outcome: { status: 'failed', failed_stage: stageName, message: error.message, code: error.code || null } });
    return { run_id, outcome: 'failed', failed_stage: stageName, error: { message: error.message, code: error.code || null } };
  }

  async function runUnchecked({ site_id, brief, adapter = 'shay-native', raw_import, composer = DEFAULT_COMPOSER, initiator = 'pipeline', recipe_ref = null, repository_session } = {}) {
    if (!site_id) throw fail(400, 'identity_required', 'pipeline.run requires site_id');
    if (!brief || typeof brief !== 'object') throw fail(400, 'brief_required', 'pipeline.run requires a brief object');

    const { source_commit, tree_hash } = resolveTreeIdentity();
    const recipe_snapshot = brief.handoff ? { schema_version: 1, kind: 'selected-artifact-transfer', handoff: brief.handoff,
      stages: STAGES.map(stage => ({ stage, model: 'none', agent: stage === 'research' ? 'selected-artifact-import' : 'deterministic' }))
    } : resolveRecipeSnapshot({ recipe, recipe_ref });

    const ctx = { site_id, brief, adapter, raw_import, composer, initiator, repository_session };

    // research runs BEFORE dna.startRun() on purpose: research_packet_ref is
    // set once, at startRun, and never mutated afterward -- starting first
    // with null would leave it null forever (A4's "null packet snapshot"
    // defect). Running research first means the record opens with the real
    // ref already known. A research failure still gets a full DNA record: it
    // is recorded as the first stage attempt right after startRun.
    const researchStartedAt = new Date().toISOString();
    let researchOutcome;
    try {
      // Awaited: research became genuinely async when the adapter started
      // spawning a CLI and fetching sources. Without this the result is a
      // Promise and outputs[0] below reads undefined.
      researchOutcome = { ok: true, result: await executors.research(ctx) };
    } catch (error) {
      researchOutcome = { ok: false, error };
    }
    const researchFinishedAt = new Date().toISOString();
    const research_packet_ref = researchOutcome.ok ? researchOutcome.result.outputs[0].ref : null;

    const { run_id } = dna.startRun({
      // The real beginning, not the moment research happened to finish.
      started_at: researchStartedAt,
      site_id, recipe_ref, research_packet_ref,
      source_commit, tree_hash, recipe_snapshot,
      stage_graph: buildStageGraph(),
      model_tool_versions: { node: process.version, composer },
    });

    const researchResult = recordStageOutcome(dna, run_id, 'research', null, researchStartedAt, researchFinishedAt, researchOutcome, recipe_snapshot);
    if (!researchResult.ok) return finalizeFailed(run_id, 'research', researchResult.error);
    ctx.packet = researchResult.value;

    const specResult = await runStage(dna, run_id, 'spec', null, () => executors.spec(ctx), recipe_snapshot);
    if (!specResult.ok) return finalizeFailed(run_id, 'spec', specResult.error);
    ctx.derivedSpec = specResult.value;

    const composeResult = await runStage(dna, run_id, 'compose', null, () => executors.compose(ctx), recipe_snapshot);
    if (!composeResult.ok) return finalizeFailed(run_id, 'compose', composeResult.error);
    ctx.composed = composeResult.value;

    const buildResult = await runStage(dna, run_id, 'build', null, () => executors.build(ctx), recipe_snapshot);
    if (!buildResult.ok) return finalizeFailed(run_id, 'build', buildResult.error);

    const verifyResult = await runStage(dna, run_id, 'verify', null, () => executors.verify(ctx), recipe_snapshot);
    if (!verifyResult.ok) return finalizeFailed(run_id, 'verify', verifyResult.error);
    ctx.verify = verifyResult.value;

    const recordResult = await runStage(dna, run_id, 'record', null, () => {
      // A4: never let a success outcome land while the manifest is hollow.
      assertManifestComplete(dna.read(run_id));
      dna.finishRun({ run_id, outcome: { status: 'success', pages: ctx.composed.pages.length, composer: ctx.composed.composer } });
      return { value: { pages: ctx.composed.pages.length } };
    }, recipe_snapshot);
    if (!recordResult.ok) return finalizeFailed(run_id, 'record', recordResult.error);

    return { run_id, outcome: 'success', site_id, packet: ctx.packet, spec: ctx.derivedSpec, composed: ctx.composed, verify: ctx.verify };
  }

  // retryStage(): locates the failed attempt for `stage` on `run_id`, then
  // re-executes ONLY that stage, reconstructing inputs from what earlier
  // stages actually persisted. No prior successful stage re-runs. Satisfies
  // A4's shape-plus-verification rerun definition, not byte-identical output.
  async function retryUnchecked({ site_id: boundSiteId, run_id, stage, brief, adapter = 'shay-native', raw_import, composer = DEFAULT_COMPOSER, initiator = 'pipeline:retry', repository_session } = {}) {
    if (!STAGES.includes(stage)) throw fail(400, 'unknown_stage', `unknown stage '${stage}'; must be one of ${STAGES.join(', ')}`);
    const record = dna.read(run_id);
    if (!record) throw fail(404, 'dna_run_not_found', `no DNA record for run_id ${run_id}`);
    // The run record's site is NOT authority: a request bound to site A could
    // otherwise name site B's run_id. The bound identity decides, refused
    // before any input is reconstructed or any stage runs.
    if (!boundSiteId) {
      throw fail(400, 'identity_required', 'retryStage requires the bound site_id');
    }
    if (record.site_id !== boundSiteId) {
      throw fail(403, 'site_mismatch', `run ${run_id} belongs to site ${record.site_id}, not ${boundSiteId}`);
    }
    const failedAttempts = record.stages.filter((s) => s.stage === stage && s.status === 'failed');
    const priorFailed = failedAttempts[failedAttempts.length - 1];
    if (!priorFailed) throw fail(400, 'no_failed_attempt', `stage '${stage}' has no failed attempt on run ${run_id} to retry`);

    const site_id = record.site_id;
    const ctx = { site_id, brief, adapter, raw_import, composer, initiator, repository_session };

    function latestSuccessOutputRef(stageName) {
      const attempts = record.stages.filter((s) => s.stage === stageName && s.status === 'success');
      return attempts[attempts.length - 1]?.outputs?.[0]?.ref || null;
    }

    if (stage !== 'research') {
      const packetRef = latestSuccessOutputRef('research');
      if (packetRef) {
        const packet_id = path.basename(packetRef, '.json');
        ctx.packet = readPacket({ paths, site_id, packet_id });
      }
    }
    if (stage === 'compose' || stage === 'build' || stage === 'verify') {
      const readResult = spec.read(site_id);
      if (readResult.valid) ctx.derivedSpec = readResult.spec;
    }
    if (stage === 'build' || stage === 'verify') {
      if (!ctx.derivedSpec) throw fail(400, 'spec_missing', 'cannot retry without a persisted, valid spec.json');
      ctx.composed = composeSite({ spec: ctx.derivedSpec, composer });
    }

    const stageFn = {
      research: () => executors.research(ctx),
      spec: () => executors.spec(ctx),
      compose: () => executors.compose(ctx),
      build: () => executors.build(ctx),
      verify: () => executors.verify(ctx),
      record: () => {
        assertManifestComplete(dna.read(run_id));
        dna.finishRun({ run_id, outcome: { status: 'success', retried_stage: 'record' } });
        return { value: {} };
      },
    }[stage];

    const result = await runStage(dna, run_id, stage, priorFailed.attempt_id, stageFn);
    if (!result.ok) return finalizeFailed(run_id, stage, result.error);
    return { run_id, outcome: 'stage_retried', stage, value: result.value };
  }

  async function guarded(options, retry = false) {
    if (!options?.site_id) throw fail(400, 'identity_required', 'pipeline requires site_id');
    if (!retry) for (const transformation of options.brief?.handoff?.transformations || []) {
      const target = paths.within('sites', options.site_id, transformation.path);
      if (fs.existsSync(target) || fs.existsSync(path.dirname(target)) && fs.readdirSync(path.dirname(target)).some(name => name.toLowerCase() === path.basename(target).toLowerCase())) {
        throw fail(409, 'continuation_target_already_exists', 'Continuation may only create absent pages');
      }
    }
    if (retry) {
      if (!STAGES.includes(options.stage)) throw fail(400, 'unknown_stage', `unknown stage '${options.stage}'`);
      const record = dna.read(options.run_id);
      if (!record) throw fail(404, 'dna_run_not_found', `no DNA record for run_id ${options.run_id}`);
      if (record.site_id !== options.site_id) throw fail(403, 'site_mismatch', 'Run belongs to a different site');
      if (!record.stages.some(item => item.stage === options.stage && item.status === 'failed')) throw fail(400, 'no_failed_attempt', `stage '${options.stage}' has no failed attempt`);
    }
    const session = repositories.begin({ ...options, retry });
    let result;
    try {
      result = await (retry ? retryUnchecked : runUnchecked)({ ...options, repository_session: session });
    } catch (error) {
      repositories.finish(session, { outcome: 'failed' });
      throw error;
    }
    try {
      const finalized = repositories.finish(session, result);
      if (finalized.outcome !== 'success') return finalized;
      return { ...finalized, source_export: exportFinalizedSource({ paths, result: finalized, brief: options.brief || {} }) };
    }
    catch (error) { if (result?.run_id) return finalizeFailed(result.run_id, 'record', error); throw error; }
  }
  const run = options => guarded(options);
  const retryStage = options => guarded(options, true);
  return {
    run,
    finalizeSource: (result, brief, reviewQa) => exportFinalizedSource({ paths, result, brief, reviewQa }),
    runBatch: (opts) => runBatchImpl({ ...opts, run }),
    retryStage,
    STAGES,
    MODEL_ROUTING,
  };
}
