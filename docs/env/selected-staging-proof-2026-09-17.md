# Local selected staging proof

Next base: fbca6d1ab42bc9dde48e368773c9b58e7d3461ab.
Worktree: /Users/famtastic-fritz/Development/worktrees/studio-selected-staging.
Branch: codex/selected-staging-continuation.
Agency base: 411252cc, companion codex/selected-staging-contract worktree.
Node: v24.19.0. Existing pinned dependencies were reused through a temporary
node_modules symlink, removed after verification. No dependencies installed.

## Commands and results

`npm run lint`: passed. `git diff --check`: passed.

```sh
SELECTED_STAGING_AGENCY_HARNESS=/Users/famtastic-fritz/Development/worktrees/fd-selected-staging-contract/scripts/test-selected-staging-contract.php \
npm test -- --maxWorkers=2 \
  tests/staging-agency-contract.test.js tests/staging-assembly.test.js \
  tests/selected-continuation-plan.test.js tests/staging-ingress-worker.test.js \
  tests/staging-worker.test.js tests/review-backup.test.js \
  tests/staging-acceptance.test.js tests/selected-build-adapter.test.js \
  tests/selected-build-packet.test.js tests/famtasticinc-adapter.test.js \
  tests/kernel-deploy.test.js tests/kernel-deploy-publish.test.js \
  tests/invariant-p0-i1.test.js tests/fulfillment-readiness.test.js \
  tests/kernel-pipeline.test.js tests/repository-creation-guard.test.js
```

124 tests, 16 files passed in 14.06 seconds. An earlier unrestricted parallel
run passed 122/123 but hit the existing 5-second repository-creation browser test
timeout; the bounded run above passed it without changing the test timeout.

## What was executed

- Signed HTTP acceptance wakes a durable worker; actual local pipeline,
  independent foundation repository, browser QA, mock host and signed callback.
- Actual PHP producer serializer emits the tested packet; actual PHP staging
  receipt service accepts its completion using synthetic entity/DB adapters.
  One synthetic notification record, checkout false. No SMTP transport exists
  in this harness. Controller HMAC is separate from this service-level proof.
- Real cPanel HTTP assembly executes multipart upload, DomainInfo, protected
  access, operation claim, private backup, binary HTTPS checks, scoped trash
  rollback and callback against injected HTTP responses. No live request.
- Real browser checks at 390/768/1280 and baseline/output screenshot digests.
  Existing selected artifacts cause zero research/copy/imagery/provider calls.
- Explicit missing-page recipe fills selected-template text slots, preserves
  prior HTML, retains input template and transformation digests. No recipe,
  overwritten selected target or tampered template evidence is refused.
- Duplicate/restart, concurrent claim, changed packet, stale revision, cross
  account, unsupported scope, QA failure, callback retry, partial upload, HTTPS
  verification failure, backup restore and foreign-byte refusal.
- Existing pipeline/repository/deploy/invariant regression suites.

## Remaining proof and implementation limits

General natural-language revisions and application completion remain open.
Only complete-static packaging and explicit selected-html-slots-v1 missing-page
continuation are implemented; other selected intents remain durable exceptions.
No provider work was performed, and no full application is claimed from HTML.

Full Drupal SQL concurrency, transaction rollback behavior, installed-runtime
controller integration and customer end-to-end lifecycle need a matching Drupal
vendor runtime. It was not installed here. Review the companion agency evidence
for frontend exact-receipt acceptance and legacy reconciliation checks.

No live cPanel, credential, target routing, trusted TLS, remote alias protection,
remote-operation conflict or served-browser proof occurred. Those are activation
gates, not successful tests. Source for the HTTP assembly is implemented; only
its injected contract is proven. Staging credentials/config/process setup and
all production writes remain unauthorized. Running-service checkout stayed clean
on codex/repository-standards at fbca6d1. No push, merge, cron or reload occurred.

Post-sweep targeted hardening: `npm test -- --maxWorkers=2
 tests/staging-assembly.test.js` passed 3 tests (3.37 seconds). The added case
proves an existing foreign .htaccess is preserved and no public artifact or
ready callback occurs. This makes 125 distinct covered tests across the sweep
and follow-up; the 124-test combined sweep was not relabeled as a 125-test run.

## Independent-review corrections

Code commit: 118201eeb06e5cc39954c67238fd5b773e76e013.
The earlier QA claim was too broad: loading and screenshot parity did not detect
missing navigation targets or stylesheets. Verifier selected-static-browser-v2
now intercepts all resource requests, serves only artifact-manifest bytes,
checks declared resources, resolves internal links and verifies fragments in
real Chromium. Evidence names broken hrefs, target paths, resources and reasons.
Valid root/nested navigation, CSS imports and anchors pass without network.

Both cPanel entry points now share directory-URL validation. A subfolder without
its final slash is refused before credential lookup or HTTP. File/access/alias
probes remain under the exact configured prefix; traversal probes are refused.
The HTTP fixture now maps that prefix to the scoped remote root and derives
anonymous denial, alias denial and noindex from its actual simulated .htaccess.
Before protection is installed, it does not report those checks as passed.

Worker tick reports a specifically busy claim and continues to other projects.
The regression keeps the first live claim and its untouched job while a second
project completes. Other claim errors and non-claim project_busy errors still
propagate. A test teardown double-close was corrected before the final run.

```sh
SELECTED_STAGING_AGENCY_HARNESS=/Users/famtastic-fritz/Development/worktrees/fd-selected-staging-contract/scripts/test-selected-staging-contract.php \
npm test -- --maxWorkers=2 \
  tests/selected-review-qa.test.js tests/cpanel-directory-scope.test.js \
  tests/staging-queue-progress.test.js tests/staging-agency-contract.test.js \
  tests/staging-assembly.test.js tests/selected-continuation-plan.test.js \
  tests/staging-ingress-worker.test.js tests/staging-worker.test.js \
  tests/review-backup.test.js tests/staging-acceptance.test.js \
  tests/invariant-p0-i1.test.js
```

43 tests in 11 files passed in 10.45 seconds. Lint and diff checks passed.
Agency commit remains 92e0d4b68d15fd69b3afd803bb7adb6040b3ceeb; its actual
serializer/receipt boundary was rerun in this suite. These tests supersede the
previous insufficient static-navigation evidence; they do not establish live
hosting, general application continuation or full Drupal runtime proof.

## Parent independent retest

Later parent review of Next 2d43117 / agency de7f6ddf passed 147 tests in
24 files in 25.66 seconds, 42 PHP assertions, three actual-selection-seam cases
and three portal API tests. Lint/diff passed and its dependency symlink was
removed. The mixed-case cross-language manifest defect found afterward is fixed
by matching PHP ASCII comparison; real PHP reorder/tamper fixtures were added.

The parent independently tested Next 1e678ad and agency 92e0d4b: the combined
bounded sweep passed 134 tests in 19 files in 18.42 seconds. Next lint and diff
checks passed; the actual PHP harness passed 40 assertions and portal API tests
passed 3 cases. The temporary Next dependency symlink was removed and its
checkout was clean. This resolves the three reproduced correctness defects.

The parent also identified a remaining production evidence-producer gap:
fresh selections cannot yet obtain selected_build_continuation through the
normal finalization path. This is remaining implementation, not a credential
or activation gate; hand-seeded evidence does not prove the routine flow.
