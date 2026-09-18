# Selected staging implementation handoff, 2026-09-17

## Current handoff synopsis

Code checkpoints: Next **7b44be49053b0a5541b14acb4e0df3cc2383af9c** and agency **cd0301130f9ea9f553a0e35442c8f68651bd81bd**. These identify the reviewed implementation before this documentation refresh; all commits remain local.

- Next: branch `codex/selected-staging-continuation`, worktree `/Users/famtastic-fritz/Development/worktrees/studio-selected-staging`.
- Agency: branch `codex/selected-staging-contract`, worktree `/Users/famtastic-fritz/Development/worktrees/fd-selected-staging-contract`.
- Implementation sweep: **1,022 tests / 99 files in 70.01 seconds**, all three PHP harnesses and actual portal component/browser dependencies enabled. Eleven source-association cases cover the final route/backoff corrections.
- Final independent parent review of these code checkpoints: **1,022 tests / 99 files in 77.73 seconds**, the same PHP/browser environments, plus PHP 42 contract assertions, 3 selection cases, 3 portal API cases and Next lint/diff checks. No open code findings remain within the bounded local scope.
- Final post-documentation cleanup will verify and remove only the exact temporary `node_modules` symlink in the Next worktree. It was retained for independent verification and is not committed. Do not treat historical cleanup notes below as current status.

### Supported local flows

**Designs-first selected static source:** real proof callback/raw capture, ordinary request/page-copy writers, selection/project creation, immutable artifact reader, derived marked shell, durable source mapping and matched receipt are connected. The normal request can produce executable records without a preseeded continuation/permission/source-authority blob. Package existing static source unchanged, or assemble missing authored pages using one unambiguous intro/hero with exactly the supported heading/body text fields. Original template bytes need not be invented: derivation from selected bytes is explicit.

**Uploaded private references:** exact active same-customer/request uploads bind to selected manifest bytes for protected review only. Distinct sharing/AI/likeness statements remain separate. Multiple declared aliases preserve each output path. Withdrawal invalidates pending work and acceptance; reuploading inactive bytes returns an explicit conflict. Current rights are rechecked, private restrictions survive source exports/receipts, and anonymous proof sharing/public consumers are denied. This is not a generated-media license or public-use grant.

**Studio source association to an existing agency request:** create the normal Studio source once, obtain a grant through `/api/pipeline/source/association`, then associate its existing site/run through `/api/pipeline/source/associate`. The agency grants only the current canonical unpaid selection, binding source/design/scope/customer/project/request and validity. Actual Git/file/browser evidence and completed-copy fields are checked. First source registration refreshes the request without another Select. A complete source packages unchanged; a verified partial source continues only missing pages in the same repository. The combined `/api/pipeline/run` association option is explicitly rejected before work, preventing callback failure from causing a rebuild.

**Revisions and recovery:** normal request changes advance the current work and clear stale acceptance. Verified completed pages survive callback/upload delay and process restart, including partial-association ancestry. The existing worker wake drains the source outbox with exact acknowledgements and shared project claims. Transient failures, including timeout/408/429/503, retain the same envelope with persisted exponential backoff from 5 to 300 seconds within grant validity. Permanent rejection or expired/stale authority enters actionable non-ready reconciliation; unrelated projects continue. No duplicate repository or retry rebuild is authorized by a transport failure.

Source finalization, source acknowledgement, protected hosting, customer acceptance and checkout remain distinct. No source callback creates hosting readiness or customer acceptance; checkout requires explicit acceptance of the current exact hosted receipt.

### Unsupported profiles and remaining operational proof

Generic application/backend generation, arbitrary layouts or existing-page edits, unspecified copy, arbitrary media transformations/licensing, and creating new agency customers/requests from Studio are not implemented by this profile. Unsupported requests retain explicit planning/exception states. Initial Studio association is static and assetless; private-reference continuation has its own separately verified rights path. See [current normal-record proof](normal-selected-records-proof-2026-09-17.md), [current writer status](../plans/NORMAL-SELECTED-WRITERS-2026-09-17.md), and [source association contract and limits](../plans/SOURCE-ASSOCIATION-2026-09-17.md).

Remaining evidence: matching Drupal vendor/runtime and real SQL transaction/concurrency/controller/customer lifecycle proof; production metadata reconciliation where applicable; actual installation-owned review target allocation and capability configuration; real credential/TLS/access/hosting/served-browser verification; authorized narrow consumer activation and rollback. Synthetic Drupal persistence and protected-host responses are not live service proof. The [consumer runbook](../capabilities/SELECTED-STAGING-CONSUMER.md) remains the activation reference. Routine in-scope protected builds retain the existing owner-approved policy; no new per-site engineering approval gate was added.

