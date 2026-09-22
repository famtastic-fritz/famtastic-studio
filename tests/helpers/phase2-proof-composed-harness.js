import { createControlHandler } from '../../server/cloud/control-server.js';
import { createWorkerHandler } from '../../server/cloud/worker-server.js';
import { createCloudTasksDispatcher } from '../../server/kernel/durable-execution/phase2/cloud-tasks.js';
import { createPhase2EffectsFirewall } from '../../server/kernel/durable-execution/phase2/effects.js';
import { createFirestoreExecutionStore } from '../../server/kernel/durable-execution/phase2/firestore-store.js';
import { createGcsArtifactStore } from '../../server/kernel/durable-execution/phase2/gcs-artifacts.js';
import {
  createPhase2ControlService,
  createPhase2WorkerService,
} from '../../server/kernel/durable-execution/phase2/runtime.js';
import { createVertexGeminiProvider } from '../../server/kernel/durable-execution/phase2/vertex-gemini-provider.js';
import { FakeFirestore } from './firestore-fake.js';
import {
  FakeCloudTasksClient,
  createFakeVertexClient,
  createMemoryGcs,
} from './phase2-proof-fakes.js';
import {
  phase2ProofConfig,
  phase2ProofHttpConfig,
  phase2ProofRequest,
  phase2ProofTaskBodies,
} from './phase2-proof-http.js';

export const PHASE2_COMPOSED_PILOT = 'pilot-composed-proof';

function runtimeId(kind, seed) {
  const match = /^phase2-proof-(\d{2})$/.exec(seed?.idempotency_key || '');
  if (!match || !['job', 'task'].includes(kind)) throw new Error('unexpected Phase 2 proof ID seed');
  return `${kind}-${match[1]}`;
}

function sourceFaultBoundary(durable) {
  const failed = new Set();
  let readExactAttempts = 0;
  let readDeterministicAttempts = 0;
  return {
    bucket_name: durable.bucket_name,
    write: durable.write,
    async readDeterministic(input) {
      readDeterministicAttempts += 1;
      return durable.readDeterministic(input);
    },
    async readExact(input) {
      readExactAttempts += 1;
      const match = /\/jobs\/(job-(?:13|14))\//.exec(input.artifactRef || '');
      if (match && !failed.has(match[1])) {
        failed.add(match[1]);
        throw Object.assign(new Error('synthetic source read interruption'), {
          statusCode: 503,
          code: 'synthetic_source_read_interruption',
        });
      }
      return durable.readExact(input);
    },
    faulted_jobs: failed,
    snapshot() {
      return {
        read_exact_attempts: readExactAttempts,
        read_deterministic_attempts: readDeterministicAttempts,
        faulted_jobs: [...failed].sort(),
      };
    },
  };
}

function artifactFaultBoundary(durable) {
  let job12Crashed = false;
  let attempts = 0;
  let job19Crashes = 0;
  return {
    bucket_name: durable.bucket_name,
    async write(input) {
      attempts += 1;
      if (input.jobId === 'job-12' && !job12Crashed) {
        job12Crashed = true;
        throw Object.assign(new Error('synthetic post-checkpoint crash'), {
          code: 'synthetic_post_checkpoint_crash',
        });
      }
      if (input.jobId === 'job-19') {
        job19Crashes += 1;
        throw Object.assign(new Error('synthetic persistent artifact interruption'), {
          code: 'synthetic_artifact_interruption',
        });
      }
      return durable.write(input);
    },
    snapshot() {
      return { job12_crashed: job12Crashed, job19_crashes: job19Crashes, attempts };
    },
  };
}

function admissionFaultBoundary(store) {
  let crashed = false;
  return {
    store: {
      ...store,
      async finalizeWorkAdmission(input) {
        if (input?.envelope?.job_id === 'job-20' && !crashed) {
          crashed = true;
          throw Object.assign(new Error('synthetic finalize interruption'), {
            statusCode: 503,
            code: 'synthetic_finalize_interruption',
          });
        }
        return store.finalizeWorkAdmission(input);
      },
    },
    snapshot: () => ({ crashed }),
  };
}

