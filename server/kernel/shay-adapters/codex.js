// Scaffolded, working adapter. Spawns the operator's own installed Codex CLI
// headless via its non-interactive subcommand (`codex exec "<prompt>"`) on
// their existing subscription auth -- no API key. Verified on this machine:
// `codex exec` with stdin closed and a strict-JSON instruction returns
// clean, parseable JSON on exit 0.
import { createCliAdapter } from './base.js';

export function createCodexAdapter({ spawnImpl, commandExistsImpl } = {}) {
  return createCliAdapter({
    id: 'codex',
    displayName: 'Codex CLI',
    command: 'codex',
    buildArgs: (promptText) => ['exec', promptText],
    spawnImpl,
    commandExistsImpl,
  });
}
