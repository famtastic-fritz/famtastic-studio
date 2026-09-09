# Approved proof artifact parity — 2026-09-09

## Result

**PASS.** A real FAMtastic proof directory was packaged as an immutable
`artifact_bundle`, sent through the selected-build packet and the real Site
Studio Next pipeline, and materialized into an isolated local site.

Source fixture:

`/Users/famtastic-fritz/Development/FAMtastic/sites/site-famtastic-designs/backend/web/proofs/pc-autonomous-journey-1786410155-21-3cec1c3cc2450f31/a`

Evidence:

- 2 publishable proof files carried and landed with matching SHA-256 digests.
- The no-dispatch deploy plan contained the same 2 files and the same per-file
  digests (`manifest_hash` `6f42bd0eb982ebfe12b450780e81ab62a065869bad88f60656b76063dd60e29a`).
- Site Studio Next's browser verification passed: one page loaded, one `h1`,
  no console errors, no placeholders, and no broken links.
- Screenshot digests matched exactly at every required viewport:
  - 390px mobile
  - 768px tablet
  - 1280px desktop
- The isolated pipeline run used `origin: test` and
  `deploy_authorized: false`. No email, payment, repository, DNS, or
  production action occurred.

## What this proves

For an approved proof, FAMtastic does not ask Site Studio to reinterpret the
design from prose. It sends the complete approved artifact bundle. Site Studio
validates each path and digest, copies the bytes unchanged, then verifies the
rendered result. The deployed manifest uses the same publishable bytes;
`spec.json` is internal operational metadata and is excluded from deployment.

## Remaining production seam

The parity problem is resolved for the artifact handoff. Production still
needs the separate authenticated transport, durable receipt/idempotency store,
signed callback, and repository/staging adapters before a real paid customer
is dispatched. This proof does not authorize those side effects.
