import { assertMockProvider, createEffectsFirewall } from './mock-provider.js';

function failure(statusCode, code, message) {
  return Object.assign(new Error(message), { statusCode, code });
}

export function createExecutionRuntime({
  store,
  provider,
  artifactStore,
  enabled = false,
  workerId = 'phase1-mock-worker',
  leaseMs = 30_000,
  baseBackoffMs = 1_000,
} = {}) {
  if (!store || !artifactStore) throw failure(500, 'execution_runtime_invalid', 'Store and artifact store are required');
  if (typeof enabled !== 'boolean') throw failure(400, 'execution_runtime_flag_invalid', 'Runtime enabled must be an exact boolean');
  const mockProvider = assertMockProvider(provider);
  const effects = createEffectsFirewall();
  if (!Number.isInteger(baseBackoffMs) || baseBackoffMs < 0 || baseBackoffMs > 3_600_000) {
    throw failure(400, 'backoff_invalid', 'Base retry backoff must be an integer from 0 through 3600000 ms');
  }

  function requireEnabled() {
    if (!enabled) throw failure(503, 'worker_runtime_disabled', 'The Phase 1 worker runtime is disabled');
  }

  function runOne() {
    requireEnabled();
    const lease = store.claimNextJob({ workerId, leaseMs });
    if (!lease) return null;
    store.assertWorkerRunnable();
    const result = mockProvider.execute(lease);
    if (!result.ok) {
      return store.failJob({
        lease,
        call: result.call,
        retryable: result.retryable,
        failureClass: result.failureClass,
        reason: result.reason,
        baseBackoffMs,
      });
    }
    const artifact = artifactStore.write({
      jobId: lease.job_id,
      logicalKey: 'mock-result',
      version: 1,
      output: result.output,
    });
    return store.completeJob({ lease, call: result.call, artifact });
  }

  return {
    runOne,
    dispatch: (options) => { requireEnabled(); return store.dispatchPending(options); },
    reconcile: (options = {}) => store.reconcile(options),
    telemetry: () => ({ provider: mockProvider.telemetry(), effects: effects.snapshot() }),
  };
}
