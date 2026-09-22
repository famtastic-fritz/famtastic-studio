# Site Studio learning record

## 2026-09-21 - Validate the actual Mac parser, not a presumed Ruby version

Observation: the Phase 2 validator selected system Ruby by executable presence
and then called an unavailable YAML.safe_load_file method. Two guard tests
failed before reaching their intended safety boundary.

Guidance: check safe-parser capability, parse file contents through safe_load,
reject aliases and object construction, and fail closed if no parser exists.
Do not silently skip validation or replace the workstation runtime globally.
Keep original failure receipts alongside repaired results. Cloud execution is
additive; this fix does not install automatic Mac customer triggers.

## 2026-09-21 - Source proof is not cloud activation proof

Observation: a cloud-shaped runtime can pass deterministic HTTP, storage,
dispatch, lease, recovery and cost tests without proving a deployable customer
path. Local Phase 1 cannot call an internal-only Cloud Run control service, and
an authorized but unattached intake service account does not create that path.
Likewise, a fake provider response proves checkpoint behavior but not the exact
Vertex API request, latency, usage metadata or billable cost in the target
project.

Guidance: keep source, committed, merged, deployed, traffic-serving and active
states distinct. An inert baseline should require more than one independent
gate: zero revision traffic, a paused queue, absent Scheduler, persistent global
pause, dispatch off, worker off and provider off. Admission must reserve durable
identity before immutable object storage, while duplicate reservations renew a
generation-bound expiry so reconciliation cannot race an in-flight write. Save
a successful provider outcome before artifact persistence so recovery never
repeats a billable model call merely because the artifact write failed.
Likewise, bind the model-call ID to the attempt inside its reservation
transaction, so a lost commit response can be classified without inventing a
second call. A queued task also needs a durable claim deadline: advance its
generation when no claim is recorded, and reject every older generation before
provider work.

The current observation sends bounded packet metadata, not selected preview
bytes. It can prove execution mechanics, not visual or design quality. Before
activation, independently prove Firestore concurrency, a low-cap Vertex `v1`
canary, a named cloud ingress workload and network route, image provenance,
zero-traffic probes and the pause/stop drill. A future Mission Control page can
be a read-only view over these states; it is not required to make the backend
durable and must not become a second execution authority.
Do not describe a baseline as inert when a queue is created running and paused
only by a later command. Also record that stopping future work cannot cancel a
provider request already submitted; drain evidence must reconcile its outcome
and cost.

Evidence: `npm run prove:execution:phase2`, the Phase 2 focused tests and
`docs/evidence/DURABLE-EXECUTION-PHASE2-2026-09-21.md`.

## 2026-09-19 - A 202 receipt must follow durable intent, not precede work

Observation: the signed staging endpoint recorded acceptance but did not start
or durably dispatch a build. Enabled schedule records and a permanent server do
not prove that queued work executes, retries or recovers after interruption.

Guidance: commit the task, job, idempotency binding and dispatch intent in one
transaction before acknowledging it. Treat JSONL journals and events as
retryable projections when SQLite is the authority. Keep one AgentTaskLog row
per task and separate attempts and model calls so retries do not rewrite task
identity or hide cost. A global pause must be rechecked immediately before work,
leases need fencing and expiry, artifact identity must be stable across retries,
and exhausted work must become visible dead letter state.

Synthetic fixtures can prove state-machine behavior but cannot prove preservation
of a real database. Take an online backup, migrate only the disposable copy and
compare legacy rows before and after. A Phase 1 manual observation gate does not
change the selected-build contract: routine green customer builds must not wait
for Fritz approval. No mission-control subdomain is required to establish this
backend contract; a later dashboard should be a read-only view over these states.

Evidence: `npm run prove:execution`, the durable execution test files and
`docs/evidence/DURABLE-EXECUTION-PHASE1-2026-09-19.md`.

## 2026-09-17 - Missing SFTP inputs do not mean missing hosting access

Observation: the default adapter required SFTP settings while the ecosystem
already held a working cPanel API credential and upload recipe. A controlled
customer review deployed successfully through API2 mkdir and UAPI upload_files.
Guidance: inspect repository recipes, stored credential IDs and live routing
before asking the owner for access again. Record actual transport proof apart
from adapter readiness. Root-sharing makes host and anonymous-access checks
mandatory; absent DNS is not privacy. See the client-selected build contract.

## 2026-09-14 - Source ownership must be enforced before the first write

A validator alone is not a reproducible website build. The older static composer
used an echo-only build command and had no lockfile or local tests. Fresh generated
clones now prove `npm ci`, tests and a real allowlisted public artifact build. A
failed HTML check or unsafe allowlist does not replace a previous artifact. Keep
Git knowledge records separate from publishable files: the old deployment denylist
was too narrow once full source docs existed. Static deployment now requires an
explicit public-file list for source repositories and excludes JSON, Markdown,
backend paths and symlinks. Application runtime configuration needs its own recipe.
Generated build output also needs ownership: being named `dist` does not make a
directory disposable. The static builder records exact generated inventory in
Git-local metadata and refuses tracked, unowned, modified or extra output. A
successor is staged before the receipted predecessor is replaced. Compatibility
accepts legacy explicit-array public manifests through the same safety gates.

