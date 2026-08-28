## use /api/intelligence/actions
**Source:** server/__smoke__/operator-action-repro.js:38
**Kind:** route
**Verdict:** RETIRE
**Purpose:** Smoke-test harness that mounts the intelligence actions router in a temporary Express app.
**Inputs:** none via HTTP; test script drives POSTs to `/api/intelligence/actions/runs/start`.
**Outputs:** none via HTTP.
**Side effects:** Creates a temp directory, seeds a fake run ledger, starts an HTTP server, runs three smoke cases, then deletes the temp directory.
**Identity:** Test harness binds `SITE_DIR` and `SITES_ROOT` at module scope: `createActionsRouter(() => SITE_DIR, SITES_ROOT)`.
**Risks:** Not a production route; any preserved behavior belongs in the new test suite, not the runtime.
**Verdict reasoning:** This is a test script, not a production route registration. Retire it; the new system should exercise the actions router through its own test harness.

## use /api/intelligence
**Source:** server/__smoke__/operator-fast-server.js:34
**Kind:** route
**Verdict:** RETIRE
**Purpose:** Fast smoke server that mounts the read-only intelligence router for local Operator Workspace testing.
**Inputs:** env `SITE_TAG`, `STUDIO_PORT`; serves static `public/` and `/api/intelligence/*`.
**Outputs:** Serves `/api/intelligence/*` read endpoints and `/api/intelligence/actions/*` writes.
**Side effects:** Starts an HTTP server on `127.0.0.1:STUDIO_PORT`.
**Identity:** Resolves site dir from `process.env.SITE_TAG || 'site-mbsh-reunion'`; ambient env default.
**Risks:** Test-only surface; not production.
**Verdict reasoning:** Test harness, not production route. Retire; new system tests through dedicated test fixtures.

## use /api/intelligence/actions
**Source:** server/__smoke__/operator-fast-server.js:37
**Kind:** route
**Verdict:** RETIRE
**Purpose:** Fast smoke server mount for the intelligence actions router.
**Inputs:** none at mount.
**Outputs:** none at mount.
**Side effects:** Registers the actions router under `/api/intelligence/actions`.
**Identity:** Bound to `() => path.join(SITES_ROOT, TAG)`; ambient TAG closure.
**Risks:** Test-only surface.
**Verdict reasoning:** Test harness mount. Retire along with the fast server.

## get /
**Source:** server/component-routes.js:79
**Kind:** route
**Verdict:** ADAPT
**Purpose:** Returns the global component library inventory.
**Inputs:** none.
**Outputs:** `{ components: inventory.listInventory() }`.
**Side effects:** none observed.
**Identity:** Reads from `hubRoot` closure (`deps.hubRoot || path.resolve(__dirname, '..')`); no explicit site id.
**Risks:** Coupled to legacy `components/library.json` shape; global hubRoot.
**Verdict reasoning:** Component inventory is still useful, but the router must receive explicit hub/site context instead of a closure. ADAPT.

## get /check
**Source:** server/component-routes.js:83
**Kind:** route
**Verdict:** ADAPT
**Purpose:** Checks whether a component id exists in the inventory.
**Inputs:** `?id=`.
**Outputs:** `{ exists, near }`.
**Side effects:** none observed.
**Identity:** Uses `inventory` module; no explicit site id.
**Risks:** Same global-inventory coupling.
**Verdict reasoning:** ADAPT with explicit hub context and reconcile inventory schema.

## get /contract
**Source:** server/component-routes.js:89
**Kind:** route
**Verdict:** ADAPT
**Purpose:** Returns the surgical component insertion contract constant.
**Inputs:** none.
**Outputs:** `{ contract: inventory.SURGICAL_INSERTION_CONTRACT }`.
**Side effects:** none.
**Identity:** none.
**Risks:** Contract shape may change in the new component model.
**Verdict reasoning:** ADAPT; contract shape must be reconciled with the new component system.

## get /:id
**Source:** server/component-routes.js:93
**Kind:** route
**Verdict:** ADAPT
**Purpose:** Reads a single component's `component.json` metadata file.
**Inputs:** path `id`.
**Outputs:** component JSON or 404/500.
**Side effects:** reads `<hubRoot>/components/<id>/component.json`.
**Identity:** Uses `hubRoot` closure.
**Risks:** Path traversal is protected by the file existence check and id usage, but it relies on hubRoot closure.
**Verdict reasoning:** ADAPT with explicit hub root; path logic is reusable.

## get /insertions
**Source:** server/component-routes.js:323
**Kind:** route
**Verdict:** KEEP-CONVERT
**Purpose:** Lists component insertion history for an explicitly named site tag.
**Inputs:** `?tag=`.
**Outputs:** `{ insertions }`.
**Side effects:** reads `sites/<tag>/_test/insertion-history.jsonl`.
**Identity:** Explicit `?tag=` with safe-tag regex validation.
**Risks:** Reads site file; path traversal protected.
**Verdict reasoning:** Already requires explicit tag and is read-only. KEEP-CONVERT.

## get /content-fields/:page
**Source:** server/content-field-routes.js:60
**Kind:** route
**Verdict:** KEEP-CONVERT
**Purpose:** Returns editable content fields for a page in an explicitly named site.
**Inputs:** path `page`; explicit `siteTag` from `req.ctx` via `siteTagOr400(req, res)`.
**Outputs:** `{ page, fields, total }`.
**Side effects:** reads spec for the named site.
**Identity:** Explicit via `siteTagOr400`; comments explicitly forbid ambient fallback.
**Risks:** `isValidPageName` guards page names; otherwise low risk.
**Verdict reasoning:** V1 explicit-tag route with no ambient fallback. KEEP-CONVERT.

## get /api/inspector/fields
**Source:** server/inspector-routes.js:137
**Kind:** route
**Verdict:** KEEP-CONVERT
**Purpose:** Returns selectable editable fields on a page for the resolved site.
**Inputs:** `?page=`; site resolved via `resolveSite(req, res)`.
**Outputs:** `{ site_tag, page, fields }`.
**Side effects:** reads page HTML from the resolved site's live root.
**Identity:** UNDETERMINED: `resolveSite` is not defined in the read portion; assume V1 explicit context but verify contract.
**Risks:** Coupling to `resolveSite` behavior; if it allows ambient fallback this becomes a RETIRE candidate.
**Verdict reasoning:** V1 inspector route; likely explicit site resolution. KEEP-CONVERT once `resolveSite` contract is confirmed.

## get /sites
**Source:** server/intelligence-routes.js:42
**Kind:** route
**Verdict:** KEEP-CONVERT
**Purpose:** Lists all sites under the sites root.
**Inputs:** none.
**Outputs:** `{ sites: reader.listSites(sitesRoot) }` or `{ sites: [] }` if no root.
**Side effects:** reads sites root directory.
**Identity:** Uses `sitesRoot` closure; hub-scoped.
**Risks:** Low.
**Verdict reasoning:** Read-only site listing. KEEP-CONVERT.

## get /brief
**Source:** server/intelligence-routes.js:47
**Kind:** route
**Verdict:** RETIRE
**Purpose:** Reads the intelligence brief for the resolved site.
**Inputs:** `?tag=` optional; falls back to `resolveSiteDir(req)`.
**Outputs:** brief JSON or 404.
**Side effects:** reads site intelligence brief file.
**Identity:** `siteDirFor(req)` returns `resolveSiteDir(req)` when `?tag` is absent — ambient fallback quoted.
**Risks:** Ambient site resolution; no explicit site required.
**Verdict reasoning:** Relies on ambient site resolution when `?tag` is absent. The new system forbids ambient state, so RETIRE in favor of an explicit-tag successor.

