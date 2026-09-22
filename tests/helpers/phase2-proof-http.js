import { Readable } from 'node:stream';
import { createControlHandler } from '../../server/cloud/control-server.js';
import { createWorkerHandler } from '../../server/cloud/worker-server.js';
import { createCloudTasksDispatcher } from '../../server/kernel/durable-execution/phase2/cloud-tasks.js';
import { loadPhase2Config, PHASE2_ENV } from '../../server/kernel/durable-execution/phase2/config.js';
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
  installProcessNetworkGuard,
} from './phase2-proof-fakes.js';
import { phase2ProofPacket } from './phase2-proof-fixtures.js';

export function phase2ProofConfig({
  pilotRunId = 'pilot-http-proof',
  maxJobCostMicros = 80_000,
  maxTotalCostMicros = 1_600_000,
} = {}) {
  return loadPhase2Config({
    [PHASE2_ENV.mode]: 'cloud-shadow',
    [PHASE2_ENV.scope]: 'phase2-pilot',
    [PHASE2_ENV.runtime]: '1',
    [PHASE2_ENV.maxJobs]: '20',
    [PHASE2_ENV.pilotRunId]: pilotRunId,
    [PHASE2_ENV.maxJobCostMicros]: String(maxJobCostMicros),
    [PHASE2_ENV.maxTotalCostMicros]: String(maxTotalCostMicros),
    [PHASE2_ENV.model]: 'gemini-3.1-flash-lite',
    [PHASE2_ENV.pricebookVersion]: 'vertex-gemini-2026-09-21',
    [PHASE2_ENV.vertexLocation]: 'global',
    [PHASE2_ENV.projectId]: 'phase2-proof-project',
    [PHASE2_ENV.region]: 'us-central1',
    [PHASE2_ENV.queueId]: 'phase2-proof',
    [PHASE2_ENV.workerUrl]: 'https://phase2-worker-proof-uc.a.run.app/internal/tasks/execute',
    [PHASE2_ENV.workerAudience]: 'https://phase2-worker-proof-uc.a.run.app',
    [PHASE2_ENV.controlAudience]: 'https://phase2-control-proof-uc.a.run.app',
    [PHASE2_ENV.intakeServiceAccount]: 'phase2-intake@phase2-proof-project.iam.gserviceaccount.com',
    [PHASE2_ENV.schedulerServiceAccount]: 'phase2-scheduler@phase2-proof-project.iam.gserviceaccount.com',
    [PHASE2_ENV.taskInvokerServiceAccount]: 'phase2-invoker@phase2-proof-project.iam.gserviceaccount.com',
    [PHASE2_ENV.firestoreDatabase]: 'phase2-proof',
    [PHASE2_ENV.sourceBucket]: 'phase2-proof-sources',
    [PHASE2_ENV.artifactBucket]: 'phase2-proof-results',
  });
}

export function phase2ProofHttpConfig(runtime, audience) {
  return {
    audience,
    maxJsonBytes: 1024 * 1024,
    allowedPrincipals: {
      accept: [runtime.gcp.intake_service_account],
      reconcile: [runtime.gcp.scheduler_service_account],
      execute: [runtime.gcp.task_invoker_service_account],
    },
  };
}

export async function phase2ProofRequest(handler, {
  url, body, principal, trace = null,
}) {
  const bytes = Buffer.from(JSON.stringify(body));
  const req = Readable.from([bytes]);
  req.method = 'POST';
  req.url = url;
  req.headers = {
    'content-type': 'application/json; charset=utf-8',
    'content-length': String(bytes.length),
    'x-proof-principal': principal,
  };
  let response;
  const completed = new Promise((resolve) => {
    const res = {
      writableEnded: false,
      statusCode: 200,
      headers: {},
      writeHead(statusCode, headers) {
        this.statusCode = statusCode;
        this.headers = headers;
      },
      end(chunk) {
        this.writableEnded = true;
        response = {
          status: this.statusCode,
          headers: this.headers,
          body: JSON.parse(Buffer.from(chunk || '{}').toString('utf8')),
        };
        resolve();
      },
    };
    handler(req, res);
  });
  await completed;
  if (trace) trace.push({ url, principal, status: response.status });
  return response;
}

export function phase2ProofTaskBodies(client) {
  return [...client.tasks.values()].map((task) => (
    JSON.parse(Buffer.from(task.httpRequest.body).toString('utf8'))
  )).sort((left, right) => left.dispatch_generation - right.dispatch_generation);
}

function requireProof(condition, message) {
  if (!condition) throw new Error(`Phase 2 HTTP checkpoint proof failed: ${message}`);
}

export function assertPhase2HttpCheckpointProofReport(report) {
  requireProof(report?.proof_scope === 'phase2_in_process_http_fixture', 'scope is not the in-process HTTP fixture');
  requireProof(report.activation_evidence === false
    && report.firestore_emulator_concurrency_proven === false
    && report.gcp_canary_proven === false, 'hermetic evidence was overstated');
  requireProof(report.admission_status === 202, 'HTTP admission did not succeed');
  requireProof(report.crash_status === 503
    && report.crash_error === 'phase2_artifact_persistence_pending'
    && report.checkpoint_state_before_recovery === 'provider_succeeded',
  'provider success was not durably checkpointed before the injected crash');
  requireProof(report.recovery_status === 200
    && report.recovery_state === 'provider_resume'
    && JSON.stringify(report.dispatch_generations) === JSON.stringify([1, 2]),
  'checkpoint recovery did not create the expected resume dispatch');
  requireProof(report.completion_status === 200
    && report.final_state === 'awaiting_approval', 'resumed execution did not reach the review gate');
  requireProof(report.provider_calls === 1
    && report.artifact_write_attempts === 2, 'checkpoint recovery repeated provider work or skipped artifact recovery');
  requireProof(report.external_effects_zero === true, 'an external customer effect occurred');
  const expectedNetworkKeys = ['fetch', 'http', 'https', 'net', 'tls'];
  const network = report.process_network_attempts;
  requireProof(network && typeof network === 'object' && !Array.isArray(network)
    && JSON.stringify(Object.keys(network).sort()) === JSON.stringify(expectedNetworkKeys)
    && expectedNetworkKeys.every((key) => network[key] === 0), 'a process network hook was invoked or omitted');
  return report;
}

