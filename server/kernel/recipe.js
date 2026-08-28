// Recipes: runnable templates derived from Build DNA (plan 2.7, decision 7).
//
// fromRun() ("save as recipe") reads a completed DNA record (server/kernel/dna.js)
// and derives an ordered, parameterized template: stages in dependency order,
// prompt templates with variables extracted from the resolved prompt snapshot,
// model/agent assignment per stage, and a verification requirement per stage
// carried forward from what that stage's verifier actually checked.
//
// Recipes are versioned and never overwritten in place: write() always adds a
// new version file; editing a recipe means writing a new version with the
// same recipe_id.
//
// Rerun definition (amendment A4, binding, restated here because recipe.js is
// the thing a rerun is checked against): a rerun of a recipe succeeds when the
// SAME resolved stage graph executes against NEW declared inputs and every
// stage reaches its verification requirement. It is never judged by whether
// the model output is byte-identical to the original run — isVerifiedRerun()
// below deliberately does not compare outputs.
import fs from 'node:fs';
import crypto from 'node:crypto';

const SCHEMA_VERSION = 1;

function sha256Hex(value) {
  const buf = typeof value === 'string' || Buffer.isBuffer(value) ? value : JSON.stringify(value);
  return crypto.createHash('sha256').update(buf).digest('hex');
}

