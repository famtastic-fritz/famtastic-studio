import crypto from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { canonicalJson } from '../server/kernel/durable-execution/phase2/canonical.js';
import { loadPhase2Config, PHASE2_ENV } from '../server/kernel/durable-execution/phase2/config.js';
import { createFirestoreExecutionStore } from '../server/kernel/durable-execution/phase2/firestore-store.js';
import { createPhase2ControlService } from '../server/kernel/durable-execution/phase2/runtime.js';
import {
  createPhase2RuntimeSource,
  reconcilePhase2RuntimeSources,
} from '../server/kernel/durable-execution/phase2/runtime-source.js';
import { FakeFirestore } from './helpers/firestore-fake.js';

function packet() {
  const artifacts = [{
    role: 'selected_preview', path: 'proof/index.html', sha256: 'a'.repeat(64), bytes: 1200,
  }];
  const manifest = artifacts.map(({ bytes, path, role, sha256 }) => ({ bytes, path, role, sha256 }));
  return {
    schema: 'famtastic.site-studio.build-packet.v1',
    packet_id: 'packet-1',
    idempotency_key: 'idem-1',
    request_id: 'request-1',
    project_id: 'project-1',
    build_class: 'prepayment_selected_direction_staging',
    selected_direction_ids: ['direction-1'],
    artifacts,
    artifact_manifest_sha256: crypto.createHash('sha256').update(JSON.stringify(manifest)).digest('hex'),
    selected_artifacts: [{
      direction_id: 'direction-1',
      source_artifact_path: artifacts[0].path,
      source_artifact_sha256: artifacts[0].sha256,
      source_artifact_bytes: artifacts[0].bytes,
    }],
    boundary: { deploy_authorized: false },
  };
}

function oversizedPacket() {
  const value = packet();
  value.artifacts = Array.from({ length: 500 }, (_, index) => ({
    role: index === 0 ? 'selected_preview' : 'render_evidence',
    path: `proof/${String(index).padStart(3, '0')}-${'x'.repeat(470)}`,
    sha256: crypto.createHash('sha256').update(String(index)).digest('hex'),
    bytes: 1,
  }));
  value.selected_artifacts = [{
    direction_id: 'direction-1',
    source_artifact_path: value.artifacts[0].path,
    source_artifact_sha256: value.artifacts[0].sha256,
    source_artifact_bytes: 1,
  }];
  const manifest = value.artifacts.map(({ bytes, path, role, sha256 }) => ({ bytes, path, role, sha256 }));
  value.artifact_manifest_sha256 = crypto.createHash('sha256').update(JSON.stringify(manifest)).digest('hex');
  return value;
}

function runtimeConfig() {
  return loadPhase2Config({
    [PHASE2_ENV.mode]: 'cloud-shadow', [PHASE2_ENV.scope]: 'phase2-pilot',
    [PHASE2_ENV.runtime]: '1', [PHASE2_ENV.maxJobs]: '20',
    [PHASE2_ENV.pilotRunId]: 'pilot-1', [PHASE2_ENV.maxJobCostMicros]: '250000',
    [PHASE2_ENV.maxTotalCostMicros]: '5000000', [PHASE2_ENV.model]: 'gemini-3.1-flash-lite',
    [PHASE2_ENV.pricebookVersion]: 'vertex-gemini-2026-09-21',
    [PHASE2_ENV.vertexLocation]: 'global', [PHASE2_ENV.projectId]: 'pilot-project-123',
    [PHASE2_ENV.region]: 'us-central1', [PHASE2_ENV.queueId]: 'phase2-pilot',
    [PHASE2_ENV.workerUrl]: 'https://phase2-worker.run.app/internal/tasks/execute',
    [PHASE2_ENV.workerAudience]: 'https://phase2-worker.run.app',
    [PHASE2_ENV.controlAudience]: 'https://phase2-control.run.app',
    [PHASE2_ENV.intakeServiceAccount]: 'phase2-intake@pilot-project-123.iam.gserviceaccount.com',
    [PHASE2_ENV.schedulerServiceAccount]: 'phase2-scheduler@pilot-project-123.iam.gserviceaccount.com',
    [PHASE2_ENV.taskInvokerServiceAccount]: 'phase2-invoker@pilot-project-123.iam.gserviceaccount.com',
    [PHASE2_ENV.firestoreDatabase]: 'phase2-pilot',
    [PHASE2_ENV.sourceBucket]: 'phase2-source-bucket',
    [PHASE2_ENV.artifactBucket]: 'phase2-artifact-bucket',
  });
}

