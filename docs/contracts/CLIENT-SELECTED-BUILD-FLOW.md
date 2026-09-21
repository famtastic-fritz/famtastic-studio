# Client-selected build continuation

Owner direction, 2026-09-17: a client choosing a direction starts the full site
build. Fritz is not a required reviewer for every routine build or revision.
Payment waits until the client is fully satisfied with, and explicitly accepts,
the exact working site. Hosted review is not a production launch.

## Required flow

1. Consume the account/request/project-bound selected packet and its design DNA.
2. Claim one idempotent build job for the selection revision. Duplicate callbacks
   must not create another repo, build, email, offer or charge.
3. Build in the independent customer repository. Preserve the selected visual
   system and authored pages; complete agreed scope, not only a copied mockup.
4. Run functional, responsive, accessibility, asset-rights and independent visual
   QA. Failed checks enter a bounded repair loop, then an actionable exception.
5. Host an access-controlled review on FAMtastic Inc and verify actual HTTPS
   bytes, anonymous denial and authenticated desktop/mobile behavior.
6. Return the signed packet-bound staging receipt to Designs. Studio does not
   impersonate a customer, mark acceptance, send mail or own financial records.
7. Client changes produce versioned builds in the same selected direction, unless
   the client explicitly changes it. A new artifact invalidates old acceptance.
8. Only explicit customer acceptance of the current exact artifact can make
   checkout eligible. Charge still needs customer checkout/terms consent and
   authoritative payment evidence. Silence, direction selection and QA are not
   acceptance. Final launch remains a separate authorized release.

Escalate scope, cost/provider policy, rights, legal claims, unsafe integrations,
security failures or repeated failed QA. Routine green builds do not wait on
Fritz. Do not create a new owner approval task for every selected-site build.

## Existing FAMtastic Inc hosting route

Before declaring hosting access missing, inspect the ecosystem's
`platform/capabilities/deploy/deploy-backend.sh`, its vault helper and the live
cPanel domain/document-root record. The existing Keychain service is
`famtastic-platform`; the credential ID is `studio.cpanel.api_token`. Credentials
never enter packets, source, logs or browser code.

Verified 2026-09-17: cPanel `nineoo` at `https://famtasticinc.com:2083` supports
API2 Fileman.mkdir and UAPI Fileman.upload_files with TLS validation enabled.
The Inc homepage uses selective host-aware routing under a root shared with
MBSH. Inspect current rules before resolving a path; do not assume every route
maps to `public_html/famtasticinc-landing`, or modify shared root routing.
An approved `/client-slug/` path can avoid DNS changes. Install access controls
before HTML/assets, keep auth hashes outside public_html, upload only the
allowlisted artifact and preserve a rollback copy. Noindex or missing DNS is
not access control. Verify that other hostnames cannot expose the artifact.

## Evidence versus implementation

Pros In Training's independent repository contains `scripts/deploy-review.mjs`,
the scoped initial-deploy implementation. Source `f552643613135afe74fa2b6a93e919e3a36770ef`
was deployed through this API route and authenticated bytes were verified.
This establishes one controlled static review, not a general-purpose deployed
Studio transport or an autonomous queue consumer.

`server/kernel/famtasticinc-adapter.js` still defaults to dry-run and requires
injected transport plus SFTP-shaped credential preflight. Do not label that
runner operational from the manual cPanel receipt. Integrating the cPanel
transport, revision-safe receipt lifecycle and real selection-to-build dispatch
requires executable negative/idempotency tests and a hosted end-to-end receipt.

## Local continuation implementation, 2026-09-17

See `docs/plans/SELECTED-CONTINUATION-2026-09-17.md` for the initiation matrix.
Selected transfer is an explicit operation, not fresh research. The additive
`continuation` contract carries account/request/project identity, monotonic
selection revision, correlation/origin, requested next action, full design
contract, complete static scope, rights-bound artifact retrieval mapping and
immutable review target. Existing v1 packets are durably retained but cannot
execute without this evidence. Missing scope is an exception, never permission
to guess. The accompanying agency branch adds producer and receipt support.

SQLite retention and project claims replace event-only acceptance. The runtime
consumer is separately installed through explicit capability injection; merely
setting the existing dispatch URL still does not activate a consumer. Local
source now supports provenance import, deterministic selected-byte packaging,
static browser QA, mock cPanel provider serialization, and signed success/failure
callbacks. Generated documents and source repositories remain independent.

An interruption during an uncertain repository mutation fails closed to a
reconciliation exception rather than duplicating work. Completed packaging,
QA and hosting checkpoints survive restart; callback retries preserve exact
bytes. Unsupported application scope or natural-language revision work without
an executable revision recipe cannot signal ready. The existence of this local
implementation does not establish hosted transport or Drupal runtime proof.