Independent runtime is insufficient when the customer source remains inside an
agency repository. The prior post-build scaffold also bypassed direct builds
and overwrote authored documentation. Use the same preflight/package before all
creation paths, record foundation files in DNA, preserve authored source and
reject foreign/dirty/common-directory targets. A remote URL comes from Git, not
from a naming convention. See the repository reconciliation research record.

Sibling imports were locally functional but not portable. Discovery now reads
the pinned catalog from an explicitly configured independent checkout and
checks root, origin, revision and bytes. Availability of a library is not proof
of a full studio UI, installed application or production customer workflow.

## 2026-09-14 - Newsletter is a separate business-owned consent lane

Preserve explicit signup apart from booking, double-opt-in, read-only GET,
CSRF-protected confirmation/unsubscribe and business-owned storage/outbox.
An owner reader list does not imply campaign sending. Automatic transaction
retries must never wrap SMTP: the fixed post-acceptance deadlock check proves
one send, an uncertain outcome and no automatic resend.

The orchestrator verified source `b79aca2b` live through a controlled HTTPS
signup/confirmation/unsubscribe lifecycle and removed the fixture. This is a
candidate source pattern for future builds, not an imported or bundled Studio
feature. Keep readiness flags unchanged. Published local SEO files establish
source/deployment evidence, not search-account setup or rankings.

## 2026-09-14 - Application ownership must survive component discovery

Observation: The first Locs Owner Desk used the agency customer portal as its
runtime. The owner required a separate business application instead. Reusing a
presentation component was incorrectly allowed to determine the location of
authentication, booking records and notifications.

Guidance: Discover and reuse components at build time while preserving the
business's own backend descriptor, same-domain owner routes, identity authority,
database boundary and notification queue. An agency footer credit is not a
runtime dependency. Do not downgrade an application site into a static rebuild
or point it back to the agency portal when updating pages or assets. If Studio
cannot represent the functional contract, stop that operation explicitly.

Evidence: Designs source `ebb1215c`, `customer-apps/tighten-up-your-locs/`, and
`docs/architecture/LOCS_STANDALONE_APPLICATION_V1.md`. The orchestrator reports
core cutover live: database isolation, exact one-request import, 12 legacy write
guards, hosted controlled owner workflow, unchanged six-table rollback digests,
and fixture cleanup. Own same-origin booking, independent worker and nightly
backup are active; a backup was verified and corrected instructions accepted by
SMTP. Personal owner sign-in, inbox delivery and a restore drill remain separate
gates. Newsletter was pending at that core checkpoint; its later release is
recorded above. The capability record pins exact
source/package and receipt identifiers.
The Component Studio historical React hashes and Site Studio discovery-only
flags remain unchanged.

Post-evaluation: The discovery seam correctly preserves readiness metadata, but
the consumer guidance was too vague about business ownership. The updated
contract now names forbidden agency runtime dependencies. A future executable
application recipe needs an independence test in addition to visual parity and
catalog discovery tests.

## 2026-09-13 - Owner Desk recipe discovery and evidence boundaries

Observation: An earlier research review counted relative path segments incorrectly and called the Component Studio sibling import broken. Executing the existing import showed it was already correct. The new `/api/component-recipes` endpoint adds specification discovery, not a path repair.

Guidance: Resolve and execute imports before declaring a discovery failure. Test missing-library behavior separately from successful empty catalogs. Preserve implementation/readiness fields from the source package instead of normalizing them away. Recipe discovery does not prove rendering, customer authorization, booking transactions or deployment.

The captured Owner Desk implementation belongs to the FAMtastic Designs booking lane; reusable presentation source belongs to Component Studio. A future Studio build must bind the selected business's approved brand and backend adapter explicitly. Never transplant Tighten Up Your Locs identity or records into another business. Calendar and class enrollment are distinct domains sharing instructor time.

Evidence: `tests/component-recipe-discovery.test.js`, `docs/capabilities/OWNER-DESK-RECIPE-DISCOVERY.md`; consumer implementation lineage is recorded in Designs `docs/evidence/owner-desk-implementation/`.

## 2026-09-18: Hosted inquiry proof verification

Two independent redesign proofs passed persisted inquiry, authenticated owner status, content editing and browser submission checks. HTTP 200 alone can be a host anti-bot page; require JSON success, pace live probes and reuse SSH. See [candidate and exact source evidence](recipes/independent-review-inbox-candidate.md). Customer assets and records remain in their owning repos; generator promotion is unproven.