No push, merge, production/config/cron/DNS/hosting activation, provider execution/spend, customer send, payment or Drive write occurred in this task.
Production cron/email behavior and the Kakes delivery issue are not repaired merely by these local commits.

## Historical initial checkpoint — superseded by the synopsis above

The remainder preserves earlier evidence and file lists. Its missing-writer and cleanup statements describe those earlier checkpoints, not the current implementation.

### Historical revisions and isolation

Next code: 118201eeb06e5cc39954c67238fd5b773e76e013 (includes independent-review corrections; original implementation b5a3a30 and access guard d75caba).
Branch codex/selected-staging-continuation.
Worktree /Users/famtastic-fritz/Development/worktrees/studio-selected-staging.
Base fbca6d1ab42bc9dde48e368773c9b58e7d3461ab.
Remote https://github.com/famtastic-fritz/famtastic-studio.git.

Agency: 92e0d4b68d15fd69b3afd803bb7adb6040b3ceeb.
Branch codex/selected-staging-contract.
Worktree /Users/famtastic-fritz/Development/worktrees/fd-selected-staging-contract.
Base 411252cc98ee6fd6147682615c9d218542e1a275.

All commits local only. No running checkout switched, no push/merge, customer
job/message/payment, credential read, public upload, DNS/config/cron/reload.
Disk began at 2.4GiB free and finished near 1GiB; no installs or user-file deletion.
Temporary task dependency symlinks were removed. Both feature worktrees clean.

## Historical delivered behavior

Durable selected intent, immutable revision/account binding, explicit packaging
versus narrow static continuation, real cPanel HTTP/runtime source, private
backup/restore and signed callback retries. Existing source is imported without
provider/generation calls. An explicit selected-template slot recipe adds only
missing pages and records original/template/output hashes. General application
and freeform revision execution remain unsupported and the overall general
build-continuation requirement stays open; such requests become exceptions,
not falsely ready sites.

Agency selection serializer and receipt logic share executable contracts. The
normal proof finalizer does not yet produce the required continuation evidence;
the positive test supplies that evidence synthetically. Missing
metadata preserves selection and records a specific exception. Local legacy
reconciliation retains old source/project identity. Newer revisions archive
prior receipt/acceptance, reject stale callbacks, supersede old queued readiness
and close checkout. Failure never queues ready mail. Portal acceptance sends
the displayed exact receipt hash and refreshes stale replies without accepting
the replacement. Initiation matrix distinguishes existing Studio-local build,
Designs selected dispatch and proposed-only reverse business initiation.

## Historical evidence

Next: 124-test/16-file bounded sweep passed; then 3 targeted HTTP assembly tests
passed including one added access-policy preservation test (125 distinct tests).
Final cross-repo serializer -> real pipeline/browser -> mock hosting -> actual
PHP receipt service rerun passed against agency commit 92e0d4b. Lint/diff clean.
Exact commands: ../env/selected-staging-proof-2026-09-17.md.

Agency: parent independently reran 40 PHP contract assertions and 3 API/hash
flow tests successfully. Agency subagent also verified actual React/API browser
320/390/768/1280 containment, 44px control, one stale request and checkbox reset;
portal DNA 34/0; brand sync; nine PHP lints; frontend build on Node24.19.0.
Sparse font/hero assets and existing chunk-size warnings mean the frontend
build is not proof of complete deployment assets or canonical Node22 readiness.
See agency docs/plans/SELECTED_STAGING_CONTINUATION_LOCAL_2026-09-17.md.

## Historical remaining-work assessment

Planning-wire follow-on: unresolved selections now take the existing durable
dispatch/planning/callback path, distinct from executable work. The real legacy
family has reusable semantic markers; a bounded shared-shell adapter is approved
for local implementation. Scope/content/rights authority is still required.

Latest local producer increment: see
[source round-trip evidence](selected-source-roundtrip-2026-09-17.md). Completed
Next source now crosses the actual agency selection seam and reuses one mapped
repository through receipt. This supersedes the earlier claim that no normal
selection adapter consumes an export. Concept execution, authority registry
writers and unresolved-intent dispatch remain implementation gaps.

Routine evidence production remains implementation work, not activation-only:
see [the producer trace](selected-staging-producer-trace-2026-09-17.md) for exact
available facts, missing authoritative writers and the source-owner decision.
No complete routine producer-to-receipt success is claimed.

Matching Drupal vendor/runtime for real SQL concurrency/transaction/controller
and customer lifecycle proof. Production metadata reconciliation. Broader
revision/application recipes. Separately authorized credential binding, review
target provisioning, TLS/access and live cPanel/served-browser proof, consumer
configuration and narrow activation. No routine per-build approval was added.
An ambiguous crash inside a repository mutation requires receipt reconciliation
rather than blind duplication. Foreign access policy is preserved, not replaced.

