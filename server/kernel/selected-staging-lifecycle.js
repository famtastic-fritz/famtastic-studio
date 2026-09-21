import { selectedStagingDiagnostic } from './selected-staging-configuration.js';

// One facade is injected into all HTTP modules. Embedded wakes coalesce; external
// mode leaves consumption to the CLI. Cross-process exclusion remains in SQLite.
export function createSelectedStagingLifecycle({ runtime, workerMode, pollIntervalMs = 5000,
  report = entry => console.error(JSON.stringify(entry)) }) {
  let started = false, stopping = false, timer = null, pending = null, closing = null;
  const operations = new Set();
  function track(operation) {
    const result = Promise.resolve().then(operation);
    operations.add(result);
    result.then(() => operations.delete(result), () => operations.delete(result));
    return result;
  }
  function wake() {
    if (!runtime || stopping || workerMode !== 'embedded') return Promise.resolve([]);
    if (!pending) {
      clearTimeout(timer); timer = null;
      pending = track(() => runtime.wake()).catch(error => {
        report(selectedStagingDiagnostic(error, 'wake'));
        throw error;
      }).finally(() => { pending = null; schedule(); });
    }
    return pending;
  }
  function schedule() {
    if (!started || stopping || !runtime || workerMode !== 'embedded' || timer) return;
    timer = setTimeout(() => { timer = null; wake().catch(() => {}); }, pollIntervalMs);
    timer.unref?.();
  }
  const shared = runtime ? { ...runtime, wake } : null;
  if (runtime?.sourceAssociation) {
    shared.sourceAssociation = { ...runtime.sourceAssociation };
    for (const method of ['request', 'finalize', 'deliver', 'tick']) {
      if (typeof runtime.sourceAssociation[method] !== 'function') continue;
      shared.sourceAssociation[method] = (...args) => {
        if (stopping) return Promise.reject(Object.assign(new Error('selected_staging_stopping'), { code: 'selected_staging_stopping', statusCode: 503 }));
        return track(() => runtime.sourceAssociation[method](...args));
      };
    }
  }
  function stop() { stopping = true; clearTimeout(timer); timer = null; }
  function close() {
    stop();
    closing ||= (async () => {
      await Promise.allSettled([...operations, ...(pending ? [pending] : [])]);
      await runtime?.close();
    })();
    return closing;
  }
  if (shared) shared.close = close;
  return { runtime: shared, stop, close, start() {
    if (started || stopping) return;
    started = true;
    wake().catch(() => {});
  } };
}
