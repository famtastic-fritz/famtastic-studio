import { spawnSync } from 'node:child_process';
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  PHASE2_BOOTSTRAP_GATE,
  PHASE2_BOOTSTRAP_GATE_ENV,
  bootstrapDurableExecutionPhase2,
} from '../scripts/bootstrap-durable-execution-phase2.mjs';
import { PHASE2_ENV } from '../server/kernel/durable-execution/phase2/config.js';
import { FakeFirestore } from './helpers/firestore-fake.js';

const PILOT_RUN_ID = 'pilot-run-001';

function validEnv(overrides = {}) {
  return {
    [PHASE2_BOOTSTRAP_GATE_ENV]: PHASE2_BOOTSTRAP_GATE,
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

function fakeFirestore() {
  const firestore = new FakeFirestore();
  firestore.projectId = 'famtastic-pilot-123';
  firestore.databaseId = 'phase2-pilot';
  return firestore;
}

function pausedControls(overrides = {}) {
  return {
    phase_tag: 'phase2_cloud_shadow',
    active_pilot_run_id: PILOT_RUN_ID,
    global_pause: true,
    dispatch_enabled: false,
    worker_enabled: false,
    provider_enabled: false,
    updated_at_ms: 1_700_000_000_000,
    updated_by: 'test',
    ...overrides,
  };
}

function emptyBudget(overrides = {}) {
  return {
    phase_tag: 'phase2_cloud_shadow',
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

function applyEnvironment(binDir, logPath, overrides = {}) {
  return {
    ...process.env,
    PATH: `${binDir}:${process.env.PATH}`,
    PHASE2_TEST_GCLOUD_LOG: logPath,
    PHASE2_APPLY_GATE: 'APPLY_INERT_PHASE2_BASELINE',
    PHASE2_ONLINE_PLAN_PASSED: 'yes',
    FIRESTORE_EMULATOR_HOST: '127.0.0.1:8080',
    PHASE2_PROJECT_ID: 'famtastic-pilot-123',
    PHASE2_REGION: 'us-central1',
    PHASE2_CONTROL_SERVICE: 'studio-phase2-control',
    PHASE2_WORKER_SERVICE: 'studio-phase2-worker',
    PHASE2_QUEUE: 'studio-phase2-shadow',
    PHASE2_SCHEDULER_JOB: 'studio-phase2-dispatch',
    PHASE2_PILOT_RUN_ID: PILOT_RUN_ID,
    PHASE2_MAX_JOB_COST_MICROS: '250000',
    PHASE2_MAX_TOTAL_COST_MICROS: '5000000',
    PHASE2_MODEL: 'gemini-3.1-flash-lite',
    PHASE2_PRICEBOOK_VERSION: 'vertex-gemini-2026-09-21',
    PHASE2_VERTEX_LOCATION: 'global',
    PHASE2_FIRESTORE_DATABASE: 'phase2-pilot',
    PHASE2_SOURCE_BUCKET: 'famtastic-phase2-source',
    PHASE2_ARTIFACT_BUCKET: 'famtastic-phase2-artifacts',
    PHASE2_WORKER_URL: 'https://studio-phase2-worker-123.us-central1.run.app/internal/tasks/execute',
    PHASE2_WORKER_AUDIENCE: 'https://studio-phase2-worker-123.us-central1.run.app',
    PHASE2_CONTROL_AUDIENCE: 'https://studio-phase2-control-123.us-central1.run.app',
    PHASE2_CONTROL_IMAGE: `us-central1-docker.pkg.dev/famtastic-pilot-123/studio-phase2/control@sha256:${'a'.repeat(64)}`,
    PHASE2_WORKER_IMAGE: `us-central1-docker.pkg.dev/famtastic-pilot-123/studio-phase2/worker@sha256:${'b'.repeat(64)}`,
    PHASE2_ARTIFACT_REPOSITORY: 'studio-phase2',
    PHASE2_CONTROL_SA: 'studio-p2-control',
    PHASE2_WORKER_SA: 'studio-p2-worker',
    PHASE2_INTAKE_SA: 'studio-p2-intake',
    PHASE2_SCHEDULER_SA: 'studio-p2-scheduler',
    PHASE2_TASK_INVOKER_SA: 'studio-p2-task-invoker',
    ...overrides,
  };
}

describe('Phase 2 operator bootstrap CLI', () => {
  it('is import-safe and requires the one exact gate before any database change', async () => {
    expect(typeof bootstrapDurableExecutionPhase2).toBe('function');
    for (const gate of [undefined, '', 'yes', `${PHASE2_BOOTSTRAP_GATE} `]) {
      const firestore = fakeFirestore();
      await expect(bootstrapDurableExecutionPhase2({
        env: validEnv({ [PHASE2_BOOTSTRAP_GATE_ENV]: gate }),
        firestoreClient: firestore,
      })).rejects.toMatchObject({ code: 'phase2_bootstrap_gate_denied', statusCode: 403 });
      expect(firestore.dump()).toEqual({});
    }
  });

  it('rejects a Firestore emulator endpoint before any database change', async () => {
    const firestore = fakeFirestore();
    await expect(bootstrapDurableExecutionPhase2({
      env: validEnv({ FIRESTORE_EMULATOR_HOST: '127.0.0.1:8080' }),
      firestoreClient: firestore,
    })).rejects.toMatchObject({ code: 'phase2_bootstrap_endpoint_override', statusCode: 503 });
    expect(firestore.dump()).toEqual({});
  });

  it('refuses inert apply with a Firestore emulator endpoint before any cloud call', () => {
    const binDir = mkdtempSync(path.join(tmpdir(), 'phase2-apply-test-'));
    try {
      const logPath = path.join(binDir, 'gcloud.log');
      const gcloudPath = path.join(binDir, 'gcloud');
      writeFileSync(logPath, '');
      writeFileSync(gcloudPath, '#!/usr/bin/env bash\nprintf "gcloud:%s\\n" "$*" >> "$PHASE2_TEST_GCLOUD_LOG"\n');
      chmodSync(gcloudPath, 0o700);
      const result = spawnSync('bash', ['infra/gcp/phase2/scripts/apply-inert.sh'], {
        cwd: process.cwd(),
        env: applyEnvironment(binDir, logPath),
        encoding: 'utf8',
      });
      expect(result.status).toBe(1);
      expect(result.stderr).toContain('FIRESTORE_EMULATOR_HOST must be unset');
      expect(readFileSync(logPath, 'utf8')).toBe('');
    } finally {
      rmSync(binDir, { recursive: true, force: true });
    }
  });

  it('keeps inert apply disabled before cloud calls with no accepted create-only gate', () => {
    const binDir = mkdtempSync(path.join(tmpdir(), 'phase2-apply-blocker-test-'));
    try {
      const logPath = path.join(binDir, 'gcloud.log');
      const gcloudPath = path.join(binDir, 'gcloud');
      writeFileSync(logPath, '');
      writeFileSync(gcloudPath, '#!/usr/bin/env bash\nprintf "gcloud:%s\\n" "$*" >> "$PHASE2_TEST_GCLOUD_LOG"\n');
      chmodSync(gcloudPath, 0o700);
      const result = spawnSync('bash', ['infra/gcp/phase2/scripts/apply-inert.sh'], {
        cwd: process.cwd(),
        env: applyEnvironment(binDir, logPath, {
          FIRESTORE_EMULATOR_HOST: '',
          PHASE2_CREATE_ONLY_RUN_GATE: 'I_ACCEPT_RISK',
        }),
        encoding: 'utf8',
      });
      expect(result.status).toBe(1);
      expect(result.stderr).toContain('PHASE2_CREATE_ONLY_RUN_GATE has no accepted value');
      expect(result.stderr).toContain('create-only Cloud Run mechanism is required');
      expect(readFileSync(logPath, 'utf8')).toBe('');
    } finally {
      rmSync(binDir, { recursive: true, force: true });
    }
  });

  it('creates only paused controls and an empty exact pilot budget', async () => {
    const firestore = fakeFirestore();
    const receipt = await bootstrapDurableExecutionPhase2({
      env: validEnv(),
      firestoreClient: firestore,
      clock: () => 1_700_000_000_000,
    });
    expect(receipt).toEqual({
      ok: true,
      mode: 'cloud-shadow',
      scope: 'phase2-pilot',
      project_id: 'famtastic-pilot-123',
      firestore_database: 'phase2-pilot',
      pilot_run_id: PILOT_RUN_ID,
      duplicate: false,
      controls: {
        global_pause: true,
        dispatch_enabled: false,
        worker_enabled: false,
        provider_enabled: false,
      },
      budget: {
        max_jobs: 20,
        accepted_jobs: 0,
        max_total_cost_micros: 5_000_000,
        reserved_cost_micros: 0,
        settled_cost_micros: 0,
        uncertain_cost_micros: 0,
      },
    });
    expect(Object.keys(firestore.dump()).sort()).toEqual([
      `executionBudgets/${PILOT_RUN_ID}`,
      'executionControls/global',
    ]);
    expect(firestore.read('executionControls/global')).toEqual(pausedControls({
      updated_by: 'phase2-bootstrap-cli',
    }));
    expect(firestore.read(`executionBudgets/${PILOT_RUN_ID}`)).toEqual(emptyBudget());
  });

  it('is idempotent only while the pilot remains empty and fully disabled', async () => {
    const firestore = fakeFirestore();
    const options = { env: validEnv(), firestoreClient: firestore, clock: () => 1_700_000_000_000 };
    await bootstrapDurableExecutionPhase2(options);
    const before = firestore.dump();
    const receipt = await bootstrapDurableExecutionPhase2(options);
    expect(receipt.duplicate).toBe(true);
    expect(firestore.dump()).toEqual(before);
  });

  it('refuses enabled controls, nonempty state, and another database without mutation', async () => {
    const cases = [
      {
        setup(firestore) {
          firestore.seed('executionControls/global', pausedControls({ global_pause: false }));
          firestore.seed(`executionBudgets/${PILOT_RUN_ID}`, emptyBudget());
        },
        code: 'phase2_bootstrap_controls_unsafe',
      },
      {
        setup(firestore) {
          firestore.seed('executionControls/global', pausedControls());
          firestore.seed(`executionBudgets/${PILOT_RUN_ID}`, emptyBudget({ accepted_jobs: 1 }));
        },
        code: 'phase2_bootstrap_budget_unsafe',
      },
      {
        setup(firestore) { firestore.databaseId = '(default)'; },
        code: 'phase2_bootstrap_database_mismatch',
      },
      {
        setup(firestore) { firestore.projectId = 'another-project'; },
        code: 'phase2_bootstrap_database_mismatch',
      },
      {
        setup(firestore) { firestore.projectId = undefined; },
        code: 'phase2_bootstrap_database_mismatch',
      },
      {
        setup(firestore) { firestore.databaseId = undefined; },
        code: 'phase2_bootstrap_database_mismatch',
      },
      {
        setup(firestore) {
          firestore.seed('executionControls/global', pausedControls());
          firestore.seed(`executionBudgets/${PILOT_RUN_ID}`, emptyBudget());
          firestore.seed('executionJobs/orphan_job', {
            phase_tag: 'phase2_cloud_shadow',
            pilot_run_id: PILOT_RUN_ID,
            job_id: 'orphan_job',
          });
        },
        code: 'phase2_bootstrap_jobs_present',
      },
    ];
    for (const candidate of cases) {
      const firestore = fakeFirestore();
      candidate.setup(firestore);
      const before = firestore.dump();
      await expect(bootstrapDurableExecutionPhase2({
        env: validEnv(),
        firestoreClient: firestore,
      })).rejects.toMatchObject({ code: candidate.code, statusCode: 503 });
      expect(firestore.dump()).toEqual(before);
    }
  });

  it('rejects invalid runtime configuration before touching Firestore', async () => {
    const firestore = fakeFirestore();
    await expect(bootstrapDurableExecutionPhase2({
      env: validEnv({ [PHASE2_ENV.maxJobs]: '21' }),
      firestoreClient: firestore,
    })).rejects.toMatchObject({ code: 'phase2_config_invalid', statusCode: 503 });
    expect(firestore.dump()).toEqual({});
  });
});
