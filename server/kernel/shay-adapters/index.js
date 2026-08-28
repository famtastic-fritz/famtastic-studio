// Adapter registry. shay.js's resolveProvider() is the only caller that
// should import this in production; tests import it directly to exercise
// adapters in isolation. Every entry implements the identical interface
// (base.js's createCliAdapter output), so shay.js never branches on which
// one it got.
import { createClaudeAdapter } from './claude.js';
import { createCodexAdapter } from './codex.js';
import { createKimiAdapter } from './kimi.js';

// claude is the proven default: verified on this machine to spawn cleanly
// and return parseable strict JSON. The others are scaffolded behind the
// same interface with honest availability reporting.
export const DEFAULT_ADAPTER_ID = 'claude';

// gemini is PERMANENTLY RETIRED (2026-08-23). Google ended Gemini Code Assist
// for individuals; the CLI returns a terminal IneligibleTierError that no retry
// or version bump resolves. Do not re-add it. The Google replacement route,
// Antigravity, exposes no headless invocation an adapter can drive: its `chat`
// subcommand hands the prompt to the GUI and exits 0 with zero bytes of output.
// See docs/efficiency/GOOGLE-ROUTE-FINDING.md.
const FACTORIES = Object.freeze({
  claude: createClaudeAdapter,
  codex: createCodexAdapter,
  kimi: createKimiAdapter,
});

export const ADAPTER_IDS = Object.freeze(Object.keys(FACTORIES));

// { spawnImpl, commandExistsImpl } are test-only injection points threaded
// straight through to base.js's createCliAdapter. Returns null for an
// unknown id rather than throwing -- callers decide whether an unknown
// configured id falls back to the default or surfaces as unavailable.
export function getAdapter(id, { spawnImpl, commandExistsImpl } = {}) {
  const factory = FACTORIES[id];
  if (!factory) return null;
  return factory({ spawnImpl, commandExistsImpl });
}
