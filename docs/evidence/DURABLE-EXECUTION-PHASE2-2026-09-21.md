# Durable execution Phase 2 evidence

## Result

Phase 2 is implemented as a local, inert candidate on top of the verified Phase
1 base. The final focused Phase 2 and Phase 1 regression suites pass. The full
repository suite is not green in this Linux workspace for the classified
environment and timeout failures below. The candidate is not pushed, merged,
deployed, traffic-serving or active. No Google Cloud resource, model API,
schedule, customer repository, callback, message, publish, deployment or
payment was changed by this work.

| State | Evidence |
| --- | --- |
| Phase 1 base | Commit `16fc24e`, confirmed by the owner as merged, installed and healthy |
| Phase 2 source | Implemented on `codex/durable-execution-phase2-cloud-pilot` |
| Local verification | Phase 2: 14 files, 169 tests passed; Phase 1 regression: 6 files, 42 tests passed |
| Pushed or merged | No |
| Cloud baseline applied | No |
| Real provider canary | No |
| Customer automation live | No |

## Implemented boundary

The control service authenticates the exact intake or reconciliation service
account for its matching route. Admission uses an exact packet digest,
transactionally reserves a job and idempotency binding, then writes a
deterministic immutable source object before finalizing the job, outbox and
event. Exact duplicates converge. Conflicting reuse, cross-pilot reuse, a full
20-job pilot, oversized provider input and paused admission fail closed without
creating work.

Duplicate reserved admissions atomically renew matching reservation generations
and expiry timestamps on the job and idempotency binding. Expiration validates
the same generation and deadline in one transaction. This prevents a stale
reconciler from expiring a reservation while an identical retry writes the
source object. The immutable GCS save is also bounded to 60 seconds inside the
15-minute reservation lease.

The worker claims with a fenced lease, rechecks worker and provider controls,
reads the exact generation-pinned source object and calls only the fixed Vertex
adapter. A successful provider result and measured cost settle to a durable
checkpoint before artifact persistence. Recovery resumes from that checkpoint
without a second provider call. Artifact and dispatch retries are bounded;
each dispatch generation has one deterministic task name, and exhausted
dispatch reaches visible manual review and dead letter state.

Dispatch delivery also has a durable claim acknowledgement deadline. The worker
acknowledges the exact task name and current generation in its claim transaction.
If a submitted or delivered task never claims, reconciliation advances one
generation transactionally; delayed older generations are rejected before work.
Bounded exhaustion becomes visible manual review. If Cloud Tasks reports
`ALREADY_EXISTS` but the required `FULL` lookup cannot verify the existing task,
the candidate parks immediately with `execution_risk=unknown` rather than
redriving an identity it cannot prove.

The model-call reservation transaction binds its call ID to the active attempt.
If the commit succeeds but its response is lost, failure handling reads that
durable binding and may settle the reservation at zero only with an explicit
pre-provider confirmation and zero provider evidence. A mismatched call ID or
any provider evidence fails closed.

The effect firewall denies callback, outbound message, publish, deploy,
customer-repository write and payment. The only provider output is a bounded
shadow observation parked at the pilot review gate. This gate is not customer
acceptance and does not add a routine Fritz approval requirement to the selected
build contract.

## Provider and cost boundary

The adapter fixes these values in code:

| Item | Fixed value |
| --- | --- |
| SDK and mode | `@google/genai`, Vertex mode |
| API version | `v1` |
| Model | `gemini-3.1-flash-lite` |
| Location | `global` |
| Thinking | `MINIMAL`, summaries excluded |
| Output bound | 4096 candidate plus thinking tokens |
| Call reservation | 80000 micros |
| Pilot maxima | 250000 micros per job, 5000000 micros total |

Usage rejects cached tokens, missing or inconsistent totals, combined output
and thinking tokens above the fixed bound, and calculated cost above the
reservation. Thinking tokens are permitted because the selected model can
produce them even at `MINIMAL`; they are recorded and priced as output. A
successful provider outcome is not relabeled as provider failure if later
artifact persistence fails.

The current provider input contains bounded staging-packet metadata: identities,
artifact paths, digests, roles and declared sizes. It does not send selected
preview bytes. The result cannot establish visual or design quality.

## Inert infrastructure and stop path

The Google Cloud package describes a one-shot baseline that refuses existing
managed resource names. It requires a pre-existing named Firestore database and
exact regional Artifact Registry image digests. It never substitutes
`(default)`. Bootstrap, the pause-only CLI and apply scaffolding refuse an
ambient Firestore emulator endpoint before database or cloud mutation, so an
emulator cannot produce a false live-database receipt.

Apply is currently hard-disabled before its first cloud call. The proposed
sequence used `gcloud run deploy`, which is create-or-update, so a service
created between absence preflight and deployment could be adopted and mutated.
The script has no accepted create-only gate value. A separately reviewed change
must replace both Run deploy steps with an atomic create-only mechanism and add
conflict evidence.

The visible mutation scaffold also creates the queue and pauses it in separate
commands. That leaves an unproven create-then-pause interval in which the queue's
initial state is not durably paused. The current hard-disabled apply never runs
those commands. A future apply must remove or atomically contain that interval.

If that blocker is closed and a later apply is separately authorized, the
initial state must still be inert:

- control and worker are internal, IAM authenticated and receive zero traffic;
- runtime and caller service accounts are distinct;
- the queue is paused, rate-limited and concurrency one;
- Scheduler is absent;
- global pause is on; dispatch, worker and provider are off;
- the intake caller identity is authorized but unattached to a workload;
- no secret is created.

