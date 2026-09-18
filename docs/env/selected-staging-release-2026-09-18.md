# Selected handoff release work - 2026-09-18

Owner authorized implementing the official handoff repair after Kakes' manual
staging delivery. Do not replay Kakes/PIT's failed legacy packets or overwrite
their public access policy. Preserve current email-branding main in Designs.

Source saved and pushed on the repair branches only: Next implementation
`2e597d0423c37516094a72632b17bc0e122f58f9`, Designs implementation
`accf1ec2468db3f76b1603d8bf31821f0a8d3ada`. Neither main, running Studio process,
nor production agency files were changed by this repair pass. Activation is
held; do not label either source push a production release.

## Corrections discovered during activation

- The server boot did not pass stagingRuntime to HTTP modules. Source association
  stayed unconfigured even though a worker constructor existed.
- Artifact HMAC authentication was not wired by the runtime example.
- Production Drupal mounts the callback under `/web`; the unmounted callback
  used by local fixtures returns Apache 404 on the actual host.
- Dispatch URL and signing credentials are absent in live Designs. The two
  historical selected jobs failed five times; do not silently replay them.

## Private transport

The actual agency SSH host accepts reverse forwarding to remote loopback. A
temporary health-only local server was reached successfully and then stopped.
The new dedicated ingress proxy permits only the exact signed staging acceptance
POST and an honestly labeled health route. It does not expose the Studio UI,
source association, generic build, files, or other mutations. The internal
acceptance route independently verifies the original signed bytes again.

No tunnel service, production secrets or new scheduler is enabled merely by
shipping this source. Explicit installation configuration remains required.

## Real cPanel smoke

`node scripts/prove-selected-hosting.mjs --apply` passed on September 18. It
creates only the isolated `selected-handoff-smoke-20260918` target and refuses
existing target/auth files. Synthetic input was built once, locally browser-QA'd,
then uploaded through the real protected transport. Anonymous and alias access
denial, noindex, rollback backup and HTTPS byte hashes passed.

Target: `https://famtasticinc.com/selected-handoff-smoke-20260918/`.
Manifest: `861e128effa4eae2c2ac5d7eb3faacaa7a097d31d291823ab4730405b81279b3`.
Source commit: `0e257c897737dd88a45f14689416756b65063767` (synthetic local source).
Private receipt: `/var/folders/4z/76l8zpns7hvdlykrk2fkf8wr0000gn/T/selected-worker-YKLOsy/hosted-proof.json`.

Callback was local capture only, not production acceptance. No real customer,
SMTP, DNS, payment, or final launch. Retain the protected target and private
recovery evidence until the operator deliberately retires this smoke.

## Still separate from this proof

The final combined suite passed **1,090 tests across 104 files**, with all four
cross-repository overrides and SELECTED_PORTAL_FRONTEND supplied; no skips.
Duration: 73.12 seconds. Real staging-review browser verification
passed separately at 320/390/768/1280. Lint and diff checks passed. Private config,
boot, polling, external claim contention, shutdown and mounted callbacks are
included in that suite. A matching installed Drupal 11.4.5 / PHP 8.5.9 SQLite
runtime passed 54 checks including rollback, idempotency and revision acceptance.
This is not production MySQL concurrency or a hosted end-to-end customer run.

Source push/release, private credential/tunnel configuration and scheduled
execution each need their own receipt. Arbitrary page editing, general
application generation and automatic review target allocation are not
implemented by the bounded static consumer. Both producer and consumer need a
legitimate matching per-project protected-review binding. Do not enable with a
dummy customer mapping or overwrite Kakes/PIT's public targets to satisfy that
requirement. Planning-only activation is not implemented either.

Agency PHPUnit also passed 217 tests / 1,142 assertions. The canonical customer
journey runner did **not** pass: after catalog and SEO checks it expected the
retired prospect-checkout behavior and received `account_checkout_required`.
No account/payment gate was bypassed. Broader journey certification, production
deployment and activation are held. These repair branches can be retained for
review without changing main or the currently running services.
