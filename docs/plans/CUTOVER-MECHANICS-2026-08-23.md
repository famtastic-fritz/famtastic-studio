# Cutover mechanics and rollback runbook

**Status:** Ready for the decision. Execution is a hard stop for Fritz.
**Scope:** per CUTOVER-AMENDMENT-2026-08-23, this covers the **production build
path only**. Proof generation is not cutting over.

---

## 0. Preconditions, all verifiable before anything changes

Run and confirm green:

```bash
cd ~/Development/FAMtastic/site-studio-next && npm run gates
```

Expect: lint OK, tests pass, smoke 11/11, G4-0 PASS, G4-1 PASS, exit 0.

Confirm the boundary holds:

```bash
node -e "import('./server/kernel/research-center.js').then(m=>console.log(m.describe()))"
```

Confirm production is untouched by the shadow work: G4-1's zero-write audit is
part of `npm run gates` and reports SKIPPED-WITH-REASON where it could not check,
which is not the same as a pass. Read that list before proceeding.

## 1. What actually changes

Three things, in this order. Each is independently reversible.

| # | Change | Reversal |
|---|---|---|
| 1 | Studio becomes system of record for builds | stop routing builds to it; the legacy path is untouched and still works |
| 2 | The proof webhook is served by the research-grounded path instead of the stamp logic | flip the handler back; the webhook contract to callers never changed |
| 3 | Deploys target FAMtasticInc under a path, DNS points at the created folder on go-live | `deploy.rollback()`, then repoint DNS |

**Nothing is deleted at cutover.** The stamp logic stays on disk, the legacy
path stays runnable, and no proof record is rewritten. That is what makes every
row above reversible.

## 2. Sequence

1. **Freeze.** No merges to `main` during the window.
2. **Tag the pre-cutover commit.** `git tag pre-cutover-<date> && git push --tags`.
   This is the single most important step; it is what step 5 restores to.
3. **Gates green** on the exact commit being cut over. Not a similar one.
4. **Cut change 1** (builds to Studio). Observe one real build end to end.
5. **Cut change 2** (webhook handler). Observe one real proof request end to end,
   and confirm the response shape to the caller is byte-identical to before.
6. **Cut change 3** (deploy target) for **one** site first, not all of them.
   Verify, then proceed.
7. **Watch.** Defined below.

## 3. What to watch, and for how long

For 48 hours after each change:

- `execution_status` distribution across new packets. A sudden collapse to
  `no_findings` means the research CLI is failing; the retry now catches a single
  empty packet, but a systematic failure will show here first.
- The `origin` split on `/api/sites`. Real customer sites must land as `legit`,
  never `unknown`. An `unknown` climbing means specs are not declaring origin.
- Media slot counts. Declared but zero filled is expected today. Declared zero
  everywhere means the bridge broke.
- Deploy receipts: every deploy has a manifest hash and an active-release pointer.
- The journal: every stage writes an entry, or the DNA is incomplete.

## 4. Rollback runbook

### 4a. Roll back a deploy

`deploy.rollback()` exists and is the supported path. It restores the prior
receipt's bytes, **re-verifies against bytes read back from disk rather than the
in-memory manifest**, and fails loudly if the restore did not land exactly. It
then switches the active-release pointer separately and verifies that too,
because restoring bytes and changing which release is active are two different
claims.

```bash
curl -X POST "http://127.0.0.1:3400/api/sites/rollback?site_id=<SITE_ID>" \
  -H 'content-type: application/json' \
  -d '{"receipt_id":"<RECEIPT_ID>"}'
```

Note the shape: **`site_id` is bound at ingress from the query string or the
`x-site-id` header, never from the body** (A1: identity is bound once and frozen,
with no ambient fallback). `initiator` is taken from the bound
`conversation_id`, defaulting to `console`. The body carries only `receipt_id`.

Preconditions it enforces for you:
- `receipt_id` is required; the route refuses with `receipt_id_required`
- a request with no `site_id` is refused with `identity_required` rather than
  guessing a current site
- a receipt with no `prior_receipt_id` is refused with `no_prior_deploy` rather
  than rolling back to nothing
- cross-site receipt ids 404 (A1 identity binding)

Failure modes and what they mean:
- `rollback_verification_failed` — bytes on disk do not match the prior manifest.
  **Do not retry blindly.** The target directory is in an unknown state; inspect
  before acting.
- `rollback_pointer_verification_failed` — bytes restored but the active pointer
  did not switch. The site is serving old bytes under a pointer claiming
  otherwise. Fix the pointer before anything else.

**Proof this path works:** `tests/kernel-deploy.test.js`, `describe('deploy.rollback')`
covers the happy path (prior release restored, journal entry written with
`restored_receipt_id`), manifest-hash tamper detection after rollback, refusal
when there is no prior deploy, and cross-site refusal. Green as of this writing.

DNS is **not** reverted by rollback. `dns_evidence` is explicitly recorded as
`"rollback: no new dns check performed"`. If DNS was repointed at go-live,
repoint it manually and confirm propagation.

### 4b. Roll back the webhook handler

Flip the handler back to the previous implementation and redeploy. The webhook
contract to callers never changed, so no caller needs to know. Confirm with one
real request that the response shape matches.

### 4c. Roll back the whole cutover

```bash
git checkout pre-cutover-<date>
npm run gates    # must be green on the restored commit before relying on it
```

Then restart Studio. Note the launchd rule: Studio is managed by
`com.famtastic.studio`; restart with `launchctl stop com.famtastic.studio` and
let launchd bring it back. Never start it manually.

### 4d. What rollback cannot undo

State honestly:
- **DNS propagation.** Minutes to hours, outside our control.
- **Anything a customer already saw.** A proof that was viewed was viewed.
- **Journal and DNA entries.** These are append-only by design. Rollback adds a
  `deploy.rollback` entry; it does not erase history, and it should not.

## 5. Abort criteria

Stop and roll back, rather than pressing on, if any of these occur:

- a deploy verification fails
- the webhook response shape changes for any caller
- research `execution_status` collapses to `no_findings` across multiple briefs
- any write is detected against the live proof pipeline
- gates go red on `main`

## 6. Who decides

Cutover execution is one of the two hard stops. This runbook makes the decision
executable and reversible; it does not make it.
