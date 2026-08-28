// Builds + Recipes module: thin HTTP binding over the dna and recipe kernels
// (server/kernel/dna.js, server/kernel/recipe.js). No pipeline logic lives
// here -- this module only reads/writes through those two kernels and maps
// their errors to status codes, same shape as server/modules/sites/index.js.
//
// /api/builds used to be a `not_implemented` placeholder inside
// server/modules/operations/index.js (raw directory enumeration of the dna
// and recipes roots, no parsed runs). This module now owns that path with a
// real reader backed by dna.list(), so the placeholder route was removed
// from operations/index.js to avoid two registrations racing on the same
// path (module load order is alphabetical by directory name -- `builds`
// loads before `operations` -- so the duplicate would have silently lost,
// but leaving it in place would still be two sources of truth for one URL).
import { createDna } from '../../kernel/dna.js';
import { createRecipe } from '../../kernel/recipe.js';

function errorResponse(error) {
  const status = error.statusCode || 500;
  const body = { error: error.code || 'handler_failed', message: error.message };
  return { status, body };
}

function fail(statusCode, code, message) {
  return Object.assign(new Error(message), { statusCode, code });
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (chunk) => { data += chunk; });
    req.on('end', () => {
      if (!data) return resolve({});
      try {
        resolve(JSON.parse(data));
      } catch {
        reject(fail(400, 'invalid_body', 'request body is not valid JSON'));
      }
    });
    req.on('error', reject);
  });
}

// dna.list() summaries do not include a duration -- derive it here from the
// two timestamps it does carry rather than teaching the kernel about display
// concerns. null (never 0) when either timestamp is missing, per convention 7.
function durationMs(run) {
  if (!run.started_at || !run.finished_at) return null;
  const start = new Date(run.started_at).getTime();
  const end = new Date(run.finished_at).getTime();
  if (Number.isNaN(start) || Number.isNaN(end)) return null;
  return end - start;
}

export default {
  name: 'builds',
  register({ app, paths }) {
    const dna = createDna({ paths });
    const recipe = createRecipe({ paths, dna });

    // Global: runs span every site, this is a cross-site inventory read, not
    // one site's state (convention 5).
    app.route('GET', '/api/builds', async () => {
      const runs = dna.list().map((run) => ({ ...run, duration_ms: durationMs(run) }));
      return {
        status: 200,
        body: {
          status: runs.length ? 'available' : 'empty',
          source: 'dna kernel (dna.list())',
          note: runs.length ? undefined : 'No build runs recorded yet.',
          denominators: { total: { value: runs.length } },
          runs,
        },
      };
    }, { scope: 'global' });

    app.route('GET', '/api/recipes', async () => {
      const recipes = recipe.list();
      return {
        status: 200,
        body: {
          status: recipes.length ? 'available' : 'empty',
          source: 'recipe kernel (recipe.list())',
          note: recipes.length ? undefined : 'No recipes saved yet.',
          denominators: { total: { value: recipes.length } },
          recipes,
        },
      };
    }, { scope: 'global' });

    app.route('GET', '/api/recipes/read', async ({ query }) => {
      const recipeId = (query.get('recipe_id') || '').trim();
      const versionStr = query.get('version');
      const version = versionStr ? Number(versionStr) : null;
      if (!recipeId) {
        return { status: 200, body: { status: 'NOT_FOUND', note: 'recipe_id is required', source: 'recipe kernel (recipe.read())' } };
      }
      const found = recipe.read(recipeId, version);
      if (!found) {
        return { status: 200, body: { status: 'NOT_FOUND', note: `recipe ${recipeId} not found`, source: 'recipe kernel (recipe.read())' } };
      }
      return { status: 200, body: { status: 'available', source: 'recipe kernel (recipe.read())', recipe: found } };
    }, { scope: 'global' });

    // Site-scoped: the router already bound and froze `identity` at ingress
    // (scope: 'site' requires site_id); this handler never calls
    // bindIdentity itself. run_id is looked up globally by the dna kernel,
    // then checked against the bound site_id so a request scoped to site A
    // cannot read a run that belongs to site B -- a run with no site_id
    // recorded (not tied to any one site) is not subject to that check.
    app.route('GET', '/api/builds/run', async ({ query, identity }) => {
      const runId = (query.get('run_id') || '').trim();
      if (!runId) {
        return { status: 200, body: { status: 'NOT_FOUND', note: 'run_id is required', source: 'dna kernel (dna.read())' } };
      }
      const record = dna.read(runId);
      if (!record) {
        return { status: 200, body: { status: 'NOT_FOUND', note: `no DNA record for run_id ${runId}`, source: 'dna kernel (dna.read())' } };
      }
      if (record.site_id && record.site_id !== identity.site_id) {
        return { status: 200, body: { status: 'NOT_FOUND', note: `run ${runId} belongs to a different site`, source: 'dna kernel (dna.read())' } };
      }
      return { status: 200, body: { status: 'available', source: 'dna kernel (dna.read())', run: record } };
    });

    // Site-scoped mutation: "save as recipe" on a completed run. Only a run
    // that reached a successful outcome and belongs to the bound site (or
    // carries no site_id at all) can be turned into a recipe.
    app.route('POST', '/api/builds/save-as-recipe', async ({ req, identity }) => {
      try {
        const body = await readJsonBody(req);
        const runId = (body.run_id || '').trim();
        if (!runId) throw fail(400, 'run_id_required', 'save-as-recipe requires run_id');

        const record = dna.read(runId);
        if (!record) throw fail(404, 'dna_run_not_found', `no DNA record for run_id ${runId}`);
        if (record.site_id && record.site_id !== identity.site_id) {
          throw fail(403, 'site_mismatch', `run ${runId} belongs to a different site`);
        }
        // The pipeline finishes runs with an OBJECT outcome ({ status: 'success', ... }),
        // while this compared a literal string, so no real successful pipeline run
        // could ever be saved as a recipe. Accept the canonical object shape and
        // the plain string, and normalise before judging.
        const outcomeStatus = typeof record.outcome === 'string'
          ? record.outcome
          : record.outcome?.status ?? null;
        if (outcomeStatus !== 'success') {
          throw fail(400, 'run_not_successful', `run ${runId} did not reach a successful outcome (outcome: ${outcomeStatus ?? 'unknown'}); only a successful run can be saved as a recipe`);
        }

        const saved = recipe.fromRun(runId, { name: body.name || null, recipe_id: body.recipe_id || null });
        return { status: 200, body: { status: 'ok', recipe: saved } };
      } catch (error) {
        return errorResponse(error);
      }
    });

    // Rung 3 ground truth: the operator's verdict on a build. Telemetry knows
    // what a run did, never whether the result was worth sending to a customer.
    app.route('POST', '/api/builds/outcome', async ({ req, identity }) => {
      try {
        const body = await readJsonBody(req);
        const runId = (body.run_id || '').trim();
        if (!runId) throw fail(400, 'run_id_required', 'recording an outcome requires run_id');
        const decision = (body.operator_decision || '').trim();
        const captured = dna.setOutcome({
          run_id: runId,
          site_id: identity.site_id,
          operator_decision: decision,
          customer_selected_direction: body.customer_selected_direction,
          note: body.note ?? null,
          decided_by: identity.conversation_id || 'console',
        });
        return { status: 200, body: { status: 'ok', outcome_capture: captured } };
      } catch (error) {
        return errorResponse(error);
      }
    });
  },
};