## get /capability-truth
**Source:** server/intelligence-routes.js:53
**Kind:** route
**Verdict:** RETIRE
**Purpose:** Reads the capability-truth file for the resolved site.
**Inputs:** `?tag=` optional; falls back to `resolveSiteDir(req)`.
**Outputs:** truth JSON or 404.
**Side effects:** reads site capability-truth file.
**Identity:** Ambient fallback: `return resolveSiteDir(req);`.
**Risks:** Ambient site resolution.
**Verdict reasoning:** Same ambient fallback as `/brief`. RETIRE.

## get /runs
**Source:** server/intelligence-routes.js:59
**Kind:** route
**Verdict:** RETIRE
**Purpose:** Lists intelligence runs for the resolved site.
**Inputs:** `?tag=` optional; falls back to `resolveSiteDir(req)`.
**Outputs:** `{ runs }`.
**Side effects:** reads site intelligence runs directory.
**Identity:** Ambient fallback: `return resolveSiteDir(req);`.
**Risks:** Ambient site resolution.
**Verdict reasoning:** Ambient fallback. RETIRE in favor of explicit-tag route.

## get /runs/:runId
**Source:** server/intelligence-routes.js:63
**Kind:** route
**Verdict:** RETIRE
**Purpose:** Reads a single run ledger, proof packet, and learning candidates for the resolved site.
**Inputs:** path `runId`; `?tag=` optional.
**Outputs:** `{ ledger, proof, learning_candidates }`.
**Side effects:** reads run files under the resolved site.
**Identity:** Ambient fallback: `return resolveSiteDir(req);`.
**Risks:** Ambient site resolution; "proof" here is an internal intelligence proof packet, not the FAMtastic Designs protected revenue pipeline.
**Verdict reasoning:** Ambient fallback. RETIRE; replace with explicit-tag route.

## get /contract
**Source:** server/media-routes.js:16
**Kind:** route
**Verdict:** ADAPT
**Purpose:** Returns the media registry asset shape contract.
**Inputs:** none.
**Outputs:** `{ contract, asset_shape }`.
**Side effects:** none.
**Identity:** none.
**Risks:** Contract shape may change.
**Verdict reasoning:** ADAPT; reconcile asset contract with new media model.

## get /
**Source:** server/media-routes.js:34
**Kind:** route
**Verdict:** RETIRE
**Purpose:** Returns the media asset registry for a site.
**Inputs:** `?tag=` optional; falls back to `resolveSiteDir()`.
**Outputs:** `{ registry, summary }`.
**Side effects:** reads `sites/<tag>/media-registry.json`.
**Identity:** `else if (typeof resolveSiteDir === 'function') { siteDir = resolveSiteDir(); }` — ambient fallback.
**Risks:** Ambient site resolution.
**Verdict reasoning:** Ambient fallback when tag absent. RETIRE in favor of explicit-tag route.

## get /briefs
**Source:** server/research-routes.js:104
**Kind:** route
**Verdict:** KEEP-CONVERT
**Purpose:** Lists markdown research briefs in the hub repo.
**Inputs:** none.
**Outputs:** `{ briefs: [...] }`.
**Side effects:** reads `<repoRoot>/research/briefs/`.
**Identity:** Uses `repoRoot` closure (hub root).
**Risks:** Hub-root scoped, not site-scoped.
**Verdict reasoning:** Read-only hub resource list. KEEP-CONVERT with explicit hub root.

## get /brief/:id
**Source:** server/research-routes.js:134
**Kind:** route
**Verdict:** KEEP-CONVERT
**Purpose:** Returns a single research brief's content and summary.
**Inputs:** path `id`.
**Outputs:** `{ id, filename, title, summary, body_first_500 }`.
**Side effects:** reads brief file under hub root.
**Identity:** Uses `repoRoot` closure.
**Risks:** Path traversal protected by containment check and SAFE_ID regex.
**Verdict reasoning:** Read-only and path-safe. KEEP-CONVERT.

## get /api/build-status/:tag
**Source:** server/runtime-status-routes.js:16
**Kind:** route
**Verdict:** KEEP-CONVERT
**Purpose:** Returns build state and dist page count for an explicit site tag.
**Inputs:** path `tag`.
**Outputs:** `{ tag, state, building, pages_built, pages, has_brief, fam_score, deployed_url }`.
**Side effects:** reads spec and dist dir for the tag.
**Identity:** Explicit `:tag` with safe-tag regex validation.
**Risks:** Reads site files; path traversal protected.
**Verdict reasoning:** Explicit tag, read-only. KEEP-CONVERT.

## get /api/verify
**Source:** server/runtime-status-routes.js:47
**Kind:** route
**Verdict:** RETIRE
**Purpose:** Returns the last build verification result for the active site.
**Inputs:** none.
**Outputs:** `spec.last_verification` or null.
**Side effects:** reads ambient spec via `readSpec()`.
**Identity:** `readSpec()` uses the global active site (TAG).
**Risks:** Ambient site state.
**Verdict reasoning:** Uses ambient `readSpec()` without explicit tag. RETIRE; the V1 successor in `verification-routes.js` already requires explicit tag.

## get /api/site-studio/preview-url
**Source:** server/runtime-vnext-build-route.js:164
**Kind:** route
**Verdict:** KEEP-CONVERT
**Purpose:** Returns the dist-vnext preview URL for an explicitly named site.
**Inputs:** explicit `siteTag` via `siteTagOr400(req, res)`.
**Outputs:** `{ site_tag, url }`.
**Side effects:** none.
**Identity:** Explicit via `siteTagOr400`.
**Risks:** Low.
**Verdict reasoning:** V1 explicit-tag route. KEEP-CONVERT.

## get /api/site-studio/build-vnext/status
**Source:** server/runtime-vnext-build-route.js:176
**Kind:** route
**Verdict:** KEEP-CONVERT
**Purpose:** Returns runtime-vnext build run status from the database.
**Inputs:** `?run_id=`.
**Outputs:** run status JSON.
**Side effects:** reads `vnextDb`.
**Identity:** Run-id scoped, not site-ambient.
**Risks:** Low.
**Verdict reasoning:** Read-only run lookup. KEEP-CONVERT.

## get /
**Source:** server/site-settings-routes.js:35
**Kind:** route
**Verdict:** KEEP-CONVERT
**Purpose:** Reads per-site settings overrides for an explicit tag.
**Inputs:** `?tag=`.
**Outputs:** `site-settings.json` or an empty skeleton.
**Side effects:** reads file.
**Identity:** Explicit `?tag=` with `isSafeTag` validation.
**Risks:** Path traversal protected.
**Verdict reasoning:** Explicit tag, read-only. KEEP-CONVERT.

## get /api/spec
**Source:** server/studio-state-routes.js:40
**Kind:** route
**Verdict:** RETIRE
**Purpose:** Returns the full `spec.json` for the active site.
**Inputs:** none.
**Outputs:** spec JSON or error object.
**Side effects:** reads ambient spec.
**Identity:** `readSpec()` uses active site global state.
**Risks:** Ambient state; may expose full spec.
**Verdict reasoning:** Relies on ambient `readSpec()`. RETIRE in favor of an explicit-tag spec endpoint.

## get /api/site-info
**Source:** server/studio-state-routes.js:49
**Kind:** route
**Verdict:** RETIRE
**Purpose:** Returns the active site's spec wrapped in `{ spec }`.
**Inputs:** none.
**Outputs:** `{ spec }`.
**Side effects:** reads ambient spec.
**Identity:** `readSpec()` ambient.
**Risks:** Ambient state.
**Verdict reasoning:** Ambient active-site read. RETIRE.

