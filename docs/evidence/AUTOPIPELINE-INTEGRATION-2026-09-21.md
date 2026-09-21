# Additive Mac/cloud automation integration

Status: in progress, local source only. No production cutover.

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