The pause command requires the exact `PAUSE_PHASE2_SHADOW` gate and exact
project, named database and pilot binding. In one transaction it writes global
pause on and dispatch, worker and provider off, then rereads and verifies them.
It has no enable mode. The stop script attempts queue and Scheduler pause,
persistent pause and IAM containment in order, while classifying failures and
continuing later containment.

Pause and IAM containment stop future work after their gates take effect; they
cannot cancel a Vertex request already in flight. Such a request may still
complete and incur cost. Any live stop receipt must therefore reconcile the
model-call ledger and provider logs before declaring the system drained.

## Hermetic 20-job proof

`npm run prove:execution:phase2` composes the production control and worker HTTP
handlers in process with fake Firestore, Cloud Tasks, GCS and provider adapters.
All 20 jobs use the production Phase 2 source wrapper and 80000-micro call
reservation.

| Measure | Observed |
| --- | ---: |
| Awaiting pilot review gate | 18 |
| Dead letters | 2 |
| Attempts | 25 |
| Fake provider calls | 23 |
| Provider successes checkpointed | 19 |
| Output artifacts | 18 |
| Named task create attempts | 35 |
| Provider call repeated after checkpoint crash | 0 |
| Active leases after convergence | 0 |
| Real provider calls | 0 |
| Process network hooks | 0 |
| Customer effects | 0 |

The proof also establishes paused admission with zero work, exact duplicates,
content conflict, pilot cap, recovery of an admission interrupted after source
storage, two source-read faults, three transient provider retries, a checkpoint
crash, and generation-10 artifact/dispatch exhaustion reaching durable manual
review. The final controls are returned to global pause on with dispatch, worker
and provider off.

This is a hermetic source-level proof. Its own receipt explicitly records
`activation_evidence=false`, `firestore_emulator_concurrency_proven=false` and
`gcp_canary_proven=false`.

## Local verification

The following checks passed in this Linux workspace:

- Phase 2, bootstrap and pause tests: 14 files, 169 of 169 tests.
- Phase 1 regression selection: 6 files, 42 of 42 tests.
- Phase 1 deterministic proof.
- Phase 2 composed deterministic proof.
- repository lint and JavaScript syntax checks.
- `npm audit --omit=dev`: zero vulnerabilities.
- Phase 2 infrastructure validation and offline plan.
- `git diff --check`.

The first full repository run discovered 100 files and 1,149 tests. It completed
with 91 files passed and 9 failed, and had 1,125 tests passed and 24 failed.
Twenty failures cascade from the missing Playwright Chromium binary, including a
later dirty-repository assertion; two require absolute Mac sibling repositories
that do not exist in this Linux workspace; and two creator-credit cases reached
their 5-second timeout under contention. The creator-credit file then passed 5
of 5 tests with one worker and a 20-second timeout; its two long cases took 3.9
and 4.5 seconds.

A repeat using the identical full-suite command and unchanged environment and
timeouts completed with 92 of 100 files and 1,127 of 1,149 tests passing. Its 22
failures were the 20 missing-Playwright family and two absent-Mac-sibling cases;
the creator-credit tests passed. Both results are recorded here. Their variance
supports classifying the first run's two creator timeouts as concurrency and
time-budget artifacts, not Phase 2 regressions. The full repository suite is
still not claimed green, and independent verification must record fresh totals
for the final candidate.

The full dependency audit is not clean: it reports two moderate development-only
findings through `@vitest/mocker`. The installed Vitest line was raised to
`3.2.7`, while the reported remediation requires a major Vitest upgrade. The
production dependency audit remains clean, and production containers omit
development dependencies. Independent verification must rerun both audit modes
and report any drift rather than treating this caveat as resolved.

The offline plan used only `infra/gcp/phase2/env.example`; it made no cloud
call. Online plan, container build, image push, Firestore emulator concurrency,
cloud apply and live model calls were not run.

## Activation blockers

This candidate must not be activated until a separate reviewed change and
receipt prove all of the following:

1. Independent review of the candidate commit and a clean Mac repository run.
2. Firestore emulator or equivalent concurrency evidence for admission, cap,
   lease fencing, checkpoint and reconciliation races.
3. Central stored-identity validation before every relevant mutation: dispatch
   reserve, deliver and release must bind the requested outbox document ID to
   `outbox.intent_id`, `job.intent_id`, job ID, pilot and dispatch generation;
   remaining claim, reconcile and terminal settlement paths must completely bind
   stored job, attempt, call, outbox, document and generation ownership before
   state or cost settlement.
4. Firestore transaction callbacks must capture their effective timestamp inside
   each callback attempt, with contention evidence proving a retry cannot shorten
   a reservation, lease or acknowledgement deadline.
5. A low-cap Vertex `v1` canary proving the exact request, structured JSON,
   `STOP`, usage fields, thinking-token accounting, latency and cost.
6. Digest-pinned container builds, SBOM/provenance and exact Artifact Registry
   describes.
7. An atomic create-only Cloud Run mechanism that cannot adopt a same-name
   service in the absence-check race window.
8. Queue creation that is initially paused without a create-then-pause window.
9. Online read-only plan, named-database proof and absence checks.
10. A named cloud ingress workload and internal network path for intake.
11. Zero-traffic revision probes, persistent-pause drill, in-flight provider
   accounting and a completed evidence receipt.
12. A separately reviewed activation change for traffic, queue and Scheduler.

No Mission Control subdomain or dashboard is required for these mechanics. A
later dashboard should remain a read-only operational view over the durable
state, not another scheduler or authority.

Use the companion
[independent verification prompt](../handoffs/DURABLE-EXECUTION-PHASE2-VERIFICATION-PROMPT.md).