## get /api/pages
**Source:** server/studio-state-routes.js:54
**Kind:** route
**Verdict:** RETIRE
**Purpose:** Returns the page list and current page for the active site.
**Inputs:** none.
**Outputs:** `{ pages, currentPage }`.
**Side effects:** reads ambient `listPages()` and `getCurrentPage()`.
**Identity:** ambient.
**Risks:** Ambient state.
**Verdict reasoning:** Active-site page state. RETIRE; replace with explicit-tag endpoint.

## get /api/studio-state
**Source:** server/studio-state-routes.js:70
**Kind:** route
**Verdict:** RETIRE
**Purpose:** Returns a composite studio state object including tag, files, brief, decisions, and spec.
**Inputs:** none.
**Outputs:** large state JSON.
**Side effects:** reads ambient spec, state file, dist dir.
**Identity:** `getTag()`, `getSiteDir()`, `getDistDir()` closures all resolve active site.
**Risks:** Ambient state; heavy aggregation.
**Verdict reasoning:** Heavily ambient composite endpoint. RETIRE; split into explicit-tag endpoints.

## get /captures
**Source:** server/think-tank-routes.js:88
**Kind:** route
**Verdict:** KEEP-CONVERT
**Purpose:** Lists think-tank capture files in the hub repo inbox.
**Inputs:** none.
**Outputs:** `{ captures }`.
**Side effects:** reads `<repoRoot>/captures/inbox/`.
**Identity:** Uses `repoRoot` closure (hub root).
**Risks:** Hub-root scoped.
**Verdict reasoning:** Read-only hub resource list. KEEP-CONVERT with explicit hub root.

## get /contract
**Source:** server/think-tank-routes.js:131
**Kind:** route
**Verdict:** ADAPT
**Purpose:** Returns the think-tank capture contract schema.
**Inputs:** none.
**Outputs:** `{ contract: { capture_shape, promotion_targets } }`.
**Side effects:** none.
**Identity:** none.
**Risks:** Contract shape may change.
**Verdict reasoning:** ADAPT; reconcile capture contract with new think-tank model.

## get /verify
**Source:** server/verification-routes.js:46
**Kind:** route
**Verdict:** KEEP-CONVERT
**Purpose:** Returns `spec.last_verification` for an explicit site.
**Inputs:** explicit `siteTag` via `siteTagOr400(req, res)`.
**Outputs:** `spec.last_verification` or null.
**Side effects:** reads spec for the named site.
**Identity:** Explicit via `siteTagOr400`.
**Risks:** Low.
**Verdict reasoning:** V1 explicit-tag route. KEEP-CONVERT.

## get /contract
**Source:** server/visual-refinement-routes.js:27
**Kind:** route
**Verdict:** ADAPT
**Purpose:** Returns the visual refinement tweak contract.
**Inputs:** none.
**Outputs:** refinement contract JSON.
**Side effects:** none.
**Identity:** none.
**Risks:** Contract shape may change.
**Verdict reasoning:** ADAPT; reconcile refinement contract with new token/tweak model.

## get /working-copies
**Source:** server/visual-refinement-routes.js:44
**Kind:** route
**Verdict:** RETIRE
**Purpose:** Lists visual refinement working-copy directories for a site.
**Inputs:** `?tag=` optional; falls back to `resolveSiteDir(req)`.
**Outputs:** `{ ok, working_copies }`.
**Side effects:** reads `<siteDir>/.refinement/`.
**Identity:** `else { siteDir = resolveSiteDir(req); }` — ambient fallback.
**Risks:** Ambient fallback.
**Verdict reasoning:** Allows ambient site resolution. RETIRE in favor of explicit-tag route.

## get /read
**Source:** lib/bridge-routes.js:79
**Kind:** route
**Verdict:** ADAPT
**Purpose:** Reads a file relative to the FAMtastic home directory.
**Inputs:** `?path=` relative path.
**Outputs:** `{ content, path }` or 400/403/404.
**Side effects:** reads file.
**Identity:** Hub-scoped (`~/famtastic`).
**Risks:** Path traversal if `resolveSafe` has bugs; broad read access across the hub.
**Verdict reasoning:** Useful internal read bridge. ADAPT with explicit root scope and audit.

## get /jobs
**Source:** lib/ops-api.js:152
**Kind:** route
**Verdict:** KEEP-CONVERT
**Purpose:** Returns jobs grouped into UI lanes from the ops ledger.
**Inputs:** none.
**Outputs:** `{ lanes, lane_counts, stale_debt }`.
**Side effects:** reads `jobs/jobs.jsonl` and inventory snapshot under hub root.
**Identity:** Hub-scoped, not site-specific.
**Risks:** Reads hub-level ops files.
**Verdict reasoning:** Read-only ops workspace data. KEEP-CONVERT.

## get /runs
**Source:** lib/ops-api.js:189
**Kind:** route
**Verdict:** KEEP-CONVERT
**Purpose:** Returns ops runs from `runs/runs.jsonl`.
**Inputs:** none.
**Outputs:** `{ envelope }` containing runs.
**Side effects:** reads runs ledger.
**Identity:** Hub-scoped.
**Risks:** Low.
**Verdict reasoning:** Read-only ops data. KEEP-CONVERT.

## get /tasks
**Source:** lib/ops-api.js:194
**Kind:** route
**Verdict:** KEEP-CONVERT
**Purpose:** Returns ops tasks from `tasks/tasks.jsonl`.
**Inputs:** none.
**Outputs:** tasks array.
**Side effects:** reads tasks ledger.
**Identity:** Hub-scoped.
**Risks:** Low.
**Verdict reasoning:** Read-only ops data. KEEP-CONVERT.

## get /plans
**Source:** lib/ops-api.js:199
**Kind:** route
**Verdict:** KEEP-CONVERT
**Purpose:** Returns plans from the hub plans registry.
**Inputs:** none.
**Outputs:** plans array.
**Side effects:** reads `plans/registry.json`.
**Identity:** Hub-scoped.
**Risks:** Low.
**Verdict reasoning:** Read-only ops data. KEEP-CONVERT.

## get /gaps
**Source:** lib/ops-api.js:217
**Kind:** route
**Verdict:** KEEP-CONVERT
**Purpose:** Returns ops gaps from `docs/ops/gaps.jsonl`.
**Inputs:** none.
**Outputs:** gaps array.
**Side effects:** reads gaps ledger.
**Identity:** Hub-scoped.
**Risks:** Low.
**Verdict reasoning:** Read-only ops data. KEEP-CONVERT.

## get /memory
**Source:** lib/ops-api.js:222
**Kind:** route
**Verdict:** KEEP-CONVERT
**Purpose:** Stub endpoint that counts memory markdown files in the hub memory directory.
**Inputs:** none.
**Outputs:** `{ envelope }` with memory file entries.
**Side effects:** reads `memory/` directory and `.wolf/cerebrum.md`.
**Identity:** Hub-scoped.
**Risks:** Low; full memory recall is deferred to a later module.
**Verdict reasoning:** Read-only stub. KEEP-CONVERT.

## get /debt
**Source:** lib/ops-api.js:239
**Kind:** route
**Verdict:** KEEP-CONVERT
**Purpose:** Returns the technical-debt inventory snapshot.
**Inputs:** none.
**Outputs:** inventory snapshot.
**Side effects:** reads inventory snapshot file.
**Identity:** Hub-scoped.
**Risks:** Depends on inventory snapshot being generated.
**Verdict reasoning:** Read-only ops data. KEEP-CONVERT.

## get /needsMe
**Source:** lib/ops-api.js:247
**Kind:** route
**Verdict:** KEEP-CONVERT
**Purpose:** Returns open reviews and tasks waiting on the user.
**Inputs:** none.
**Outputs:** `{ reviews, tasks, count }`.
**Side effects:** reads `reviews/reviews.jsonl` and `tasks/tasks.jsonl`.
**Identity:** Hub-scoped.
**Risks:** Low.
**Verdict reasoning:** Read-only ops workspace data. KEEP-CONVERT.

