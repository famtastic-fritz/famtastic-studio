import { describe, expect, it } from 'vitest';
import { accept, storeHarness, taskName, workEnvelope, reservationFor } from './helpers/phase2-store-fixture.js';

function retryAfterDelay(h, delay = 60_000) {
  const original = h.firestore.runTransaction.bind(h.firestore);
  h.firestore.runTransaction = async (operation) => {
    await original(async (tx) => { await operation(tx); tx.operations = []; });
    h.advance(delay);
    return original(operation);
  };
}

describe('dispatch document and retry fencing', () => {
  for (const operation of ['reserve', 'deliver', 'release']) {
    it.each(['outbox-id', 'job-id', 'job-intent', 'generation'])(`${operation} rejects corrupt %s without writes`, async (field) => {
      const h = await storeHarness();
      await h.enable();
      const a = await accept(h.store);
      const reserved = await h.store.reserveDispatch({ intentId: a.intent_id, dispatcherId: 'test' });
      const jobPath = `executionJobs/${a.job_id}`;
      const outboxPath = `executionOutbox/${a.intent_id}`;
      if (field === 'outbox-id') h.firestore.seed(outboxPath, { ...h.firestore.read(outboxPath), intent_id: 'foreign' });
      if (field === 'job-id') h.firestore.seed(jobPath, { ...h.firestore.read(jobPath), job_id: 'foreign' });
      if (field === 'job-intent') h.firestore.seed(jobPath, { ...h.firestore.read(jobPath), intent_id: 'foreign' });
      if (field === 'generation') h.firestore.seed(outboxPath, { ...h.firestore.read(outboxPath), dispatch_generation: 1.5 });
      const before = h.firestore.dump();
      const options = { intentId: a.intent_id, dispatchGeneration: 1, reservationToken: reserved.reservation_token, taskName: taskName(reserved) };
      const invoke = operation === 'reserve'
        ? () => h.store.reserveDispatch({ intentId: a.intent_id, dispatcherId: 'test' })
        : operation === 'deliver' ? () => h.store.markDispatchDelivered(options)
          : () => h.store.releaseDispatch({ ...options, error: 'unavailable' });
      await expect(invoke()).rejects.toMatchObject({ code: 'dispatch_identity_conflict' });
      expect(h.firestore.dump()).toEqual(before);
    });
  }

  it('uses the retried transaction timestamp for reservation and claim deadlines', async () => {
    const h = await storeHarness();
    await h.enable();
    const a = await accept(h.store);
    // Discard the first attempt's buffered writes, advance time, then retry.
    retryAfterDelay(h);
    await h.store.reserveDispatch({ intentId: a.intent_id, dispatcherId: 'test', reservationMs: 30_000 });
    const outbox = await h.store.getOutbox(a.intent_id);
    expect(outbox.reservation_expires_at_ms).toBe(h.now() + 30_000);
    expect(outbox.claim_not_after_ms).toBe(h.now() + 900_000);
  });

  it('starts the admission recovery window at the retried timestamp', async () => {
    const h = await storeHarness();
    await h.enable();
    retryAfterDelay(h);
    const reserved = await h.store.reserveWorkAdmission(reservationFor(workEnvelope()));
    expect(reserved.expires_at_ms).toBe(h.now() + 900_000);
  });

  it('starts the worker lease at the retried timestamp', async () => {
    const h = await storeHarness();
    await h.enable();
    const a = await accept(h.store);
    const r = await h.store.reserveDispatch({ intentId: a.intent_id, dispatcherId: 'test' });
    const name = taskName(r);
    await h.store.markDispatchDelivered({ intentId: a.intent_id, dispatchGeneration: 1, reservationToken: r.reservation_token, taskName: name });
    retryAfterDelay(h);
    const lease = await h.store.claimJob({ jobId: a.job_id, intentId: a.intent_id,
      dispatchGeneration: 1, pilotRunId: 'pilot-1', siteId: r.site_id,
      packetDigest: r.packet_digest, workerId: 'test', leaseMs: 5_000, taskName: name });
    expect(lease.lease_expires_at_ms).toBe(h.now() + 5_000);
  });

  it('rejects stale release even when the newer generation is already delivered', async () => {
    const h = await storeHarness();
    await h.enable();
    const a = await accept(h.store);
    const r = await h.store.reserveDispatch({ intentId: a.intent_id, dispatcherId: 'test' });
    await h.store.markDispatchDelivered({ intentId: a.intent_id, dispatchGeneration: 1, reservationToken: r.reservation_token, taskName: taskName(r) });
    const before = h.firestore.dump();
    await expect(h.store.releaseDispatch({ intentId: a.intent_id, dispatchGeneration: 2, reservationToken: r.reservation_token, error: 'late' }))
      .rejects.toMatchObject({ code: 'stale_dispatch_generation' });
    expect(h.firestore.dump()).toEqual(before);
  });
});
