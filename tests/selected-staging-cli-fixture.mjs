// Run through the real CLI to hold a durable claim while a server also polls.
import { createStagingRuntime } from '../server/kernel/staging-runtime.js';
import { createPaths } from '../server/kernel/paths.js';
import { createJournal } from '../server/kernel/journal.js';
export function createRuntime() {
  const paths = createPaths(), journal = createJournal({ paths });
  const forbidden = () => { throw new Error('fixture_capability_forbidden'); };
  const runtime = createStagingRuntime({ paths, journal,
    pipeline: { run: forbidden }, fetchArtifact: forbidden, allowedArtifactOrigins: [], qa: forbidden, host: { deploy: forbidden },
    callback: async () => {
      await new Promise(resolve => {
        process.once('message', resolve);
        process.send({ fixture: 'claim-held' });
      });
      return { ok: true };
    } });
  return { ...runtime, close: () => { runtime.close(); process.disconnect(); } };
}
