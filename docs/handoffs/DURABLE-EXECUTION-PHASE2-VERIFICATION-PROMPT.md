# Independent Codex verification prompt for Phase 2

Copy everything below into a fresh Codex session with access to the Mac and the
local repository.

```text
Act as an independent verifier. Do not trust the implementation summary. Prove
or disprove the durable execution Phase 2 candidate with direct evidence.

Repository:
/Users/famtastic-fritz/Development/FAMtastic-Repos/site-studio-next

Candidate branch:
codex/durable-execution-phase2-cloud-pilot

Required Phase 1 base commit:
16fc24e

Safety rules:
- Do not merge, rebase, push, force-push, deploy, apply cloud infrastructure,
  enable traffic, resume a queue, create or resume Scheduler, call a real model,
  send a callback/message, publish, charge, or change any customer repository.
- Do not run the online Phase 2 plan. It contacts Google Cloud even though it is
  read-only. Run only the documented offline plan with example values.
- Do not write to ~/.config/famtastic/studio.db or its WAL/SHM files.
- Preserve every existing local change. Use a separate temporary Git worktree.
- Never substitute the default Firestore database, a public service, a mutable
  image tag, or real credentials in order to make a check pass.
- If the candidate branch is not present locally or on origin, stop and report
  that the candidate must be transferred or pushed. Do not reconstruct it from
  this prompt and do not test a different branch.

1. Inspect the owner's checkout without changing it. Record git status, branch,
   HEAD, worktree/common directory and origin. Read AGENTS.md, CONVENTIONS.md,
   .claude/skills/site-studio-conventions/SKILL.md,
   .claude/skills/dna-capture/SKILL.md, design.md, SITE-LEARNINGS.md,
   CONVERSATIONS.md and docs/contracts/CLIENT-SELECTED-BUILD-FLOW.md.

2. Resolve the exact candidate branch. Record its full SHA and confirm its
   ancestry includes Phase 1 commit 16fc24e. Fetching origin is allowed only if
   it does not alter the owner's files. Create a detached temporary worktree at
   the candidate SHA. Compare it with its merge base and current default branch;
   report material drift. Do not modify or switch the owner's checkout.

3. Inspect every changed file. Independently verify:
   - the Phase 2 runtime is isolated and is not imported by the current server;
   - paused admission creates no durable row or GCS object;
   - reserve precedes immutable source write and finalize; exact duplicates
     converge, conflicts and cross-pilot reuse fail, and the transactional cap
     cannot exceed 20;
   - duplicate reserved admission renews a matched generation-bound lease, and
     stale reconciliation cannot expire an in-flight retry;
   - canonical JSON preserves own __proto__, constructor and prototype keys
     without pollution or digest collision;
   - task bodies contain IDs only, task names are deterministic, ALREADY_EXISTS
     convergence compares the exact target, body and OIDC identity, and
     each dispatch generation keeps one task identity until a transactionally
     fenced claim-timeout redrive advances the generation;
   - an ALREADY_EXISTS result whose FULL lookup fails parks the job immediately
     with unknown execution risk rather than redriving an unverified identity;
   - each delivered generation has a bounded worker-claim acknowledgement,
     claim and acknowledgement are atomic, unclaimed delivery advances one
     generation, stale generations cannot execute, and bounded exhaustion is
     visible manual review;
   - claims use fenced leases, controls are rechecked immediately before work,
     retries are bounded, stale completion fails, and exhaustion is visible;
   - delayed reservation and pre-submission-authorization responses cannot cause
     a provider call after terminal lease reconciliation; authorization binds
     job, immutable envelope, attempt, reserved call, outbox generation, pilot
     controls and cost coverage, followed by an immediate local clock check
     requiring the shared provider timeout plus 5000 ms of remaining lease;
   - completion rejects missing or cross-linked outbox records before settlement;
     expired claims require the current attempt generation; scheduled checkpoint
     predecessors survive unclaimed redrives without another provider call;
   - renewed and finalized duplicate admissions bind requested document IDs,
     stored job/binding identities and finalized outbox/source lineage before
     acceptance or mutation;
   - provider success and measured cost checkpoint before artifact persistence,
     so artifact recovery does not repeat a billable provider call;
   - if model-call reservation commits but its response is lost, the durable
     attempt binding is recovered and settled at zero only with proven
     pre-provider absence and zero metrics; mismatched call IDs fail closed;
   - callback, outbound, publish, deploy, customer repository and payment
     effects cannot complete;
   - model, API v1, global location, MINIMAL thinking, structured schema, input
     size, combined candidate/thinking token limit, zero cached tokens, exact
     usage total, pricebook and 80000-micro reservation are fixed and enforced;
   - text plus opaque thoughtSignature can parse, while thought summaries,
     tool/function calls and executable content fail closed;
   - persistent pause is pause-only, exact-gated and project/database/pilot
     bound, while stop continues IAM containment after a failed pause attempt;
   - bootstrap, pause and apply refuse FIRESTORE_EMULATOR_HOST before database
     or cloud mutation;
   - all source evidence says local/hermetic, not deployed or activated.

4. Install and inspect dependencies in the temporary worktree:
   npm ci
   npm audit
   npm audit --omit=dev
   npm run lint
   git diff --check 16fc24e...HEAD

   Record exact results. Inspect package-lock changes, direct and transitive
   versions, Node >=24 compatibility and any install scripts. Do not ignore an
   audit finding or a lockfile mismatch. The candidate baseline is expected to
   have zero production findings and two moderate development-only findings
   through @vitest/mocker after the Vitest 3.2.7 update; the published fix path
   requires a major Vitest upgrade. Verify that exact caveat independently.
   Treat any production finding, unexpected audit drift or inaccurate evidence
   as a merge blocker.

5. Run the Phase 2 checks with reduced concurrency:
   npx vitest run tests/bootstrap-durable-execution-phase2.test.js tests/pause-durable-execution-phase2.test.js tests/durable-execution-phase2-*.test.js --maxWorkers=2 --minWorkers=1
   npm run prove:execution:phase2

   Require the proof to identify itself as a hermetic composed in-process HTTP
   fixture. Confirm 20 jobs, 18 awaiting approval, two dead letters, 25
   attempts, 23 fake provider calls, 18 artifacts, a single provider call for
   the checkpoint-crash job, generation-10 manual review, zero active leases,
   zero process-network hooks and zero customer effects. It must explicitly say
   activation, Firestore-emulator concurrency and GCP canary evidence are false.
   Require a regression that composes the real createCloudTasksDispatcher with
   the control reconciler and Firestore store: ALREADY_EXISTS followed by a
   failed FULL lookup must finish in manual review/dead letter with unknown
   execution risk. Adapter-only and throwing-dispatcher-stub tests are not enough.
   Also require focused proofs for unclaimed-generation redrive and lost
   model-call-reservation response recovery.
   The dedicated pre-submission and lineage-regressions test files cover the
   M1/A1/A2/A3 follow-up. Use one worker and disabled caching when disk is tight;
   refuse new test writes below 200 MiB free. Exact scoped commands and synthetic
   evidence are in docs/evidence/PHASE2-PRESUBMISSION-FENCING-2026-09-21.md.
   Authorization timestamps do not prove provider submission or make Firestore
   and HTTP atomic; retain the real contention and in-flight accounting gates.

6. Re-run the Phase 1 regression boundary:
   npx vitest run tests/durable-execution-schema.test.js tests/durable-execution-store.test.js tests/durable-execution-runtime.test.js tests/durable-execution-recovery.test.js tests/staging-acceptance.test.js tests/kernel-journal-durable.test.js --maxWorkers=2 --minWorkers=1
   npm run prove:execution

   Confirm no Phase 2 test or script opens the authoritative Mac database,
   catches up parked Phase 1 jobs, or runs enabled legacy schedules.

7. Run the full repository suite with reduced concurrency:
   npx vitest run --maxWorkers=2 --minWorkers=1

   Record exact test and file totals. Classify every failure with evidence.
   Missing browser binaries or unavailable absolute Mac sibling repositories
   are not candidate passes; report them separately as environment blockers.
   If creator-credit cases hit the default 5-second timeout only under the full
   run's concurrency, preserve that failure and rerun them separately with:
   npx vitest run tests/creator-credit.test.js --maxWorkers=1 --minWorkers=1 --testTimeout=20000
   Report both results rather than replacing the full-run receipt.

8. Run only offline infrastructure checks:
   bash infra/gcp/phase2/scripts/validate.sh
   set -a
   . infra/gcp/phase2/env.example
   set +a
   unset PHASE2_ONLINE_PLAN
   bash infra/gcp/phase2/scripts/plan.sh

   Prove from command traces and source that this path performs no gcloud or
   network call. Inspect apply-inert.sh without executing it. Verify exact
   Artifact Registry project/region/repository/digest checks, named Firestore
   recheck before first mutation, absent-resource preconditions, internal IAM,
   zero revision traffic, paused queue, absent Scheduler and distinct service
   accounts. Confirm apply-inert.sh always refuses before its first cloud call,
   has no accepted create-only Run gate value, and documents the `gcloud run
   deploy` time-of-check race as an activation blocker. Confirm the visible
   scaffold's separate queue-create and queue-pause commands leave an additional
   activation blocker, because they do not prove the queue starts paused.
   Inspect stop.sh without executing it. Confirm it cannot cancel a Vertex
   request already submitted and that later evidence must classify any in-flight
   outcome and cost.

9. Search the diff and history for credentials, tokens, service-account keys,
   private customer data, absolute private paths, mutable image tags, public
   access, default-database fallback, hidden enable routes, schedule activation,
   real provider calls in tests, callbacks/messages, publish/deploy/payment code
   and customer repository writes. Confirm no new source file exceeds 500 lines
   and no em dash was introduced.

10. Treat these as activation evidence that is still missing, not as reasons to
    fake a pass: real Firestore concurrency, container build/provenance, an
    atomic create-only Cloud Run path, online read-only plan, cloud apply,
    zero-traffic revision probes, a real low-cap
    Vertex v1 canary, a named cloud intake workload/network path, queue resume,
    initially paused queue creation without a create-then-pause interval,
    in-flight provider drain/accounting, Scheduler creation and customer-path
    execution. Also record these Firestore hardening requirements as activation
    blockers rather than silently treating partial bindings as complete:
    - dispatch reserve/deliver/release must bind the requested outbox document
      ID to outbox.intent_id, job.intent_id, job ID, pilot and generation;
    - claim, reconcile and terminal settlement must centrally bind every stored
      job, attempt, call, outbox, document and generation owner before mutation
      or cost settlement;
    - every retried Firestore transaction callback must capture its effective
      timestamp inside that callback, with contention proof that retries cannot
      shorten a reservation, lease or claim-acknowledgement deadline.

11. Produce one PASS or FAIL receipt containing:
    - tested branch, full SHA, merge base and default-branch drift;
    - exact commands, exits and test totals;
    - proof JSON summary and invariant-by-invariant source evidence;
    - dependency, secret, file-size and infrastructure findings;
    - merge blockers separated from activation blockers;
    - proof that the owner database, cloud and external systems were untouched;
    - the smallest fixes required for any failure.

Do not merge, push, deploy or activate after verification. Stop with the receipt
so Fritz can decide the next step.
```
