import { spawnSync } from 'node:child_process';
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  PHASE2_PAUSE_GATE,
  PHASE2_PAUSE_GATE_ENV,
  pauseDurableExecutionPhase2,
} from '../scripts/pause-durable-execution-phase2.mjs';
import { PHASE2_ENV } from '../server/kernel/durable-execution/phase2/config.js';
import { FakeFirestore } from './helpers/firestore-fake.js';

const PROJECT_ID = 'famtastic-pilot-123';
const DATABASE_ID = 'phase2-pilot';
const PILOT_RUN_ID = 'pilot-run-001';

function validEnv(overrides = {}) {
  return {
    [PHASE2_PAUSE_GATE_ENV]: PHASE2_PAUSE_GATE,
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
    [PHASE2_ENV.projectId]: PROJECT_ID,
    [PHASE2_ENV.region]: 'us-central1',
    [PHASE2_ENV.queueId]: 'phase2-pilot',
    [PHASE2_ENV.workerUrl]: 'https://phase2-worker-123.us-central1.run.app/internal/tasks/execute',
    [PHASE2_ENV.workerAudience]: 'https://phase2-worker-123.us-central1.run.app',
    [PHASE2_ENV.controlAudience]: 'https://phase2-control-123.us-central1.run.app',
    [PHASE2_ENV.intakeServiceAccount]: 'phase2-intake@famtastic-pilot-123.iam.gserviceaccount.com',
    [PHASE2_ENV.schedulerServiceAccount]: 'phase2-scheduler@famtastic-pilot-123.iam.gserviceaccount.com',
    [PHASE2_ENV.taskInvokerServiceAccount]: 'phase2-invoker@famtastic-pilot-123.iam.gserviceaccount.com',
    [PHASE2_ENV.firestoreDatabase]: DATABASE_ID,
    [PHASE2_ENV.sourceBucket]: 'famtastic-phase2-source',
    [PHASE2_ENV.artifactBucket]: 'famtastic-phase2-artifacts',
    ...overrides,
  };
}

function fakeFirestore({ projectId = PROJECT_ID, databaseId = DATABASE_ID } = {}) {
  const firestore = new FakeFirestore();
  firestore.projectId = projectId;
  firestore.databaseId = databaseId;
  return firestore;
}

function controls(overrides = {}) {
  return {
    phase_tag: 'phase2_cloud_shadow',
    active_pilot_run_id: PILOT_RUN_ID,
    global_pause: false,
    dispatch_enabled: true,
    worker_enabled: true,
    provider_enabled: true,
    updated_at_ms: 1_699_999_999_000,
    updated_by: 'activation-fixture',
    synthetic_allowlist: ['fixture-only'],
    ...overrides,
  };
}

function stopEnvironment(binDir, logPath) {
  return {
    ...process.env,
    PATH: `${binDir}:${process.env.PATH}`,
    PHASE2_TEST_CONTAINMENT_LOG: logPath,
    PHASE2_STOP_GATE: 'STOP_PHASE2_SHADOW',
    PHASE2_PROJECT_ID: PROJECT_ID,
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
    PHASE2_FIRESTORE_DATABASE: DATABASE_ID,
    PHASE2_SOURCE_BUCKET: 'famtastic-phase2-source',
    PHASE2_ARTIFACT_BUCKET: 'famtastic-phase2-artifacts',
    PHASE2_WORKER_URL: 'https://studio-phase2-worker-123.us-central1.run.app/internal/tasks/execute',
    PHASE2_WORKER_AUDIENCE: 'https://studio-phase2-worker-123.us-central1.run.app',
    PHASE2_CONTROL_AUDIENCE: 'https://studio-phase2-control-123.us-central1.run.app',
    PHASE2_CONTROL_IMAGE: `us-central1-docker.pkg.dev/${PROJECT_ID}/studio-phase2/control@sha256:${'a'.repeat(64)}`,
    PHASE2_WORKER_IMAGE: `us-central1-docker.pkg.dev/${PROJECT_ID}/studio-phase2/worker@sha256:${'b'.repeat(64)}`,
    PHASE2_ARTIFACT_REPOSITORY: 'studio-phase2',
    PHASE2_CONTROL_SA: 'studio-p2-control',
    PHASE2_WORKER_SA: 'studio-p2-worker',
    PHASE2_INTAKE_SA: 'studio-p2-intake',
    PHASE2_SCHEDULER_SA: 'studio-p2-scheduler',
    PHASE2_TASK_INVOKER_SA: 'studio-p2-task-invoker',
  };
}

