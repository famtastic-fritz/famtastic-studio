# Site Studio learning record

## 2026-09-21 - Reverify the actual cross-repository pair

Independent PHP journal/artifact tests cannot replace the full Studio/agency
pair. Run all paired source/portal/dispatch fixtures with exact source paths,
then both lint/proof commands and combined PHP. The current pair passes1588
Studio tests and791 PHP tests; synthetic receipts do not activate the pipeline.

## 2026-09-21 - Synthetic builds also need ownership-scoped cleanup

Full regressions can pass their assertions yet exhaust disk when batch/shadow
fixtures survive every case. Register each temporary root when allocated; restore
the caller's environment before deleting only those test-owned roots. Verify
absence in teardown. An interrupted run needs separate exact-target inventory,
open-file checks and a verified recoverable archive, not wildcard deletion of
all similarly named directories. Retain its failed-run receipt, and rerun the
same paired source rather than crediting an older full-suite pass.

## 2026-09-21 - Verify the packaged import closure, not the host checkout

A shared CLI helper can pass host tests while being absent from both filtered
images. Copy only the Docker-declared, context-allowed source into a disposable
root and execute its real Node imports. Removing the helper must fail; computed
imports need execution, not just literal-import scanning. This source check does
not prove a clean dependency installation, Linux image build or cloud activation.

## 2026-09-21 - Test executable entrypoints, not only imported functions

Node canonicalizes module URLs across macOS `/tmp` and other symlinks; comparing
an unresolved argv path can silently skip a CLI's main function. The actual
bounded-worker child-process test exposed this while imported function tests
passed. Preserve separate assertions for direct execution and inert import.
The signed public staging ingress deliberately forwards to the distinct internal
selected route, not the Phase 1 mock route. See the Mac capability evidence.

## 2026-09-21 - A completed-source fixture must supply complete authority

The old fixture selected uncredited Home against an already branded export and
omitted PNG authority. It also seeded another project's durable mapping first.
Start with an unassociated normal pipeline result, use the artifact bundle's
binary `bytes` field for the PNG, bind the full current scope including project
type, and supply authoritative files plus explicit rights. The separate proof
callback's 2 MB limit is not this complete-source contract. Fix the fixture, not
the production boundary. The one-file offline roundtrip passes; no full suite
or production activation is claimed.

## 2026-09-21 - Share transformation authority, not a worker's claim of equivalence

A required footer is not permission to waive selected-source hashes. A fresh
versioned grant binds the agency's original proof to a pinned, byte-exact
projection. Both languages independently compute it, preserve the original
selection and reject unknown policy or extra assets. The existing agency
presentation decorator is not the canonical source transform. Keep legacy
grants unchanged and require independent authored evidence for every added page.
Original lengths, not just digests, must match the retained bundle bytes.

## 2026-09-21 - Integrating real selected work with isolated execution pilots

- Preserve the Phase 1 mock firewall; a real opt-in consumer uses its own
  internal route. A configured runtime is not permission to change mock mode.
- A historical selected consumer can conflict with a newer approved footer
  policy even when Git merges cleanly. Verify the deterministic derivative,
  its exact PNG and private receipt at QA, hosting and later source reuse.
- Passing synthetic tests did not close Phase 2 source review: independent
  delayed-response and cross-linked-record probes found additional lease and
  ownership gaps. Retain failure evidence and fix them before activation.

## 2026-09-21 - A returned reservation is not current execution authority

A transaction can commit while its response is delayed past the worker lease.
Recheck the complete lease, dispatch and reserved-call lineage transactionally,
then check the local remaining lease immediately before provider submission.
Budget for the fixed provider timeout and headroom. Keep authorization evidence
separate from evidence that a request was actually sent; no local check can make
a database transaction and remote HTTP atomic. Terminal reconciliation must not
be overwritten with invented zero cost by a late worker.

Duplicates also require ownership checks. Read requested document IDs and bind
their stored identities before returning acceptance or renewing a reservation.
Checkpoint predecessors may span unclaimed redrives, but only with an explicit
resume marker and scheduled state. Test both rejection and that valid recovery.
Evidence: `docs/evidence/PHASE2-PRESUBMISSION-FENCING-2026-09-21.md` (synthetic only).

## 2026-09-21 - Recovery must validate lineage, not only record existence

A found outbox, expired attempt or successful model-call record is not enough
to authorize recovery. Validate its complete job/packet/intent/fence lineage
before financial settlement or artifact reuse. Reject stale dispatch generations
even on duplicate-response paths. Sample time inside transaction callbacks:
Firestore may rerun them after the original lease timestamp is stale. Retain
separate evidence for simulated transaction retries and real cloud contention.

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
## 2026-09-18 — Boot, hosting and business activation are different gates

