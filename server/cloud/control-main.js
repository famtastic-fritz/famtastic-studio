import { Firestore } from '@google-cloud/firestore';
import { CloudTasksClient } from '@google-cloud/tasks';
import { Storage } from '@google-cloud/storage';
import { OAuth2Client } from 'google-auth-library';
import { pathToFileURL } from 'node:url';
import { createControlServer } from './control-server.js';
import { listenPhase2Server } from './phase2-http.js';
import { loadPhase2Config } from '../kernel/durable-execution/phase2/config.js';
import { createCloudTasksDispatcher } from '../kernel/durable-execution/phase2/cloud-tasks.js';
import { phase2Failure } from '../kernel/durable-execution/phase2/errors.js';
import {
  createFirestoreExecutionStore,
  FIRESTORE_PHASE_TAG,
} from '../kernel/durable-execution/phase2/firestore-store.js';
import { createGcsArtifactStore } from '../kernel/durable-execution/phase2/gcs-artifacts.js';
import { createGoogleOidcVerifier } from '../kernel/durable-execution/phase2/google-oidc.js';
import { createPhase2ControlService } from '../kernel/durable-execution/phase2/runtime.js';

const CONTROL_MAX_JSON_BYTES = 1024 * 1024;

function startupFailure(code, message) {
  return phase2Failure(503, code, message);
}

function listenPort(env) {
  const value = env.PORT ?? '8080';
  if (typeof value !== 'string' || !/^(0|[1-9][0-9]{0,4})$/.test(value)) {
    throw startupFailure('phase2_port_invalid', 'PORT must be an integer from 0 through 65535');
  }
  const port = Number(value);
  if (port > 65_535) {
    throw startupFailure('phase2_port_invalid', 'PORT must be an integer from 0 through 65535');
  }
  return port;
}

function httpConfig(config, env) {
  return Object.freeze({
    host: '0.0.0.0',
    port: listenPort(env),
    audience: config.gcp.control_audience,
    maxJsonBytes: CONTROL_MAX_JSON_BYTES,
    allowedPrincipals: Object.freeze({
      accept: Object.freeze([config.gcp.intake_service_account]),
      reconcile: Object.freeze([config.gcp.scheduler_service_account]),
      execute: Object.freeze([config.gcp.task_invoker_service_account]),
    }),
  });
}

function nonnegativeInteger(value) {
  return Number.isSafeInteger(value) && value >= 0;
}

function assertFirestoreBoundary(firestore, config) {
  if (firestore.databaseId !== config.gcp.firestore_database
    || firestore.projectId !== config.gcp.project_id) {
    throw startupFailure('phase2_firestore_boundary_mismatch', 'Firestore client is bound to another project or database');
  }
}

