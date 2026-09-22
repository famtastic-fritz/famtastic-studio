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

## Remaining gates

- Full source/security review and Firestore ownership/timestamp hardening.
- Real consumer/producer contract and scheduler/worker inventory.
- End-to-end isolated customer proof and recovery evidence.
- Authenticated shared Mac/cloud claims and deployment evidence.
- Cloud create-only/initial-pause, concurrency, provenance, bounded canary and
  in-flight cost accounting proofs. Cloud remains disabled.
