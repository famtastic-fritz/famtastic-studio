# Mac Phase CLI entry verification, 2026-09-21

## Scope

Base: `857df0da61dfb3c0c7ef06c1807c28359c2c4c03`.
Branch: `codex/mac-phase-cli-entry`.
Isolated worktree: `/tmp/famtastic-mac-phase-cli.vu42M5/studio`.

`server/kernel/cli-entry.js` compares `realpathSync(new URL(import.meta.url))`
with `realpathSync(process.argv[1])`. Both sides are canonicalized, including
when Node preserves the main-module symlink. Missing or unresolvable entries
do not qualify as direct execution. The helper only reads filesystem identity.

Only these existing entrypoints changed, and only their direct-entry detection
and associated imports changed:

- `scripts/prove-durable-execution.mjs`
- `scripts/prove-durable-execution-phase2.mjs`
- `scripts/bootstrap-durable-execution-phase2.mjs`
- `scripts/pause-durable-execution-phase2.mjs`
- `server/cloud/control-main.js`
- `server/cloud/worker-main.js`

Pause transactions, configuration validation, authorization, provider loading,
and all other runtime behavior remain unchanged. No G4 scripts, package files,
activation flags, or other documentation changed.

## Executed checks

Node `v24.19.0`; Vitest `3.2.7`. Both package and lock files matched the existing
candidate byte-for-byte before symlinking its `node_modules`; no install ran.

`tests/mac-phase-cli-entry.test.js` passed 25 tests, including 24 real Node
subprocesses. Each subprocess has an empty environment. A directory symlink
preserves relative imports and package lookup while testing both default Node
resolution and `--preserve-symlinks-main`:

- Eight direct-entry subprocesses return exit 1 with exact redacted JSON:
  bootstrap `phase2_bootstrap_gate_denied`, pause `phase2_pause_gate_denied`,
  control and worker `phase2_config_invalid`. An exit-0 no-op fails these tests.
- Four proof subprocesses emit nonempty JSON that passes the existing full
  proof validators, including the Phase 2 HTTP checkpoint report. A tampered
  job count is also rejected by the validators.
- Twelve imports from a different actual file entry print only the import
  sentinel, without running the imported CLI. SQLite import warnings are
  permitted, but CLI receipts are not.
- One helper test checks canonical equality and rejects absent, invalid, and
  different entries.

The subprocess preload denies fetch, HTTP(S), net/TLS connections, and server
listening. Any recorded attempt forces exit 97, even if caught. It supplements
the existing integration wrapper's OS sandbox; it is not an independent OS
sandbox. The wrapper denies external network, localhost port 3400, and child
read/write access to authoritative application data and configured cloud/SSH
credential directories. Its before/after protected-data comparison was equal.
Existing adjacent tests use injected fakes and permitted ephemeral loopback.

Final command, run through the existing wrapper:

```sh
node /tmp/famtastic-phase2-review.NVAfPl/run-integration-check.mjs mac-phase-cli-entry-final \
  'cd /tmp/famtastic-mac-phase-cli.vu42M5/studio && node node_modules/vitest/vitest.mjs run tests/mac-phase-cli-entry.test.js tests/bootstrap-durable-execution-phase2.test.js tests/pause-durable-execution-phase2.test.js tests/durable-execution-phase2-entrypoints.test.js tests/durable-execution-phase2-proof.test.js tests/durable-execution-recovery.test.js tests/invariant-p0-i1.test.js --no-file-parallelism --maxWorkers=1 --no-cache && npm run lint && npm run prove:execution && npm run prove:execution:phase2'
```

Result: **63/63 tests in seven files passed**, both lint checks passed, and
both actual proof commands emitted passing JSON receipts. Wrapper exit 0,
elapsed 9,293 ms, `stoppedFor: null`, `protectedDataUnchanged: true`.
The wrapper enforced its 200 MiB minimum headroom; the final nearby disk check
showed 840,836 KiB available. No full suite, browser, install, or deployment ran.

Local evidence, retained outside the worktree:

- `/tmp/famtastic-phase2-review.NVAfPl/mac-phase-cli-entry-final.lI2FvU/receipt.json`
- `/tmp/famtastic-phase2-review.NVAfPl/mac-phase-cli-entry-final.lI2FvU/output.log`
- `/tmp/famtastic-phase2-review.NVAfPl/mac-phase-cli-entry-recheck.b0WYBn/receipt.json`

An earlier run in `mac-phase-cli-entry.ZWMJDO` failed before CLI execution
because macOS denied a nested `sandbox-exec`. That failed receipt remains
retained. The tests now inherit the outer OS sandbox and use the additional
child preload; no production guard was relaxed to make verification pass.

## What the receipts prove, and do not prove

Phase 1: 20 synthetic jobs, 27 attempts, 25 mock provider calls, 18 artifacts,
two dead letters, zero actual model cost, zero external calls, and zero
recorded process-network attempts. Its receipt correctly does not claim to
have independently verified authoritative preservation; the outer wrapper
performs that separate before/after comparison.

Phase 2: 20 hermetic composed-runtime jobs, 25 attempts, 23 fake provider calls,
18 artifacts, two dead letters, zero real provider calls, and zero recorded
process-network attempts. The additional in-process HTTP checkpoint proves a
resume with one fake provider call and two artifact-write attempts.

These are executed local fixture and CLI-entry results, not proof of cloud
activation, real Firestore concurrency, a GCP canary, customer creative output,
or an unattended production workflow. No real cloud/provider configuration,
authentication, preflight, customer message, or production flag was used.