function makeAuth() {
  const calls = [];
  return {
    calls,
    async verify({ headers, audience }) {
      const email = headers['x-proof-principal'];
      calls.push({ email, audience });
      return { email };
    },
  };
}

export function collectionRows(firestore, collection) {
  const prefix = `${collection}/`;
  return Object.entries(firestore.dump())
    .filter(([path]) => path.startsWith(prefix))
    .map(([, value]) => value);
}

export async function createComposedPhase2ProofHarness() {
  const runtime = phase2ProofConfig({
    pilotRunId: PHASE2_COMPOSED_PILOT,
    maxJobCostMicros: 240_000,
    maxTotalCostMicros: 5_000_000,
  });
  let now = 1_800_000_000_000;
  let sequence = 0;
  let providerNow = 1_900_000_000_000;
  const firestore = new FakeFirestore();
  const store = createFirestoreExecutionStore({
    firestore,
    clock: () => now,
    idFactory: (kind) => `${kind}_${String(++sequence).padStart(5, '0')}`,
  });
  await store.bootstrapControls({
    pilotRunId: runtime.pilot_run_id,
    maxJobs: runtime.max_jobs,
    maxTotalCostMicros: runtime.cost.max_total_cost_micros,
    actor: 'phase2-composed-proof',
  });

  const sourceMemory = createMemoryGcs();
  const artifactMemory = createMemoryGcs();
  const gcsPrefix = `phase2/${runtime.pilot_run_id}`;
  const durableSource = createGcsArtifactStore({
    storage: sourceMemory.storage,
    bucketName: runtime.gcp.source_bucket,
    prefix: gcsPrefix,
  });
  const durableArtifact = createGcsArtifactStore({
    storage: artifactMemory.storage,
    bucketName: runtime.gcp.artifact_bucket,
    prefix: gcsPrefix,
  });
  const sourceStore = sourceFaultBoundary(durableSource);
  const artifactStore = artifactFaultBoundary(durableArtifact);
  const admissionFault = admissionFaultBoundary(store);
  const taskClient = new FakeCloudTasksClient();
  const dispatcher = createCloudTasksDispatcher({
    client: taskClient,
    projectId: runtime.gcp.project_id,
    location: runtime.gcp.region,
    queueId: runtime.gcp.queue_id,
    targetUrl: runtime.gcp.worker_url,
    audience: runtime.gcp.worker_audience,
    serviceAccountEmail: runtime.gcp.task_invoker_service_account,
  });
  const fakeVertex = createFakeVertexClient({ permanentTransientJobs: [] });
  const provider = createVertexGeminiProvider({
    client: fakeVertex.client,
    projectId: runtime.gcp.project_id,
    location: runtime.provider.location,
    clock: () => {
      providerNow += 5;
      return providerNow;
    },
  });
  const effects = createPhase2EffectsFirewall();
  const control = createPhase2ControlService({
    config: runtime,
    store: admissionFault.store,
    sourceStore,
    dispatcher,
    clock: () => now,
    idFactory: runtimeId,
  });
  const worker = createPhase2WorkerService({
    config: runtime,
    store,
    sourceStore,
    artifactStore,
    provider,
    effects,
    clock: () => now,
  });
  const auth = makeAuth();
  const controlHandler = createControlHandler({
    auth,
    intake: control.accept,
    reconciler: control.reconcile,
    config: phase2ProofHttpConfig(runtime, runtime.gcp.control_audience),
  });
  const workerHandler = createWorkerHandler({
    auth,
    worker: worker.execute,
    config: phase2ProofHttpConfig(runtime, runtime.gcp.worker_audience),
  });
  const routeTrace = [];
  const call = (handler, input) => phase2ProofRequest(handler, { ...input, trace: routeTrace });

  return {
    runtime,
    firestore,
    store,
    sourceMemory,
    artifactMemory,
    gcsPrefix,
    sourceStore,
    artifactStore,
    admissionFault,
    taskClient,
    fakeVertex,
    effects,
    auth,
    routeTrace,
    controlHandler,
    workerHandler,
    call,
    advance(milliseconds) { now += milliseconds; },
    taskBodies() { return phase2ProofTaskBodies(taskClient); },
  };
}
