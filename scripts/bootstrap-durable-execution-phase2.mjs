import { Firestore } from '@google-cloud/firestore';
import { pathToFileURL } from 'node:url';
import { loadPhase2Config } from '../server/kernel/durable-execution/phase2/config.js';
import { phase2Failure } from '../server/kernel/durable-execution/phase2/errors.js';
import {
  createFirestoreExecutionStore,
  FIRESTORE_PHASE_TAG,
} from '../server/kernel/durable-execution/phase2/firestore-store.js';

export const PHASE2_BOOTSTRAP_GATE = 'BOOTSTRAP_PAUSED_PHASE2_PILOT';
export const PHASE2_BOOTSTRAP_GATE_ENV = 'PHASE2_BOOTSTRAP_GATE';

function failure(code, message) {
  return phase2Failure(503, code, message);
}

function requireExactGate(env) {
  if (env?.[PHASE2_BOOTSTRAP_GATE_ENV] !== PHASE2_BOOTSTRAP_GATE) {
    throw phase2Failure(403, 'phase2_bootstrap_gate_denied', 'The exact Phase 2 bootstrap gate is required');
  }
}

function rejectEmulatorEndpoint(env) {
  if (env?.FIRESTORE_EMULATOR_HOST) {
    throw failure('phase2_bootstrap_endpoint_override', 'The Phase 2 bootstrap cannot use a Firestore emulator endpoint');
  }
}

function assertSafeControls(controls, pilotRunId) {
  if (!controls || controls.phase_tag !== FIRESTORE_PHASE_TAG
    || controls.active_pilot_run_id !== pilotRunId
    || controls.global_pause !== true
    || controls.dispatch_enabled !== false
    || controls.worker_enabled !== false
    || controls.provider_enabled !== false) {
    throw failure('phase2_bootstrap_controls_unsafe', 'Phase 2 controls are not paused with every execution gate disabled');
  }
  return controls;
}

function assertEmptyBudget(budget, config) {
  if (!budget || budget.phase_tag !== FIRESTORE_PHASE_TAG
    || budget.pilot_run_id !== config.pilot_run_id
    || budget.max_jobs !== config.max_jobs
    || budget.max_total_cost_micros !== config.cost.max_total_cost_micros
    || budget.accepted_jobs !== 0
    || budget.reserved_cost_micros !== 0
    || budget.settled_cost_micros !== 0
    || budget.uncertain_cost_micros !== 0) {
    throw failure('phase2_bootstrap_budget_unsafe', 'Phase 2 bootstrap budget is missing, nonempty, or does not match configuration');
  }
  return budget;
}

function assertInjectedDatabase(firestore, config) {
  if (firestore?.databaseId !== config.gcp.firestore_database
    || firestore?.projectId !== config.gcp.project_id) {
    throw failure('phase2_bootstrap_database_mismatch', 'Injected Firestore client is bound to another project or database');
  }
}

async function assertExistingStateSafe(store, config) {
  const [controls, budget, jobs] = await Promise.all([
    store.getControls(),
    store.getBudget(config.pilot_run_id),
    store.listJobs(),
  ]);
  if (controls) assertSafeControls(controls, config.pilot_run_id);
  if (budget) assertEmptyBudget(budget, config);
  if (!Array.isArray(jobs)
    || jobs.some((job) => job?.pilot_run_id === config.pilot_run_id)) {
    throw failure('phase2_bootstrap_jobs_present', 'Phase 2 bootstrap requires an empty pilot with no existing jobs');
  }
}

export async function bootstrapDurableExecutionPhase2({
  env = process.env,
  firestoreClient,
  clock,
  idFactory,
} = {}) {
  requireExactGate(env);
  rejectEmulatorEndpoint(env);
  const config = loadPhase2Config(env);
  const firestore = firestoreClient ?? new Firestore({
    projectId: config.gcp.project_id,
    databaseId: config.gcp.firestore_database,
  });
  assertInjectedDatabase(firestore, config);
  const store = createFirestoreExecutionStore({ firestore, clock, idFactory });
  await assertExistingStateSafe(store, config);
  const initialized = await store.bootstrapControls({
    pilotRunId: config.pilot_run_id,
    maxJobs: config.max_jobs,
    maxTotalCostMicros: config.cost.max_total_cost_micros,
    actor: 'phase2-bootstrap-cli',
  });
  const controls = assertSafeControls(initialized.controls, config.pilot_run_id);
  const budget = assertEmptyBudget(initialized.budget, config);
  return Object.freeze({
    ok: true,
    mode: config.mode,
    scope: config.scope,
    project_id: config.gcp.project_id,
    firestore_database: config.gcp.firestore_database,
    pilot_run_id: config.pilot_run_id,
    duplicate: initialized.duplicate,
    controls: Object.freeze({
      global_pause: controls.global_pause,
      dispatch_enabled: controls.dispatch_enabled,
      worker_enabled: controls.worker_enabled,
      provider_enabled: controls.provider_enabled,
    }),
    budget: Object.freeze({
      max_jobs: budget.max_jobs,
      accepted_jobs: budget.accepted_jobs,
      max_total_cost_micros: budget.max_total_cost_micros,
      reserved_cost_micros: budget.reserved_cost_micros,
      settled_cost_micros: budget.settled_cost_micros,
      uncertain_cost_micros: budget.uncertain_cost_micros,
    }),
  });
}

function isDirectExecution() {
  return Boolean(process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url);
}

if (isDirectExecution()) {
  bootstrapDurableExecutionPhase2().then(
    (receipt) => process.stdout.write(`${JSON.stringify(receipt)}\n`),
    (error) => {
      process.stderr.write(`${JSON.stringify({
        ok: false,
        event: 'phase2_bootstrap_failed',
        code: typeof error?.code === 'string' ? error.code : 'bootstrap_failed',
      })}\n`);
      process.exitCode = 1;
    },
  );
}
