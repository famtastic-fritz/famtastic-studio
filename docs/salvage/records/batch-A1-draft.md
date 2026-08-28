## GET /api/deploy-info
**Source:** server/deploy-repo-routes.js:29
**Kind:** route
**Verdict:** ADAPT
**Purpose:** Reports the current deploy state (local preview, staging, production) for the ambient site by reading its spec file.
**Inputs:** No params/body. Reads `readSpec()` (ambient — no site argument passed), `getHubRepoCache()`, `previewPort`, `getSiteDir()`, `getDistDir()`, `getSpecFile()`.
**Outputs:** JSON with `local`, `staging`, `production` env blocks (url, state, deployed_at, provider, site_id, custom_domain), `hub_repo`, `site_repo`, `deployed`, `url`. On any thrown error, silently returns an empty-shaped 200 body (`{ local: {}, staging: null, production: null, repo: null, deployed: false }`) rather than an error status.
**Side effects:** None observed — read-only, no writes, no network calls, no spawned processes.
**Identity:** Ambient. Calls `readSpec()` with zero arguments; the spec resolved is whatever `getSpecFile()`/closure state currently points at, not a value supplied by the request. Compare to POST /api/deploy in the same file, which explicitly requires `siteTag` via `siteTagOr400`.
**Risks:** The catch-all `catch { res.json(...) }` masks real failures (missing spec file, corrupt JSON, provider errors) as a benign "not deployed" state — a caller cannot distinguish "truly undeployed" from "read failed." Combined with ambient site binding, this is unsafe under any multi-site/concurrent-request model.
**Verdict reasoning:** The read-only status shape and field list are useful and worth carrying forward, but the ambient site binding and error-masking must be redesigned — take the contract, not the code.

