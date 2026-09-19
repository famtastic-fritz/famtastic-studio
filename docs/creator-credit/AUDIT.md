# Site Studio Next creator-credit audit, 2026-09-18

Base: freshly fetched origin/main 52096d2243dda76cda3740b9f4c40623994d8f23. Isolated branch codex/creator-credit-next. Component source pin 5371b242a314cb4c689d39bf0e975bf8373b2b0d; Media pin de7d78d1fad6100c5297d0c4676b94efcf09ff01. Vendored foundation 1.1.1 is byte-identical for all ten implementation/asset files listed in vendor/site-foundation/PROVENANCE.md. Identity schema remains 1.0.0.

## Implemented scope

- Static deterministic and model composition: finalize once before DNA hashing, preserve footer text, append missing row and transfer exact PNG into the public allowlist. Generated 404 is covered.
- Drupal/WordPress and decoupled React template sources: actual Twig/PHP footer and both React application templates gain credit plus exact assets. Syntax checked; installed CMS runtime and production are not claimed.
- Approved artifact transfer: already compliant semantic rows pass byte-identically, regardless of marker, attribute order or asset path. Missing-credit old selections derive a new output by appending only credit, with an internal .famtastic/creator-credit-transform.json receipt recording original/derived file digests, version/authorization and unchanged acceptance/payment/auth/customer state. No page regeneration, extra approval, provider call or second build. The original bundle/approval hash is preserved; no automatic customer acceptance or publication is asserted.
- Build/export validation: exact referenced PNG bytes, accessible destination and final-row structure checked before copying or replacing a previous artifact. A mounted bundle can explicitly set artifact_bundle.public_base_path; build/deploy public-file manifests accept public_base_path. No guessed mount, no new scripts/cookies. Attribution defaults to absent; only the safe public slug triplet is accepted when supplied.
- Invalid existing rows, conflicting assets or absent referenced assets remain explicit repair failures. This is not a promise that every legacy packet works. An actual old Kakes packet was not available in this writer scope; the same older-selected-bundle seam is proved with a synthetic full pipeline test, not claimed as a Kakes production migration.

## Proof

- Full Next suite passed 81 files / 941 tests before the final compatibility/derivative review refinements.
- Final affected suites: 8 files / 54 tests passed with --testTimeout=30000 --maxWorkers=1. Includes old uncredited selected packet through the real local pipeline, unchanged original bundle, persisted transform receipt, unchanged customer/financial state flags, already credited byte parity, CMS source, build ownership, deployment boundary and identity guards.
- npm run lint and git diff --check passed. The later full-suite confirmation was interrupted by local ENOSPC, not reported as a pass; final validation used the targeted suites after cleanup.
- scripts/prove-creator-credit.mjs passed Chromium 390/768/1280: exactly one PNG, natural width 2172, exact HTTP SHA-256 ebb0477344132d32e449ba19e2b622921585aa71af0decdbcf8abfbe033fa950, widths 160/220/220, target heights 69.33/89.33/89.33, centered final row, accessible keyboard link, footer preserved and no horizontal overflow. All generated React JSX parsed via esbuild. Local in-memory server only; no production claim.
- Cross-lane read-only compatibility: actual MBSH frontend/index.html v1, Pros In Training site/index.html customer marker and The Reckoning public/readers/index.html under /lab/the-reckoning/ pass the shared semantic/hash validator. Agency component source inspected. No other lane files changed. External CSS geometry and fixed-overlay clearance require browser proof; structural validation alone never establishes rendered compliance.

## Exact affected paths

- AGENTS.md
- CHANGELOG.md
- CONVERSATIONS.md
- README.md
- SITE-LEARNINGS.md
- config/repositories/catalog.v1.json
- design.md
- docs/creator-credit/AUDIT.md
- docs/creator-credit/BRIEF.md
- docs/creator-credit/POLICY.md
- scripts/prove-creator-credit.mjs
- server/kernel/compose-claude.js
- server/kernel/compose-repository-tools.js
- server/kernel/compose.js
- server/kernel/creator-credit-cms.js
- server/kernel/creator-credit-transform.js
- server/kernel/creator-credit.js
- server/kernel/deploy-helpers.js
- server/kernel/git-delivery.js
- tests/creator-credit.test.js
- tests/deploy-source-boundary.test.js
- tests/fulfillment-readiness.test.js
- tests/generated-static-output-ownership.test.js
- tests/helpers/credited-fixture.js
- tests/kernel-compose.test.js
- tests/kernel-deploy-publish.test.js
- tests/kernel-deploy.test.js
- tests/prove.test.js
- tests/selected-build-adapter.test.js
- vendor/site-foundation/CREATOR-CREDIT.md
- vendor/site-foundation/PROVENANCE.md
- vendor/site-foundation/creator-credit.js
- vendor/site-foundation/credit-html.js
- vendor/site-foundation/famtastic-designs-logo-v1.png
- vendor/site-foundation/index.js
- vendor/site-foundation/package.json
- vendor/site-foundation/scaffold.js

## Adoption and exclusions

Parent authorized main integration after first MBSH deployed 0653d920d20fe82aa429be7901adcd8544b7be65. Parent later reports website 52 docs at ce93342 and email adapters source 76b578c; those reports are not independent verification here. No historical emails resent. Agency/customer live deployments are outside this lane. No remote host writes, newly launched customers, auth/finance/customer records, immutable historical evidence or memory changes.

Primary Next checkout was clean at fbca6d1ab42bc9dde48e368773c9b58e7d3461ab on codex/repository-standards and is eligible for a documented fast-forward after integration. Source adoption does not prove a running service has reloaded; runtime restart/queue adoption remains separately unverified. Component primary is clean but divergent on codex/phone-first-site-desk-contract at d802c05d20ab98b18960265f9eb0c281d668640e: preserve and reconcile separately. Ecosystem primary is dirty and must remain untouched. Media primary can safely fast-forward.

Local storage: removed only the 43,304 KiB (about 42.3 MiB) node_modules install created in this worktree this run, then reused the already-existing canonical dependencies via a disposable symlink for final tests. The Vite temporary cache had self-cleaned. No assets or worktrees removed. Do not attribute unrelated filesystem free-space changes to this cleanup.

Final regression addendum: creator-credit and full fulfillment-readiness suites passed 2 files / 10 tests, including conflicting PNG refusal, missing referenced logo refusal, preservation of originals and the old selected-packet derivative. Universal policy now requires cache-independent critical geometry and cache-busting any dependent shared CSS. Disposable dependency symlink removed after testing.
