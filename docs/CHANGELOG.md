# Site Studio Next change log

## 2026-09-21 - Fence recovery records and refresh retried transaction clocks

Bind dispatch records, expired attempts and checkpointed calls to exact job,
pilot, packet, intent and fencing identities before mutation or reuse. Refresh
timestamps within transaction callbacks. Thirty added regression cases and the
full 1,185-test suite pass; both synthetic execution proofs and offline validation
pass. This is local source evidence, not live Firestore or customer automation.
See `docs/evidence/AUTOPIPELINE-INTEGRATION-2026-09-21.md`.

## 2026-09-21 - Mac offline validation repair (local only)

Use safe YAML parsing compatible with the workstation's Ruby 2.6, reject
aliases/object construction, and fail closed when no parser is available.
Full suite: 1,155 tests passed across 101 files. Offline infrastructure
validation and example plan passed; Phase 1 and Phase 2 synthetic proofs passed.
No deployment, cloud activation or customer execution occurred. See
`docs/evidence/AUTOPIPELINE-INTEGRATION-2026-09-21.md` for scope and remaining work.

## 2026-09-21 - Inert durable execution Phase 2 candidate

Added an isolated Google Cloud shadow runtime around the Phase 1 contracts:
private control and worker HTTP services, staged Firestore admission, named Cloud
Tasks dispatch, immutable GCS source and observation artifacts, fenced leases,
provider-success checkpoints, bounded recovery, explicit dead letters, cost
ledgers, exact OIDC route identities and a deny-by-default customer-effect
firewall. The fixed provider is Vertex Gemini 3.1 Flash-Lite through
`@google/genai` Vertex API `v1`, with `MINIMAL` thinking, a combined 4096 output
and thinking-token bound, and billed thinking-token accounting.

Unclaimed task deliveries now carry a bounded, transactional worker-claim
acknowledgement and advance through fenced dispatch generations; stale tasks
cannot execute and exhaustion is visible. A failed FULL lookup after Cloud Tasks
reports `ALREADY_EXISTS` parks the job with unknown execution risk. Lost
responses from a committed model-call reservation recover the attempt-bound call
and can settle it at zero only with proven pre-provider absence.

The infrastructure package is deliberately inert and apply is hard-disabled
before cloud calls until Cloud Run creation is atomically create-only. The
reviewed target gives new revisions zero traffic, pauses the queue, omits
Scheduler, keeps all four application controls safe, and leaves the intake
identity unattached to a cloud workload.
A pause-only command and stop sequence persist the safe controls and continue
IAM containment even when one containment action fails. There is no enable
command in this package.

Bootstrap, pause and apply refuse an ambient Firestore emulator. Two activation
blockers remain explicit in the infrastructure scaffold: Cloud Run lacks an
atomic create-only path, and queue creation followed by a separate pause leaves
an unproven initial-running interval. Stop cannot cancel a Vertex request already
in flight, so a live drill must reconcile its outcome and cost.

The hermetic composed proof drives 20 synthetic jobs through the production
control and worker HTTP composition. It ends with 18 observations awaiting the
pilot review gate and two visible dead letters, including admission recovery,
provider-checkpoint recovery and generation-10 dispatch exhaustion. It made no
real provider, Google Cloud, network or customer-effect call. Firestore emulator
concurrency, a real GCP provider canary, ingress connectivity, deployment and
activation remain unproven. See
[the Phase 2 evidence](evidence/DURABLE-EXECUTION-PHASE2-2026-09-21.md).
The production dependency audit is clean; the full audit retains two moderate
development-only `@vitest/mocker` findings whose reported fix requires a major
Vitest upgrade.

## 2026-09-19 - Fail-closed durable execution Phase 1

Selected staging intake now commits one AgentTaskLog row, one Phase 1 job and
one dispatch intent in a single SQLite transaction before returning 202. Exact
duplicates return the original receipt; conflicting reuse returns 409. Journal
and event files are idempotent post-commit projections with an explicit retry
helper, so a filesystem failure cannot create a false rollback or erase the
authoritative acceptance.

Added bounded worker leases, fencing, retry backoff, dead letters, deterministic
artifact identities, a pilot-only manual gate, per-attempt and per-model-call
records, zero-cost mock provider enforcement, a default-on global pause and
default-off dispatch and worker controls. Phase 1 accepts only a privately branded deterministic mock and
a direct-child disposable SQLite file under the execution root. It rejects real
providers, effects, symlinks, hard links, foreign SQLite application IDs and
unsafe file modes. This does not start a worker, schedule, cloud service,
callback, message, deployment or customer build.