A tested worker constructor does nothing if server boot never injects it. Test
the real boot graph, credential/config refusal, restart polling, process claims
and graceful shutdown. Verify deployed callback mounts rather than assuming
root `/api` routing. A private loopback tunnel should expose only signed ingress,
never the full operator interface. A successful synthetic protected-hosting
receipt does not create client bindings or prove a production callback. Neither
side currently allocates targets automatically; do not call this fully automatic
until target allocation and exact normal customer delivery are proven.

## 2026-09-17 - Private uploaded reference reuse (local)

Reference-sharing consent is neither a publication license nor AI permission. Persist restrictions outside and inside source repositories; register owned policy metadata with the build guard after bootstrap. Planning callbacks have no build artifacts and must not invoke build-only rights reads. Keep current rights checks ahead of both hosting and successful receipts.

## 2026-09-17 - Reconcile before reading mapped artifacts

An agency can name a real older verified source while its latest callback is delayed. Resolve that ancestor before mapped artifact reads, using durable history, Git ancestry and exact unchanged bytes; a missing digest and a verified older digest are distinct cases. Keep unknown hashes rejected. Test three revisions as well as the first callback delay.

## 2026-09-17 - Callback acknowledgement is not source completion

A locally verified page remains complete when hosting or callback transport fails. Persist semantic completed-step bindings and reconcile authenticated incoming records before assembly, without weakening the existing-output guard or claiming hosting/agency acknowledgement. Keep original source origin separate from a later handoff initiator. Multi-cycle browser regressions need a bounded timeout that covers their real work, so timeout cleanup cannot race active browser reads.

## 2026-09-17 - Separate completed source from changed customer intent

Source finalization is an output of an existing selection, so its arrival must not itself invalidate customer acceptance. Compare semantic page records, preserve completed packet identity for unchanged input, and advance on actual scope/content changes. Resolve missing work before requiring assembler fields; a transfer-only hero page needs no intro component. Writer-created mappings must survive process restart and retain exact existing page bytes.

## 2026-09-17 - Derive from source rather than require an absent template

Exact selected HTML can supply a marked shell without claiming receipt of an original template. Retain the full unchanged document and record parsed shell offsets/hashes. A source-preservation contract is valid for artifact import; it is not permission to invent palette/typography or to run a generic composer.

## 2026-09-17 - Hash producer bytes across languages

Associative PHP JSON decoding loses empty-object distinctions, and PHP/Node number serialization differs. Preserve a versioned authoritative byte payload and verify before decoding. Never validate an export by re-encoding a consumer view. Faithful fixtures must include real immutable chrome marker kinds, not only editable text.

## 2026-09-17 - Shared shell is structural, not the entire head

Legacy pages may have page-specific title, metadata and styles. Compare marked header/footer/shared CSS exactly; replace title and description explicitly. Require authored content and transformation permission independently of renderer validity. Check actual repository output absence before repository mutation, including case variants; packet manifests alone may omit existing files.

## 2026-09-17 - Wire ordering and existing semantic source contracts

PHP strcmp and JavaScript localeCompare disagree for mixed case. Wire manifests
must use locale-independent ASCII ordering; never rename customer assets to hide
hash differences. Inspect actual template artifacts before declaring structure
absent: this legacy family has header/footer/shared-style and typed field markers.

## 2026-09-17 - A prior clean/QA result cannot certify changed bytes

Parent review reproduced an exporter accepting edited files with old QA and
commit metadata. Recheck live HEAD/branch/worktree and the verify-stage manifest;
bind QA to site/run/manifest. Compare to actual verified bytes, not composer
suggestions: source protection may deliberately preserve existing scaffold files.

## 2026-09-17 - Export source after its repository commit

Source evidence must bind actual on-disk public bytes and finalized repository
identity. Exporting before the commit loses that binding; treating successful
pipeline verification as all-scope QA loses missing features and pending edits.
Record completion blockers separately and require the actual selected-browser QA.

## 2026-09-17 - A consumer fixture is not a normal producer flow

Observation: the cross-repository test exercised real serialization and receipt
services but supplied continuation authority by hand. Actual proof finalization
does not record those facts, so successful consumer tests overstated routine
readiness. Guidance: trace the writer of every authority-bearing field before
claiming end-to-end completion. Byte hashes, fulfilled media and valid HTML do
not establish agreed site scope, rights approval or protected target ownership.
Keep missing writers classified as implementation, not configuration.

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

## 2026-09-17 - Selected transfer is not generation

