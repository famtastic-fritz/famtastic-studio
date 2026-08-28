# Revenue safety gates G4-0 and G4-1

**Date:** 2026-08-22. Endgame ship-blocking items 21 and 22 (SITE-STUDIO-REBUILD-PLAN-v1.1 amendment A12, binding). These protect live customer revenue and are the highest-consequence artifacts remaining in the rebuild. Both gates run entirely offline: no network egress, no `FAMTASTIC_PROOF_*` secrets read or set, no writes to any production path.

## What was read before building these

- `CONVENTIONS.md` -- greenfield rules: no copying from legacy, P0-I1 (server must never import `famtastic-proof-job-routes` or read `FAMTASTIC_PROOF_*`), identity binding, honest states.
- Amendment A12 (`SITE-STUDIO-REBUILD-PLAN-v1.1-AMENDMENTS-2026-08-21.md`) -- the literal spec for G4-0 and G4-1, quoted in full in the gate scripts' header comments.
- ADR-0002 (`site-studio/docs/decisions/ADR-0002-proof-contract-schema-mismatch.md`) -- the schema_version 1-vs-2 break: the real Drupal producer sends `schema_version: 2`, the legacy consumer originally accepted only `1`, hotfix `8a1d38bd` made it accept both. The break is latent today (no production remote dispatch is configured) but becomes urgent and blocking the instant `SITE_STUDIO_URL` is set in production or remote dispatch is otherwise enabled -- at that point every real dispatch would 422 and, because `ProofCampaignService.php` persists the campaign before dispatch, strand it with no job. G4-0 is the mechanical check ADR-0002 names as the thing that keeps this from recurring silently.
- `server/kernel/invariants.js` -- the P0-I1 preflight: `preflightModuleClosure` statically walks the module graph before anything is imported and rejects a forbidden module name, a forbidden env-prefix read, or a forbidden config-root reference; `assertNoProofRoutes` checks a built app's registered route table for a proof-ingress pattern. Both are reused for real in G4-1, not reimplemented.
- `SiteStudioProofClient.php` (the real Drupal producer) -- read in full to build byte-accurate fixtures: `schema_version`, `routine`, `idempotency_key`, `campaign_id`, `prospect{...}`, `directions`, `required_variant_count`, `direction_contract{a,b,c}`, `callback_url`, `project{...}`, `website_discovery_v2`/`v3`, signed via `hash_hmac('sha256', $body, $secret)` over `json_encode($payload, JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR)`.
- `famtastic-proof-job-routes.js` (the legacy consumer) -- read in full to confirm `validateRequest` and `verifySignature` are pure, side-effect-free exports safe to call in-process, and to see exactly what `createProofJobService`/`accept()`/`registerFamtasticProofJobRoute` do (write job files, schedule async generation and callback delivery) so the gate could deliberately avoid calling them.

## A pinning correction found while building this

Amendment A12 says "both SHAs recorded in the gate," meaning the sites-repo SHA and the site-studio-repo SHA. On this machine, `sites/` and `site-studio/` turn out to be plain subdirectories of one FAMtastic monorepo -- neither has its own `.git` at that level -- so a naive `git -C .../sites rev-parse HEAD` and `git -C .../site-studio rev-parse HEAD` return the **same** commit, which would look like two independent pins while actually pinning nothing about which producer commit was tested.

The real producer file, `SiteStudioProofClient.php`, lives inside a **separately nested** git repo at `sites/site-famtastic-designs` (its own `.git`, remote `famtastic-designs.git`). G4-0 pins that nested repo's HEAD as the producer SHA, and the outer `site-studio/` repo's HEAD (which does hold `famtastic-proof-job-routes.js`) as the consumer SHA. These are genuinely independent commits and both are printed by the gate.

## How to run them

```
cd ~/Development/famtastic-wt-phase-0/site-studio-next
node scripts/gate-g4-0-contract.mjs
node scripts/gate-g4-1-shadow-boundary.mjs
npx vitest run tests/revenue-safety.test.js
npx vitest run
```

