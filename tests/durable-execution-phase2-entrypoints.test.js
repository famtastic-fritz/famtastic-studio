import { afterEach, describe, expect, it, vi } from 'vitest';
import { composeControlMain, startControlMain } from '../server/cloud/control-main.js';
import { composeWorkerMain, startWorkerMain } from '../server/cloud/worker-main.js';
import { PHASE2_ENV } from '../server/kernel/durable-execution/phase2/config.js';
import { FakeFirestore } from './helpers/firestore-fake.js';

const PHASE_TAG = 'phase2_cloud_shadow';
const PILOT_RUN_ID = 'pilot-run-001';
const openServers = [];

function validEnv(overrides = {}) {
  return {
    PORT: '0',
    [PHASE2_ENV.mode]: 'cloud-shadow',
    [PHASE2_ENV.scope]: 'phase2-pilot',
    [PHASE2_ENV.runtime]: '1',
    [PHASE2_ENV.maxJobs]: '20',
    [PHASE2_ENV.pilotRunId]: PILOT_RUN_ID,
    [PHASE2_ENV.maxJobCostMicros]: '250000',
    [PHASE2_ENV.maxTotalCostMicros]: '5000000',
    [PHASE2_ENV.model]: 'gemini-3.1-flash-lite',
    [PHASE2_ENV.pricebookVersion]: 'vertex-gemini-2026-09-21',
    [PHASE2_ENV.vertexLocation]: 'global',
    [PHASE2_ENV.projectId]: 'famtastic-pilot-123',
    [PHASE2_ENV.region]: 'us-central1',
    [PHASE2_ENV.queueId]: 'phase2-pilot',
    [PHASE2_ENV.workerUrl]: 'https://phase2-worker-123.us-central1.run.app/internal/tasks/execute',
    [PHASE2_ENV.workerAudience]: 'https://phase2-worker-123.us-central1.run.app',
    [PHASE2_ENV.controlAudience]: 'https://phase2-control-123.us-central1.run.app',
    [PHASE2_ENV.intakeServiceAccount]: 'phase2-intake@famtastic-pilot-123.iam.gserviceaccount.com',
    [PHASE2_ENV.schedulerServiceAccount]: 'phase2-scheduler@famtastic-pilot-123.iam.gserviceaccount.com',
    [PHASE2_ENV.taskInvokerServiceAccount]: 'phase2-invoker@famtastic-pilot-123.iam.gserviceaccount.com',
    [PHASE2_ENV.firestoreDatabase]: 'phase2-pilot',
    [PHASE2_ENV.sourceBucket]: 'famtastic-phase2-source',
    [PHASE2_ENV.artifactBucket]: 'famtastic-phase2-artifacts',
    ...overrides,
  };
}

function pausedControls(overrides = {}) {
  return {
    phase_tag: PHASE_TAG,
    active_pilot_run_id: PILOT_RUN_ID,
    global_pause: true,
    dispatch_enabled: false,
    worker_enabled: false,
    provider_enabled: false,
    updated_at_ms: 1_700_000_000_000,
    updated_by: 'test-fixture',
    ...overrides,
  };
}

function emptyBudget(overrides = {}) {
  return {
    phase_tag: PHASE_TAG,
    pilot_run_id: PILOT_RUN_ID,
    max_jobs: 20,
    accepted_jobs: 0,
    max_total_cost_micros: 5_000_000,
    reserved_cost_micros: 0,
    settled_cost_micros: 0,
    uncertain_cost_micros: 0,
    created_at_ms: 1_700_000_000_000,
    updated_at_ms: 1_700_000_000_000,
    ...overrides,
  };
}

function boundFirestore() {
  const firestore = new FakeFirestore();
  firestore.projectId = 'famtastic-pilot-123';
  firestore.databaseId = 'phase2-pilot';
  return firestore;
}

function readyFirestore() {
  const firestore = boundFirestore();
  firestore.seed('executionControls/global', pausedControls());
  firestore.seed(`executionBudgets/${PILOT_RUN_ID}`, emptyBudget());
  return firestore;
}

function fakeStorage() {
  return {
    bucket: vi.fn(() => ({
      file: vi.fn(() => ({})),
    })),
  };
}

function controlOptions(firestoreClient) {
  return {
    env: validEnv(),
    firestoreClient,
    storageClient: fakeStorage(),
    cloudTasksClient: {
      createTask: vi.fn(),
      getTask: vi.fn(),
    },
    oidcVerifierClient: { verifyIdToken: vi.fn() },
  };
}

function workerOptions(firestoreClient) {
  return {
    env: validEnv(),
    firestoreClient,
    storageClient: fakeStorage(),
    vertexClient: { models: { generateContent: vi.fn() } },
    oidcVerifierClient: { verifyIdToken: vi.fn() },
  };
}

function seedJob(firestore, index, costs = {}) {
  firestore.seed(`executionJobs/job_${index}`, {
    phase_tag: PHASE_TAG,
    pilot_run_id: PILOT_RUN_ID,
    job_id: `job_${index}`,
    max_cost_micros: 250_000,
    reserved_cost_micros: 0,
    settled_cost_micros: 0,
    uncertain_cost_micros: 0,
    ...costs,
  });
}

afterEach(async () => {
  await Promise.all(openServers.splice(0).map((server) => new Promise((resolve) => server.close(resolve))));
});

