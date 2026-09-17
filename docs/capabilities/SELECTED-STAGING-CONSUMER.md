# Selected staging capability and activation boundary

## Local implementation

Fresh kernels; legacy behavior was reference evidence only. Durable jobs retain
the exact accepted packet and hash, use SQLite FULL synchronous transactions,
reject changed idempotency reuse and wrong account/project/request/revision,
and serialize workers by project. A live PID claim never expires during work.
Dead claims can be recovered; interrupted non-idempotent build writes become
an explicit reconciliation exception. Callbacks use stable event IDs/raw bytes.
No queue code sends mail, creates orders, accepts a site, changes DNS or launches.

`createStagingRuntime` accepts explicit local capabilities. A reviewed local
module exports `createRuntime()` and the worker runner invokes `wake()`.
`node scripts/selected-staging-worker.mjs /absolute/runtime.mjs --once` processes
eligible jobs once; omitting `--once` polls every five seconds. Stop with SIGTERM
and allow the current operation to checkpoint. Do not point this at live jobs
until every activation gate below is independently reviewed and authorized.

Source transfer records inherited provenance instead of generating research,
copy, imagery or layout. Existing byte-identical files are not rewritten. The
real local pipeline preserves the foundation and records DNA. Static QA checks
390/768/1280 widths, structural accessibility, declared rights and exact
baseline/output screenshot hashes. It is not a complete WCAG or application
behavior audit. Unknown forms, dependencies and incomplete pages fail closed.

## cPanel provider boundary

`createCpanelReview` binds site/customer/HTTPS host/scoped root/access policy once,
checks packet target equality, backs up before writes, keeps access controls
installed, verifies public bytes and HTTPS probes, and restores on failure.
`createCpanelFileApi` serializes API2 mkdir and UAPI upload_files. Authenticated
request, remote reads/CAS, protection, alias checks, backup/restore and probes are
injected capabilities. Tests implement those with a local contract harness.
`cpanel-http-transport.js` now implements authenticated HTTP serialization,
DomainInfo target verification, private remote operation claims, scoped listing,
binary reads through authenticated HTTPS, protection, upload, mkdir and scoped
trash rollback. `selected-staging-assembly.js` wires that transport to the real
pipeline, static QA, bounded artifact fetch, callback and durable worker.
`scripts/selected-staging-runtime.example.mjs` exports an actual `createRuntime`
using reviewed private JSON and explicit credential environment bindings. No
credentials were acquired or network requests sent in tests; injected HTTP
responses execute this real assembly. The template import path must be updated
if copied outside this source tree. Production hosting remains unverified.
The API2 scoped trash operation follows the official Fileman fileop contract:
https://api.docs.cpanel.net/cpanel-api-2/cpanel-api-2-modules-fileman/cpanel-api-2-functions-fileman-fileop
Uploads use UAPI multipart Fileman.upload_files, as in the customer recipe.


The provider must preserve an exact private backup and CAS every file against
expected old/new bytes, including timed-out uploads. Restore must compare the
restored manifest and retain protection. Detect extra stale public files from
older releases in preflight; fail closed or quarantine only receipted files.
Do not remove unrelated files. No API call grants DNS/TLS or final-launch truth.

## Narrow activation checklist (not authorized in this task)

1. Review both tested commits and run the cross-repository PHP/Node contract
   proof against those exact checkouts. Install matching Drupal vendor/runtime
   elsewhere and prove real row locks, transaction rollback, outbox dedup,
   revision invalidation and authenticated customer acceptance. Current PHP
   adapters prove service logic only, not Drupal/SQL integration.
2. Confirm sufficient disk and private persistent staging root; back up its DB
   while worker is stopped. Configure customer repositories outside platform
   Git roots. Never adopt a dirty, foreign or nested checkout.
3. Supply actual source scope, design contract, rights, retrieval mapping and
   completed-stage provenance from authoritative agency records. An old digest
   alone is insufficient. Audit selected revision intent; do not convert a
   requested edit into packaging of unchanged old content.
4. Review the implemented cPanel HTTP capability module against this harness.
   Inspect exact vhost/root, Inc/MBSH shared routing, DNS and trusted TLS.
   Validate protected review/alias denial BEFORE upload. Use existing vault
   credential IDs without printing them. No SFTP prerequisite is implied.
5. Bind only the approved review target and fixed callback endpoint, configure
   the separate dispatch/callback secrets outside source, and reject redirects.
   Confirm artifact origin allowlist, streamed size limits and authenticated
   retrieval. No secrets in packets or job history.
6. With separate authorization, start one consumer against an isolated hosted
   synthetic job, verify source/manifest/browser/access/receipt and agency
   outbox state. Do not drain the live backlog. No customer email is implied.
7. Only after that proof, authorize specific production config/process changes
   and queue scope. Existing PHP cron repair remains a separate task.

## Rollback and resumption

Stop dispatch for this lane and stop the worker gracefully. Preserve DB, job
payloads, claims, DNA and receipts. Revert the reviewed source/config changes
without deleting customer repositories. Keep the last protected review served;
if an upload is uncertain, restore only its verified operation backup using
CAS, then verify HTTPS hashes and alias denial. Do not restore a job DB across
already-accepted callback events; reconcile event IDs with Designs first.
Never clear a live claim or replay an uncertain build blindly. Inspect the
foundation lock, dirty snapshot, Git HEAD, DNA and selected input hashes, then
write an explicit reconciliation action. Existing review acceptance may not be
carried to a new artifact. Rollback cannot refund, charge, email or launch.

`review-backup.js` implements private checksummed snapshots, stale-file inventory
refusal and exact restore, including rejection of third-party changed bytes.
The live provider still needs an exclusive remote target claim: cPanel read
followed by upload is not an atomic compare-and-swap against outside operators.
Tests prove local algorithm behavior and injected provider calls, not such a
remote lock. Baseline/output digests are retained separately; this lane performs
no content transformation. Any future URL rewriting/transformation must record
its input/output hashes and explicit versioned transform before readiness.

## Supported missing-work recipe

`continue_build` requires `selected-html-slots-v1`, with named
`fill_selected_template` steps. Each step binds an existing selected source
template digest, current design-contract digest, explicit authored text slots,
rights receipt and requested-change IDs. It may add only missing HTML paths;
completed selected paths are rejected as targets. Slot substitution is HTML
escaped and prohibited in tags/scripts/style. Original template bytes and
input/output hashes are retained in transformation evidence and DNA. No
research, concept/copy generation or layout redesign occurs. Missing pages
without this recipe remain unsupported. This is a narrow static continuation
capability, not a general application or natural-language revision engine.

Existing .htaccess must exactly match this runtime's selected review policy.
A foreign or authored policy is preserved and raises review_access_policy_changed
before content upload. Migrating such a policy is a separate reviewed operation,
not an incidental consequence of selecting or revising a site.
