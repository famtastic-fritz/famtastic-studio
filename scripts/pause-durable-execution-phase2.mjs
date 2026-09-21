import { Firestore } from '@google-cloud/firestore';
import { pathToFileURL } from 'node:url';
import { loadPhase2Config } from '../server/kernel/durable-execution/phase2/config.js';
import { phase2Failure } from '../server/kernel/durable-execution/phase2/errors.js';
import {
  createFirestoreExecutionStore,
  FIRESTORE_PHASE_TAG,
} from '../server/kernel/durable-execution/phase2/firestore-store.js';

export const PHASE2_PAUSE_GATE = 'PAUSE_PHASE2_SHADOW';
export const PHASE2_PAUSE_GATE_ENV = 'PHASE2_PAUSE_GATE';

const SAFE_CONTROLS = Object.freeze({
  global_pause: true,
  dispatch_enabled: false,
  worker_enabled: false,
  provider_enabled: false,
});

function failure(code, message) {
  return phase2Failure(503, code, message);
}

function requireExactGate(env) {
  if (env?.[PHASE2_PAUSE_GATE_ENV] !== PHASE2_PAUSE_GATE) {
    throw phase2Failure(403, 'phase2_pause_gate_denied', 'The exact Phase 2 pause gate is required');
  }
}

function rejectEmulatorEndpoint(env) {
  if (env?.FIRESTORE_EMULATOR_HOST) {
    throw failure('phase2_pause_endpoint_override', 'The persistent pause cannot use a Firestore emulator endpoint');
  }
}

function assertDatabaseBinding(firestore, config) {
  if (firestore?.projectId !== config.gcp.project_id
    || firestore?.databaseId !== config.gcp.firestore_database) {
    throw failure('phase2_pause_database_mismatch', 'Firestore is not bound to the configured project and named database');
  }
}

function assertSafeControls(controls, pilotRunId) {
  if (!controls || controls.phase_tag !== FIRESTORE_PHASE_TAG
    || controls.active_pilot_run_id !== pilotRunId
    || Object.entries(SAFE_CONTROLS).some(([key, value]) => controls[key] !== value)) {
    throw failure('phase2_pause_verification_failed', 'Persistent controls are not fully paused for the configured pilot');
  }
  return controls;
}

function controlReceipt(controls) {
  return Object.freeze(Object.fromEntries(
    Object.keys(SAFE_CONTROLS).map((key) => [key, controls[key]]),
  ));
}

export async function pauseDurableExecutionPhase2({
  env = process.env,
  firestoreClient,
  clock,
} = {}) {
  requireExactGate(env);
  rejectEmulatorEndpoint(env);
  const config = loadPhase2Config(env);
  const firestore = firestoreClient ?? new Firestore({
    projectId: config.gcp.project_id,
    databaseId: config.gcp.firestore_database,
  });
  assertDatabaseBinding(firestore, config);
  const store = createFirestoreExecutionStore({ firestore, clock });
  const result = await store.pauseControls({
    pilotRunId: config.pilot_run_id,
    actor: 'phase2-pause-cli',
  });
  assertSafeControls(result.controls, config.pilot_run_id);
  const verified = assertSafeControls(await store.getControls(), config.pilot_run_id);
  return Object.freeze({
    ok: true,
    event: 'phase2_persistent_pause_verified',
    mode: config.mode,
    scope: config.scope,
    project_id: config.gcp.project_id,
    firestore_database: config.gcp.firestore_database,
    pilot_run_id: config.pilot_run_id,
    duplicate: result.duplicate,
    controls: controlReceipt(verified),
  });
}

function isDirectExecution() {
  return Boolean(process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url);
}

if (isDirectExecution()) {
  pauseDurableExecutionPhase2().then(
    (receipt) => process.stdout.write(`${JSON.stringify(receipt)}\n`),
    (error) => {
      process.stderr.write(`${JSON.stringify({
        ok: false,
        event: 'phase2_persistent_pause_failed',
        code: typeof error?.code === 'string' ? error.code : 'phase2_pause_failed',
      })}\n`);
      process.exitCode = 1;
    },
  );
}