describe('Phase 2 persistent pause CLI', () => {
  it('is import-safe and rejects every inexact gate without a write', async () => {
    expect(typeof pauseDurableExecutionPhase2).toBe('function');
    for (const gate of [undefined, '', 'yes', `${PHASE2_PAUSE_GATE} `]) {
      const firestore = fakeFirestore();
      firestore.seed('executionControls/global', controls());
      const before = firestore.dump();
      await expect(pauseDurableExecutionPhase2({
        env: validEnv({ [PHASE2_PAUSE_GATE_ENV]: gate }),
        firestoreClient: firestore,
      })).rejects.toMatchObject({ code: 'phase2_pause_gate_denied', statusCode: 403 });
      expect(firestore.dump()).toEqual(before);
    }
  });

  it.each([
    ['project', { projectId: 'another-project' }],
    ['database', { databaseId: 'another-database' }],
  ])('rejects a wrong %s binding without a write', async (_label, binding) => {
    const firestore = fakeFirestore(binding);
    firestore.seed('executionControls/global', controls());
    const before = firestore.dump();
    await expect(pauseDurableExecutionPhase2({
      env: validEnv(),
      firestoreClient: firestore,
    })).rejects.toMatchObject({ code: 'phase2_pause_database_mismatch', statusCode: 503 });
    expect(firestore.dump()).toEqual(before);
  });

  it('rejects a Firestore emulator endpoint without a write', async () => {
    const firestore = fakeFirestore();
    firestore.seed('executionControls/global', controls());
    const before = firestore.dump();
    await expect(pauseDurableExecutionPhase2({
      env: validEnv({ FIRESTORE_EMULATOR_HOST: '127.0.0.1:8080' }),
      firestoreClient: firestore,
    })).rejects.toMatchObject({ code: 'phase2_pause_endpoint_override', statusCode: 503 });
    expect(firestore.dump()).toEqual(before);
  });

  it('rejects another active pilot in the same transaction without a write', async () => {
    const firestore = fakeFirestore();
    firestore.seed('executionControls/global', controls({ active_pilot_run_id: 'pilot-run-002' }));
    const before = firestore.dump();
    await expect(pauseDurableExecutionPhase2({
      env: validEnv(),
      firestoreClient: firestore,
    })).rejects.toMatchObject({ code: 'pilot_scope_conflict', statusCode: 409 });
    expect(firestore.dump()).toEqual(before);
  });

  it('writes the four safe controls exactly and leaves every other record unchanged', async () => {
    const firestore = fakeFirestore();
    firestore.seed('executionControls/global', controls());
    firestore.seed(`executionBudgets/${PILOT_RUN_ID}`, { marker: 'unchanged' });
    const receipt = await pauseDurableExecutionPhase2({
      env: validEnv({ PHASE2_DISPATCH_ENABLED: 'true' }),
      firestoreClient: firestore,
      clock: () => 1_700_000_000_000,
    });
    expect(receipt).toEqual({
      ok: true,
      event: 'phase2_persistent_pause_verified',
      mode: 'cloud-shadow',
      scope: 'phase2-pilot',
      project_id: PROJECT_ID,
      firestore_database: DATABASE_ID,
      pilot_run_id: PILOT_RUN_ID,
      duplicate: false,
      controls: {
        global_pause: true,
        dispatch_enabled: false,
        worker_enabled: false,
        provider_enabled: false,
      },
    });
    expect(firestore.read('executionControls/global')).toEqual(controls({
      global_pause: true,
      dispatch_enabled: false,
      worker_enabled: false,
      provider_enabled: false,
      updated_at_ms: 1_700_000_000_000,
      updated_by: 'phase2-pause-cli',
    }));
    expect(firestore.read(`executionBudgets/${PILOT_RUN_ID}`)).toEqual({ marker: 'unchanged' });
  });

  it('is idempotent when the exact pilot is already fully paused', async () => {
    const firestore = fakeFirestore();
    firestore.seed('executionControls/global', controls({
      global_pause: true,
      dispatch_enabled: false,
      worker_enabled: false,
      provider_enabled: false,
      updated_by: 'prior-stop',
    }));
    const before = firestore.dump();
    const receipt = await pauseDurableExecutionPhase2({
      env: validEnv(),
      firestoreClient: firestore,
      clock: () => 1_700_000_000_000,
    });
    expect(receipt.duplicate).toBe(true);
    expect(firestore.dump()).toEqual(before);
  });

  it('classifies a pause failure and continues every later infrastructure containment step', () => {
    const binDir = mkdtempSync(path.join(tmpdir(), 'phase2-stop-test-'));
    try {
      const logPath = path.join(binDir, 'containment.log');
      const gcloudPath = path.join(binDir, 'gcloud');
      const nodePath = path.join(binDir, 'node');
      writeFileSync(gcloudPath, '#!/usr/bin/env bash\nprintf "gcloud:%s\\n" "$*" >> "$PHASE2_TEST_CONTAINMENT_LOG"\n');
      writeFileSync(nodePath, '#!/usr/bin/env bash\nprintf "node:pause\\n" >> "$PHASE2_TEST_CONTAINMENT_LOG"\nprintf \'{"ok":false,"event":"phase2_persistent_pause_failed","code":"fixture_failure"}\\n\' >&2\nexit 1\n');
      chmodSync(gcloudPath, 0o700);
      chmodSync(nodePath, 0o700);
      const result = spawnSync('bash', ['infra/gcp/phase2/scripts/stop.sh'], {
        cwd: process.cwd(),
        env: stopEnvironment(binDir, logPath),
        encoding: 'utf8',
      });
      expect(result.status).toBe(1);
      expect(result.stderr).toContain('containment failed: persistent controls paused');
      expect(result.stderr).toContain('stop completed with failures');
      const log = readFileSync(logPath, 'utf8').trim().split('\n');
      const schedulerIndex = log.findIndex((line) => line.includes('scheduler jobs pause'));
      const pauseIndex = log.indexOf('node:pause');
      const lastIamIndex = log.findLastIndex((line) => line.includes('run services remove-iam-policy-binding'));
      expect(schedulerIndex).toBeGreaterThanOrEqual(0);
      expect(pauseIndex).toBeGreaterThan(schedulerIndex);
      expect(lastIamIndex).toBeGreaterThan(pauseIndex);
    } finally {
      rmSync(binDir, { recursive: true, force: true });
    }
  });
});