## get /
**Source:** server.js:1136
**Kind:** route
**Verdict:** KEEP-CONVERT
**Purpose:** Exchanges a bootstrap nonce for an authenticated session cookie.
**Inputs:** `?bootstrap=`.
**Outputs:** 302 redirect with `Set-Cookie` or fallback redirect.
**Side effects:** redeems nonce, creates session, sets cookie.
**Identity:** none (global auth).
**Risks:** Auth-critical; nonce must be single-use and failures must be indistinguishable from no nonce.
**Verdict reasoning:** Core bootstrap auth mechanism. KEEP-CONVERT.

## use /api
**Source:** server.js:1188
**Kind:** route
**Verdict:** KEEP-CONVERT
**Purpose:** Rejects `/api` requests from non-loopback origins as defense in depth.
**Inputs:** request connection remote address.
**Outputs:** 403 if off-host.
**Side effects:** none.
**Identity:** none.
**Risks:** Misconfiguration could block legitimate callers or allow LAN access.
**Verdict reasoning:** Security boundary. KEEP-CONVERT.

## use /api
**Source:** server.js:1345
**Kind:** route
**Verdict:** KEEP-CONVERT
**Purpose:** Requires authentication for all `/api` routes mounted below it.
**Inputs:** session cookie or bearer token.
**Outputs:** 401 if unauthenticated.
**Side effects:** sets `req.auth`.
**Identity:** none.
**Risks:** Auth gate; must remain before privileged routes.
**Verdict reasoning:** Core auth enforcement. KEEP-CONVERT.

## use /api
**Source:** server.js:1349
**Kind:** route
**Verdict:** KEEP-CONVERT
**Purpose:** Requires elevated privilege for dangerous `/api` mutations listed in `PRIVILEGED_API_ROUTES`.
**Inputs:** `req.auth`, `req.method`, `req.path`.
**Outputs:** 403 if privileged route without elevation.
**Side effects:** none.
**Identity:** none.
**Risks:** Privilege escalation if route list is incomplete or misordered.
**Verdict reasoning:** Core privilege boundary. KEEP-CONVERT.

## use /api
**Source:** server.js:1391
**Kind:** route
**Verdict:** KEEP-CONVERT
**Purpose:** Wires the V1 explicit-tag verification router under `/api`.
**Inputs:** none at mount.
**Outputs:** none at mount.
**Side effects:** registers `createVerificationRouter`.
**Identity:** Router uses explicit `siteTag` via `siteTagOr400`.
**Risks:** Route ordering; must be mounted before parameterized routes.
**Verdict reasoning:** V1 explicit-tag router. KEEP-CONVERT.

## use /api
**Source:** server.js:1408
**Kind:** route
**Verdict:** KEEP-CONVERT
**Purpose:** Wires the V1 explicit-tag content-field router under `/api`.
**Inputs:** none at mount.
**Outputs:** none at mount.
**Side effects:** registers `createContentFieldRouter`.
**Identity:** Router uses explicit `siteTag` via `siteTagOr400`.
**Risks:** Route ordering.
**Verdict reasoning:** V1 explicit-tag router. KEEP-CONVERT.

## use /api/bridge
**Source:** server.js:1429
**Kind:** route
**Verdict:** ADAPT
**Purpose:** Wires the file read/write bridge under `/api/bridge`.
**Inputs:** none at mount.
**Outputs:** none at mount.
**Side effects:** registers bridge router.
**Identity:** Hub-scoped.
**Risks:** Broad file-system bridge.
**Verdict reasoning:** Useful internal bridge, but scope and auth need review. ADAPT.

## use /api/ops
**Source:** server.js:1434
**Kind:** route
**Verdict:** KEEP-CONVERT
**Purpose:** Wires the Ops Workspace API under `/api/ops`.
**Inputs:** none at mount.
**Outputs:** none at mount.
**Side effects:** registers ops router.
**Identity:** Hub-scoped.
**Risks:** Route ordering.
**Verdict reasoning:** Read-only ops workspace surface. KEEP-CONVERT.

## use /api/intelligence
**Source:** server.js:1438
**Kind:** route
**Verdict:** RETIRE
**Purpose:** Wires the intelligence router using an ambient site closure.
**Inputs:** none at mount.
**Outputs:** none at mount.
**Side effects:** registers router bound to ambient TAG.
**Identity:** `createIntelligenceRouter(() => SITE_DIR(), SITES_ROOT)` — ambient.
**Risks:** Ambient site state.
**Verdict reasoning:** Mount uses ambient `SITE_DIR()` closure. RETIRE; replace with explicit-tag router.

## use /api/intelligence/actions
**Source:** server.js:1443
**Kind:** route
**Verdict:** RETIRE
**Purpose:** Wires the intelligence actions router using an ambient site closure.
**Inputs:** none at mount.
**Outputs:** none at mount.
**Side effects:** registers router bound to ambient TAG.
**Identity:** `createActionsRouter(() => SITE_DIR(), SITES_ROOT)` — ambient.
**Risks:** Ambient site state; actions include run start/stop mutations.
**Verdict reasoning:** Ambient `SITE_DIR()` closure. RETIRE; replace with explicit-tag router.

## use /api/components
**Source:** server.js:1444
**Kind:** route
**Verdict:** RETIRE
**Purpose:** Wires the component router bound to active site/dist/spec closures.
**Inputs:** none at mount.
**Outputs:** none at mount.
**Side effects:** registers router.
**Identity:** `getDistDir: () => DIST_DIR(), getTag: () => TAG, readSpec, writeSpec` — ambient.
**Risks:** Ambient `readSpec`/`writeSpec` can mutate active site spec on import/export.
**Verdict reasoning:** Bound to ambient site/dist/spec. RETIRE; component routes need explicit site context.

## use /api/media
**Source:** server.js:1454
**Kind:** route
**Verdict:** RETIRE
**Purpose:** Wires the media router using an ambient site closure.
**Inputs:** none at mount.
**Outputs:** none at mount.
**Side effects:** registers router bound to ambient TAG.
**Identity:** `createMediaRouter(() => SITE_DIR(), SITES_ROOT)` — ambient.
**Risks:** Ambient site state.
**Verdict reasoning:** Ambient `SITE_DIR()` closure. RETIRE; replace with explicit-tag router.

## use /api/refinement
**Source:** server.js:1455
**Kind:** route
**Verdict:** RETIRE
**Purpose:** Wires the visual refinement router using an ambient site closure.
**Inputs:** none at mount.
**Outputs:** none at mount.
**Side effects:** registers router bound to ambient TAG.
**Identity:** `createRefinementRouter(() => SITE_DIR(), SITES_ROOT)` — ambient.
**Risks:** Ambient site state.
**Verdict reasoning:** Ambient `SITE_DIR()` closure. RETIRE; replace with explicit-tag router.

## use /api/research
**Source:** server.js:1456
**Kind:** route
**Verdict:** KEEP-CONVERT
**Purpose:** Wires the hub-scoped research brief router under `/api/research`.
**Inputs:** none at mount.
**Outputs:** none at mount.
**Side effects:** registers `createResearchRouter(HUB_ROOT)`.
**Identity:** Hub-scoped.
**Risks:** Route ordering.
**Verdict reasoning:** Hub-scoped read-only router. KEEP-CONVERT.

