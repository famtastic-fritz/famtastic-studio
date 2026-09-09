# Selected-build handoff smoke record — 2026-09-09

## What was researched first

This run was designed from the local primary contracts, not from an imagined
HTTP integration:

- `docs/decisions/ADR-0007-platform-boundary-and-selected-build-packet.md`
  defines the boundary: FAMtastic owns intake, research, creative direction,
  proofs, and selection; Site Studio owns build, verification, deploy, and
  journal.
- `server/kernel/selected-build-packet.js` is the existing fail-closed packet
  validator. It requires identity, selected direction, spec, brand, asset
  references, research provenance, origin, and explicit boundary permissions.
- `server/kernel/pipeline.js` is the real hermetic Site Studio Next build
  pipeline. It records DNA and runs a browser verification stage.
- The customer-journey acceptance contract requires a synthetic run to remain
  isolated and to distinguish local proof from payment/provider/production
  proof.

The adapter was implemented only after those contracts were read. It does not
read FAMtastic tables, call an external endpoint, send mail, charge Stripe,
touch DNS, deploy, or mutate a customer site.

## What was added

- `server/kernel/selected-build-adapter.js`
  - requires a paid-order snapshot, an approved current proof selection,
    matching customer identity, and research provenance;
  - refuses unpaid, stale-proof, identity-drift, missing-approval, or missing
    commerce evidence;
  - emits `selected_build_packet.v1` through the existing validator;
  - projects the packet into the real Next pipeline brief shape;
  - provides an explicit in-memory duplicate/conflict receipt guard for the
    synthetic run. Production still needs a durable receipt before dispatch.
- `tests/selected-build-adapter.test.js`
  - exercises unpaid, stale, and identity failures;
  - proves duplicate idempotency;
  - runs the actual Site Studio Next pipeline against a temporary data root,
    with deploy authorization false.

## Evaluation result

Command:

```text
npx vitest run tests/selected-build-adapter.test.js tests/selected-build-packet.test.js
```

Result on 2026-09-09:

```text
Test Files  2 passed (2)
Tests       17 passed (17)
```

The end-to-end case produced a real local site and passed the browser verify
stage. The packet carried `origin: test` and
`boundary.deploy_authorized: false`; the duplicate returned the original
receipt. This is **locally proven**, not test-provider or production proof.

The repository lint gate also passed:

```text
npm run lint
lint-no-monolith: OK
lint-no-ambient-site: OK
```

## Still intentionally unproven

The next seam is not silently declared complete. A production adapter still
needs a durable receipt store, an authenticated transport to Site Studio Next,
the callback/failure contract, and a real paid-order event from the canonical
FAMtastic record. A real customer must not be dispatched until those checks
and the owner approval boundary are exercised. No Shay record was read or
changed by this smoke run.