export async function runPhase2HttpCheckpointProof() {
  const network = installProcessNetworkGuard();
  try {
    const runtime = phase2ProofConfig();
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
      actor: 'phase2-http-proof',
    });
    const sourceMemory = createMemoryGcs();
    const artifactMemory = createMemoryGcs();
    const gcsPrefix = `phase2/${runtime.pilot_run_id}`;
    const sourceStore = createGcsArtifactStore({
      storage: sourceMemory.storage,
      bucketName: runtime.gcp.source_bucket,
      prefix: gcsPrefix,
    });
    const durableArtifactStore = createGcsArtifactStore({
      storage: artifactMemory.storage,
      bucketName: runtime.gcp.artifact_bucket,
      prefix: gcsPrefix,
    });
    let artifactWriteAttempts = 0;
    const crashOnceArtifactStore = {
      bucket_name: durableArtifactStore.bucket_name,
      async write(input) {
        artifactWriteAttempts += 1;
        if (artifactWriteAttempts === 1) {
          throw Object.assign(new Error('synthetic crash after provider checkpoint'), {
            code: 'synthetic_post_checkpoint_crash',
          });
        }
        return durableArtifactStore.write(input);
      },
    };
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
    const control = createPhase2ControlService({
      config: runtime,
      store,
      sourceStore,
      dispatcher,
      clock: () => now,
    });
    const fakeVertex = createFakeVertexClient();
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
    const worker = createPhase2WorkerService({
      config: runtime,
      store,
      sourceStore,
      artifactStore: crashOnceArtifactStore,
      provider,
      effects,
      clock: () => now,
    });
    const auth = {
      async verify({ headers }) {
        return { email: headers['x-proof-principal'] };
      },
    };
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

    await store.setControls({ global_pause: false }, 'phase2-http-proof-admission');
    const accepted = await phase2ProofRequest(controlHandler, {
      url: '/v1/staging/accept',
      body: { packet: phase2ProofPacket(1) },
      principal: runtime.gcp.intake_service_account,
    });
    requireProof(accepted.status === 202, 'HTTP admission failed');
    await store.setControls({
      global_pause: false,
      dispatch_enabled: true,
      worker_enabled: true,
      provider_enabled: true,
    }, 'phase2-http-proof-run');
    const dispatched = await phase2ProofRequest(controlHandler, {
      url: '/internal/reconcile',
      body: {},
      principal: runtime.gcp.scheduler_service_account,
    });
    requireProof(dispatched.status === 200, 'initial HTTP dispatch failed');
    const firstTask = phase2ProofTaskBodies(taskClient)[0];
    const crashed = await phase2ProofRequest(workerHandler, {
      url: '/internal/tasks/execute',
      body: firstTask,
      principal: runtime.gcp.task_invoker_service_account,
    });
    if (crashed.status !== 503 || crashed.body.error !== 'phase2_artifact_persistence_pending') {
      const failedJob = await store.getJob(firstTask.job_id);
      const failedTask = failedJob ? await store.getTask(failedJob.task_id) : null;
      requireProof(false, `unexpected first worker response ${crashed.status}:${JSON.stringify({
        body: crashed.body,
        failure: failedTask?.failure_reason,
        provider_calls: fakeVertex.calls.length,
      })}`);
    }
    const jobAfterCrash = await store.getJob(firstTask.job_id);
    const attemptAfterCrash = await store.getAttempt(jobAfterCrash.active_attempt_id);
    const callAfterCrash = await store.getModelCall(attemptAfterCrash.model_call_id);

    now += 240_001;
    const recovered = await phase2ProofRequest(controlHandler, {
      url: '/internal/reconcile',
      body: {},
      principal: runtime.gcp.scheduler_service_account,
    });
    const secondTask = phase2ProofTaskBodies(taskClient).at(-1);
    const completed = await phase2ProofRequest(workerHandler, {
      url: '/internal/tasks/execute',
      body: secondTask,
      principal: runtime.gcp.task_invoker_service_account,
    });
    const finalJob = await store.getJob(firstTask.job_id);
    const effectSnapshot = effects.snapshot();
    const effectCounts = [...Object.values(effectSnapshot.attempted), ...Object.values(effectSnapshot.completed)];
    return assertPhase2HttpCheckpointProofReport({
      proof_scope: 'phase2_in_process_http_fixture',
      activation_evidence: false,
      firestore_emulator_concurrency_proven: false,
      gcp_canary_proven: false,
      admission_status: accepted.status,
      crash_status: crashed.status,
      crash_error: crashed.body.error,
      checkpoint_state_before_recovery: callAfterCrash.state,
      recovery_status: recovered.status,
      recovery_state: recovered.body.recovery.recovered_leases[0]?.state,
      dispatch_generations: phase2ProofTaskBodies(taskClient).map((task) => task.dispatch_generation),
      completion_status: completed.status,
      final_state: finalJob.state,
      provider_calls: fakeVertex.calls.length,
      artifact_write_attempts: artifactWriteAttempts,
      external_effects_zero: effectCounts.every((value) => value === 0),
      process_network_attempts: { ...network.attempts },
    });
  } finally {
    network.restore();
  }
}