Activation/rollback: ../capabilities/SELECTED-STAGING-CONSUMER.md and the agency
runbook. These are explicit gates, not a declaration of production readiness.

## Historical independent-review correction proof

43 affected/cross-repo tests in 11 files passed with two workers, including
real Chromium navigation/resource negatives and positives, directory/prefix
scoping, protection-dependent HTTP fixtures and independent busy-queue progress.
Lint and diff checks pass. Agency source remains unchanged at 92e0d4b.

Parent independently retested Next 1e678ad and agency 92e0d4b: 134 tests in
19 files passed in 18.42 seconds, plus Next lint/diff, 40 PHP assertions and
3 portal API tests. The dependency symlink was removed and checkout was clean.
See selected-staging-proof-2026-09-17.md for the exact command and limitations.

## Historical changed files: Next

```text
config/paths.json
docs/CHANGELOG.md
docs/SITE-LEARNINGS.md
docs/capabilities/SELECTED-STAGING-CONSUMER.md
docs/contracts/CLIENT-SELECTED-BUILD-FLOW.md
docs/env/selected-staging-handoff-2026-09-17.md
docs/env/selected-staging-proof-2026-09-17.md
docs/plans/SELECTED-CONTINUATION-2026-09-17.md
scripts/selected-staging-runtime.example.mjs
scripts/selected-staging-worker.mjs
server/kernel/cpanel-http-transport.js
server/kernel/cpanel-review.js
server/kernel/pipeline-executors.js
server/kernel/pipeline.js
server/kernel/review-backup.js
server/kernel/review-directory-url.js
server/kernel/selected-continuation-plan.js
server/kernel/selected-provenance.js
server/kernel/selected-review-qa.js
server/kernel/selected-staging-assembly.js
server/kernel/selected-static-navigation.js
server/kernel/staging-callback.js
server/kernel/staging-contract.js
server/kernel/staging-runtime.js
server/kernel/staging-store.js
server/kernel/staging-worker.js
server/modules/pipeline/index.js
tests/cpanel-directory-scope.test.js
tests/cpanel-http-fixture.mjs
tests/review-backup.test.js
tests/selected-continuation-plan.test.js
tests/selected-review-qa.test.js
tests/staging-agency-contract.test.js
tests/staging-assembly.test.js
tests/staging-ingress-worker.test.js
tests/staging-queue-progress.test.js
tests/staging-worker-fixture.mjs
tests/staging-worker.test.js
```

## Historical changed files: Agency

```text
.site-context/SITE-LEARNINGS.md
backend/web/modules/custom/famtastic_pipeline/src/Controller/CustomerPortalController.php
backend/web/modules/custom/famtastic_pipeline/src/Controller/SiteStudioCallbackController.php
backend/web/modules/custom/famtastic_pipeline/src/Service/AutomationWorker.php
backend/web/modules/custom/famtastic_pipeline/src/Service/CustomerPortalService.php
backend/web/modules/custom/famtastic_pipeline/src/Service/SelectedStagingContinuation.php
backend/web/modules/custom/famtastic_pipeline/src/Service/SiteStudioBuildPacketService.php
backend/web/modules/custom/famtastic_pipeline/src/Service/StagingReceiptService.php
docs/CAPABILITY_REGISTRY.md
docs/CHANGELOG.md
docs/SITE_LEARNINGS.md
docs/plans/SELECTED_STAGING_CONTINUATION_LOCAL_2026-09-17.md
frontend/src/api/customer.js
frontend/src/api/stagingReview.js
frontend/src/components/portal/PortalProjectsView.jsx
frontend/src/pages/CustomerPortalDashboard.jsx
scripts/reconcile-selected-staging-packet.php
scripts/test-selected-staging-contract.php
scripts/test-staging-review-browser.mjs
scripts/test-staging-review-flow.mjs
```
## Historical shared-shell follow-on

The bounded `legacy-shared-shell-v1` adapter is now implemented locally, including mapped same-repository continuation and existing-output preflight. See [local evidence](legacy-shared-shell-proof-2026-09-17.md) for 69 passing tests, source/permission contracts and remaining normal producer writers. General automatic build completion and runtime activation are not claimed.
## Historical parent review corrections

Inherited phone/email/address/testimonial marker kinds now pass unchanged; editing them is rejected. Finalized exports use lossless source-wire v2, and planning/scope hashes bind producer bytes. Evidence: `source-wire-v2-2026-09-17.md`. Remaining normal-writer connection plan: `../plans/NORMAL-SELECTED-WRITERS-2026-09-17.md`. No general automatic-build completion claim.