## POST /api/deploy
**Source:** server/deploy-repo-routes.js:72
**Kind:** route
**Verdict:** ADAPT
**Purpose:** Dispatches a deploy of the site's `dist-vnext` build artifact to a resolved provider (Netlify, Cloudflare Pages, or Vercel) for either the staging or production environment.
**Inputs:** Body: `env` ('staging'|'production', defaults 'staging'). Site identity: `siteTagOr400(req, res)` — requires `req.ctx.siteTag`, which the `requestContext` middleware (server.js:1114) populates from an explicit `siteTag`/`site_tag`/`sitetag`/`tag` field in params/body/query/header; if absent the route 400s with `site_tag_required`. Also reads `getDistVnextDir(siteTag)`, `readSpec(siteTag)`, `loadSettings()`.
**Outputs:** 200 `{ ok: true, deployment_id, site_tag, env }` on dispatch (deploy runs async after response). Various 400/409/412 error bodies (`invalid_env`, `deploy_in_progress`, `no_vnext_build`, `unsupported_deploy_provider`, `no_netlify_site_id`, Netlify preflight failure reasons).
**Side effects:** Writes a deployment job record via `upsertDeployment(readSpec, writeSpec, siteTag, deploymentId, {...})` (mutates the site spec file). Broadcasts to all connected WebSocket clients (unfiltered by site — `[...wss.clients].filter(c => c.readyState===1)`, then reused for `runDeploy`'s progress messages). Calls `checkNetlify()` (network/CLI probe) when provider is Netlify. Fires `runDeploy(...)` which dispatches an actual deploy (subprocess/network call to the provider) — real infrastructure and possibly customer-facing site changes, especially for `env==='production'`.
**Identity:** Explicit — this route is the one place in the batch that genuinely enforces `siteTagOr400`, and captures `capturedProvider`/`siteId` before dispatch specifically so the async completion path never falls back to ambient state (see in-code comments at lines 98-121, 140-142, 152-154).
**Risks:** The in-progress guard is keyed on `(siteTag, env)` so it isolates other sites correctly, but the WebSocket broadcast is NOT site-scoped — every connected client (potentially for other sites' Studio sessions) receives every deploy's progress messages, which could leak cross-site deploy activity to an operator working on an unrelated site. Production deploys are real revenue/customer-facing writes; a bad `dist-vnext` build ships live. `checkNetlify()` and `runDeploy()` were not read in this pass — their internals are UNDETERMINED here.
**Verdict reasoning:** The identity-binding discipline (explicit siteTag, captured-before-dispatch provider/site-id) is exactly right and should be kept; the ambient WebSocket broadcast and un-traced `runDeploy`/`checkNetlify` internals mean this needs new code around a good contract, not a paste.

## GET /api/deploy-status
**Source:** server/deploy-repo-routes.js:192
**Kind:** route
**Verdict:** ADAPT
**Purpose:** HTTP-pollable read of a single deployment's status/URL by deployment id, for clients that never open a WebSocket.
**Inputs:** Query: `deployment_id` (required string). Calls `findDeployment({ sitesRoot: getSitesRoot(), readSpec }, deploymentId)`.
**Outputs:** 400 if `deployment_id` missing; 404 `deployment_not_found` if not found; else 200 `{ ok: true, deployment: {...normalized record...} }` with back-compat field spreading (`...record` merged after explicit defaults, then captured/actual provider and site-id fields re-asserted after the spread).
**Side effects:** None observed — read-only against the deployment record store.
**Identity:** Not bound to a request-supplied site tag directly; `findDeployment` is passed `getSitesRoot()` (presumably scans across sites by `deployment_id`, which is itself the identity key) — UNDETERMINED: `findDeployment`'s implementation in lib/deploy-jobs.js was not read in this pass, so whether it can leak another site's deployment record given a guessed/collided id is unverified.
**Risks:** If `deployment_id` values are not cryptographically unpredictable and `findDeployment` searches across all sites under `sitesRoot`, this could allow cross-site deployment status disclosure. UNDETERMINED: need to read `newDeploymentId()` and `findDeployment()` in lib/deploy-jobs.js to confirm id unpredictability and per-site scoping.
**Verdict reasoning:** The HTTP-polling contract (avoid requiring a WebSocket) is a good idea worth keeping, but the identity/scoping question is open enough that it should be re-implemented against the new job-record design rather than ported directly.

## POST /api/create-site-repo
**Source:** server/deploy-repo-routes.js:227
**Kind:** route
**Verdict:** RETIRE
**Purpose:** Kicks off creation of a standalone production git repo (containing only `dist/` build output) for the ambient site, streaming progress over WebSocket.
**Inputs:** No body fields used by the route itself (`createSiteRepo(client)` reads everything from closure/global state). Requires at least one connected WebSocket client (`[...wss.clients].find(c => c.readyState === 1)`) — 400 `No WebSocket client connected` if none.
**Outputs:** 200 `{ success: true, message: 'Creating site repo...' }` immediately; actual work (and failure) is reported asynchronously only over the WebSocket the route picked, not in the HTTP response.
**Side effects:** `createSiteRepo` (server.js:19100) is entirely ambient: it reads `loadSettings()`, builds `repoPath` from `TAG` (module-level global, not a request value), reads `DIST_DIR()`, copies the dist directory to a new repo path with `fs.cpSync`, writes `.gitignore` and a scaffolded `CLAUDE.md`, shells out to `gh repo create` (network call to GitHub), and mutates `spec.site_repo` via `writeSpec(spec)`. It also mutates a single module-level `siteRepoInProgress` boolean lock shared across ALL sites, not per-site.
**Identity:** Ambient — ships to whichever site `TAG` currently names at call time, and the in-progress lock is global, so a create-site-repo call for site A would be blocked (or worse, interleaved) by an in-flight call for site B. Quote: `const repoPath = path.join(basePath, TAG);` and `let siteRepoInProgress = false;` (module scope).
**Risks:** Global ambient site binding combined with a global (not per-site) in-progress lock is a correctness hazard in any multi-site-concurrent model. The route also silently no-ops (returns success) even though the real work — including a `gh repo create` GitHub API call — hasn't happened yet; a caller has no HTTP-observable way to know if it succeeded or failed. Writes outside the sites tree to `settings.prod_sites_base` (default `~/famtastic-sites`), a second on-disk location the new system would need to know about.
**Verdict reasoning:** Ambient global site binding plus a global (non-per-site) mutex is exactly the pattern the new system forbids; the WebSocket-only completion signal also has no HTTP-observable equivalent to POST /api/deploy's job-record pattern in the same file, so it should not be ported as-is.

## PUT /api/site-repo
**Source:** server/deploy-repo-routes.js:235
**Kind:** route
**Verdict:** RETIRE
**Purpose:** Manually sets/overrides the ambient site's `site_repo` (local path + git remote) in its spec file, e.g. to point at a manually-created repo.
**Inputs:** Body: `repoPath` (required), `remote` (optional). No site identity parameter — operates on `readSpec()` ambiently.
**Outputs:** 400 `repoPath required` if missing, or `repoPath must be under home directory` if the resolved path escapes `os.homedir()`. Else 200 `{ success: true, site_repo }`.
**Side effects:** Mutates the ambient site's spec file via `writeSpec(spec)` — sets `spec.site_repo = { path, remote }`.
**Identity:** Ambient. `readSpec()`/`writeSpec(spec)` are called with no site argument — this writes to whatever site the process/closure currently considers current, exactly the pattern POST /api/deploy in the same file was rewritten to avoid.
**Risks:** Path traversal is only partially guarded (home-directory containment check via string prefix match, not a canonicalized/symlink-safe check) — UNDETERMINED whether `path.resolve` plus a `startsWith(home + sep)` string check is symlink-safe; not verified in this pass. Ambient site binding means a concurrent request context resolving a different site would silently write the wrong site's repo pointer.
**Verdict reasoning:** Ambient site state is the disqualifying issue per the rebuild's explicit-identity rule; the home-directory containment check is also weaker than the traversal guards used elsewhere in this codebase (e.g. `isSafeTag`/`isSafeId`), so this is not a clean mechanical port.

## POST /api/integrations/famtastic/proof-jobs
**Source:** server/famtastic-proof-job-routes.js:333
**Kind:** route
**Verdict:** ARCHIVE-FOR-FUTURE
**Purpose:** Public machine-to-machine intake endpoint for FAMtastic Designs: accepts an HMAC-signed job describing a prospect and three design "directions," queues async generation of three distinct proof-site variants, and delivers the results to a callback URL.
**Inputs:** Raw body (HMAC-verified against `X-FAMtastic-Signature` using `dispatchSecret`), header `Idempotency-Key` (must equal `payload.idempotency_key`), JSON body validated by `validateRequest`: `schema_version` (1 or 2), `idempotency_key` (`^proof:[a-z0-9-]{3,190}$`), `campaign_id` (`^[a-z0-9-]{3,190}$`), `callback_url` (valid http/https URL), `required_variant_count` (must be exactly 3), `prospect.business_name` (required). Env: `FAMTASTIC_PROOF_DISPATCH_SECRET`, `FAMTASTIC_PROOF_CALLBACK_SECRET`, `FAMTASTIC_PROOF_JOBS_DIR`, `FAMTASTIC_PROOF_OUTPUT_ROOT`.
**Outputs:** 503 if secrets unconfigured; 401 `invalid_signature`; 422 `invalid_proof_job` with validation message; else 202 `{ job_id, status: 'accepted', duplicate }`. Actual generated variants (HTML + thumbnail + design DNA) are POSTed asynchronously to `payload.callback_url`, not returned in this response.
**Side effects:** Writes a job record to `jobsDir` (`save(job)`), then asynchronously (`setImmediate`) calls `generateProofCampaign` (server.js `generateProofCampaign`, the same function wired to POST /api/proof-campaign) to generate 3 HTML variants via `completeWithShay` (LLM call), writes artifacts under `outputRoot/campaign_id/direction_id/`, optionally renders thumbnails, and delivers via HTTP callback (`deliver(job, variants)`, network call to the caller-supplied `callback_url`) with HMAC signing via `callbackSecret`. On restart, `resumePending()` re-drives any job left in `accepted`/`generating`/`callback_pending` state.
**Identity:** Not site-scoped in the site-registry sense — identity here is `campaign_id` (validated, safe-charset) plus `idempotency_key`, used as an output directory name, not a `site_id` bound to an existing site record.
**Risks:** This is the customer-facing entry point of FAMtastic Designs' revenue pipeline — a broken or fabricated variant here ships directly to prospects. It is protected revenue scope. Idempotency handling on retry-after-failure (`existing.status === 'failed'` re-queues) trusts the stored payload's continued safety without re-validating it against current secrets/config. `deliver()`'s callback-signing internals were not traced in this pass — UNDETERMINED: confirm callback delivery retry/failure semantics before any future revisit.
**Verdict reasoning:** Per explicit instruction, anything touching the FAMtastic Designs proof pipeline is ARCHIVE-FOR-FUTURE — this is protected revenue scope, not MVP scope for the rebuild, and must not be ported, adapted, or retired without a dedicated future phase.

## POST /runs/:runId/proof
**Source:** server/intelligence-actions.js:219
**Kind:** route
**Verdict:** KEEP-CONVERT
**Purpose:** Attaches a proof packet (evidence entries plus blockers/non-blockers) to an intelligence run's ledger for a given site — an internal development/ops proof record, not the FAMtastic Designs customer proof pipeline.
**Inputs:** Path: `runId` (validated by `withRunIdGuard` via `reader.isSafeId`). Query: `tag` (optional; validated by `reader.isSafeTag` if present, else 400 `invalid_tag`) resolved to `siteDir` by `siteDirOr`/`resolveSiteDirFromReq` — falls back to `resolveSiteDir()` default only when no `tag` query param is supplied. Body: `pass_id` (optional), `proofs` (required array, 400 `proofs_must_be_array` if not), `blockers`/`non_blockers` (optional arrays). Body traversal-guarded (`hasTraversal`) and size-capped at 64KB.
**Outputs:** 200 `{ proof_packet: packet }` on success; mapped error statuses via `mapWriterError` (409 `already_exists`/`run_terminal`, 404 `run_not_found`, 400 for invalid run_id/status/verdict/cost or missing fields, 500 `writer_failed` otherwise).
**Side effects:** Calls `writer.attachProofPacket(siteDir, runId, {...})` (server/intelligence-writer.js) which does an atomic JSON write to `intelligenceDir(siteDir)/runs/<runId>/proof.json` (or equivalent), appending the new packet to `existing.packets`.
**Identity:** Explicit-if-supplied, ambient-fallback: `req.query.tag` is validated and honored when present (`isSafeTag`), but silently falls back to `resolveSiteDir()`'s default when absent — this is the documented "transitional" pattern in lib/request-context.js, not the hard-required `siteTagOr400` pattern used by POST /api/deploy.
**Risks:** The optional-tag fallback means a caller that forgets `?tag=` writes to whatever site the server's default currently resolves to, silently. Low customer-facing risk (this is an internal ops/proof ledger, not the FAMtastic Designs pipeline — see famtastic-proof-job-routes.js for that), but still an identity-binding gap.
**Verdict reasoning:** The underlying contract (atomic per-run proof-packet ledger, validated run id, size-capped body, clean error mapping) is sound and worth porting mechanically; only the identity binding needs tightening to require an explicit site tag rather than falling back ambiently.

## GET /proofs
**Source:** lib/ops-api.js:212
**Kind:** route
**Verdict:** ADAPT
**Purpose:** Returns the global (repo-wide, not per-site) Ops Workspace proof ledger — a development/build-verification record distinct from both the FAMtastic Designs customer pipeline and the per-run intelligence proof packets above.
**Inputs:** No params. Reads `proofs/proof-ledger.jsonl` relative to `ROOT` (`path.resolve(__dirname, '..', '..')` — i.e. one level above the site-studio repo root itself, not a per-site path).
**Outputs:** 200 `envelope(proofs, ['proofs/proof-ledger.jsonl'])` — the shared ops-API envelope: `{ snapshot_version, generated_at, source_ledgers, record_count, data }`, with each proof record enriched by `attachFreshness(...)` (freshness/staleness classification keyed on `recorded_at`).
**Side effects:** None observed — read-only.
**Identity:** Not site-scoped at all — this ledger lives above the per-site directory structure entirely, at repo root, and the route takes no site parameter. UNDETERMINED whether individual ledger records carry a `site_tag`/`site_id` field internally (not verified — the route only reads the whole file, does not filter).
**Risks:** A repo-root-relative global ledger is a fundamentally different data model than the per-site salvage principle this rebuild is organized around; if this ledger mixes proof records from multiple sites/campaigns with no per-record access control, any future per-site view would need new filtering logic that doesn't exist here. Low risk in the current single-operator local-tool context, but the underlying model doesn't map cleanly onto explicit per-site identity.
**Verdict reasoning:** The envelope/freshness contract (`generated_at`, `source_ledgers`, freshness classification) is reusable pattern worth keeping, but the global (non-site-scoped) ledger file needs redesigning around explicit identity before it fits the new system — hence ADAPT rather than KEEP-CONVERT.

## POST /api/auth/bootstrap
**Source:** server.js:1291
**Kind:** route
**Verdict:** RETIRE
**Purpose:** Exchanges the operator's root token (bearer header or body `token`) for an HttpOnly session cookie plus a CSRF token, opening the operator's authenticated session for the local single-operator Studio tool.
**Inputs:** `Authorization: Bearer <token>` header or `{ token }` in body, read by `presentedRootToken(req)`. Verified against a 32-byte root credential stored at `~/.config/famtastic/studio-token` (per lib/auth.js), held only as a SHA-256 digest and compared with `crypto.timingSafeEqual`.
**Outputs:** 401 `{ error: 'Authentication required', code: 'invalid_token' }` on bad/missing token. On success: `Set-Cookie` header with the session cookie (HttpOnly, SameSite=Strict, Path=/), and 200 JSON `{ ok: true, csrfToken, expiresAt, enforced }`.
**Side effects:** Creates a new in-memory session record (`store.create(...)` in lib/auth.js) — this is what it protects: bridge exec, codex exec, PTY/terminal, settings writes, site lifecycle (create/switch/delete), and the Operator V1 mutation surface (build-vnext, deploy, content-field, verify) per `PRIVILEGED_API_ROUTES` (server.js ~1250-1263).
**Identity:** N/A — this system is explicitly single-operator/single-tenant ("Scope: SINGLE-OPERATOR LOCAL TOOL... exactly one principal — the operator", lib/auth.js comment). There is no site_id or multi-user concept here at all.
**Risks:** None observed as a security flaw in the legacy design itself (timing-safe comparison, HttpOnly cookie, root token never logged/echoed) — the risk is purely architectural mismatch with the new system's network-layer-only access model.
**Verdict reasoning:** Per instruction, the new system has no operator auth ceremony (network-layer access control only), so this whole bootstrap/session mechanism is RETIRE; recorded here so the surface it protected (terminal/bridge/codex exec, settings writes, site lifecycle, deploy/build/content-field/verify mutations) is auditable when network-layer controls are designed.

## POST /api/auth/elevate
**Source:** server.js:1304
**Kind:** route
**Verdict:** RETIRE
**Purpose:** Re-presents the root token against an existing session to open a short (5-minute) "privileged" scope window, required for the dangerous mutation surface beyond a plain session.
**Inputs:** Session id from the `studio_session` cookie, plus root token (bearer header or body `token`) via `presentedRootToken(req)`.
**Outputs:** 401 `{ error: 'Authentication required', code: 'reauth_failed' }` if session invalid or token wrong. Else 200 `{ ok: true, privilegedUntil }`.
**Side effects:** Updates the session record's `privilegedUntil` timestamp in the in-memory session store (`store.update`).
**Identity:** N/A — single-operator tool, no site/user identity involved; this is a global privilege-elevation state per session, not per site.
**Risks:** None observed as a flaw in the legacy design (the privileged window is short and requires re-presenting the root token, not just holding a session). Purely an architectural mismatch with the new network-layer-only access model.
**Verdict reasoning:** Same as bootstrap — the new system replaces this entire session/privilege-elevation ceremony with network-layer access control, so RETIRE; recorded so it's known that "privileged" scope existed and gated bridge/codex exec, settings writes, and lifecycle/deploy mutations.

## POST /api/auth/logout
**Source:** server.js:1311
**Kind:** route
**Verdict:** RETIRE
**Purpose:** Revokes the operator's current session and clears the session cookie.
**Inputs:** Session id from the `studio_session` cookie.
**Outputs:** 200 `{ ok: true, revoked }` (revoked is a boolean from `store.remove`).
**Side effects:** Removes the session record from the in-memory session store; sets a clearing `Set-Cookie` header (Max-Age=0).
**Identity:** N/A — single-operator tool, no site/user identity.
**Risks:** None observed. Purely superseded by the new access model.
**Verdict reasoning:** Part of the same auth ceremony being retired wholesale; nothing in this specific route needs individual scrutiny beyond noting what it tears down (the operator session created by bootstrap).

## GET /api/auth/status
**Source:** server.js:1320
**Kind:** route
**Verdict:** RETIRE
**Purpose:** Lets the frontend client check, without a token, whether auth enforcement is on and whether the current caller (cookie or bearer) is authenticated, recovering a usable CSRF token for an already-authenticated session that lost track of it.
**Inputs:** Request headers (cookie or `Authorization: Bearer`), resolved via `studioAuth.authenticateHeaders(req.headers || {})`.
**Outputs:** 200 always (this route does not appear to 401): `{ enforced, authenticated, kind, scopes, csrfToken }` where `csrfToken` is populated only for an already-cookie-authenticated session caller (never for bearer callers, and never for an unauthenticated caller) — per the code comment, this is deliberately safe because the session cookie is HttpOnly/same-origin and no CORS headers are set on this response.
**Side effects:** None observed — read-only status probe.
**Identity:** N/A — single-operator tool.
**Risks:** None observed as a flaw; the design comment explicitly reasons through why exposing csrfToken here is safe (same-origin only, HttpOnly cookie). Purely superseded.
**Verdict reasoning:** Same auth-ceremony retirement; recorded for completeness since it documents the CSRF-recovery UX problem (second tab, cleared site data, partitioned storage) the new system will not need to solve the same way.

## POST /api/proof-generate
**Source:** server.js:1575
**Kind:** route
**Verdict:** ARCHIVE-FOR-FUTURE
**Purpose:** Directly invokes the core proof-site generation engine for a single variant — an LLM-driven template build (via `completeWithShay`) producing a standalone proof-site HTML artifact, template, and design-DNA JSON.
**Inputs:** Body: `proof_id`, `output_dir`, `spec`, `proof_url` (optional) — passed to `generateProofArtifact({ proofId, outputDir, spec, proofUrl })` (server.js:4611).
**Outputs:** 200 with the generation result (artifact path, template path, design-DNA path, thumbnail, timing) on success; on error, `res.status(err.statusCode || 500).json({ success: false, error: err.message })`.
**Side effects:** `generateProofArtifact` calls `completeWithShay(templatePrompt, { timeoutMs: 300000 })` (an LLM generation call), writes `_template.html`, extracted logo SVGs (`famSkeletons.extractLogoSVGs`) when `proofSpec.famtastic_mode` is set, and other artifacts to `resolvedOutputDir` via `writeTemplateArtifacts`. Throws `proofHttpError(502, ...)` if the LLM output is empty/invalid HTML or fails to parse into reusable artifacts.
**Identity:** Not site-registry-scoped; identity is `proofId`/`outputDir`, validated by `assertSafeProofId` and `resolveProofOutputDir` (safe-path helpers), not a `site_id` bound to an existing site.
**Risks:** This is the exact function (`generateProofArtifact`) that `generateProofCampaign` calls per-variant, and `generateProofCampaign` is the `generateCampaign` implementation wired directly into the FAMtastic Designs machine-to-machine job route (server.js:1175-1181, `registerFamtasticProofJobRoute({ generateCampaign: generateProofCampaign, ... })`). This manual/direct HTTP trigger exercises the same production revenue-generation engine outside the signed/idempotent job-queue path, with none of that route's HMAC auth, idempotency, or callback delivery — i.e., an unauthenticated (once past loopback+session auth) way to fire the same expensive LLM generation.
**Verdict reasoning:** Because it invokes the identical generation engine that produces the FAMtastic Designs customer-facing proof output, this is protected revenue scope by the same rule as the /api/integrations/famtastic/proof-jobs route — ARCHIVE-FOR-FUTURE, not RETIRE (the engine has real value) and not KEEP-CONVERT (it bypasses the production route's auth/idempotency contract).

## POST /api/proof-campaign
**Source:** server.js:1590
**Kind:** route
**Verdict:** ARCHIVE-FOR-FUTURE
**Purpose:** Directly invokes multi-variant proof-campaign generation (three design directions in one call) — this is literally the same `generateProofCampaign` function used as `generateCampaign` by the FAMtastic Designs production job route.
**Inputs:** Body: `campaign_id`, `base_spec` (required object), `variants` (required non-empty array, each with `direction_id`, optional `direction_name`, `proof_url`), `output_base_dir` (optional, defaults under `__dirname/proofs/<campaign_id>`).
**Outputs:** 200 with `{ success: true, campaign_id, status: 'proofs_generated', ... }` (results array per variant: artifact/template/design-DNA paths, thumbnail, generation time) on success; error status/body via `proofHttpError`.
**Side effects:** Calls `generateProofArtifact` once per variant (see above — LLM calls, filesystem writes), computes a SHA-256 hash of each generated HTML into `htmlHashes` (a distinctness check used elsewhere to enforce the "3 distinct variants" contract that famtastic-proof-job-routes.js validates against: `result.distinct_html !== true` is checked there).
**Identity:** Not site-registry-scoped; identity is `campaign_id`, validated by `assertSafeProofId`, used only as a directory name under `proofs/`.
**Risks:** Same as /api/proof-generate above — this is `generateCampaign` itself, the exact function the signed/idempotent FAMtastic Designs job route depends on (server.js:1176 `generateCampaign: generateProofCampaign`). A manual/direct call here bypasses that route's HMAC signature verification, idempotency-key dedup, and callback delivery guarantees while exercising the same production revenue pipeline.
**Verdict reasoning:** Protected revenue scope by direct code identity with the production pipeline (not just conceptual similarity) — ARCHIVE-FOR-FUTURE per the explicit instruction, never RETIRE (the underlying generation logic has real value) and never KEEP-CONVERT (bypasses production auth/idempotency).

## GET /api/session-history
**Source:** server.js:1601
**Kind:** route
**Verdict:** RETIRE
**Purpose:** Returns session/uptime/file-status metadata for the current site's chat/build history.
**Inputs:** No params. Calls `db.getSessionHistory(TAG)` where `TAG` is a module-level global constant set once at process startup from the site the Studio process was launched for — not derived from the request.
**Outputs:** 200 with whatever `db.getSessionHistory(TAG)` returns; 500 `{ error: e.message }` on throw. UNDETERMINED: `db.getSessionHistory`'s exact return shape — the `db` module's implementation was not read in this pass.
**Side effects:** None observed at the route level (read-only call into `db`), though `db.getSessionHistory` internals were not traced — UNDETERMINED whether it performs any writes (e.g. lazily creating a history record).
**Identity:** Ambient. `TAG` is a single global bound at process startup; this route has no way to answer for any site other than the one the current Studio process instance is running for. Quote: `db.getSessionHistory(TAG)` where `TAG` is defined once near the top of server.js as the process's site tag, not read from `req`.
**Risks:** In a single-process-per-site model (which is how this legacy Studio runs — one Node process per site, per the "Studio Process Management" launchd convention referenced in project docs) this ambient binding is actually safe in practice, but it is the exact pattern ("rely on ambient/global state") the new system forbids by design, since the new system does not assume one process per site.
**Verdict reasoning:** Per instruction, prefer RETIRE for anything depending on ambient/global site state — this route's entire identity model is the global `TAG`, which the new explicit-identity system rejects; the underlying "session history" concept can be redesigned later against an explicit site parameter if wanted, but this route as written does not survive.

## GET /api/sessions
**Source:** server.js:2350
**Kind:** route
**Verdict:** RETIRE
**Purpose:** Lists the ambient site's recorded chat sessions (index, id, start/end times, message count) with a short text preview pulled from a matching summary file.
**Inputs:** No params. Reads `STUDIO_FILE()` (ambient — a function of process/closure state, not request) for `studio.sessions`, then for each session checks `SUMMARIES_DIR()/session-<id>.md` (also ambient) for a preview.
**Outputs:** 200 with a plain array of session summary objects (not wrapped in an envelope). Malformed/missing `STUDIO_FILE()` is swallowed (`catch { studio = {} }`) and silently returns `[]`-shaped output rather than an error.
**Side effects:** None observed — read-only (file reads only).
**Identity:** Ambient — `STUDIO_FILE()` and `SUMMARIES_DIR()` resolve against whatever site the process currently considers current; no site parameter is accepted or used.
**Risks:** Same ambient-state pattern as /api/session-history; error-swallowing means a broken/corrupt studio file looks identical to "no sessions yet" to any caller.
**Verdict reasoning:** Ambient global site state disqualifies this from KEEP-CONVERT/ADAPT per the explicit rule; RETIRE, with the underlying "list sessions with preview" idea available to reconsider later against an explicit site id.

## POST /api/sessions/load
**Source:** server.js:2378
**Kind:** route
**Verdict:** RETIRE
**Purpose:** Loads the full conversation transcript for one of the ambient site's past sessions, selected by index, filtering the conversation log by that session's time range (or `session_id` when messages carry one).
**Inputs:** Body: `session_index` (required, must be a valid index into `studio.sessions`). Reads `STUDIO_FILE()` and `CONVO_FILE()` — both ambient.
**Outputs:** 400 `invalid session_index` or `session has no start time`; else 200 `{ session, messages }` (or `[]` if no `CONVO_FILE()` exists).
**Side effects:** None observed — read-only (file reads, JSON-line parsing).
**Identity:** Ambient — same `STUDIO_FILE()`/`CONVO_FILE()` global-resolution pattern as the two routes above; `session_index` selects within the ambient site's session list, there is no site parameter at all.
**Risks:** The timestamp-range fallback (`m.at >= startTime && m.at <= endTime`) when messages lack a `session_id` could pull in messages from an adjacent session if timestamps are close/ambiguous, but this is a minor correctness note relative to the identity issue. Individual `JSON.parse` failures per line are silently dropped (`catch { return null }` then filtered), which is reasonable defensive parsing but means malformed log lines vanish without any signal.
**Verdict reasoning:** Same ambient-global-state disqualification as the other session routes in this file — RETIRE. The "load one session's transcript" behavior worth remembering conceptually, but the code depends entirely on process-global site state the new system does not have.

## GET /api/shay-shay/session-init
**Source:** server.js:6881
**Kind:** route
**Verdict:** RETIRE
**Purpose:** Initializes (or reads) a Shay conversation session: mints or reads per-surface (`lite`/`desk`) session cookies, reports Shay availability/developer-mode/reasoning-authority metadata, and reports the ambient "active site."
**Inputs:** No body/params required. Reads existing `_shaySessionCookieName('lite'|'desk')` cookies via `_parseCookies(req)`; mints new UUIDs via `crypto.randomUUID()` when absent.
**Outputs:** 200 `{ ok: true, generated_at, shay: { status, action }, reasoning: { capability: 'shay', authority: 'shay' }, distinct_capabilities: ['media','deploy'], active_site: TAG, active_page: currentPage, developer_mode, developer_audit, conversation_ids: { lite, desk } }`. 500 `{ error: e.message }` on throw.
**Side effects:** Sets two `Set-Cookie` headers (session cookies for lite/desk surfaces) via `_setShaySessionCookie`. Calls `shayProvider.isAvailable()` (likely a network/process check — UNDETERMINED, `shayProvider`'s implementation was not read in this pass). Logs session mint/hit events to stderr (`console.error('[session-diag] ...')`).
**Identity:** Ambient. `active_site: TAG` is the same module-level global used throughout this file — this route reports whichever site the current process instance is bound to, with no way to ask about a different site. Quote: `active_site: TAG,` where `TAG` is the process-global site tag.
**Risks:** The conversation-id cookies are per-surface but not per-site — in a model where multiple sites could share a browser session, a lite/desk conversation id minted while working on one site could be reused against another site's Shay session-init call if cookies aren't cleared, though this is somewhat mitigated by the fact this legacy system runs one process per site. `shayProvider.isAvailable()` internals UNDETERMINED.
**Risks (continued):** Given the "Route Site Studio reasoning through Shay" / "Enforce single Studio reasoning authority" work referenced in recent commit history, this route is part of an active reasoning-authority boundary; retiring it changes how the new system needs to bootstrap a Shay conversation, which is worth flagging even though the auth ceremony itself is out of scope for the new system.
**Verdict reasoning:** Ambient `TAG`-bound `active_site` disqualifies it under the "prefer RETIRE for ambient global state" rule; the conversation-cookie-minting behavior is a separate concern from the auth ceremony but is still bound to the same global site model, so it does not survive as written either.

## GET /api/cost/session
**Source:** server.js:11435
**Kind:** route
**Verdict:** RETIRE
**Purpose:** Already permanently disabled in the legacy code — always returns HTTP 410 Gone.
**Inputs:** None consulted; the handler ignores `req` entirely.
**Outputs:** `res.status(410).json({ error: 'reasoning cost telemetry is owned by Shay', code: 'shay_owned' })` — unconditional, every call.
**Side effects:** None — no logic executes beyond the fixed response.
**Identity:** N/A — the route performs no site-scoped or ambient-state work; it is dead weight.
**Risks:** None. It is already inert.
**Verdict reasoning:** The route is a hard-disabled stub in the legacy code itself (per its own neighboring comment: "reasoning cost telemetry is owned by Shay" — same pattern as `/api/agent/stats` and `/api/telemetry/sdk-cost-summary` immediately adjacent in server.js, lines ~11419-11436). There is no behavior to salvage; RETIRE is definitional here, not judgment-based.