## use /api/think-tank
**Source:** server.js:1457
**Kind:** route
**Verdict:** KEEP-CONVERT
**Purpose:** Wires the hub-scoped think-tank router under `/api/think-tank`.
**Inputs:** none at mount.
**Outputs:** none at mount.
**Side effects:** registers `createThinkTankRouter(HUB_ROOT)`.
**Identity:** Hub-scoped.
**Risks:** Route ordering.
**Verdict reasoning:** Hub-scoped read-only router. KEEP-CONVERT.

## use /api/site-settings
**Source:** server.js:1458
**Kind:** route
**Verdict:** KEEP-CONVERT
**Purpose:** Wires the per-site settings router with the sites root.
**Inputs:** none at mount.
**Outputs:** none at mount.
**Side effects:** registers `createSiteSettingsRouter(SITES_ROOT)`.
**Identity:** Sites-root scoped; individual routes require explicit `?tag=`.
**Risks:** Route ordering.
**Verdict reasoning:** Router enforces explicit tag per route. KEEP-CONVERT.

## get /api/logs/tail
**Source:** server.js:1483
**Kind:** route
**Verdict:** KEEP-CONVERT
**Purpose:** Returns recent log lines for the Studio process.
**Inputs:** `?n=`, `?level=`.
**Outputs:** `{ count, lines }`.
**Side effects:** reads in-memory logger buffer.
**Identity:** Process-global.
**Risks:** May leak sensitive log entries.
**Verdict reasoning:** Read-only diagnostic endpoint. KEEP-CONVERT.

## get /api/history
**Source:** server.js:1533
**Kind:** route
**Verdict:** RETIRE
**Purpose:** Returns conversation history for the active site.
**Inputs:** none.
**Outputs:** array of messages.
**Side effects:** reads `CONVO_FILE()` which is ambient.
**Identity:** `CONVO_FILE()` resolves against active TAG.
**Risks:** Ambient state.
**Verdict reasoning:** Reads active-site conversation log. RETIRE; replace with explicit-tag endpoint.

## get /api/assets
**Source:** server.js:1543
**Kind:** route
**Verdict:** RETIRE
**Purpose:** Lists image assets in the active site's `dist/assets`.
**Inputs:** none.
**Outputs:** array of asset metadata.
**Side effects:** reads `DIST_DIR()` ambient.
**Identity:** ambient.
**Risks:** Ambient state.
**Verdict reasoning:** Reads active site dist. RETIRE; replace with explicit-tag endpoint.

## use /site-assets
**Source:** server.js:1557
**Kind:** route
**Verdict:** RETIRE
**Purpose:** Statically serves assets from the active site dist.
**Inputs:** path.
**Outputs:** file.
**Side effects:** reads `DIST_DIR()`.
**Identity:** ambient.
**Risks:** Ambient state.
**Verdict reasoning:** Active-site static mount. RETIRE; new preview server serves per-site assets explicitly.

## get /api/config
**Source:** server.js:1560
**Kind:** route
**Verdict:** RETIRE
**Purpose:** Returns runtime config including active tag and ports.
**Inputs:** none.
**Outputs:** `{ tag, previewPort, studioPort, sitesRoot }`.
**Side effects:** none.
**Identity:** ambient TAG.
**Risks:** Exposes active tag; ambient.
**Verdict reasoning:** Returns ambient TAG. RETIRE; clients should receive config from explicit context.

## get /api/health
**Source:** server.js:1567
**Kind:** route
**Verdict:** KEEP-CONVERT
**Purpose:** Public readiness probe.
**Inputs:** none.
**Outputs:** `{ status, uptime, timestamp }`.
**Side effects:** none.
**Identity:** none.
**Risks:** none.
**Verdict reasoning:** Standard health probe. KEEP-CONVERT.

## get /api/portfolio-stats
**Source:** server.js:1606
**Kind:** route
**Verdict:** KEEP-CONVERT
**Purpose:** Returns portfolio-level statistics.
**Inputs:** none.
**Outputs:** stats JSON.
**Side effects:** reads db.
**Identity:** Hub-scoped.
**Risks:** Depends on db schema.
**Verdict reasoning:** Read-only hub-level metric. KEEP-CONVERT.

## get /api/server-info
**Source:** server.js:1611
**Kind:** route
**Verdict:** RETIRE
**Purpose:** Returns server runtime metadata.
**Inputs:** none.
**Outputs:** server info JSON.
**Side effects:** reads files, ambient state.
**Identity:** ambient TAG, currentPage, etc.
**Risks:** Ambient state; may expose internal paths.
**Verdict reasoning:** Heavily ambient. RETIRE; split into explicit health/config endpoints.

## get /api/templates
**Source:** server.js:1649
**Kind:** route
**Verdict:** KEEP-CONVERT
**Purpose:** Lists available site templates in the hub config.
**Inputs:** none.
**Outputs:** array of template names.
**Side effects:** reads `<HUB_ROOT>/config/site-templates/`.
**Identity:** Hub-scoped.
**Risks:** Low.
**Verdict reasoning:** Hub-scoped read-only list. KEEP-CONVERT.

## get /api/uploads
**Source:** server.js:1848
**Kind:** route
**Verdict:** RETIRE
**Purpose:** Returns uploaded assets metadata for the active site.
**Inputs:** none.
**Outputs:** array of assets.
**Side effects:** reads ambient spec and uploads dir.
**Identity:** ambient.
**Risks:** Ambient state.
**Verdict reasoning:** Active-site uploads list. RETIRE; explicit-tag replacement.

## get /api/cdn-injections
**Source:** server.js:2127
**Kind:** route
**Verdict:** RETIRE
**Purpose:** Returns CDN injection records for the active site.
**Inputs:** none.
**Outputs:** array of injection records.
**Side effects:** reads ambient spec.
**Identity:** ambient.
**Risks:** Ambient state.
**Verdict reasoning:** Active-site CDN state. RETIRE; explicit-tag replacement.

## get /api/character-branding
**Source:** server.js:2173
**Kind:** route
**Verdict:** RETIRE
**Purpose:** Returns character branding placements for the active site.
**Inputs:** none.
**Outputs:** placements and summary JSON.
**Side effects:** reads ambient spec.
**Identity:** ambient.
**Risks:** Ambient state.
**Verdict reasoning:** Active-site character state. RETIRE; explicit-tag replacement.

## use /assets/uploads
**Source:** server.js:2225
**Kind:** route
**Verdict:** RETIRE
**Purpose:** Statically serves uploaded files from the active site uploads directory.
**Inputs:** path.
**Outputs:** file.
**Side effects:** reads `UPLOADS_DIR()` ambient.
**Identity:** ambient.
**Risks:** Ambient state.
**Verdict reasoning:** Active-site static upload mount. RETIRE; per-site preview server should serve these.

## get /api/versions
**Source:** server.js:2236
**Kind:** route
**Verdict:** RETIRE
**Purpose:** Returns page version history for the active site.
**Inputs:** `?page=`.
**Outputs:** versions array.
**Side effects:** reads `VERSIONS_DIR()` ambient.
**Identity:** ambient.
**Risks:** Ambient state.
**Verdict reasoning:** Active-site versions. RETIRE; explicit-tag replacement.

## get /api/versions/:page/:timestamp
**Source:** server.js:2242
**Kind:** route
**Verdict:** RETIRE
**Purpose:** Returns the content of a specific page version for the active site.
**Inputs:** path `page`, `timestamp`.
**Outputs:** version metadata and content.
**Side effects:** reads version file from `VERSIONS_DIR()`.
**Identity:** ambient.
**Risks:** Ambient state.
**Verdict reasoning:** Active-site version read. RETIRE; explicit-tag replacement.

## get /api/brand-health
**Source:** server.js:2982
**Kind:** route
**Verdict:** RETIRE
**Purpose:** Returns brand health scan including orphaned slot mappings for the active site.
**Inputs:** none.
**Outputs:** brand health JSON.
**Side effects:** reads ambient spec and dist pages.
**Identity:** ambient.
**Risks:** Ambient state.
**Verdict reasoning:** Active-site brand health. RETIRE; explicit-tag replacement.

