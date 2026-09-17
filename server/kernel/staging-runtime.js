import { createStagingStore } from './staging-store.js';
import { createStagingWorker } from './staging-worker.js';
// Installation-level capability injection, never data from an HTTP packet.
// The serving module can share this runtime with a dedicated worker process.
export function createStagingRuntime({ paths, journal, ...capabilities }) {
  const store = createStagingStore({ paths, journal });
  const worker = createStagingWorker({ ...capabilities, store });
  let pending = null;
  function wake() {
    pending ||= worker.tick().finally(() => { pending = null; });
    return pending;
  }
  return { store, worker, wake, close: () => store.close() };
}
