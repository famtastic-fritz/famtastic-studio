# Contract: account-bound staging receipt

Version: `famtastic.site-studio.staging-receipt.v1`

Site Studio Next emits this receipt only after a real FAMtastic Inc staging
transport returns an accepted receipt. A dry run, local build, or planned
handoff cannot open customer checkout.

Required fields:

- `status`: `deployed`
- `event_id`, `packet_id`, and `idempotency_key`
- `website_request_id` (the Drupal account-owned request)
- `staging_url` (HTTPS)
- `artifact_sha256` (64-character SHA-256 digest)
- `qa`: one or more named checks, each with `status: passed`
- `completed_at`

Drupal verifies the HTTP HMAC at the callback boundary, then persists the
receipt on the matching website request. It accepts the same receipt only
idempotently; a different receipt cannot replace an existing lock. Checkout
requires `staging_status=deployed` and a valid receipt hash. Payment remains
the separate fulfillment gate; DNS, SSL, email, and production cutover stay
outside this receipt.
