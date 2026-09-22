import { canonicalDigest, canonicalJson } from '../../server/kernel/durable-execution/phase2/canonical.js';
import {
  PHASE2_PROVIDER_CALL_RESERVATION_MICROS, VERTEX_GEMINI_MODEL, VERTEX_GEMINI_PRICEBOOK_VERSION,
} from '../../server/kernel/durable-execution/phase2/pricebook.js';
import { accept, dispatchAndClaim, providerOutput, storeHarness } from './phase2-store-fixture.js';

// All records, usage and costs in this fixture are synthetic and in memory.
export async function activeFencingHarness({ checkpoint = false, leaseMs = 240_000 } = {}) {
  const h = await storeHarness({ maxTotalCostMicros: 5_000_000 });
  await h.enable();
  const accepted = await accept(h.store, undefined, { jobMaxCostMicros: 250_000 });
  const { lease } = await dispatchAndClaim(h.store, accepted, { leaseMs });
  const call = await h.store.reserveModelCall({
    lease, model: VERTEX_GEMINI_MODEL, pricebookVersion: VERTEX_GEMINI_PRICEBOOK_VERSION,
    reservedCostMicros: PHASE2_PROVIDER_CALL_RESERVATION_MICROS,
  });
  const output = providerOutput();
  if (checkpoint) await h.store.checkpointProviderSuccess({
    lease, modelCallId: call.model_call_id, output, providerRequestId: 'synthetic-request-1',
    inputTokens: 1000, outputTokens: 200, thinkingTokens: 0, cachedInputTokens: 0,
    totalTokens: 1200, latencyMs: 10, promptVersion: 'synthetic-v1',
    inputSha256: 'e'.repeat(64), actualCostMicros: 550,
  });
  return {
    ...h, accepted, lease, call,
    artifact: {
      logical_key: 'shadow-observation', version: 1,
      artifact_ref: 'gs://phase2-pilot/jobs/job-1/shadow-observation-v1.json#1',
      sha256: canonicalDigest(output), bytes: Buffer.byteLength(canonicalJson(output)),
    },
  };
}

export function claimInput(h, overrides = {}) {
  return {
    jobId: h.lease.job_id, intentId: h.lease.intent_id,
    dispatchGeneration: h.lease.dispatch_generation, pilotRunId: h.lease.pilot_run_id,
    siteId: 'site-1', packetDigest: 'd'.repeat(64), workerId: 'replacement',
    taskName: 'unused-on-rejection', leaseMs: 240_000, ...overrides,
  };
}

export function seedField(h, collection, id, field, value) {
  const path = `${collection}/${id}`;
  h.firestore.seed(path, { ...h.firestore.read(path), [field]: value });
}
