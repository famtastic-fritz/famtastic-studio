// Scaffolded adapter. Spawns the operator's own installed Kimi CLI headless
// (`kimi -p "<prompt>"`) on their existing subscription auth -- no API key.
// This machine has previously seen a billing-cycle 403 from this CLI; that
// state is not fought here -- base.js's failure classifier recognizes a 403
// or billing error in the CLI's own output and reports 'billing_blocked'
// rather than a generic failure or a fabricated success. Kimi's plain-text
// output can include a leading reasoning line before the JSON answer;
// cli-runner.js's extractJson() already handles pulling the JSON out of
// surrounding text, so no special-casing is needed here.
import { createCliAdapter } from './base.js';

export function createKimiAdapter({ spawnImpl, commandExistsImpl } = {}) {
  return createCliAdapter({
    id: 'kimi',
    displayName: 'Kimi CLI',
    command: 'kimi',
    buildArgs: (promptText) => ['-p', promptText],
    spawnImpl,
    commandExistsImpl,
  });
}