The synthetic 20-job proof covers duplicate intake, an outbox repair, a runtime
restart after two abandoned leases, transient retries, permanent failure and
retry exhaustion. It asserts 18 pilot-gate jobs, 2 dead letters, 27 attempts, 25
zero-cost mock calls, 18 matching database and disk artifacts, no active lease,
no orphan and no external effect. Preservation of the actual 448 parked jobs,
seven schedules and three performance rows remains for independent verification
against a SQLite online-backup copy, never the live database. See
[the Phase 1 evidence](evidence/DURABLE-EXECUTION-PHASE1-2026-09-19.md).

## 2026-09-14 - Independent source foundation and portable libraries

Compatibility follow-on: the one public-file manifest path accepts both existing
explicit arrays of relative strings and `{schema_version:1,files:[...]}`. Both
formats use identical private-path/type/symlink gates; invalid records never
fall back to an empty or broadly copied release.
Generated static builders now reject tracked, unowned or edited `dist` outputs
using an exact Git-local ownership receipt; only unchanged generated predecessors
can be replaced after the next artifact is staged.
The exact root `.htaccess` is retained when explicitly packaged for Apache,
while localhost previews still refuse to serve it. Other hidden/source files
remain denied. This preserves the existing Inc site's server-control boundary.

Generated static repositories now include dependency-free lockfiles, actual HTML
tests, CI and a real `npm run build` producing allowlisted `dist/` output. Local
preview and deploy reject private source/metadata and symlinks. Source repositories
without an explicit public-file manifest cannot use the static deploy adapter.
Existing authored package/test/deployment docs, PHP and .htaccess survive rebuilds.

Follow-on: after source push and idle/data verification, the authorized local
launchd service was switched to the independent checkout while preserving its
exact data root. Both live library catalogs resolve, and the real pipeline
rejects a wrong-repository target with 409 before writing. The runtime receipt
is recorded separately from customer website deployment.

Added one versioned site-foundation package, Git identity preflight, complete
startup/design/learning/research scaffold and preservation rules. Direct,
conversational and retry paths now share the contract; foreign origins and dirty
targets fail before site writes. Removed invented repository URLs. Components
and Media now discover pinned JSON catalogs with explicit unavailable states,
separate from portfolio inventory and full platform readiness. See the
[source contract](capabilities/SITE-REPOSITORY-STANDARD.md). No customer website
service restart or customer data migration is implied.

## 2026-09-14 - Business-owned newsletter source awareness

Recorded verified consumer release `b79aca2b`: 18-table independent application,
controlled signup/confirmation/unsubscribe proof, fixture cleanup and an
owner-only read-only reader list. No campaign sender or bundled newsletter
component is claimed. Future builds must preserve separate consent, own storage
and one-attempt SMTP with explicit uncertain outcomes. Published local SEO files
do not prove GBP, Search Console or rankings. All discovery/recipe readiness
flags remain unchanged; later `576b190a` deployment was still pending.

## 2026-09-14 - Preserve independent business applications

Documented the Locs owner correction: shared components do not imply an agency
portal, identity, database, booking API or notification queue dependency. Future
application-site updates must preserve the independent backend and same-domain
owner entry, not regenerate a static substitute or the retired portal route.

Recorded independent consumer source `ebb1215c`, migration guard source
`4cec4bd3` and public source `3dfaed65`. The orchestrator reports core cutover
live, exact one-request import, 12 legacy guards, hosted controlled owner
workflow checks, unchanged rollback digests, independent workers and a verified
backup. Corrected instruction emails were accepted by SMTP. Personal owner
sign-in, inbox delivery and a restore drill are not claimed complete. Newsletter
was pending at the core checkpoint and is recorded above. Exact identifiers are in the
capability record.
Discovery remains read-only and non-executable; no readiness flags or runtime
code were promoted by this documentation change.

Validation: 11 focused discovery/inventory tests passed; whitespace checks pass.

## 2026-09-13 - Read-only candidate recipe discovery

Added `GET /api/component-recipes` to discover specifications from sibling
Component Studio while preserving readiness flags and explicitly reporting an
unavailable library. Existing component inventory remains intact. Four focused
discovery tests and seven inventory tests pass locally. No executable owner UI
import, scheduling runtime or production deployment is claimed.

See [capability and learning](capabilities/OWNER-DESK-RECIPE-DISCOVERY.md).