function newId(prefix) {
  return `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
}

function fail(statusCode, code, message) {
  return Object.assign(new Error(message), { statusCode, code });
}

// {{variable}} style placeholders found in a resolved prompt snapshot. The
// recipe template keeps the placeholder; a run of the recipe supplies values.
function extractVariables(promptSnapshot) {
  if (typeof promptSnapshot !== 'string') return [];
  const found = new Set();
  const re = /\{\{\s*([a-zA-Z0-9_.]+)\s*\}\}/g;
  let m;
  while ((m = re.exec(promptSnapshot))) found.add(m[1]);
  return [...found];
}

// Derives the stage template list from a DNA record. Order follows the
// record's own replay_manifest.stage_graph (already the ordered dependency
// graph for that run) rather than execution order, since retries mean
// record.stages can contain more entries than there are graph nodes. For
// each graph node, the LATEST attempt (by finished_at) is treated as the
// resolved behavior to template — retries are attempt history, not separate
// stages.
function deriveStages(runRecord) {
  const graph = runRecord.replay_manifest.stage_graph;
  return graph.map((node) => {
    const name = typeof node === 'string' ? node : node.stage;
    const depends_on = typeof node === 'string' ? [] : node.depends_on || [];
    const attempts = runRecord.stages
      .filter((s) => s.stage === name)
      .sort((a, b) => (a.finished_at < b.finished_at ? -1 : 1));
    const latest = attempts[attempts.length - 1] || null;
    const promptSnapshot = runRecord.replay_manifest.prompt_snapshots[name]?.prompt ?? latest?.prompt_snapshot ?? null;

    return {
      stage: name,
      depends_on,
      prompt_template: latest?.prompt_template ?? null,
      prompt_snapshot: promptSnapshot,
      variables: extractVariables(promptSnapshot),
      model: latest?.model ?? null,
      agent: latest?.agent ?? null,
      verification_requirement: latest?.verification ?? null,
      verifier_version: latest?.verifier_version ?? null,
    };
  });
}

export function createRecipe({ paths, dna }) {
  // Versioned storage: <recipes root>/<recipe_id>/<version>.json. write()
  // always picks the next unused version number for a recipe_id and never
  // touches an existing version file.
  function versionsDir(recipeId) {
    return paths.within('recipes', recipeId);
  }

  function existingVersions(recipeId) {
    const dir = versionsDir(recipeId);
    if (!fs.existsSync(dir)) return [];
    return fs
      .readdirSync(dir)
      .filter((f) => /^\d+\.json$/.test(f))
      .map((f) => Number(f.replace('.json', '')))
      .sort((a, b) => a - b);
  }

  function write(recipe) {
    if (!recipe.recipe_id) throw fail(400, 'recipe_id_required', 'write requires recipe_id');
    paths.ensure('recipes');
    const dir = versionsDir(recipe.recipe_id);
    fs.mkdirSync(dir, { recursive: true });
    const versions = existingVersions(recipe.recipe_id);
    const nextVersion = versions.length ? versions[versions.length - 1] + 1 : 1;
    const file = paths.within('recipes', recipe.recipe_id, `${nextVersion}.json`);
    if (fs.existsSync(file)) {
      // Should be unreachable given nextVersion derivation, but a version file
      // is never overwritten even if it somehow already exists.
      throw fail(409, 'recipe_version_exists', `recipe ${recipe.recipe_id} version ${nextVersion} already exists`);
    }
    const versioned = { ...recipe, version: nextVersion, written_at: new Date().toISOString() };
    fs.writeFileSync(file, JSON.stringify(versioned, null, 2));
    return versioned;
  }

  // fromRun(): "save as recipe". Derives a runnable template from a completed
  // DNA record and writes it as version 1 (or the next version, if recipe_id
  // is supplied to update an existing recipe family).
  function fromRun(runId, { name = null, recipe_id = null } = {}) {
    const run = dna.read(runId);
    if (!run) throw fail(404, 'dna_run_not_found', `no DNA record for run_id ${runId}`);
    if (!run.replay_manifest?.stage_graph?.length) {
      throw fail(400, 'dna_run_has_no_stage_graph', `run ${runId} has no stage_graph to derive a recipe from`);
    }

    const stages = deriveStages(run);
    const recipe = {
      recipe_id: recipe_id || newId('recipe'),
      schema_version: SCHEMA_VERSION,
      name: name || `recipe from ${runId}`,
      source_run_id: runId,
      created_at: new Date().toISOString(),
      stack_directives: run.recipe_snapshot?.stack_directives || run.replay_manifest.recipe_snapshot?.stack_directives || [],
      stages,
      verification_requirements: stages.map((s) => ({ stage: s.stage, requirement: s.verification_requirement })),
    };
    return write(recipe);
  }

  function read(recipeId, version = null) {
    const versions = existingVersions(recipeId);
    if (!versions.length) return null;
    const target = version ?? versions[versions.length - 1];
    const file = paths.within('recipes', recipeId, `${target}.json`);
    if (!fs.existsSync(file)) return null;
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  }

  function list() {
    paths.ensure('recipes');
    const root = paths.root('recipes');
    if (!fs.existsSync(root)) return [];
    return fs
      .readdirSync(root)
      .filter((entry) => fs.statSync(paths.within('recipes', entry)).isDirectory())
      .map((recipeId) => {
        const versions = existingVersions(recipeId);
        const latest = read(recipeId);
        return {
          recipe_id: recipeId,
          versions,
          latest_version: versions[versions.length - 1],
          name: latest?.name ?? null,
        };
      });
  }

  // Graph-shape equality: same stages, same order, same declared dependencies.
  // Deliberately ignores prompt_snapshot/model/agent so a recipe can be
  // re-templated (e.g. model upgrade) without invalidating rerun checks that
  // only care about structural shape.
  function sameGraphShape(a, b) {
    if (a.length !== b.length) return false;
    return a.every((node, i) => {
      const other = b[i];
      if (!other || node.stage !== other.stage) return false;
      const da = [...(node.depends_on || [])].sort();
      const db = [...(other.depends_on || [])].sort();
      return da.length === db.length && da.every((v, idx) => v === db[idx]);
    });
  }

  // isVerifiedRerun(): the rerun contract (A4), enforced. A rerun DNA record
  // is a valid rerun of `recipe` when its resolved stage graph has the same
  // shape as the recipe's derived stages AND every stage in the rerun reached
  // a passing verification result. Model output equality is never checked.
  function isVerifiedRerun(recipe, rerunRunRecord) {
    const recipeGraph = recipe.stages.map((s) => ({ stage: s.stage, depends_on: s.depends_on }));
    const rerunGraph = (rerunRunRecord.replay_manifest.stage_graph || []).map((n) =>
      typeof n === 'string' ? { stage: n, depends_on: [] } : { stage: n.stage, depends_on: n.depends_on || [] },
    );
    if (!sameGraphShape(recipeGraph, rerunGraph)) {
      return { verified: false, reason: 'stage_graph_shape_mismatch' };
    }

    const latestByStage = new Map();
    for (const attempt of rerunRunRecord.stages) {
      latestByStage.set(attempt.stage, attempt); // last write wins: stages array is append-only in execution order
    }

    for (const node of recipeGraph) {
      const attempt = latestByStage.get(node.stage);
      if (!attempt) return { verified: false, reason: `stage_never_ran:${node.stage}` };
      // An explicit verification failure must always lose. The previous OR let
      // { status: 'success', verification: { passed: false } } certify itself,
      // so a stage that ran its verifier and failed could still be counted as a
      // verified rerun. A contradictory record is a failure, not a pass.
      if (attempt.verification && attempt.verification.passed === false) {
        return { verified: false, reason: `stage_verification_failed:${node.stage}` };
      }
      const passed = attempt.verification?.passed === true || attempt.status === 'success';
      if (!passed) return { verified: false, reason: `stage_not_verified:${node.stage}` };
      if (attempt.status === 'failed') {
        return { verified: false, reason: `stage_failed:${node.stage}` };
      }
    }
    return { verified: true, reason: null };
  }

  return { fromRun, read, write, list, isVerifiedRerun, deriveStages };
}
