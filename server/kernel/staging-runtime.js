import { createStagingStore } from './staging-store.js';
import { createStagingWorker } from './staging-worker.js';
import { createSelectedSourceResolver } from './selected-source-binding.js';
// Installation-level capability injection, never data from an HTTP packet.
// The serving module can share this runtime with a dedicated worker process.
export function createStagingRuntime({ paths, journal, ...capabilities }) {
  const store = createStagingStore({ paths, journal });
  const resolveSource = capabilities.resolveSource || createSelectedSourceResolver({ paths, mappings: capabilities.sourceMappings || [], getMappings: store.sourceMappings });
  const worker = createStagingWorker({ ...capabilities, store, resolveSource });
  let pending = null;
  function wake() {
    pending ||= worker.tick().finally(() => { pending = null; });
    return pending;
  }
  return { store, worker, wake, close: () => store.close() };
}