## get /slot-preview/:page
**Source:** server.js:3281
**Kind:** route
**Verdict:** RETIRE
**Purpose:** Serves a page with interactive slot overlays for the active site.
**Inputs:** path `page`.
**Outputs:** HTML with injected slot inspector and selection bridge scripts.
**Side effects:** reads dist page; mutates HTML in memory only.
**Identity:** ambient.
**Risks:** Ambient state; script injection into rendered HTML.
**Verdict reasoning:** Active-site preview overlay. RETIRE; explicit-tag preview path.

## get /api/projects
**Source:** server.js:5289
**Kind:** route
**Verdict:** KEEP-CONVERT
**Purpose:** Returns a list of all sites under sites root.
**Inputs:** none.
**Outputs:** projects array.
**Side effects:** reads each site's `spec.json`.
**Identity:** `SITES_ROOT` hub-scoped.
**Risks:** Reads all sites; may be slow with many sites.
**Verdict reasoning:** Hub-scoped site listing. KEEP-CONVERT.

## get /api/sites
**Source:** server.js:5348
**Kind:** route
**Verdict:** KEEP-CONVERT
**Purpose:** Returns a list of all sites under sites root (sidebar variant).
**Inputs:** none.
**Outputs:** `{ sites }` array.
**Side effects:** reads each site's `spec.json` and `spec.json` mtime.
**Identity:** `SITES_ROOT` hub-scoped.
**Risks:** Reads all sites.
**Verdict reasoning:** Hub-scoped site listing. KEEP-CONVERT.

## get /api/interview/status
**Source:** server.js:5662
**Kind:** route
**Verdict:** RETIRE
**Purpose:** Returns client interview state for the active site.
**Inputs:** none.
**Outputs:** interview status JSON.
**Side effects:** reads ambient spec.
**Identity:** ambient.
**Risks:** Ambient state.
**Verdict reasoning:** Active-site interview state. RETIRE; explicit-tag replacement.

## get /api/interview/health
**Source:** server.js:5684
**Kind:** route
**Verdict:** RETIRE
**Purpose:** Returns whether the UI should prompt to start an interview for the active site.
**Inputs:** none.
**Outputs:** `{ auto_interview_enabled, should_prompt, reason }`.
**Side effects:** reads ambient spec and settings.
**Identity:** ambient.
**Risks:** Ambient state.
**Verdict reasoning:** Active-site interview policy. RETIRE; explicit-tag replacement.

## get /api/stock-search
**Source:** server.js:5908
**Kind:** route
**Verdict:** KEEP-CONVERT
**Purpose:** Searches Unsplash and/or Pexels for stock photos.
**Inputs:** `?query=`, `?width=`, `?height=`, `?provider=`, `?limit=`.
**Outputs:** `{ results, query, provider }`.
**Side effects:** external HTTPS calls to Unsplash/Pexels.
**Identity:** none (provider keys from global settings).
**Risks:** External API calls; API key exposure in settings.
**Verdict reasoning:** Read-only external search. KEEP-CONVERT.

## get /api/summaries
**Source:** server.js:6271
**Kind:** route
**Verdict:** RETIRE
**Purpose:** Returns recent session summaries.
**Inputs:** none.
**Outputs:** summaries array.
**Side effects:** reads session summaries file for active site.
**Identity:** ambient active site.
**Risks:** Ambient state.
**Verdict reasoning:** Reads active-site session summaries. RETIRE; explicit-tag replacement.

## get /api/blueprint
**Source:** server.js:6625
**Kind:** route
**Verdict:** RETIRE
**Purpose:** Returns the site blueprint.
**Inputs:** none.
**Outputs:** blueprint JSON.
**Side effects:** reads blueprint for active site.
**Identity:** ambient.
**Risks:** Ambient state.
**Verdict reasoning:** Active-site blueprint read. RETIRE; explicit-tag replacement.

## get /api/build-metrics
**Source:** server.js:6680
**Kind:** route
**Verdict:** RETIRE
**Purpose:** Returns build metrics for the active site.
**Inputs:** none.
**Outputs:** metrics array.
**Side effects:** reads `<SITE_DIR()>/build-metrics.jsonl`.
**Identity:** ambient.
**Risks:** Ambient state.
**Verdict reasoning:** Active-site build metrics. RETIRE; explicit-tag replacement.

## get /api/brain-status
**Source:** server.js:6783
**Kind:** route
**Verdict:** KEEP-CONVERT
**Purpose:** Returns Shay provider availability.
**Inputs:** none.
**Outputs:** `{ shay: { status, action }, timestamp }`.
**Side effects:** calls `shayProvider.isAvailable()`.
**Identity:** none.
**Risks:** External provider check.
**Verdict reasoning:** Read-only provider status. KEEP-CONVERT.

## get /api/capability-manifest
**Source:** server.js:6795
**Kind:** route
**Verdict:** KEEP-CONVERT
**Purpose:** Returns live capability manifest.
**Inputs:** none.
**Outputs:** manifest JSON.
**Side effects:** calls `buildCapabilityManifest()`.
**Identity:** Hub-scoped.
**Risks:** Depends on capability checks.
**Verdict reasoning:** Read-only capability status. KEEP-CONVERT.

## get /api/studio-capabilities
**Source:** server.js:6804
**Kind:** route
**Verdict:** KEEP-CONVERT
**Purpose:** Alias for `/api/capability-manifest`.
**Inputs:** none.
**Outputs:** manifest JSON.
**Side effects:** calls `buildCapabilityManifest()`.
**Identity:** Hub-scoped.
**Risks:** Duplicate surface.
**Verdict reasoning:** Read-only capability status alias. KEEP-CONVERT; consider deduplicating.

## get /api/research
**Source:** server.js:10144
**Kind:** route
**Verdict:** RETIRE
**Purpose:** Lists markdown research files in the active site's research dir.
**Inputs:** none.
**Outputs:** `{ files }`.
**Side effects:** reads `SITE_DIR()/research`.
**Identity:** ambient.
**Risks:** Ambient state.
**Verdict reasoning:** Active-site research listing. RETIRE; explicit-tag replacement.

## get /api/research/verticals
**Source:** server.js:10177
**Kind:** route
**Verdict:** RETIRE
**Purpose:** Lists known verticals and researched verticals for the active site.
**Inputs:** none.
**Outputs:** `{ known_verticals, researched_verticals }`.
**Side effects:** reads `SITE_DIR()/research`.
**Identity:** ambient.
**Risks:** Ambient state.
**Verdict reasoning:** Active-site vertical listing. RETIRE; explicit-tag replacement.

## get /api/research/sources
**Source:** server.js:10209
**Kind:** route
**Verdict:** KEEP-CONVERT
**Purpose:** Returns available research source capabilities.
**Inputs:** none.
**Outputs:** `{ capabilities }`.
**Side effects:** none.
**Identity:** none.
**Risks:** Static config.
**Verdict reasoning:** Read-only capability advertisement. KEEP-CONVERT.

## get /api/research/effectiveness
**Source:** server.js:10213
**Kind:** route
**Verdict:** RETIRE
**Purpose:** Returns 410 — reasoning telemetry is owned by Shay.
**Inputs:** none.
**Outputs:** `{ error, code }`.
**Side effects:** none.
**Identity:** none.
**Risks:** Already retired surface.
**Verdict reasoning:** Already a 410 tombstone. RETIRE; no conversion needed.