async function assertPersistedPilotState(store, config) {
  let controls;
  let budget;
  let jobs;
  try {
    [controls, budget, jobs] = await Promise.all([
      store.getControls(),
      store.getBudget(config.pilot_run_id),
      store.listJobs(),
    ]);
  } catch (error) {
    throw startupFailure('phase2_state_unavailable', 'Phase 2 persistent controls and budget could not be verified', error);
  }

  const controlsValid = controls?.phase_tag === FIRESTORE_PHASE_TAG
    && controls.active_pilot_run_id === config.pilot_run_id
    && ['global_pause', 'dispatch_enabled', 'worker_enabled', 'provider_enabled']
      .every((key) => typeof controls[key] === 'boolean');
  const ledgerFields = [
    budget?.accepted_jobs,
    budget?.reserved_cost_micros,
    budget?.settled_cost_micros,
    budget?.uncertain_cost_micros,
  ];
  const committedCost = ledgerFields.slice(1).reduce((sum, value) => sum + value, 0);
  const pilotJobs = Array.isArray(jobs)
    ? jobs.filter((job) => job?.pilot_run_id === config.pilot_run_id)
    : [];
  const jobLedgersValid = pilotJobs.every((job) => {
    const fields = [
      job.reserved_cost_micros,
      job.settled_cost_micros,
      job.uncertain_cost_micros,
    ];
    return fields.every(nonnegativeInteger)
      && job.max_cost_micros === config.cost.max_job_cost_micros
      && fields.every((value) => value <= job.max_cost_micros)
      && fields.reduce((sum, value) => sum + value, 0) <= job.max_cost_micros;
  });
  const jobLedgerTotals = pilotJobs.reduce((totals, job) => ({
    reserved: totals.reserved + job.reserved_cost_micros,
    settled: totals.settled + job.settled_cost_micros,
    uncertain: totals.uncertain + job.uncertain_cost_micros,
  }), { reserved: 0, settled: 0, uncertain: 0 });
  const budgetValid = budget?.phase_tag === FIRESTORE_PHASE_TAG
    && budget.pilot_run_id === config.pilot_run_id
    && budget.max_jobs === config.max_jobs
    && budget.max_total_cost_micros === config.cost.max_total_cost_micros
    && ledgerFields.every(nonnegativeInteger)
    && budget.accepted_jobs === pilotJobs.length
    && pilotJobs.length <= budget.max_jobs
    && jobLedgersValid
    && jobLedgerTotals.reserved === budget.reserved_cost_micros
    && jobLedgerTotals.settled === budget.settled_cost_micros
    && jobLedgerTotals.uncertain === budget.uncertain_cost_micros
    && committedCost <= budget.max_total_cost_micros;
  if (!controlsValid || !budgetValid || !Array.isArray(jobs)) {
    throw startupFailure(
      'phase2_state_invalid',
      'Phase 2 persistent controls or budget are missing, invalid, or bound to another pilot',
    );
  }
  return Object.freeze({
    controls: Object.freeze({ ...controls }),
    budget: Object.freeze({ ...budget }),
    pilot_job_count: pilotJobs.length,
  });
}

export async function composeControlMain({
  env = process.env,
  firestoreClient,
  storageClient,
  cloudTasksClient,
  oidcVerifierClient,
  clock,
  idFactory,
} = {}) {
  const config = loadPhase2Config(env);
  const http = httpConfig(config, env);
  const firestore = firestoreClient ?? new Firestore({
    projectId: config.gcp.project_id,
    databaseId: config.gcp.firestore_database,
  });
  assertFirestoreBoundary(firestore, config);
  const store = createFirestoreExecutionStore({ firestore, clock, idFactory });
  const persisted = await assertPersistedPilotState(store, config);
  const storage = storageClient ?? new Storage({ projectId: config.gcp.project_id });
  const tasks = cloudTasksClient ?? new CloudTasksClient();
  const tokenVerifier = oidcVerifierClient ?? new OAuth2Client();
  const sourceStore = createGcsArtifactStore({
    storage,
    bucketName: config.gcp.source_bucket,
    prefix: `phase2/${config.pilot_run_id}`,
  });
  const dispatcher = createCloudTasksDispatcher({
    client: tasks,
    projectId: config.gcp.project_id,
    location: config.gcp.region,
    queueId: config.gcp.queue_id,
    targetUrl: config.gcp.worker_url,
    serviceAccountEmail: config.gcp.task_invoker_service_account,
    audience: config.gcp.worker_audience,
  });
  const auth = createGoogleOidcVerifier({
    verifier: tokenVerifier,
    audience: config.gcp.control_audience,
    allowedServiceAccountEmails: [...new Set([
      config.gcp.intake_service_account,
      config.gcp.scheduler_service_account,
    ])],
    clock,
  });
  const service = createPhase2ControlService({
    config,
    store,
    sourceStore,
    dispatcher,
    clock,
    idFactory,
  });
  const server = createControlServer({
    auth,
    intake: service.accept,
    reconciler: service.reconcile,
    config: http,
  });
  return Object.freeze({ role: 'control', config, persisted, service, server, http });
}

export async function startControlMain(options = {}) {
  const application = await composeControlMain(options);
  await listenPhase2Server({ server: application.server, config: application.http });
  return application;
}

function isDirectExecution() {
  return Boolean(process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url);
}

if (isDirectExecution()) {
  startControlMain().catch((error) => {
    process.stderr.write(`${JSON.stringify({
      level: 'error',
      event: 'phase2_control_start_failed',
      code: typeof error?.code === 'string' ? error.code : 'startup_failed',
    })}\n`);
    process.exitCode = 1;
  });
}