Both gate scripts exit non-zero on any FAIL, 0 otherwise. Neither performs network egress; both are plain Node scripts with no dependency on `npm run` (package.json was not edited per the task's file-ownership constraint).

## G4-0, offline consumer-driven contract test

**File:** `scripts/gate-g4-0-contract.mjs`. **Verdict on this machine: PASS, 11/11.**

```
=== G4-0: offline consumer-driven contract test (amendment A12) ===
Zero network egress. Legacy handler pure functions called in-process against fixtures only.

PASS  pin producer repo HEAD (sites/site-famtastic-designs, holds SiteStudioProofClient.php)
PASS  pin site-studio repo HEAD (holds famtastic-proof-job-routes.js)
PASS  pin site-studio-next (this gate's own repo) HEAD
PASS  import legacy handler in-process, pure functions only (no route registration, no service)
PASS  raw JSON body leaves forward slashes unescaped (matches PHP JSON_UNESCAPED_SLASHES)
PASS  verifySignature accepts a correctly HMAC-SHA256 signed v2 body
PASS  verifySignature rejects a tampered signature
PASS  validateRequest accepts schema_version 2 (current FAMtastic Designs contract)
PASS  validateRequest accepts schema_version 1 (original contract, hotfix 8a1d38bd)
PASS  validateRequest refuses an unknown schema_version with HTTP 422
PASS  202 response shape (as statically read from source) is well-formed

Pinned SHA -- producer repo sites/site-famtastic-designs (SiteStudioProofClient.php): b5652ec638df9ffdc906ff320ec7391a4cab334e
Pinned SHA -- site-studio repo (famtastic-proof-job-routes.js):                        585d64b13316e14f92fddb8b50c6b75cb0d7c971
Note: sites/site-famtastic-designs is its own nested git repo (remote famtastic-designs.git), separate from the outer FAMtastic monorepo that holds site-studio/.
Pinned SHA -- site-studio-next (this gate's own repo):                                 2ec3508f89d8ec22e5f81cdc0b631bff013937cc

11 passed, 0 failed
VERDICT: PASS
```

### What it proves

- The exact raw JSON body shape the real Drupal producer sends today (`schema_version: 2` plus `routine`, `directions`, `direction_contract`, `project`, `website_discovery_v2/v3`, and the original required fields) is accepted by the legacy consumer's `validateRequest`, with the HMAC-SHA256 signature over that exact raw body verified by `verifySignature`.
- `schema_version: 1` (the original 2026-08-01 contract) is *also* accepted, which is the ADR-0002 hotfix (`8a1d38bd`) actually landed and not regressed.
- An unknown `schema_version` (99) is refused with HTTP 422, so a future producer contract change that isn't explicitly supported fails closed rather than silently.
- Both repo commits that matter (producer and consumer) are pinned and printed, so this result is reproducible against a named pair of commits, not just "whatever is checked out right now."
- PHP's `JSON_UNESCAPED_SLASHES` and Node's default `JSON.stringify` behavior agree on not escaping forward slashes, which matters because the signature is computed byte-for-byte over the serialized body; the gate asserts the constructed body has no escaped slashes.

### What it deliberately does not prove

- **It does not test the real production consumer.** The greenfield tree has no proof ingress of its own by design (P0-I1); there is nothing else in this repo to test against yet. The legacy handler is used as the only known-good reference consumer. If and when a real greenfield consumer is built, this gate (or a successor) needs to run against that instead.
- **It does not call `accept()`, `createProofJobService()`, or `registerFamtasticProofJobRoute()`.** Those run the service: write job files, schedule async campaign generation, and attempt callback delivery. The task explicitly prohibited "running the service." The 202 response shape check in this gate is therefore built from *static reading* of the source (the `job_id: proof_job_<uuid>`, `status: 'accepted'`, `duplicate: false` shape on the new-job branch), not from actually exercising that code path. A future change to that shape that isn't also reflected in this gate's hardcoded expectation would not be caught.
- **It does not test real network conditions.** No HTTP request is ever made by this gate -- no timeout behavior, no retry behavior, no TLS, no DNS, no rate limiting.
- **It does not test idempotency end-to-end.** `validateRequest` checks the *shape* of `idempotency_key`; the actual dedup logic lives in `service.accept()`'s `findByKey()`, which this gate never calls.
- **It does not test authentication beyond signature verification.** There's no session, token, or account-level authorization in this contract; the gate only checks the HMAC.
- **It does not prove the pinned commits are what's actually deployed.** It records the commits it read at gate-run time on this machine; nothing here checks that against what's running in production. That's a separate, human-owned precondition (documented in ADR-0002: "the Site Studio instance serving that endpoint must already be running code at or after `8a1d38bd` before `SITE_STUDIO_URL` is set").

## G4-1, fail-closed shadow boundary

**File:** `scripts/gate-g4-1-shadow-boundary.mjs`. **Verdict on this machine: PASS, 6/6 checked, 4 SKIPPED-WITH-REASON.**

```
=== G4-1: fail-closed shadow boundary (amendment A12) ===
Machine-checkable proof that a shadow run cannot mutate production.

PASS  module closure contains no proof ingress (preflightModuleClosure + assertNoProofRoutes, real app built without listening)
      38 files checked, 13 modules registered, no socket opened
PASS  no FAMTASTIC_PROOF_* variable present in process.env
      scanned key names only, no values printed
PASS  configured shadow roots are isolated temp paths, disjoint from production proof-jobs/proof-output
      shadow root: /var/folders/4z/76l8zpns7hvdlykrk2fkf8wr0000gn/T/g4-1-shadow-0LsrXZ
PASS  callback dispatcher is a stub with no real network capability (injected fetch is a stub; real fetch unused)
      stub invoked 1 time(s); real global fetch invoked: false
PASS  zero-write audit: campaigns
      1 file(s), digest unchanged (f497f57acb97...)
SKIPPED-WITH-REASON  zero-write audit: proof-jobs (production, ~/.config/famtastic/proof-jobs)
      no production proof-jobs directory exists on this machine (only smoke-proof-jobs / poc-proof-jobs, which are non-production per ADR-0002)
SKIPPED-WITH-REASON  zero-write audit: proof-output (production, ~/.config/famtastic/proof-output)
      no production proof-output directory exists on this machine (only smoke-proof-output / poc-proof-output, which are non-production per ADR-0002)
PASS  zero-write audit: artifact store (~/.config/famtastic/blobs)
      22 file(s), digest unchanged (857566d0750b...)
SKIPPED-WITH-REASON  zero-write audit: ledger (per-site intelligence ledgers under legacy site-studio/sites)
      location exists (/Users/famtastic-fritz/Development/FAMtastic/site-studio/sites) but contains zero files to audit on this machine; a before/after comparison over zero files would prove nothing
SKIPPED-WITH-REASON  zero-write audit: outreach
      outreach state lives in the Drupal database, not on this filesystem; verifying it needs production egress, which this gate forbids

6 passed, 0 failed, 4 skipped-with-reason
NOTE: SKIPPED-WITH-REASON checks are not failures, but they are not proof either -- see the list above for exactly what could not be checked on this machine and why.
VERDICT: PASS
```

### What each check proves

1. **Module closure** -- reuses `preflightModuleClosure` and `assertNoProofRoutes` from `server/kernel/invariants.js` for real, against a real app object built the same way `server/index.js` boots (all kernels loaded, all `server/modules/*/index.js` registered) but **without ever calling `http.createServer`/`.listen()`** -- no socket is opened by this gate. Confirms the greenfield server's actual module graph and registered route table carry no proof ingress today.
2. **Env scan** -- confirms no `FAMTASTIC_PROOF_*` key exists in `process.env` for the process the gate itself runs under. Key names only are ever inspected or printed; values are never read out.
3. **Path isolation** -- the shadow roots used by this gate's own exercised workload are freshly created under `os.tmpdir()` and asserted disjoint (neither an ancestor nor a descendant) of the production `~/.config/famtastic/proof-jobs` and `~/.config/famtastic/proof-output` paths (resolved the same way `site-studio/lib/config-root.js` resolves them, hardcoded rather than read from a possibly-overridden env var).
4. **Stub dispatcher** -- the `fetchImpl` used by the shadow workload is a local stub function, asserted to not be the same reference as `globalThis.fetch`. During the workload, real `fetch` is temporarily replaced with a spy that throws if called, and the check asserts it was never invoked.
5. **Zero-write audit** -- read-only (file paths + sizes + mtimes hashed into one digest, file contents never opened) before/after snapshot of every production location this gate could identify, run around the same shadow workload exercised by checks 3-4.

### Production locations audited (and why those specifically)

Found by reading the codebase, not guessed:

- **campaigns** -- `~/.config/famtastic/campaigns`, where the legacy Studio writes prospect/campaign CSVs. Exists on this machine (1 file); audited and unchanged.
- **artifact store** -- the *configured* production `proof-output` root does not exist on this machine (see below). `~/.config/famtastic/blobs` is the actual content-addressed artifact store used elsewhere in the Studio and does exist (22 files); audited as the closest real "artifact" location and unchanged.
- **ledger** -- per-site intelligence ledgers live at `sites/<site>/.studio/intelligence/runs/<run>/ledger.json` under the legacy site-studio data tree (`server/intelligence-writer.js`'s `ledgerPath()`). There is no single `~/.config/famtastic/ledger` root. The gate recursively finds every `ledger.json` under legacy `site-studio/sites/`; there are currently zero on this machine.
- **outreach** -- **CORRECTED BY THE ORCHESTRATOR.** Outreach state is not a filesystem path, which is why a path search found nothing. It lives in the Drupal database: `sites/site-famtastic-designs/backend/web/modules/custom/famtastic_pipeline/src/Service/OperationalLedger.php` imports `Drupal\Core\Database\Connection` and queries `->condition('consent_type', 'outreach')`. Reaching it requires network egress to the production GoDaddy host, which this gate forbids. The earlier wording here said the feature does not exist; that was wrong, and the distinction matters because "not shipped" and "shipped but unobservable from this machine" carry opposite weight at a cutover.

### What was SKIPPED-WITH-REASON, and why, stated plainly

1. **`~/.config/famtastic/proof-jobs`** -- does not exist on this machine. Only `smoke-proof-jobs` and `poc-proof-jobs` exist, and ADR-0002 explicitly documents both as non-production (smoke tests / proof-of-concept runs). To un-skip: this exact directory would need to exist, which per `config-root.js` only happens once a real job has been accepted through the production route.
2. **`~/.config/famtastic/proof-output`** -- same reasoning as above, for the output side.
3. **ledger** -- the root directory (`site-studio/sites/`) exists, but contains zero `ledger.json` files anywhere under it right now. A before/after comparison over zero files is true trivially and would prove nothing about the boundary holding, so the gate reports it as unauditable rather than as a hollow PASS. To un-skip: at least one site needs a real intelligence run that has produced a `ledger.json`.
4. **outreach** -- **CORRECTED BY THE ORCHESTRATOR.** Outreach state is not a filesystem path, which is why a path search found nothing. It lives in the Drupal database: `sites/site-famtastic-designs/backend/web/modules/custom/famtastic_pipeline/src/Service/OperationalLedger.php` imports `Drupal\Core\Database\Connection` and queries `->condition('consent_type', 'outreach')`. Reaching it requires network egress to the production GoDaddy host, which this gate forbids. The earlier wording here said the feature does not exist; that was wrong, and the distinction matters because "not shipped" and "shipped but unobservable from this machine" carry opposite weight at a cutover. To un-skip: a read-only query against the production database, which only Fritz can authorize.

**Read this plainly: 4 of the 8 locations this gate would ideally audit could not be audited on this machine today.** That is not a passing result being dressed up -- it is the accurate state of what could be verified, and the gate says so instead of hiding it inside a green summary line.

### What it deliberately does not prove

- **It is a snapshot-in-time boundary check, not a standing guarantee.** It proves that, as of the code and configuration that exist right now, a shadow run using isolated roots and a stub dispatcher cannot be observed to write to the production locations that exist and have data to audit. It does not prove there is no *other*, not-yet-written code path that could reach production in the future -- a new module, a new config default, a new dependency that reads `FAMTASTIC_CONFIG_DIR` differently, etc. This gate needs to be re-run after any change that touches path resolution, module loading, or the proof/shadow surface.
- **It does not prove the boundary holds under a real network.** The stub fetch is asserted unused/not-real; it does not simulate what would happen if a real network call somehow occurred (that scenario is exactly what the stub is meant to prevent, not exercise).
- **It does not prove anything about the 4 SKIPPED-WITH-REASON locations.** No claim of safety is made for `proof-jobs`, `proof-output`, ledger, or outreach beyond "nothing existed there to check, and the gate said so."
- **It does not prove the *greenfield* server has a working shadow-run feature at all.** No such feature exists yet in this tree; the workload exercised here is a minimal fixture (write one job file into a temp dir, call the stub once) built by this gate to exercise checks 3-5, not a real shadow-run implementation. When a real shadow-run feature is built, this gate (or a successor) should exercise *that* code path instead of the fixture.

## Test suite

`tests/revenue-safety.test.js` imports the exported check-building-block functions from both gate scripts (`buildV1Payload`/`buildV2Payload`/`signBody`/`gitHead`/`runChecks` from G4-0; `AUDIT_LOCATIONS`/`snapshotListing`/production path constants from G4-1) and asserts on them directly, so a regression points at the specific broken assertion rather than only "the gate script's exit code changed." Verbatim run:

```
$ npx vitest run tests/revenue-safety.test.js
 RUN  v3.2.4 /Users/famtastic-fritz/Development/famtastic-wt-phase-0/site-studio-next

 ✓ tests/revenue-safety.test.js (9 tests) 177ms

 Test Files  1 passed (1)
      Tests  9 passed (9)
```

(One expected stderr line, `fatal: not a git repository (or any of the parent directories): .git`, comes from a test that asserts `gitHead()` throws loudly for a non-repo path rather than silently returning an empty pin -- that is the test intentionally exercising the failure path, not a real error.)

Full suite, same run:

```
$ npx vitest run
 Test Files  23 passed (23)
      Tests  260 passed (260)
```

(23 files / 260 tests includes test files owned by other concurrent work in this shared worktree, not just `revenue-safety.test.js`; all pass.)

## Constraints honored

- No network egress at any point (no HTTP client is ever invoked with a real target; the one stub `fetch` call in G4-1 targets `https://example.invalid`, an address reserved by RFC 2606 that is never dialed because the injected implementation never makes a real request).
- No `FAMTASTIC_PROOF_*` secret was read or set. G4-1 checks explicitly that none are present.
- No write to any production path. All writes happen inside `fs.mkdtempSync(os.tmpdir())`-rooted directories.
- Only the four owned files were created/edited: `scripts/gate-g4-0-contract.mjs`, `scripts/gate-g4-1-shadow-boundary.mjs`, `tests/revenue-safety.test.js`, `docs/research/revenue-safety-gates-2026-08-22.md`.
- Nothing was committed. This is a shared worktree; `git add -A` was never run.

## Note on how this document was verified

The orchestrator ran both gates directly rather than accepting a lane's report, and corrected one material inaccuracy in this file: a lane had written that no outreach code path exists anywhere, when in fact it exists in the Drupal database layer and simply is not a filesystem path. That correction is recorded here rather than silently applied, because a revenue-safety document that quietly changes its claims is worth less than one that shows where it was wrong.

**The standing conclusion is unchanged:** the outreach guarantee rests on containment rather than observation, and the cutover packet must label it that way.
