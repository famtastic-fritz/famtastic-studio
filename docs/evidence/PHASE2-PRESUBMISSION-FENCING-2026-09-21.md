# Phase 2 pre-submission and lineage follow-up

## Scope and result

Base: `9468ecfd5ab45f40d37be305dda2aa341fe13893`.
Branch: `codex/phase2-presubmission-fencing`.
Earlier partial source checkpoint: `f55b672009cef553260a097bed7d6ecc2355b664`.
The commit containing this receipt completes the isolated M1, A1, A2 and A3
source follow-up. The parent still owns independent verification and merge.

Result: 163 dedicated regression tests and 130 targeted compatibility tests
passed, 293 unique tests across 10 files. Both source lints and whitespace
checks passed. This is synthetic local source evidence, not real Firestore
contention, provider execution, cloud activation or customer delivery proof.
No full repository suite, install, audit, container build or infrastructure
command was run for this follow-up.

## Changes and invariant mapping

| Finding | Source | Regression evidence |
| --- | --- | --- |
| M1: provider submission after lease expiry and reconciliation | `firestore-provider-submission.js`, `provider-submission.js`, `runtime.js` | Delayed reservation and authorization responses after terminal reconciliation make zero fake provider calls; the uncertain reservation is not overwritten with zero |
| M1: insufficient remaining lease or changed ownership | Same sources, shared `firestore-bindings.js` | Transaction checks job, immutable envelope, attempt, call, outbox, pilot controls and reservation coverage; local receipt/clock/window checks reject stale responses |
| A1: completion ignored current outbox | `firestore-worker.js`, `firestore-bindings.js` | Missing or cross-linked outbox and wrong generation reject before artifacts, approval or cost settlement |
| A2: expired claim accepted wrong attempt generation | `firestore-claim.js`, `firestore-reconcile.js`, `firestore-bindings.js` | Wrong expired generation rejects without writes; exact-generation checkpoint resume and a checkpoint surviving two unclaimed redrives both complete with one attempt and one call |
| A3: duplicate admission accepted detached stored work | `firestore-staged-admission.js` | Renewal, first finalize and both finalized duplicate entry points reject changed job/binding identity before writes; finalized outbox/source mismatches also reject |

Source paths in the table are under
`server/kernel/durable-execution/phase2/`.

### M1 authorization contract and remaining race

The execution store now requires `authorizeProviderSubmission({ lease,
modelCallId })`. Its transaction reads the requested job, attempt, model call,
outbox, controls and budget, captures time inside each callback attempt, checks
the claimed immutable work envelope and ownership, and requires an active
running attempt with its exact reserved call. It enforces the pinned provider,
model, pricebook and 80000-micro reservation with job and pilot coverage.

The transaction records `provider_submission_authorized_at_ms` on that reserved
call. This marker means only that authorization checks passed; it is not proof
that an HTTP request was sent, accepted, completed or billed. Lost authorization
responses can still be classified as pre-provider absence by the worker that
has not invoked the provider. Existing post-submission uncertainty handling is
unchanged.

Both the transaction and the immediate local check require at least the shared
120000-ms provider timeout plus 5000 ms of headroom. The runtime checks the
receipt's lease/call identity, rejects a backwards local clock, and performs no
awaited work between the final clock check and `modelProvider.execute()`.
The headroom is a minimum admission policy, not a measured cloud latency SLA.

Firestore and provider HTTP are not atomic. Controls or ownership may change,
the process may pause, or clocks may change after the final check. A submitted
remote request may also continue beyond the adapter's local timeout. These
checks close the reproduced delayed-response paths, not the irreducible
transaction-to-HTTP race. Real contention, clock behavior, timeout/drain and
in-flight cost reconciliation remain activation requirements.

### A2 checkpoint predecessor contract

A running attempt must match the current outbox generation exactly. A queued
or retry-wait checkpoint must be explicitly bound by `resume_attempt_id`, have
`resume_scheduled` state and precede the current generation. It may precede by
more than one because unclaimed task deliveries can redrive without repeating
the provider call. The shared validator is used by claim and expired-lease
reconciliation. This does not certify every other stored-lineage path.