## get /api/research/feed
**Source:** server.js:10240
**Kind:** route
**Verdict:** KEEP-CONVERT
**Purpose:** Returns the hub-level research feed index.
**Inputs:** `?vertical=`, `?limit=`.
**Outputs:** `{ findings, count }`.
**Side effects:** reads research feed index.
**Identity:** Hub-scoped.
**Risks:** Low.
**Verdict reasoning:** Hub-scoped read-only feed. KEEP-CONVERT.

## get /api/research/seed-status
**Source:** server.js:10318
**Kind:** route
**Verdict:** RETIRE
**Purpose:** Returns research seed status for the active site.
**Inputs:** none.
**Outputs:** `{ seeded, unseeded, pinecone_available }`.
**Side effects:** reads `SITE_DIR()/research`.
**Identity:** ambient.
**Risks:** Ambient state.
**Verdict reasoning:** Active-site seed status. RETIRE; explicit-tag replacement.

## get /api/research/threshold-analysis
**Source:** server.js:10347
**Kind:** route
**Verdict:** KEEP-CONVERT
**Purpose:** Returns research cache threshold analysis from a hub-level log.
**Inputs:** none.
**Outputs:** threshold analysis JSON.
**Side effects:** reads `<HUB_ROOT>/.local/research-calls.jsonl`.
**Identity:** Hub-scoped.
**Risks:** Low.
**Verdict reasoning:** Hub-scoped analytics. KEEP-CONVERT.

## get /api/worker-queue
**Source:** server.js:10405
**Kind:** route
**Verdict:** KEEP-CONVERT
**Purpose:** Returns pending worker tasks from the SQLite job store.
**Inputs:** none.
**Outputs:** queue summary and task list.
**Side effects:** reads SQLite jobs via `db.listJobs()`.
**Identity:** Hub-scoped.
**Risks:** Low.
**Verdict reasoning:** Hub-scoped read-only job queue. KEEP-CONVERT.

## get /api/memory
**Source:** server.js:10468
**Kind:** route
**Verdict:** ADAPT
**Purpose:** Returns memory rows filtered by entity/type/category.
**Inputs:** `?entity_type=`, `?entity_id=`, `?category=`, `?limit=`.
**Outputs:** `{ memories, count }`.
**Side effects:** reads memory db.
**Identity:** No explicit site id; `entity_id` may encode site.
**Risks:** Could leak memories across sites without a site filter.
**Verdict reasoning:** No site-scoped filter visible. ADAPT to require explicit `site_tag` filter.

## get /api/jobs
**Source:** server.js:10500
**Kind:** route
**Verdict:** KEEP-CONVERT
**Purpose:** Lists jobs with optional status/site/limit filters.
**Inputs:** `?status=`, `?site_tag=`, `?limit=`.
**Outputs:** `{ jobs, count, retired_reasoning_count }`.
**Side effects:** reads SQLite jobs.
**Identity:** Optional explicit `?site_tag=` filter.
**Risks:** Low.
**Verdict reasoning:** Already supports explicit `site_tag` filter. KEEP-CONVERT.

## get /api/research/:filename
**Source:** server.js:10533
**Kind:** route
**Verdict:** RETIRE
**Purpose:** Reads a research markdown file for the active site.
**Inputs:** path `filename`.
**Outputs:** `{ name, content }`.
**Side effects:** reads `SITE_DIR()/research/<filename>`.
**Identity:** ambient.
**Risks:** Ambient state.
**Verdict reasoning:** Active-site research read. RETIRE; explicit-tag replacement.

## get /api/image-suggestions
**Source:** server.js:10562
**Kind:** route
**Verdict:** RETIRE
**Purpose:** Returns stock-image query suggestions derived from the active site brief.
**Inputs:** none.
**Outputs:** `{ suggestions, business_name, industry }`.
**Side effects:** reads ambient spec.
**Identity:** ambient.
**Risks:** Ambient state.
**Verdict reasoning:** Reads active-site brief. RETIRE; explicit-tag replacement.

## get /api/context
**Source:** server.js:11112
**Kind:** route
**Verdict:** ADAPT
**Purpose:** Returns generated studio context markdown.
**Inputs:** none.
**Outputs:** `{ exists, content, active_site, generated_at }`.
**Side effects:** reads hub context file.
**Identity:** Reads hub file but response includes `active_site: TAG` ambient.
**Risks:** Response includes ambient active site.
**Verdict reasoning:** Hub-scoped context file; response includes ambient TAG. ADAPT to take explicit site context.

## all /api/brain
**Source:** server.js:11134
**Kind:** route
**Verdict:** RETIRE
**Purpose:** Returns 410 — routing is managed by Shay.
**Inputs:** none.
**Outputs:** `{ error }`.
**Side effects:** none.
**Identity:** none.
**Risks:** Already retired surface.
**Verdict reasoning:** 410 tombstone. RETIRE.

## get /api/intel/report
**Source:** server.js:11139
**Kind:** route
**Verdict:** RETIRE
**Purpose:** Returns generated intelligence report for the active site.
**Inputs:** none.
**Outputs:** report JSON.
**Side effects:** generates/reads report.
**Identity:** ambient.
**Risks:** Ambient state.
**Verdict reasoning:** Active-site intelligence report. RETIRE; explicit-tag replacement.

## get /api/intel/findings
**Source:** server.js:11150
**Kind:** route
**Verdict:** RETIRE
**Purpose:** Returns filtered intelligence findings for a site.
**Inputs:** `?tag=` optional; defaults to `TAG`.
**Outputs:** findings JSON.
**Side effects:** reads/generates report, dismissed findings.
**Identity:** `const siteTag = req.query.tag || TAG;` — ambient fallback.
**Risks:** Ambient fallback.
**Verdict reasoning:** Defaults to ambient TAG. RETIRE; require explicit tag.

## all /api/codex/exec
**Source:** server.js:11344
**Kind:** route
**Verdict:** RETIRE
**Purpose:** Returns 410 — direct reasoning execution is retired.
**Inputs:** none.
**Outputs:** `{ error, code }`.
**Side effects:** none.
**Identity:** none.
**Risks:** Already retired surface.
**Verdict reasoning:** 410 tombstone. RETIRE.

## get /api/metrics/summary
**Source:** server.js:11382
**Kind:** route
**Verdict:** RETIRE
**Purpose:** Returns build metrics summary for the active site.
**Inputs:** none.
**Outputs:** metrics summary JSON.
**Side effects:** reads `<SITE_DIR()>/build-metrics.jsonl`.
**Identity:** ambient.
**Risks:** Ambient state.
**Verdict reasoning:** Active-site metrics. RETIRE; explicit-tag replacement.

## all /api/compare/generate
**Source:** server.js:11414
**Kind:** route
**Verdict:** RETIRE
**Purpose:** Returns 410 — provider comparison is retired.
**Inputs:** none.
**Outputs:** `{ error, code }`.
**Side effects:** none.
**Identity:** none.
**Risks:** Already retired surface.
**Verdict reasoning:** 410 tombstone. RETIRE.

## get /api/agent/stats
**Source:** server.js:11421
**Kind:** route
**Verdict:** RETIRE
**Purpose:** Returns 410 — reasoning telemetry is owned by Shay.
**Inputs:** none.
**Outputs:** `{ error, code }`.
**Side effects:** none.
**Identity:** none.
**Risks:** Already retired surface.
**Verdict reasoning:** 410 tombstone. RETIRE.

## get /api/agent/routing
**Source:** server.js:11427
**Kind:** route
**Verdict:** KEEP-CONVERT
**Purpose:** Returns capability routing/authority mapping.
**Inputs:** none.
**Outputs:** `{ reasoning, distinct_capabilities, deterministic_intents }`.
**Side effects:** none.
**Identity:** none.
**Risks:** Static config.
**Verdict reasoning:** Read-only routing contract. KEEP-CONVERT.

