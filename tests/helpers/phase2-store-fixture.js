import { createFirestoreExecutionStore } from '../../server/kernel/durable-execution/phase2/firestore-store.js';
import { createPhase2WorkEnvelope } from '../../server/kernel/durable-execution/phase2/work-envelope.js';
import { FakeFirestore } from './firestore-fake.js';

export function workEnvelope(overrides = {}) {
  return createPhase2WorkEnvelope({
    site_id: 'site-1',
    pilot_run_id: 'pilot-1',
    job_id: 'job-1',
    task_id: 'task-1',
    packet_id: 'packet-1',
    idempotency_key: 'idem-1',
    request_id: 'request-1',
    project_id: 'project-1',
    selected_direction_id: 'direction-1',
    packet_digest: 'd'.repeat(64),
    artifact_manifest_sha256: 'a'.repeat(64),
    source: {
      ref: 'gs://phase2-pilot/packets/packet-1.json#1',
      sha256: 'b'.repeat(64),
      bytes: 20,
    },
    ...overrides,
  });
}

export function identityFor(envelope) {
  return Object.fromEntries([
    'site_id', 'pilot_run_id', 'job_id', 'task_id', 'packet_id',
    'idempotency_key', 'request_id', 'project_id', 'packet_digest',
    'artifact_manifest_sha256', 'selected_direction_id',
  ].map((key) => [key, envelope[key]]));
}

export function reservationFor(envelope, overrides = {}) {
  return {
    identityWithoutSource: identityFor(envelope),
    siteId: envelope.site_id,
    pilotRunId: envelope.pilot_run_id,
    idempotencyKey: envelope.idempotency_key,
    jobMaxCostMicros: 2_000,
    ...overrides,
  };
}

export async function storeHarness({ maxJobs = 20, maxTotalCostMicros = 10_000 } = {}) {
  let now = 1_800_000_000_000;
  let sequence = 0;
  const firestore = new FakeFirestore();
  const store = createFirestoreExecutionStore({
    firestore,
    clock: () => now,
    idFactory: (kind) => `${kind}_${String(++sequence).padStart(4, '0')}`,
  });
  await store.bootstrapControls({ pilotRunId: 'pilot-1', maxJobs, maxTotalCostMicros });
  return {
    firestore,
    store,
    now: () => now,
    advance: (milliseconds) => { now += milliseconds; },
    enable: () => store.setControls({
      global_pause: false,
      dispatch_enabled: true,
      worker_enabled: true,
      provider_enabled: true,
    }, 'test'),
  };
}

export async function accept(store, envelope = workEnvelope(), overrides = {}) {
  const options = {
    siteId: envelope.site_id,
    pilotRunId: envelope.pilot_run_id,
    idempotencyKey: envelope.idempotency_key,
    jobMaxCostMicros: 2_000,
    ...overrides,
  };
  const reserved = await store.reserveWorkAdmission({
    identityWithoutSource: identityFor(envelope),
    ...options,
  });
  if (reserved.finalized) return reserved.acceptance;
  return store.finalizeWorkAdmission({
    envelope,
    siteId: options.siteId,
    pilotRunId: options.pilotRunId,
    idempotencyKey: options.idempotencyKey,
  });
}

export function providerOutput(envelope = workEnvelope()) {
  return {
    schema: 'famtastic.execution.vertex-observation.v1',
    job_id: envelope.job_id,
    task_id: envelope.task_id,
    packet_id: envelope.packet_id,
    project_id: envelope.project_id,
    review_status: 'ready_for_review',
    summary: 'Checkpointed shadow observation.',
    observations: [],
  };
}

export function taskName(reservation) {
  return `queues/pilot/tasks/${reservation.task_id}`;
}

export async function dispatchAndClaim(store, accepted, {
  generation = 1,
  workerId = 'worker-1',
  leaseMs = 5_000,
} = {}) {
  const reservation = await store.reserveDispatch({
    intentId: accepted.intent_id,
    dispatcherId: 'dispatcher-1',
  });
  const name = taskName(reservation);
  await store.markDispatchDelivered({
    intentId: accepted.intent_id,
    dispatchGeneration: generation,
    reservationToken: reservation.reservation_token,
    taskName: name,
  });
  const lease = await store.claimJob({
    jobId: accepted.job_id,
    intentId: accepted.intent_id,
    dispatchGeneration: generation,
    pilotRunId: 'pilot-1',
    siteId: reservation.site_id,
    packetDigest: reservation.packet_digest,
    workerId,
    leaseMs,
    taskName: name,
  });
  return { reservation, lease };
}