### A3 requested documents

Duplicate admission reads the requested identity's job document and deterministic
intent document, rather than following unvalidated stored IDs. Job identity
fields, binding fields, digest, receipt and intent must agree before acceptance
or renewal. Finalized duplicates also validate the outbox, authoritative envelope
and binding source metadata. First finalization uses the same identity guard.

## Reproduction commands and results

Run from this branch's repository root. Dependencies were reused through an
untracked `node_modules` symlink only after `package.json` and `package-lock.json`
matched the existing candidate byte for byte. Node: `v24.19.0`; Vitest: `3.2.7`.
No dependency or lockfile changed. No package manager install or cache cleanup
was performed.

Before each test batch, this read-only guard refused execution below 200 MiB:

```sh
node --input-type=module -e "import fs from 'node:fs'; if (fs.statfsSync('.').bavail * fs.statfsSync('.').bsize < 200 * 1024 ** 2) { console.error('STOP: under 200 MiB free'); process.exit(2); }"
```

Dedicated tests, exit 0: 2 files, 163 tests (47 pre-submission, 116 lineage).

```sh
node node_modules/vitest/vitest.mjs run tests/durable-execution-phase2-presubmission.test.js tests/durable-execution-phase2-lineage-regressions.test.js --maxWorkers=1 --minWorkers=1 --no-file-parallelism --no-cache
```

Compatibility tests, exit 0: 8 files, 130 tests.

```sh
node node_modules/vitest/vitest.mjs run tests/durable-execution-phase2-runtime.test.js tests/durable-execution-phase2-runtime-recovery.test.js tests/durable-execution-phase2-store.test.js tests/durable-execution-phase2-bindings.test.js tests/durable-execution-phase2-dispatch-fencing.test.js tests/durable-execution-phase2-ambiguity.test.js tests/durable-execution-phase2-provider.test.js tests/durable-execution-phase2-proof.test.js --maxWorkers=1 --minWorkers=1 --no-file-parallelism --no-cache
```

Static checks, each exit 0:

```sh
node scripts/lint-no-monolith.mjs
node scripts/lint-no-ambient-site.mjs
git diff --check
```

Existing runtime fixtures now use their store's clock; real-store test doubles
inherit the new API. A dedicated negative test rejects a runtime store missing
the authorization method. New tests use fake Firestore and fake provider/storage
clients, with process-network hooks blocked. Discarded transaction retries are
simulated in memory, not Firestore-emulator contention evidence.

The existing composed fixture retains 20 jobs, 18 awaiting approval, 2 dead
letters, 25 attempts, 23 fake provider calls, 18 artifacts, generation-10 manual
review and no remaining active lease. Reserved/settled/uncertain micros remain
0/10450/80000. Its checkpoint-crash job still makes one fake provider call;
network hooks and customer effects remain zero. The composed HTTP checkpoint
fixture still resumes generation 1 to 2 with one provider call.

## Earlier interruption and limits

Disk pressure initially prevented the admission patch and evidence-document
write without changing the admission file. The partial source was committed
early as `f55b672`, with pending verification stated in its commit message.
After space recovered, the remaining source, tests and this receipt were added.
Tests were serial with caching disabled, guarded above 200 MiB free.

An earlier inline diagnostic initially expected `stale_lease` after terminal
reconciliation. The existing failure-settlement ownership check instead returns
`attempt_identity_conflict`; its zero-provider and terminal-state assertions
held. Correcting that diagnostic's expected code yielded three passing checks.
The committed regression preserves the actual fail-closed result and uncertain
ledger. Final committed test definitions pass without weakening that boundary.

Cloud activation remains closed. This work does not authorize or prove a real
provider canary, cloud apply, container provenance, initially paused queue,
atomic create-only Run deployment, intake connectivity, traffic, Scheduler,
provider drain, customer execution or preservation via an authoritative database
test. No production or authoritative database, cloud/provider API, credentials,
customer repository or messaging system was accessed. Parent integration and
creator-credit work were not changed.
