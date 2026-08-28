// DEFAULT adapter. Spawns the operator's own installed Claude Code CLI
// headless (`claude -p "<prompt>"`) on their existing subscription auth --
// no API key. Verified on this machine: `claude -p` with a strict-JSON
// instruction returns clean, parseable JSON on exit 0.
import { createCliAdapter } from './base.js';

export function createClaudeAdapter({ spawnImpl, commandExistsImpl } = {}) {
  return createCliAdapter({
    id: 'claude',
    displayName: 'Claude Code CLI',
    command: 'claude',
    buildArgs: (promptText) => ['-p', promptText],
    spawnImpl,
    commandExistsImpl,
  });
}