describe('Phase 2 production entrypoints', () => {
  it('composes both roles without listening or changing paused persistent controls', async () => {
    const controlDb = readyFirestore();
    const workerDb = readyFirestore();
    const controlBefore = controlDb.dump();
    const workerBefore = workerDb.dump();

    const control = await composeControlMain(controlOptions(controlDb));
    const worker = await composeWorkerMain(workerOptions(workerDb));

    expect(control).toMatchObject({ role: 'control', persisted: { pilot_job_count: 0 } });
    expect(worker).toMatchObject({ role: 'worker', persisted: { pilot_job_count: 0 } });
    expect(control.server.listening).toBe(false);
    expect(worker.server.listening).toBe(false);
    expect(control.persisted.controls).toMatchObject({
      global_pause: true,
      dispatch_enabled: false,
      worker_enabled: false,
      provider_enabled: false,
    });
    expect(worker.config.provider).toMatchObject({
      sdk: '@google/genai', vertexai: true, api_version: 'v1', thinking_level: 'MINIMAL',
    });
    expect(controlDb.dump()).toEqual(controlBefore);
    expect(workerDb.dump()).toEqual(workerBefore);
  });

  it('starts only through the explicit start functions', async () => {
    const control = await startControlMain(controlOptions(readyFirestore()));
    const worker = await startWorkerMain(workerOptions(readyFirestore()));
    openServers.push(control.server, worker.server);
    expect(control.server.listening).toBe(true);
    expect(worker.server.listening).toBe(true);
  });

  it('fails closed when controls or budget are absent and creates no defaults', async () => {
    for (const compose of [
      (firestore) => composeControlMain(controlOptions(firestore)),
      (firestore) => composeWorkerMain(workerOptions(firestore)),
    ]) {
      const firestore = boundFirestore();
      await expect(compose(firestore)).rejects.toMatchObject({
        code: 'phase2_state_invalid',
        statusCode: 503,
      });
      expect(firestore.dump()).toEqual({});
    }
  });

  it('rejects a job count above the pilot cap before creating a server', async () => {
    const firestore = readyFirestore();
    for (let index = 1; index <= 21; index += 1) seedJob(firestore, index);
    firestore.seed(`executionBudgets/${PILOT_RUN_ID}`, emptyBudget({ accepted_jobs: 21 }));
    await expect(composeControlMain(controlOptions(firestore)))
      .rejects.toMatchObject({ code: 'phase2_state_invalid', statusCode: 503 });
  });

  it('rejects accepted-job and cost-ledger drift before creating a server', async () => {
    const countDrift = readyFirestore();
    seedJob(countDrift, 1);
    await expect(composeWorkerMain(workerOptions(countDrift)))
      .rejects.toMatchObject({ code: 'phase2_state_invalid', statusCode: 503 });

    const costDrift = readyFirestore();
    seedJob(costDrift, 1, { reserved_cost_micros: 10 });
    costDrift.seed(`executionBudgets/${PILOT_RUN_ID}`, emptyBudget({ accepted_jobs: 1 }));
    await expect(composeControlMain(controlOptions(costDrift)))
      .rejects.toMatchObject({ code: 'phase2_state_invalid', statusCode: 503 });
  });

  it('rejects a persisted per-job cost cap above the configured maximum', async () => {
    const firestore = readyFirestore();
    seedJob(firestore, 1, { max_cost_micros: 250_001 });
    firestore.seed(`executionBudgets/${PILOT_RUN_ID}`, emptyBudget({ accepted_jobs: 1 }));
    await expect(composeWorkerMain(workerOptions(firestore)))
      .rejects.toMatchObject({ code: 'phase2_state_invalid', statusCode: 503 });
  });

  it('rejects a self-consistent ledger whose committed cost exceeds its per-job cap', async () => {
    for (const compose of [
      (firestore) => composeControlMain(controlOptions(firestore)),
      (firestore) => composeWorkerMain(workerOptions(firestore)),
    ]) {
      const firestore = readyFirestore();
      seedJob(firestore, 1, {
        reserved_cost_micros: 100_000,
        settled_cost_micros: 100_000,
        uncertain_cost_micros: 100_000,
      });
      firestore.seed(`executionBudgets/${PILOT_RUN_ID}`, emptyBudget({
        accepted_jobs: 1,
        reserved_cost_micros: 100_000,
        settled_cost_micros: 100_000,
        uncertain_cost_micros: 100_000,
      }));
      await expect(compose(firestore))
        .rejects.toMatchObject({ code: 'phase2_state_invalid', statusCode: 503 });
    }
  });

  it('rejects an invalid listen port before constructing cloud boundaries', async () => {
    const storageClient = fakeStorage();
    await expect(composeControlMain({
      ...controlOptions(readyFirestore()),
      env: validEnv({ PORT: '70000' }),
      storageClient,
    })).rejects.toMatchObject({ code: 'phase2_port_invalid', statusCode: 503 });
    expect(storageClient.bucket).not.toHaveBeenCalled();
  });

  it('rejects a Firestore client bound to another project or database', async () => {
    for (const mismatch of [
      { projectId: 'another-project' },
      { databaseId: '(default)' },
      { projectId: undefined },
      { databaseId: undefined },
    ]) {
      const firestore = readyFirestore();
      Object.assign(firestore, mismatch);
      await expect(composeWorkerMain(workerOptions(firestore)))
        .rejects.toMatchObject({ code: 'phase2_firestore_boundary_mismatch', statusCode: 503 });
    }
  });
});