function identity(prepared) {
  return {
    site_id: 'project-project-1',
    pilot_run_id: 'pilot-1',
    job_id: 'job-1',
    task_id: 'task-1',
    packet_id: 'packet-1',
    idempotency_key: 'idem-1',
    request_id: 'request-1',
    project_id: 'project-1',
    packet_digest: prepared.packet_digest,
    artifact_manifest_sha256: packet().artifact_manifest_sha256,
    selected_direction_id: 'direction-1',
  };
}

async function harness({ reserve = true } = {}) {
  let now = 1_800_000_000_000;
  let sequence = 0;
  const store = createFirestoreExecutionStore({
    firestore: new FakeFirestore(),
    clock: () => now,
    idFactory: (kind) => `${kind}_${String(++sequence).padStart(4, '0')}`,
  });
  await store.bootstrapControls({ pilotRunId: 'pilot-1', maxJobs: 20, maxTotalCostMicros: 5_000_000 });
  await store.setControls({ global_pause: false }, 'test');
  const prepared = createPhase2RuntimeSource(packet());
  const admissionIdentity = identity(prepared);
  if (reserve) {
    await store.reserveWorkAdmission({
      identityWithoutSource: admissionIdentity,
      siteId: admissionIdentity.site_id,
      pilotRunId: 'pilot-1',
      idempotencyKey: admissionIdentity.idempotency_key,
      maxAttempts: 3,
      jobMaxCostMicros: 250_000,
    });
  }
  let source = null;
  return {
    store,
    prepared,
    admissionIdentity,
    setSource(output) {
      const body = Buffer.from(canonicalJson(output));
      source = {
        artifact_ref: 'gs://source-bucket/phase2/jobs/job-1/artifacts/staging-packet-v1.json#1',
        sha256: crypto.createHash('sha256').update(body).digest('hex'),
        bytes: body.length,
        body,
      };
    },
    sourceStore: { bucket_name: 'source-bucket', readDeterministic: async () => source },
    advance: (milliseconds) => { now += milliseconds; },
  };
}

async function recover(base) {
  return reconcilePhase2RuntimeSources({
    store: base.store,
    sourceStore: base.sourceStore,
    pilotRunId: 'pilot-1',
    limit: 20,
  });
}

