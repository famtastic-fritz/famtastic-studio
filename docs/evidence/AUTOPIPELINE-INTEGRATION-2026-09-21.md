# Additive Mac/cloud automation integration

Status: in progress, local source only. No production cutover.

## Autonomous integration checkpoint, September 21

The owner's explicit four-milestone goal supersedes the earlier conflict stop.
All integration remains isolated from the canonical running checkout. Current
main bf1ef9c was merged as 9468ecf, preserving the independent customer
collection policy under Development/FAMtastic/sites. The selected consumer
9d0f6a2 is being integrated; this is not a production release.

The internal `/api/pipeline/staging/accept` route retains its Phase 1
mock/disposable firewall. The real selected runtime has a separate
`/api/pipeline/selected-staging/accept` route, requires an injected enabled
runtime and refuses conflicting Phase 1 execution modes. The narrow private
ingress retains the existing external signed path and forwards its exact bytes
only to the real selected route. No orphan fallback queue, extra public Studio
surface or automatic provider activation is introduced.

Integration reproduced an additional incompatibility: main's mandatory creator
credit derivative changed HTML and added the exact PNG, while the older selected
QA and hosting consumers compared against the original bundle. Reconciliation
also rejected later selections against the legitimately derived source. The
repair recomputes the one owner-authorized deterministic transform, verifies
its private receipt and exact public inventory, and preserves original selected
hashes. It does not use arbitrary built output as its own QA baseline. Receipt
files remain private; the original selection and client acceptance do not change.
The changed output, including the PNG, must pass browser and hosting checks.

Local evidence directory: integration-1.xB6nQM under the existing verifier root.
The first retained selected run failed one of 41 tests (39 passed, one explicit
cross-repository skip) at source reconciliation. The focused corrected case and
eight new credit-provenance/tamper tests subsequently passed. This is not a
full-suite pass; cross-repository and final merged verification remain required.

The subsequent credit-and-selected-recheck.log run passes 28 tests in three
files: all 12 selected-worker cases, nine credit/source/rights cases and seven
route-boundary cases. Exact-original protected HTML is rejected before any
pipeline write; unchanged protected imagery retains its original bytes.
Reused multi-page builds use verified finalized-source provenance for their
derivative baseline. First Studio-origin association still fails closed at
its legacy assetless/original-Home gates; both producer and consumer need a
matching signed, narrowly scoped creator-credit policy before that path passes.

Independent review of fixed e163df7 found four reproducible Phase 2 issues:
stale pre-submission lease after reconciliation; completion without full outbox
binding; expired-claim attempt generation mismatch; and incomplete finalized
duplicate admission ownership. These are assigned to a separate repair worktree
on codex/phase2-presubmission-fencing. They remain release blockers until fixed,
independently checked and regression-tested. No cloud activation is permitted.

Read-only Mac inventory found no signed-in gcloud account or selected project.
The disk also fell below 200 MiB free during this pass and remains below safe
build headroom. Fritz has been asked for at least 5 GiB headroom and the intended
existing Cloud project/sign-in. No user files, evidence or credentials were
deleted, and no cloud resource was created. These are external prerequisites,
not reasons to replace the Mac workflow or call the four milestones complete.

## Milestone 1: offline validation compatibility

Base candidate: 184f61d323a0fcadc1712e9a312c664117209bd1.
Origin main: 16fc24ee03c679a8acf38cb1d6047895fa7c5b6d.
Work branch: codex/autopipeline-mac-cloud-integration.

The original candidate failed two bootstrap guard tests because macOS Ruby
2.6 lacks YAML.safe_load_file. Safe parsing of file contents fixes this without
weakening the gate. Added five checks cover valid YAML, malformed YAML, aliases,
Ruby object tags, and absent parsers. Parser errors never invoke a fallback.

Sandboxed rerun: npm ci, lint, diff check, 169 Phase 2 tests, 42 Phase 1 tests,
both execution proofs, full suite (1,155 tests, 101 files), offline validation
and offline example plan passed. npm audit --omit=dev: zero findings. Full audit
retains two documented moderate development findings through Vitest/mocker;
no forced major upgrade. No real cloud/provider/customer effects were exercised.
Database/WAL/SHM before/after snapshots were identical.

