# Selected source exporter and normal selection round trip

Local source/test proof only. Legacy remained read-only. No credentials,
providers, remote allocations, production jobs, email, deployment or service
changes occurred. Existing dependencies were linked temporarily; none installed.

## Implemented

Next's real pipeline exports source after repository finalization. Its verify
stage captures the actual on-disk manifest, including deliberately preserved
scaffold files. Export checks the live repository path, site manifest, HEAD,
branch, clean worktree and verified bytes. Pipeline success alone exports
`scope_complete:false`. The actual worker's selected-browser QA then supplies
site/run/manifest-bound evidence; only explicit required pages, supported static
features, no pending revisions and passing QA yield a complete source export.

An initial broad sweep exposed nine regressions when the exporter compared
composer suggestions against intentionally preserved scaffold bytes. Capturing
the verified on-disk manifest fixed that without weakening stale-byte checks.
Tests reject a dirty post-QA file, stale commit, a newly committed changed file
with old verification, cross-site/run/manifest QA, wrong scope identity, missing
pages, unsupported features, pending revisions and failed QA.

Designs' signed callback accepts `famtastic.site-studio.source-finalized.v1`
only for an existing account/request/project and an already recorded exact
source mapping. The service transaction locks the existing request, validates
the export hash/mapping, retains history and makes repeats idempotent. It does
not create a customer/project or approve rights, scope or a hosting target.

The real `CustomerPortalService::createSelectedProofStaging` seam consumes that
registered export plus separate agency authority. It derives the continuation
envelope from actual source files/spec/design/provenance, checks requested page
count and feature limitations, and requires bound file delivery/rights/scope
and review-host records. No selected_build_continuation blob is hand-seeded in
the positive test. Original proof DNA is retained; completion resolution is
stored separately from the immutable intent.

The authority scope mapping binds the exact requested-scope snapshot hash as
well as the exported scope reference. A changed page request with the same page
count cannot silently reuse a stale scope mapping. This is a recorded authority
binding, not automatic interpretation of freeform page names.

Intent revisions and history advance even before an executable packet exists.
Identical retries reuse the same intent. Executable packet revisions may bridge
blocked intent revisions only when the matching authoritative intent is stored;
unrecorded jumps still fail.

Studio-origin packages use an explicit installed `sourceMappings` resolver.
It verifies the local export, live source repository/commit/branch/remote and
every packet byte before reusing that source. It never substitutes project-ID
repository creation for an absent mapping. QA and hosting use the resolved site
identity; existing host protection is unchanged.

## Positive test and precise boundary

`tests/source-export-roundtrip.test.js` starts with actual pipeline and browser
output. The worker emits a complete export after QA. The PHP harness registers
that export through the real source registry, invokes the actual portal
selection method, and returns its actual serializer packet. The Next worker
then reuses the original repository with a separate agency project mapping,
verifies exact source bytes, performs synthetic protected hosting, and passes
the callback to the actual PHP receipt service. Retry performs no second build.
One source repository and its original commit remain; no second project-named
directory appears. Receipt queues one synthetic notification record and leaves
checkout false. No notification was sent.

The tenant, scope/rights/delivery/hosting authority and HTTP transport are
synthetic test adapters. The completed source export is actual producer output.
This distinction matters: the test does not prove that a live authority registry
or Drupal SQL runtime is provisioned. The HMAC controller branch is implemented;
the new source-registration service is exercised directly, not through live HTTP.

## Validation

Using SELECTED_SOURCE_INTENT_HARNESS pointing to agency
scripts/test-selected-source-intent.php and SELECTED_STAGING_AGENCY_HARNESS
pointing to scripts/test-selected-staging-contract.php, a two-worker sweep passed
84 tests in 18 files in 21.62 seconds. It covered exporter/roundtrip, all staging
suites, QA, cPanel scope, backup, pipeline/batch/imagery, repository creation,
source deployment boundaries and P0-I1. Agency standalone seam passed three
cases; the existing contract harness now passed 42 assertions. PHP lint passed.

Final targeted source/export/runtime recheck passed six tests in three files
in 4.47 seconds after branch-binding hardening; Next lint and diff checks passed.
The added stale-request-scope binding negative and positive round trip then
passed in the one-test focused rerun (2.36 seconds).

## Remaining implementation versus activation

Follow-on correction: unresolved-intent dispatch is now wired through the same
agency ledger/client and Next durable worker; revision-bound planning results
return through the existing callback without staging readiness. The earlier
statement below is historical. Also, the real legacy template family does have
data-template/section/field markers; the bounded adapter proposal is recorded in
../plans/LEGACY-SHARED-SHELL-ADAPTER-2026-09-17.md. Available structure does not
establish a customer's content or transformation authority.

- Ordinary concept output lacks an executable selected-preserving recipe.
  Intent and remaining-work planning are implemented, but automatic dispatch of
  unresolved intents into a durable Next planning queue is not wired. The
  supported complete-source lane is executable; the overall auto-build goal is
  not complete.
- The existing slot executor consumes explicit marked templates and authored
  content. The actual legacy source contract contains neither those markers nor
  a recorded slot mapping. Per the conditional authorization, no arbitrary HTML
  extractor or speculative assembler was added. A real selected-shell/component
  contract and bounded executor are remaining implementation.
- Agency source/scope/rights/delivery/review-target authority registry writers
  and automatic propagation into installed sourceMappings remain implementation.
  They are not a request to hand-author continuation metadata per selection.
  The new adapters consume separately recorded authority without inventing it.
- Worker-authenticated artifact routing and production-bound source export
  delivery still require integration proof. Full Drupal transaction/controller
  and actual customer lifecycle proof remain open.
- Credentials, real server target allocation, trusted TLS/access policy, live
  cPanel validation and process activation remain separately authorized gates.
  No new per-build owner approval requirement was added.