describe('Phase 2 staged-admission recovery', () => {
  it('binds prototype-shaped intake fields into the digest without forwarding them', () => {
    const ordinary = createPhase2RuntimeSource(packet());
    const keyed = packet();
    Object.defineProperty(keyed, '__proto__', {
      value: { customer_instruction: 'must remain digest-only' }, enumerable: true,
    });
    const prepared = createPhase2RuntimeSource(keyed);
    expect(prepared.packet_digest).not.toBe(ordinary.packet_digest);
    expect(Object.hasOwn(prepared.output.packet, '__proto__')).toBe(false);
    expect(JSON.stringify(prepared.output.packet)).not.toContain('customer_instruction');
  });

  it('rejects a provider-oversized projection before any durable admission or source write', async () => {
    const base = await harness({ reserve: false });
    const runtime = runtimeConfig();
    let writes = 0;
    const sourceStore = {
      bucket_name: runtime.gcp.source_bucket,
      write: async () => { writes += 1; throw new Error('must not write'); },
      readDeterministic: async () => null,
    };
    const parent = `projects/${runtime.gcp.project_id}/locations/${runtime.gcp.region}/queues/${runtime.gcp.queue_id}`;
    const control = createPhase2ControlService({
      config: runtime,
      store: base.store,
      sourceStore,
      dispatcher: {
        parent, target_url: runtime.gcp.worker_url, audience: runtime.gcp.worker_audience,
        create: async () => { throw new Error('must not dispatch'); },
      },
    });
    await expect(control.accept({ body: { packet: oversizedPacket() } }))
      .rejects.toMatchObject({ code: 'vertex_input_too_large', statusCode: 413 });
    expect(writes).toBe(0);
    expect(await base.store.snapshotCounts()).toMatchObject({ agentTaskLog: 0, executionJobs: 0 });
    expect(await base.store.getBudget('pilot-1')).toMatchObject({ accepted_jobs: 0 });
  });

  it('finalizes an immutable source written before the intake response crashed', async () => {
    const base = await harness();
    base.setSource(base.prepared.output);
    await expect(recover(base)).resolves.toMatchObject({ finalized: ['job-1'], errors: [] });
    expect(await base.store.getJob('job-1')).toMatchObject({ state: 'accepted' });
    expect((await base.store.findByKey('project-project-1', 'idem-1')).outbox)
      .toMatchObject({ state: 'pending' });
  });

  it('does not expire a missing source while a retry holds a renewed write lease', async () => {
    const base = await harness();
    const runtime = runtimeConfig();
    base.advance((15 * 60 * 1000) + 1);
    let releaseWrite;
    let source = null;
    let signalWriting;
    const writing = new Promise((resolve) => { signalWriting = resolve; });
    const writeGate = new Promise((resolve) => { releaseWrite = resolve; });
    const sourceStore = {
      bucket_name: runtime.gcp.source_bucket,
      async write({ output }) {
        signalWriting();
        await writeGate;
        const body = Buffer.from(canonicalJson(output));
        source = {
          artifact_ref: `gs://${runtime.gcp.source_bucket}/phase2/jobs/job-1/artifacts/staging-packet-v1.json#1`,
          sha256: crypto.createHash('sha256').update(body).digest('hex'),
          bytes: body.length,
          body,
        };
        return source;
      },
      readDeterministic: async () => source,
    };
    const parent = `projects/${runtime.gcp.project_id}/locations/${runtime.gcp.region}/queues/${runtime.gcp.queue_id}`;
    const control = createPhase2ControlService({
      config: runtime, store: base.store, sourceStore,
      dispatcher: {
        parent, target_url: runtime.gcp.worker_url, audience: runtime.gcp.worker_audience,
        create: async () => { throw new Error('dispatch disabled'); },
      },
      idFactory: (kind) => (kind === 'job' ? 'job-1' : 'task-1'),
    });
    const accepting = control.accept({ body: { packet: packet() } });
    await writing;
    await expect(control.reconcile()).rejects.toMatchObject({ code: 'phase2_dispatch_disabled' });
    expect(await base.store.getJob('job-1')).toMatchObject({ state: 'admission_reserved' });
    releaseWrite();
    await expect(accepting).resolves.toMatchObject({ status: 202 });
    expect(await base.store.getJob('job-1')).toMatchObject({ state: 'accepted' });
  });

  it('terminally classifies a source that stays missing beyond its recovery window', async () => {
    const base = await harness();
    base.advance((15 * 60 * 1000) + 1);
    await expect(recover(base)).resolves.toMatchObject({ expired: ['job-1'], errors: [] });
    expect(await base.store.getJob('job-1')).toMatchObject({
      state: 'admission_expired', last_failure_class: 'admission_source_missing',
    });
  });

  it('dead-letters an immutable source that violates the exact wrapper contract', async () => {
    const base = await harness();
    base.setSource({ ...base.prepared.output, unexpected: true });
    await expect(recover(base)).resolves.toMatchObject({ invalid: ['job-1'], errors: [] });
    expect(await base.store.getJob('job-1')).toMatchObject({
      state: 'admission_failed', last_failure_class: 'admission_source_invalid',
    });
  });
});