The old acceptance route retained only an event, and the generic pipeline would
repeat research even when receiving completed selected HTML. Durable packet
retention and explicit operation intent are separate requirements. Preserve
selected bytes and import provenance without generation. Validate prior evidence
against the current manifest/design, never use a completion claim to skip QA.
Cross-repository executable serialization caught a repository receipt mapping
missing mode; helper-only tests did not. Test the producer and receipt boundary
together. Existing Drupal packets need full scope/design metadata; a DNA digest
is not a reconstructible design contract. Natural-language revisions without an
executable recipe remain explicit exceptions. Local mock-host success is not
production integration proof.

## 2026-09-17 - Verify navigation and resources, not only page appearance

Independent review reproduced a missing link and stylesheet passing selected QA.
Screenshot parity can faithfully reproduce a broken source. Validate internal
paths/fragments and declared/runtime resource requests against the artifact,
with per-reference evidence. Review URL prefixes must be directory URLs before
resolution. A busy project must not prevent unrelated queued work. HTTP fixtures
must derive access/noindex from installed protection, not return those facts
unconditionally. The 43-test corrective run records these regression cases.
## 2026-09-17 - Reference aliases and inactive reupload correction

Independent review found two bounded edge cases. Hash-addressed reads now validate every same-packet declared alias and return exact bytes without dropping either output path; tenant/current-rights/containment checks remain required. Reuploading withdrawn bytes returns an explicit inactive-reference conflict, preserving withdrawal evidence. The dashboard clears stale success notices before actions; its existing API error path displays the conflict. Actual controller and two-path worker completion plus browser API error propagation are covered locally. No regrant, live action or Drive write.
## 2026-09-17 - First canonical-request Studio association (local)

The actual current unpaid request/selection writer issues an immutable one-hour signed source association. A normal Studio run can bind its verified Git/browser/file evidence without seeded mapping or rebuilding completed pages. Exact completed-copy evidence is checked against current authored fields. Durable callback retry survives restart; the first signed callback registers source and refreshes the normal request without Select. Complete pages package unchanged; only missing pages build in the same repository. Paid/reselected/expired/cross-tenant/conflicting-source/changed-copy cases fail. The grant never establishes hosting, acceptance or checkout. Initial association is static and assetless; arbitrary Studio-first agency customer/request creation and live transport remain unproven. Full regression is recorded separately; no production or Drive writes.

Association freshness follow-up: grant issue/acceptance re-read actual canonical intake scope/authored pages and contained selected file hashes/sizes, not only the saved intent. Direct row or source drift is rejected before mapping. Focused normal association/controller/route proof passes 3/3 in7.02s after this correction; the preceding full regression remains 1,014/99. Local only; no Drive write.

## 2026-09-17 - Unattended source callback and partial ancestry correction

Independent review found that durable association callbacks needed another manual call and that later ancestry rejected valid associated partial sources. The existing worker wake now retries the exact outbox envelope with explicit matched acknowledgement, shared project claims and bounded attempts. Expired/paid/reselected/changed-source/incorrect acknowledgements enter actionable non-ready reconciliation; unrelated work proceeds. Valid partial ancestry requires the original association and scope digest, exact authenticated wire, bound source/browser QA, only required_pages_incomplete, and actual Git ancestry/unchanged bytes. Callback-delay and upload-failure sequences add only Team after local About completion. Focused lifecycle proof10/10 passes21.57s; full regression recorded separately. No daemon, live activation, mail or Drive writes.

## 2026-09-17 - Keep build success separate from handoff retries

Independent POST-route review found that combining build and source association could rebuild on a failed callback replay. The combined run option is now explicitly rejected before work; supported orchestration creates once, then associates the stored site/run through its separate endpoint. Actual POST replay/concurrency/conflicting-input checks preserve run count and Git HEAD. Transient callback failures (including408/429/503) now retain persisted due times with5-second exponential backoff capped300 seconds, continuing within grant validity instead of stopping after three attempts. Permanent/stale authority still requires reconciliation. Focused11-case proof includes more than three transient failures, restart, automatic recovery and unrelated work; full regression recorded separately. No live or Drive changes.

## 2026-09-17 - Current handoff synopsis and independent closeout

Final independent parent code review passed 1,022 tests/99 files in77.73s with all PHP/browser environments, plus PHP42/3 selection/3 portal API cases and lint/diff. Refreshed the canonical handoff and writer-plan openings to describe current bounded support, explicit unsupported profiles and actual operational gates; marked older checkpoint claims historical. Append-only progress entries must not leave the current synopsis stale. No production or Drive changes; final dependency cleanup is separate from code proof.
## 2026-09-18: Hosted inquiry proof verification

Two independent redesign proofs passed persisted inquiry, authenticated owner status, content editing and browser submission checks. HTTP 200 alone can be a host anti-bot page; require JSON success, pace live probes and reuse SSH. See [candidate and exact source evidence](recipes/independent-review-inbox-candidate.md). Customer assets and records remain in their owning repos; generator promotion is unproven.