## get /api/telemetry/sdk-cost-summary
**Source:** server.js:11439
**Kind:** route
**Verdict:** RETIRE
**Purpose:** Returns 410 — reasoning call telemetry is owned by Shay.
**Inputs:** none.
**Outputs:** `{ error, code }`.
**Side effects:** none.
**Identity:** none.
**Risks:** Already retired surface.
**Verdict reasoning:** 410 tombstone. RETIRE.

## get /api/trace
**Source:** server.js:11444
**Kind:** route
**Verdict:** RETIRE
**Purpose:** Returns trace events for active site or run.
**Inputs:** `?runId=`, `?limit=`.
**Outputs:** trace events.
**Side effects:** reads trace store.
**Identity:** `queryTraceEvents({ siteTag: TAG, ... })` ambient.
**Risks:** Ambient state.
**Verdict reasoning:** Active-site trace. RETIRE; explicit-tag replacement.

## get /api/trace/run/:runId
**Source:** server.js:11450
**Kind:** route
**Verdict:** RETIRE
**Purpose:** Returns run trace for active site.
**Inputs:** path `runId`.
**Outputs:** run trace events.
**Side effects:** reads trace store.
**Identity:** `getRunTrace(TAG, runId, HUB_ROOT)` ambient.
**Risks:** Ambient state.
**Verdict reasoning:** Active-site run trace. RETIRE; explicit-tag replacement.

## get /api/workflow/stage-catalog
**Source:** server.js:11456
**Kind:** route
**Verdict:** KEEP-CONVERT
**Purpose:** Returns the workflow stage catalog JSON.
**Inputs:** none.
**Outputs:** catalog JSON.
**Side effects:** reads `<site-studio>/lib/workflow-stage-catalog.json`.
**Identity:** Hub-scoped.
**Risks:** Low.
**Verdict reasoning:** Read-only hub catalog. KEEP-CONVERT.

## get /api/agent/performance
**Source:** server.js:11467
**Kind:** route
**Verdict:** RETIRE
**Purpose:** Returns 410 — reasoning telemetry is owned by Shay.
**Inputs:** none.
**Outputs:** `{ error, code }`.
**Side effects:** none.
**Identity:** none.
**Risks:** Already retired surface.
**Verdict reasoning:** 410 tombstone. RETIRE.

## get /api/agent/scorecard
**Source:** server.js:11471
**Kind:** route
**Verdict:** RETIRE
**Purpose:** Returns 410 — reasoning telemetry is owned by Shay.
**Inputs:** none.
**Outputs:** `{ error, code }`.
**Side effects:** none.
**Identity:** none.
**Risks:** Already retired surface.
**Verdict reasoning:** 410 tombstone. RETIRE.

## get /api/fulfillment
**Source:** server.js:11476
**Kind:** route
**Verdict:** RETIRE
**Purpose:** Returns fulfillment ledger for active site or run.
**Inputs:** `?runId=`.
**Outputs:** `{ site_tag, ledger }`.
**Side effects:** reads ledger.
**Identity:** `readLedger(TAG, HUB_ROOT, runId || null)` ambient.
**Risks:** Ambient state.
**Verdict reasoning:** Active-site fulfillment ledger. RETIRE; explicit-tag replacement.

## all /api/compare/generate-v2
**Source:** server.js:11483
**Kind:** route
**Verdict:** RETIRE
**Purpose:** Returns 410 — provider comparison is retired.
**Inputs:** none.
**Outputs:** `{ error, code }`.
**Side effects:** none.
**Identity:** none.
**Risks:** Already retired surface.
**Verdict reasoning:** 410 tombstone. RETIRE.

## all /api/compare/adopt
**Source:** server.js:11487
**Kind:** route
**Verdict:** RETIRE
**Purpose:** Returns 410 — provider comparison is retired.
**Inputs:** none.
**Outputs:** `{ error, code }`.
**Side effects:** none.
**Identity:** none.
**Risks:** Already retired surface.
**Verdict reasoning:** 410 tombstone. RETIRE.

## get /api/video/jobs
**Source:** server.js:11807
**Kind:** route
**Verdict:** RETIRE
**Purpose:** Returns video generation jobs for the active site.
**Inputs:** none.
**Outputs:** `{ jobs }`.
**Side effects:** reads video jobs file for active site.
**Identity:** ambient.
**Risks:** Ambient state.
**Verdict reasoning:** Active-site video jobs. RETIRE; explicit-tag replacement.

## get /api/video/promo/:tag/download
**Source:** server.js:12250
**Kind:** route
**Verdict:** KEEP-CONVERT
**Purpose:** Serves the generated promo MP4 for an explicit site tag as a download.
**Inputs:** path `tag`.
**Outputs:** `video/mp4` file with `Content-Disposition: attachment`.
**Side effects:** reads `<siteDir>/assets/video/promo.mp4`.
**Identity:** Explicit `:tag`; sanitized via `getCharacterSiteDir(siteTag)`.
**Risks:** Path traversal protected by tag sanitization.
**Verdict reasoning:** Explicit tag, read-only file serve. KEEP-CONVERT.

## get /api/media/usage
**Source:** server.js:12361
**Kind:** route
**Verdict:** KEEP-CONVERT
**Purpose:** Returns media usage/telemetry, optionally filtered by provider and site.
**Inputs:** `?provider=`, `?site=`.
**Outputs:** usage JSON.
**Side effects:** reads telemetry store.
**Identity:** Optional explicit `?site=` with tag validation.
**Risks:** Site tag validated.
**Verdict reasoning:** Supports explicit site filter. KEEP-CONVERT.

## get /api/media/usage/:provider
**Source:** server.js:12374
**Kind:** route
**Verdict:** KEEP-CONVERT
**Purpose:** Returns media usage for a provider across the default scope.
**Inputs:** path `provider`.
**Outputs:** usage JSON.
**Side effects:** reads telemetry.
**Identity:** none.
**Risks:** Cross-site aggregation possible; no site filter on this path.
**Verdict reasoning:** Read-only media telemetry. KEEP-CONVERT; consider adding a site filter.

## get /api/validation-plan
**Source:** server.js:12383
**Kind:** route
**Verdict:** ADAPT
**Purpose:** Returns the studio UI validation plan.
**Inputs:** none.
**Outputs:** validation plan JSON.
**Side effects:** reads `<site-studio>/validation-plan.json`.
**Identity:** Overrides plan title with ambient `TAG`: `plan.title = \`Studio UI Validation — ${TAG}\``.
**Risks:** Ambient title override.
**Verdict reasoning:** Hub-level validation artifact; title uses ambient TAG. ADAPT to explicit site context.

## get /api/revenue-card
**Source:** server.js:12511
**Kind:** route
**Verdict:** ARCHIVE-FOR-FUTURE
**Purpose:** Returns client billing/revenue card data (monthly rate, PayPal link, client name, deployed URL).
**Inputs:** none.
**Outputs:** revenue card JSON.
**Side effects:** reads ambient spec.
**Identity:** ambient `readSpec()`.
**Risks:** Protected revenue scope; ambient state; exposes client billing info.
**Verdict reasoning:** Reads active-site revenue data. Protected revenue scope; archive for future explicit-tag redesign, never retire.

## get /api/settings
**Source:** server.js:12544
**Kind:** route
**Verdict:** KEEP-CONVERT
**Purpose:** Returns operator settings with secret values removed.
**Inputs:** none.
**Outputs:** settings JSON.
**Side effects:** reads settings file.
**Identity:** Hub-scoped (operator settings).
**Risks:** Exposes which secrets are configured; settings include API key placeholders.
**Verdict reasoning:** Read-only settings projection. KEEP-CONVERT.