Original and repaired command logs are retained locally in the verifier evidence
directory, with the repaired run under repair-1; they are not customer data or
proof of production operation. The complete 82-file candidate review remains
unfinished. Passing tests do not close the source review or activation gates.

## Authorized sequence and handoff to the parallel design session

1. Repair and finish Phase 2 independent review, preserving the original bundle.
2. Trace and connect automatic request processing to existing Mac capabilities.
3. Prove a controlled request through proofs, notification capture, selection and
   exactly one staging build, including interruptions and duplicate events.
4. Add cloud workers behind the same durable ownership protocol, not a second
   competing customer queue. Prove offline-Mac recovery before claiming it.

Preserve Drupal commercial/customer authority, selected artifacts, independent
customer repositories and explicit acceptance before final launch. Routine
green work must not gain a new Fritz approval gate. Unknown outcomes, rights,
security, unsupported scope and budget exceptions must remain visible.

The current Phase 1 endpoint explicitly requires mock/disposable configuration.
Do not repurpose that mode or remove its firewall to pretend real execution is
implemented. The Phase 2 cloud runtime is a separate shadow pilot, not a Mac
worker connection. Mission Control is a later view over proven operational
state, not a prerequisite and not another execution authority.

## Milestone 2: recovery identity and transaction retry hardening

Local source verification only. Dispatch reserve/deliver/release now bind the
job, intent, outbox identity and bounded integer generation. Expired-attempt
recovery validates task, packet, project, pilot, intent, fencing token and
deterministic model-call identity before accounting or reuse. A late reconciler
cannot recover a different active attempt. Lease/admission/dispatch timestamps
are sampled inside transaction callbacks so retries do not commit stale clocks.

Added 30 regression cases, including discarded transaction callbacks and foreign
attempt/call records. These simulate retries; they do not prove live Firestore
contention. The sandboxed repair-3 run passes 1,185 tests in 102 files, lint,
both synthetic execution proofs, safe YAML validation and the offline plan.
The legacy studio.db/WAL/SHM snapshots are identical. No production activation,
provider call, customer callback, message or cloud mutation occurred.

The canonical Designs disposable customer journey also passes after repairing
its omitted frontend narration dependency. That fixture captures 34 messages
and still exercises an owner-review gate; it is not evidence that the new
unattended creative-to-staging path is connected.

Read-only live checks on September 21: Drupal automation-health is observe-only,
with zero enrolled jobs and zero reserved cents. Mac PID 78266 serves healthy
on 127.0.0.1:3400 from the canonical site-studio-next checkout. The Phase 2 cloud
pilot remains additive and disabled. Complete source review, automatic intake,
real selected consumer integration and laptop-independent proof remain open.

## Remaining gates (updated)

Read-only integration check: `git merge-tree --write-tree HEAD 9d0f6a2`
exits 1 with conflicts in server/modules/pipeline/index.js, docs/CHANGELOG.md
and docs/SITE-LEARNINGS.md. No index, checkout or branch merge was performed.
The real selected-staging consumer and Phase 1 mock admission both changed the
same endpoint. This is a release integration stop, not permission to discard
either side. Resolve through an explicit contract preserving the mock firewall
and real consumer identity before activation, then rerun both regression suites.

Runtime paths were separately read from /api/admin/paths: the running service
uses Development/famtastic-wt-phase-0/.studio-next-data. The preserved legacy
studio.db snapshot must not be represented as a snapshot of that filesystem
data root. The runtime execution root does not exist; no production durable
execution database was opened or migrated in this pass.

- Full source/security review and Firestore ownership/timestamp hardening.
- Real consumer/producer contract and scheduler/worker inventory.
- End-to-end isolated customer proof and recovery evidence.
- Authenticated shared Mac/cloud claims and deployment evidence.
- Cloud create-only/initial-pause, concurrency, provenance, bounded canary and
  in-flight cost accounting proofs. Cloud remains disabled.
