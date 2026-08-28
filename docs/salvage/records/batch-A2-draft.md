## POST /import
**Source:** server/component-routes.js:103
**Kind:** route
**Verdict:** RETIRE
**Purpose:** Imports a component JSON payload into the global component library, writing `component.json`/`.html`/`.css`/`.js` files under `hubRoot/components/<id>` and updating `hubRoot/components/library.json`.
**Inputs:** body: `component` (or the body itself) object with `component_id`/`id`, `html_template`/`html`, `css`, `js`, `content_fields`, `slots`, `dependencies`, etc. No site/tag param at all.
**Outputs:** `component.json`, `<id>.html`, optional `.css`/`.js` files written to `hubRoot/components/<component_id>`; `library.json` rewritten; JSON `{ success, component }`.
**Side effects:** Writes to shared hub filesystem (`hubRoot/components/...`), calls `syncSkillFromComponent(component)` (unexamined — could have further side effects). No site scoping of any kind.
**Identity:** No site id at all — components are stored in a global `hubRoot`, not per-site. This is not "ambient site state" in the strict sense (there's no site resolution to leak) but it is a global mutable store with zero tenant/site boundary, which is exactly the shape the new system forbids for anything site-scoped. `const hubRoot = deps.hubRoot || path.resolve(__dirname, '..');`
**Risks:** No auth/validation beyond field shape; `syncSkillFromComponent` side effect unverified; global library.json is a single point of contention across all sites/operators; no journaling/undo.
**Verdict reasoning:** Global, unscoped component library management with no site identity and no proof/journal trail — built on the legacy "one shared hub of everything" premise the rebuild is moving away from. RETIRE and let component storage be re-designed with explicit ownership.

## POST /export
**Source:** server/component-routes.js:149
**Kind:** route
**Verdict:** RETIRE
**Purpose:** Extracts a `<section>` from a built dist page's HTML (by `data-section-id` or first `<section>`), turns it into a reusable component definition, and writes it to the global component library, also updating the current site's spec.
**Inputs:** body: `page`, `section_id`, `component_id`. Site is NOT a body param — resolved via `getTag()`. Reads `getDistDir()/<page>` HTML and `getDistDir()/assets/styles.css`.
**Outputs:** Writes `component.json`/`.html` to `hubRoot/components/<component_id>`, rewrites `library.json`, writes back into `readSpec()/writeSpec()` for the current site's `content[page].sections`, emits `STUDIO_EVENTS.COMPONENT_INSERTED`. Responds `{ success, component, field_count, slot_count }`.
**Side effects:** Filesystem writes to the global component hub and to the current site's spec; emits a studio event.
**Identity:** Ambient — resolves the "current" site via `const tag = getTag();` rather than taking a site id in the request body. Every write (spec update, `created_from: tag`, `used_in` list) depends on whichever site happens to be globally selected at call time.
**Risks:** A component "export" attributed to the wrong site if the ambient selection changes between request and handling (race); global `library.json` is a single shared resource across all sites — concurrent exports can clobber `used_in`/version bumps; no journal entry, only a `console.log`.
**Verdict reasoning:** Textbook ambient-site-state route (`getTag()` instead of an explicit site param) plus the same global unscoped component-hub premise as `/import`. RETIRE — the new system forbids resolving a global site id like this.

## POST /insert
**Source:** server/component-routes.js:289
**Kind:** route
**Verdict:** ADAPT
**Purpose:** Validates a `{tag, component_id, slot, page}` request, confirms the component exists in the inventory, and performs a staged, journaled insertion of that component into a specific site's page/slot via `inventory.stagedInsert`.
**Inputs:** body: `tag`, `component_id`, `slot`, `page` — all validated against strict regexes (`SAFE_TAG_LOOSE_RE`, `SAFE_COMPONENT_ID_RE`, `SAFE_SLOT_PAGE_RE`) with explicit `..` rejection.
**Outputs:** `{ ok: true, written, history_path: "<tag>/_test/insertion-history.jsonl", history_entry }` on success; validation/lookup errors as 400/500.
**Side effects:** Calls `inventory.stagedInsert({ sitesRoot, tag, componentId, slot, page })`, which writes into the site's own tree and appends to a per-site `_test/insertion-history.jsonl` journal — a real journal, not just a log line.
**Identity:** Explicit — `tag` is a required, validated body param used directly for `sitesRoot`/site targeting; no ambient fallback. This is the shape the new system wants.
**Risks:** Still reads from the same global `hubRoot/components` inventory populated by `/import` (a RETIRE'd route), so the inventory backing this route needs its own resolution; `inventory.checkExisting`/`stagedInsert` internals not traced here — UNDETERMINED: whether `stagedInsert` itself leaks ambient state or is fully parameterized by the `sitesRoot`/`tag` passed in.
**Verdict reasoning:** The contract (explicit site id, input validation, staged+journaled write) is exactly right and worth carrying forward, but it depends on the global, unscoped component inventory from the RETIRE'd `/import` route, so the backing store needs a rewrite. ADAPT — take the contract and journaling pattern, rebuild the inventory dependency underneath it.

## POST /content-field
**Source:** server/content-field-routes.js:72
**Kind:** route
**Verdict:** KEEP-CONVERT
**Purpose:** Surgically edits a single content field's text in a site's dist-vnext HTML for a given page, cascades the same value to other pages sharing global field types (phone/email/address/hours), and writes the change back to the site spec.
**Inputs:** body: `page`, `field_id`, `new_value`; explicit `siteTag` resolved via `siteTagOr400(req, res)` (400 `site_tag_required` if missing — no ambient fallback). Reads `getDistVnextDir(siteTag)/<page>` HTML and `readSpec(siteTag)`.
**Outputs:** Atomic-written HTML for the edited page and any cascade pages (`writeFileAtomic` = temp file + rename); `writeSpec(spec, {siteTag, source:'content_field_api', ...})`; emits `STUDIO_EVENTS.EDIT_APPLIED` with `tag: siteTag`; responds `{ success, field_id, old_value, new_value, cascade_pages }`.
**Side effects:** Multiple file writes (main page + cascade pages), spec write, studio event emission. Path containment check (`pagePath.startsWith(distVnextRoot + path.sep)`) guards traversal. Returns 409 `no_vnext_build` if the site has no dist-vnext build rather than silently falling back to legacy dist.
**Identity:** Fully explicit — the file header states this route was specifically rewritten to require an explicit `siteTag` (400 otherwise), replacing "legacy zero-tag ambient behavior." Comment: "Explicit site authority — V1 never reads the ambient operator site."
**Risks:** Regex-based cascade field matching (`entry.field_id.includes(field.type)`) is fuzzy and could mismatch fields across pages; oldValue detection via HTML string replace as a fallback if `data-field-id` isn't found could over-replace duplicate text; UNDETERMINED whether `writeSpec`'s atomicity is truly all-or-nothing across the multi-file cascade (a crash mid-cascade could leave some pages updated and others not, with only one spec write).
**Verdict reasoning:** This route is explicitly documented as the already-corrected version of the ambient anti-pattern the new system forbids — explicit site id, atomic writes, honest 409 for missing build state, real event emission. KEEP-CONVERT: port with mechanical changes only.

## POST /api/inspector/field-edit
**Source:** server/inspector-routes.js:54
**Kind:** route
**Verdict:** KEEP-CONVERT
**Purpose:** The inspector's single typed write path — edits one field's text on a page via a deterministic patcher, committed through a mutation transaction with revision-conflict and lock handling, producing one undo-able operation and zero model/provider calls.
**Inputs:** body: `siteTag`, `page`, `fieldId`, `value`, optional `expectedRevision`. `siteTag` resolved by `resolveSite()` from body (writes) or query (reads) or `req.ctx.siteTag`, then validated via `requireSiteAuthority(tag, 'inspector')` — 400 if missing or invalid.
**Outputs:** JSON `{ ok, site_tag, page, field_id, before, after, operation_id, document_revision, artifact_count, structure_generation, provider_calls: 0, elapsed_ms }` on success; typed error codes (`EREVISION`→409, `ELOCKED`→423, `ENOOP`→200) on failure.
**Side effects:** Calls `patchFieldText` (pure transform) then `mutationTx.executeStaged(...)` which stages and commits the file write plus optional post-processing (`runPostProcessing`); real journal integration via `journal.currentStructureGeneration(site.siteId)`.
**Identity:** Fully explicit — `resolveSite()` requires a named `siteTag` and explicitly rejects ambient selection: `res.status(400).json({ error: 'site_required', message: 'Explicit siteTag is required; the current selection is not authority.' })`.
**Risks:** None observed in the traced path — this file's own doc comment specifically calls out its design guarantee (no provider calls, single undo slot, ENOOP not treated as an error). UNDETERMINED: internals of `patchFieldText`, `mutationTx.executeStaged`, and `requireSiteAuthority` weren't opened — those modules should get their own capability records if not already covered elsewhere in the census.
**Verdict reasoning:** This is a model implementation of the exact contract the new system wants: explicit site authority, typed errors, staged+journaled mutation, honest zero-provider-calls assertion. KEEP-CONVERT with mechanical porting only.

## POST /runs/start
**Source:** server/intelligence-actions.js:108
**Kind:** route
**Verdict:** ADAPT
**Purpose:** Starts a new intelligence "run" ledger for a site (an Action Layer operation), given a `run_id`, optional `intent`, `recipe_id`, `brief`.
**Inputs:** body: `run_id` (validated `reader.isSafeId`), `intent`, `recipe_id`, `brief`; site resolved via `resolveSiteDirFromReq(req, resolveSiteDir, sitesRoot)`, which reads `req.query.tag` if present (validated `reader.isSafeTag`) or otherwise falls back to `resolveSiteDir()` — an injected ambient-default resolver.
**Outputs:** `writer.startRun(siteDir, {...})` → `{ ledger }` (201) or mapped error (409 already_exists, 400 invalid_run_id, etc).
**Side effects:** Delegates all persistence to `intelligence-writer.js` (described in file header as atomic); no direct fs calls in this handler.
**Identity:** Conditionally explicit — if `req.query.tag` is supplied it is validated and used directly (`path.join(sitesRoot, tag)`); if omitted, the route silently falls back to whatever `resolveSiteDir()` (an ambient default passed in at router-construction time) returns. So this route CAN be explicit but is not required to be — the ambient path is still live and is the default behavior when callers omit `tag`.
**Risks:** Callers that forget the `?tag=` query param get routed to an ambient/default site without any error — silent wrong-site risk, especially dangerous for a mutating "start run" call. UNDETERMINED: what `resolveSiteDir()` actually resolves to in production (session state? single-tenant default? last-selected site?) — not traced here, would need `server.js`'s wiring of `createActionsRouter(resolveSiteDir, sitesRoot)`.
**Verdict reasoning:** The ledger/writer contract (validated ids, atomic writer, typed error mapping) is worth keeping, but the shared `resolveSiteDirFromReq` helper's silent ambient fallback is exactly the pattern the new system forbids. ADAPT — keep the writer contract, rebuild site resolution to require an explicit id with no fallback.

## POST /runs/:runId/passes
**Source:** server/intelligence-actions.js:129
**Kind:** route
**Verdict:** ADAPT
**Purpose:** Appends a labeled pass/check result (`label`, `ok`, `notes`) to an existing run's ledger.
**Inputs:** path param `runId` (validated `reader.isSafeId` + traversal guard via `withRunIdGuard`); body `label` (required, trimmed), `ok`, `notes`; site via the same `siteDirOr()` → `resolveSiteDirFromReq` helper (query `tag` or ambient fallback).
**Outputs:** `writer.appendLedgerPass(siteDir, runId, {...})` → `{ ledger }` (200) or mapped writer error.
**Side effects:** Delegates to `intelligence-writer.js`'s atomic ledger append; no direct fs writes in the handler.
**Identity:** Same conditional-ambient pattern as `/runs/start` — explicit only if `?tag=` is passed, otherwise silently falls back to the injected default site resolver.
**Risks:** Same silent-wrong-site risk as `/runs/start`; a pass recorded against the wrong site's ledger would corrupt that site's proof trail without any error surfaced.
**Verdict reasoning:** Ledger-append contract and traversal/id guards are sound and reusable; the shared ambient-fallback site resolution is the defect. ADAPT — keep the writer/ledger idea, rebuild identity binding to require an explicit tag.

## POST /runs/:runId/cost
**Source:** server/intelligence-actions.js:149
**Kind:** route
**Verdict:** ADAPT
**Purpose:** Records incremental cost (`usd`, `tokens`, `provider`) against a run's ledger, with a hard confirmation gate (HTTP 428) once cumulative cost would cross $25 unless `confirm: true` is sent.
**Inputs:** path `runId`; body `usd` (required, non-negative number), `tokens` (optional non-negative number), `provider`, `confirm`; site via the same ambient-fallback `siteDirOr()` helper. Reads current ledger first via `reader.readRunLedger(siteDir, runId)` to compute the projected total before writing.
**Outputs:** `writer.recordCost(siteDir, runId, {...})` → `{ ledger }` (200); or `404 run_not_found`; or `428 { error: 'confirmation_required', threshold_usd, projected_usd }`.
**Side effects:** Read-then-write against the ledger file via `intelligence-writer.js`; no other side effects observed in this handler.
**Identity:** Same ambient-fallback pattern via `siteDirOr()`/`resolveSiteDirFromReq` as the other `/runs/*` routes.
**Risks:** Money-adjacent (tracks $ spend) but this is internal generation-cost tracking, not customer billing or the FAMtastic Designs proof pipeline — no protected-revenue flag needed. The read-before-write confirm-gate is a good safety pattern worth keeping; the site-resolution ambient fallback is the risk, since a misrouted request could pollute another site's cost ledger and silently distort its $25 threshold.
**Verdict reasoning:** The confirm-gate-on-cumulative-cost pattern is genuinely good design worth preserving; only the ambient site-resolution needs to change. ADAPT.

## POST /runs/:runId/blockers
**Source:** server/intelligence-actions.js:184
**Kind:** route
**Verdict:** ADAPT
**Purpose:** Records a blocker entry (`kind` required, plus arbitrary other body fields) against a run's ledger.
**Inputs:** path `runId`; body `kind` (required, trimmed) plus whatever else is spread into the writer call; site via the same ambient-fallback helper.
**Outputs:** `writer.recordBlocker(siteDir, runId, {...body, kind})` → `{ ledger }` (200) or mapped error.
**Side effects:** Ledger write via `intelligence-writer.js`.
**Identity:** Same ambient-fallback pattern as the sibling `/runs/*` routes.
**Risks:** Body is spread wholesale (`{ ...body, kind: body.kind.trim() }`) into the writer with only a traversal check — UNDETERMINED whether `intelligence-writer.recordBlocker` further validates/sanitizes the spread fields, or trusts them as-is into the ledger.
**Verdict reasoning:** Same reasoning as the other ledger-mutation routes in this family — contract is fine, site identity binding is the defect. ADAPT.

## POST /runs/:runId/non-blockers
**Source:** server/intelligence-actions.js:200
**Kind:** route
**Verdict:** ADAPT
**Purpose:** Records a non-blocking observation (`kind` defaulting to `"observation"`, required `note`) against a run's ledger.
**Inputs:** path `runId`; body `kind` (optional), `note` (required, trimmed); site via the same ambient-fallback helper.
**Outputs:** `writer.recordNonBlocker(siteDir, runId, {...})` → `{ ledger }` (200) or mapped error.
**Side effects:** Ledger write via `intelligence-writer.js`.
**Identity:** Same ambient-fallback pattern as the sibling `/runs/*` routes.
**Risks:** None additional beyond the shared site-resolution risk noted above; input handling here is well-guarded (required/trimmed `note`, defaulted `kind`).
**Verdict reasoning:** Contract is sound, ambient site fallback is the defect. ADAPT — same as the rest of the `/runs/*` family.

## POST /runs/:runId/learning
**Source:** server/intelligence-actions.js:238
**Kind:** route
**Verdict:** ADAPT
**Purpose:** Adds a learning candidate (`id`, `kind`, `summary` required, `evidence[]`, `promote_target`) to a run, presumably feeding a later promotion-to-memory step.
**Inputs:** path `runId`; body `id`, `kind`, `summary` (required, trimmed), `evidence` (array), `promote_target`; site via the same ambient-fallback helper.
**Outputs:** `writer.addLearningCandidate(siteDir, runId, {...})` → `{ learning_candidates }` (200) or mapped error.
**Side effects:** Ledger/learning-candidates file write via `intelligence-writer.js`.
**Identity:** Same ambient-fallback pattern as the sibling `/runs/*` routes.
**Risks:** `evidence` array contents unvalidated beyond `Array.isArray` — UNDETERMINED whether writer further checks each evidence entry's shape.
**Verdict reasoning:** Contract fine, site-resolution ambient fallback is the defect shared across this whole route family. ADAPT.

## POST /runs/:runId/next-action
**Source:** server/intelligence-actions.js:260
**Kind:** route
**Verdict:** ADAPT
**Purpose:** Sets the ledger's recorded "next action" free-text field for a run.
**Inputs:** path `runId`; body `action` (required, trimmed, but passed un-trimmed to the writer: `writer.setNextAction(siteDir, runId, action)` — note the trim check gates validity but the raw `action` is what's stored); site via the same ambient-fallback helper.
**Outputs:** `writer.setNextAction(...)` → `{ ledger }` (200) or mapped error.
**Side effects:** Ledger write via `intelligence-writer.js`.
**Identity:** Same ambient-fallback pattern as the sibling `/runs/*` routes.
**Risks:** Minor inconsistency — validates `action.trim()` is non-empty but stores the original untrimmed `action`, so leading/trailing whitespace could persist despite the check appearing to guard against empty/whitespace-only input.
**Verdict reasoning:** Same reasoning as the rest of the `/runs/*` family: contract fine, ambient site fallback is the defect. ADAPT.

## POST /runs/:runId/finalize
**Source:** server/intelligence-actions.js:276
**Kind:** route
**Verdict:** ADAPT
**Purpose:** Finalizes a run with a verdict (`pass`/`fail`/`blocked`/`parked`), presumably closing the ledger to further mutation.
**Inputs:** path `runId`; body `verdict` (required, must be in `VERDICT_ENUM`); site via the same ambient-fallback helper.
**Outputs:** `writer.finalizeRun(siteDir, runId, verdict)` → `{ ledger }` (200) or mapped error (mapper includes a `run_terminal` 409 case, implying finalize is one-way).
**Side effects:** Ledger write via `intelligence-writer.js`, likely marking the run as terminal (no further `/passes`, `/cost`, etc. should succeed afterward per `mapWriterError`'s `run is terminal` → 409 case).
**Identity:** Same ambient-fallback pattern as the sibling `/runs/*` routes.
**Risks:** Finalize is presumably irreversible (terminal state) — an ambient-site misroute here would incorrectly close out the wrong site's run with no undo path evident in this file. UNDETERMINED: whether `intelligence-writer.finalizeRun` has any reversal/unlock mechanism.
**Verdict reasoning:** Same reasoning as the rest of the `/runs/*` family, with slightly higher stakes because finalize looks irreversible. ADAPT — keep the writer contract and terminal-state guard, replace ambient site resolution with a required explicit id.
## POST /test-asset
**Source:** server/media-routes.js:60
**Kind:** route
**Verdict:** ADAPT
**Purpose:** Appends a local test media asset (no provider/network call) to a site's media registry, for exercising the media pipeline without spending on generation.
**Inputs:** body.tag (optional, validated with isSafeTag), body.asset { id, slot, prompt, source, provider, notes, variants }. Falls back to `resolveSiteDir()` (an injected ambient resolver) when `tag` is omitted.
**Outputs:** JSON { ok, asset, summary }. Writes the new asset into `<siteDir>/media-registry.json` (or wherever `appendAsset` persists) via `appendAsset(siteDir, asset)`.
**Side effects:** File write to the site's media registry. No network/provider calls (explicitly a local-test bypass). No spawned processes.
**Identity:** Hybrid — accepts an explicit `tag` body param (preferred path, validated), but if `tag` is absent it falls back to `resolveSiteDir()`, an ambient/global site resolver injected into the router factory. Line: `} else if (typeof resolveSiteDir === 'function') { siteDir = resolveSiteDir(); }`.
**Risks:** The ambient fallback means a request without `tag` silently mutates whatever site is "currently selected" server-side rather than failing closed. Test assets could be mistaken for real ones if `source`/`provider` defaults ('local-test') aren't surfaced clearly in the UI.
**Verdict reasoning:** The validation and asset-shape contract are solid and worth keeping, but the ambient-fallback branch must be deleted on the way in — explicit site id only, 400 otherwise, matching the mutation-routes.js pattern.

## POST /asset/status
**Source:** server/media-routes.js:131
**Kind:** route
**Verdict:** KEEP-CONVERT
**Purpose:** Updates the approval state (and optional review note) of a media asset within a named site's registry.
**Inputs:** body.tag (required, isSafeTag-validated), body.asset_id (required non-empty string), body.approval (must be in VALID_APPROVALS), body.note (optional, capped 300 chars).
**Outputs:** JSON { ok, asset, summary } on success; { ok:false, error/errors } on validation failure. Writes updated asset record via `updateAsset(siteDir, asset_id, updater)`.
**Side effects:** File write to the site's media registry (approval + review_note + updated_at fields).
**Identity:** Explicit — `tag` is a required body field validated with `isSafeTag`; `siteDir = path.join(sitesRoot, tag)`. No ambient fallback exists on this route.
**Risks:** No apparent authorization/ownership check beyond tag shape validation — any caller who knows a valid tag and asset_id can flip approval state. Not itself protected-revenue scope (asset approval, not proof/deploy), but worth noting for the new system's auth model.
**Verdict reasoning:** Clean explicit site-id binding and a tight validation contract; port with mechanical changes (route shape, validator reuse) rather than adapting the logic.

## POST /asset/assign
**Source:** server/media-routes.js:153
**Kind:** route
**Verdict:** KEEP-CONVERT
**Purpose:** Records that a media asset has been assigned/placed onto a component-slot or site-slot, appending to the asset's usage history and placement pages.
**Inputs:** body.tag (required, isSafeTag), body.asset_id (required), body.target_type ('site-slot' | else 'component-slot'), body.component_id, body.page, body.slot, body.site_tag (each capped to 96 chars via `.slice`).
**Outputs:** JSON { ok, asset, summary, assignment }. Writes updated asset (`used_by` array capped to last 20, `placement_pages` capped to last 20, approval auto-bumped from 'approved' to 'used') via `updateAsset`.
**Side effects:** File write to the site's media registry; mutates asset approval state as a side effect of assignment (approved → used).
**Identity:** Explicit — `tag` required body field, `isSafeTag`-validated, `siteDir = path.join(sitesRoot, tag)`. Note body also accepts a separate `site_tag` field used only for building the assignment record (defaults to `tag`), not for resolving `siteDir` — slightly confusing dual-tag naming but not an ambient leak.
**Risks:** Two similarly-named fields (`tag` vs `site_tag`) risk confusion in the port — `site_tag` in the assignment payload could silently diverge from the actual `tag` used to resolve the directory (caller can pass a different `site_tag` value that's just recorded, not enforced). Worth tightening to a single field or asserting equality on the way in.
**Verdict reasoning:** Explicit site binding and a working history/placement contract; port mechanically but collapse the tag/site_tag duplication to avoid carrying the ambiguity forward.

## GET /api/mutations/history
**Source:** server/mutation-routes.js:57
**Kind:** route
**Verdict:** KEEP-CONVERT
**Purpose:** Returns the undo/redo journal history for an explicitly named site: revision number, undo/redo availability, and a list of past operations with artifact counts.
**Inputs:** req.ctx.siteTag, or body.siteTag, or query.siteTag (checked in that order by `resolveSite`); query.limit (capped to 200, default 50).
**Outputs:** JSON { site_tag, document_revision, can_undo, can_redo, undo_description, redo_description, history[] } where each history row includes operation_id, kind, state, description, revisions, timestamps, undone/superseded flags, artifact_count, creates, deletes. Read-only against `journal.historyFor`/`artifactsFor`/`lastUndoable`/`lastRedoable`.
**Side effects:** None observed — read-only route, no writes.
**Identity:** Explicit and enforced. `resolveSite()` requires `req.ctx.siteTag` or an explicit `body.siteTag`/`query.siteTag`; if absent it returns 400 `site_required` with message "Explicit site authority is required... the current selection is not authority." Also validates the tag shape against path traversal (`..`, `/`, `\\`, absolute paths). The file's own header comment states: "There is no ambient fallback."
**Risks:** None observed beyond standard read-endpoint exposure; the module is explicitly designed to prevent the exact ambient-state class of bug this rebuild is trying to eliminate.
**Verdict reasoning:** This file is a model example of the identity discipline the new system requires — port near-verbatim as the reference pattern for other mutation/read routes.

## POST /api/mutations/undo
**Source:** server/mutation-routes.js:121
**Kind:** route
**Verdict:** KEEP-CONVERT
**Purpose:** Undoes the most recent undoable operation in the named site's mutation journal/transaction log.
**Inputs:** Same `resolveSite()` contract as above (explicit siteTag via ctx/body/query, 400 if absent or malformed).
**Outputs:** JSON { ok, site_tag, operation_id, document_revision, artifact_count, undid } on success. Calls `tx.undo(site)` which reverts file artifacts tracked by the transaction module.
**Side effects:** Mutates site files on disk (reverts prior writes) via `lib/mutation/transaction.js`'s `undo`. Journal state updated. Concurrency-guarded: returns 423 `ELOCKED` if another mutation holds the lock.
**Identity:** Explicit, same `resolveSite()` enforcement as history route — required, validated, no ambient fallback.
**Risks:** Undo is inherently destructive/rewriting of prior state; a bug in `tx.undo` could revert the wrong operation if `document_revision`/`operation_id` bookkeeping in the journal is stale. ENOUNDO is handled gracefully (409) rather than crashing — good. Genuine mutation risk lives in `lib/mutation/transaction.js` (not reviewed here) — `UNDETERMINED: whether tx.undo enforces atomicity/rollback-on-partial-failure` would need checking that module directly.
**Verdict reasoning:** Correct site-binding, honest error states (409 for no-op cases, 423 for lock conflicts) — the contract is exactly what the new system wants; port the route mechanically, re-verify the transaction module separately.

## POST /api/mutations/redo
**Source:** server/mutation-routes.js:122
**Kind:** route
**Verdict:** KEEP-CONVERT
**Purpose:** Re-applies the most recently undone operation in the named site's mutation journal.
**Inputs:** Same `resolveSite()` contract (explicit siteTag, 400 if missing/invalid).
**Outputs:** JSON { ok, site_tag, operation_id, document_revision, artifact_count, redid } on success, via `tx.redo(site)`.
**Side effects:** Mutates site files on disk (re-applies previously undone changes). Same lock/error semantics as undo (409 ENOREDO, 423 ELOCKED).
**Identity:** Explicit, identical enforcement to the undo/history routes above — no ambient fallback.
**Risks:** Same class as undo: correctness depends on `lib/mutation/transaction.js` internals not reviewed in this pass. `UNDETERMINED: whether redo can diverge from undo's exact byte-for-byte prior state`.
**Verdict reasoning:** Same reasoning as `/api/mutations/undo` — clean explicit identity binding, honest failure states, port mechanically alongside its sibling.

## POST /api/verify
**Source:** server/runtime-status-routes.js:52
**Kind:** route
**Verdict:** RETIRE
**Purpose:** Runs build verification against "the" currently-loaded site's built pages and persists the result into that site's spec.json.
**Inputs:** No body/query/param inputs read at all — the route takes zero explicit site identifier. Reads pages via `listPages()` and reads/writes the spec via `readSpec()`/`writeSpec()`, all injected as ambient closures from the caller (server.js) with no site argument.
**Outputs:** JSON verification result `{ status, checks, issues, timestamp }` (or a "No pages found" failure shape). Side effect: mutates `spec.last_verification` and calls `writeSpec(spec)` — persists to disk. Failures in the write are silently swallowed (`catch {}`).
**Side effects:** Writes to whatever site's spec.json `readSpec`/`writeSpec` currently point at (server-global state), determined entirely by ambient selection, not this request. The `catch {}` around `writeSpec` also silently discards write failures — a verification result can report success in the JSON response while failing to persist.
**Identity:** Fully ambient. There is no `tag`/`siteTag`/`site_id` parameter anywhere in this handler; `readSpec()`, `writeSpec()`, and `listPages()` are zero-argument closures resolving "the current site" from server-wide state. This is exactly the pattern the new system forbids.
**Risks:** A concurrent request against a different "current site" (e.g. via `/api/switch-site`) between two verify calls could verify one site's pages but write the result into a different site's spec.json. Silently swallowed write failures also risk reporting an honest verification while failing to journal it — a form of unverified-success reporting the rebuild explicitly wants to avoid.
**Verdict reasoning:** Depends entirely on ambient/global site-selection state (no explicit site id anywhere in the handler) and additionally hides write failures — both are premises the rebuild rejects, so RETIRE rather than adapt around them.

## POST /api/site-studio/build-vnext
**Source:** server/runtime-vnext-build-route.js:199
**Kind:** route
**Verdict:** ARCHIVE-FOR-FUTURE
**Purpose:** Runs a deterministic recipe-based Site Studio build for an explicitly named site (runtime-vnext pipeline), producing HTML pages into a staged workspace, then atomically publishing them to `sites/<tag>/dist-vnext`.
**Inputs:** body.siteTag (required — resolved via `siteTagOr400`, no ambient fallback per the file's own doc comment), body.pages (array, validated against `isValidPageName`, falls back to persisted `spec.pages` then `['index.html']`), body.siteName, body.brief (optional, persisted to spec). Also gates on `shayProvider.findReasoningAuthority(req.body, 'body')` — rejects any request that tries to smuggle in its own model/provider authority (per the "Enforce single Studio reasoning authority" repo-wide rule).
**Outputs:** JSON { success, project_id, run_id, recipe_id, recipe_version, site_tag, publish_dir, files[] }. GET .../status?run_id=<id> polls persisted run state (400 no run_id, 404 unknown). Writes: staged build workspace, then an atomically-swapped `dist-vnext` directory, journaled with a pre-swap fingerprint verified post-swap; run status transitions recipe_completed → publishing → published/publish_failed, never marked published on recipe completion alone.
**Side effects:** Spawns/executes a DeterministicToolRunner recipe (build pipeline), writes many files, performs an atomic directory swap with fingerprint verification, and does boot-time reconciliation of any run left in 'publishing' state (marks it publish_failed rather than assuming success). Refuses (409) rather than queues if a build for that siteTag is already in progress.
**Identity:** Fully explicit — `siteTagOr400` resolves from req.ctx (body/query/path) and 400s on missing or malformed tags; the file's own comments state twice that there is deliberately no ambient TAG fallback, unlike legacy dist behavior which this route explicitly avoids touching.
**Risks:** This is Site Studio's deterministic build/publish pipeline — the mechanism nearest to the FAMtastic Designs proof/deploy surface (fingerprint-verified atomic publish, run status honesty, boot-time recovery). Given its proximity to build/deploy proof machinery, treat any generation/build accuracy claims as requiring independent verification before trusting "published" status blindly.
**Verdict reasoning:** Per the salvage rules, anything touching the proof/deploy pipeline is archived rather than ported directly, even though the code quality here is high (explicit identity, honest state machine, atomic publish). Name the phase that would revisit it: the runtime-vnext build/publish design should be pulled back in when the new system builds its own deterministic build+publish contract.

## PUT /api/site-settings
**Source:** server/site-settings-routes.js:55 (route mounted at `/`, path is `/api/site-settings` per server.js mount)
**Kind:** route
**Verdict:** KEEP-CONVERT
**Purpose:** Writes per-site setting overrides (schema-validated) atomically to `sites/<tag>/site-settings.json`, resetting `schema_version`, `site_tag`, and `updated_at` server-side.
**Inputs:** query.tag (required, `isSafeTag`-validated), body { overrides: { key: value|null, ... } } (limited to 8kb via `express.json({limit:'8kb'})`), validated against `schema.validate(body, tag)` and an ALLOWED_VALUES allowlist (per file header comment).
**Outputs:** JSON { ok:true, file, body } on success; 400 for invalid tag/validation failure, 404 if the site directory doesn't exist (won't create phantom dirs). Writes via tmp-file + `fs.renameSync` for atomicity; cleans up orphaned tmp file on write failure.
**Side effects:** File write to `sites/<tag>/site-settings.json` (atomic swap). No network calls, no spawned processes.
**Identity:** Explicit — `tag` is a required query parameter, validated with `isSafeTag`, used directly to build the file path (`path.join(sitesRoot, tag, 'site-settings.json')`). No ambient fallback.
**Risks:** None observed beyond the 8kb body cap and standard validation; the 404-on-missing-dir guard specifically prevents phantom-directory creation, which is a good invariant to preserve. `UNDETERMINED: whether schema.validate's ALLOWED_VALUES allowlist is exhaustive enough to block unexpected keys` — would need reading `site-settings-schema.js` to confirm.
**Verdict reasoning:** Explicit site binding, atomic write pattern, and defensive tmp-cleanup make this a clean mechanical port; keep the same validation-then-atomic-write shape in the new module.

## DELETE /api/site-settings
**Source:** server/site-settings-routes.js:93 (route mounted at `/`, path is `/api/site-settings` per server.js mount)
**Kind:** route
**Verdict:** KEEP-CONVERT
**Purpose:** Deletes a site's settings-overrides file, resetting that site to platform defaults.
**Inputs:** query.tag (required, `isSafeTag`-validated).
**Outputs:** JSON { ok:true, deleted:false, note } if no overrides file existed; { ok:true, deleted:true } if removed; 400 for invalid tag; 500 on unlink failure with `detail`.
**Side effects:** Deletes `sites/<tag>/site-settings.json` from disk if present. No cascading effects observed — this is a settings reset, not a site or asset deletion.
**Identity:** Explicit — same `tag` query-param + `isSafeTag` pattern as the PUT route above; path built directly from the validated tag.
**Risks:** None observed; deletion is scoped to a single well-known config file, and the route reports honestly whether anything was actually deleted (`deleted:false` when nothing existed, rather than a blanket success).
**Verdict reasoning:** Same explicit-identity, low-risk pattern as PUT — mechanical port alongside its sibling routes in the same file.

## POST /api/pages/current
**Source:** server/studio-state-routes.js:58
**Kind:** route
**Verdict:** RETIRE
**Purpose:** Sets which page of "the" current site is considered active in the Studio UI/session state, after validating the page exists on disk.
**Inputs:** body.page (required, validated via injected `isValidPageName`). No site identifier of any kind is accepted by this handler.
**Outputs:** JSON { currentPage } on success; 400 if page missing/invalid name, 404 if the page file doesn't exist under `getDistDir()`. Calls `setCurrentPage(page)` then `saveStudio()` to persist.
**Side effects:** Mutates server-wide "current page" state via `setCurrentPage`/`saveStudio` — both zero-argument ambient closures injected into `registerStudioStateRoutes` from server.js, operating on whatever site `getSiteDir()`/`getDistDir()`/`getTag()` currently resolve to.
**Identity:** Fully ambient. Every helper used (`getSiteDir`, `getDistDir`, `getTag`, `getCurrentPage`, `setCurrentPage`, `saveStudio`) is a closure over server-global "current site" state; the handler itself accepts no site id parameter at all. The whole `studio-state-routes.js` module (GET /api/spec, /api/site-info, /api/pages, /api/studio-state) is built on this same ambient-getter pattern.
**Risks:** In a multi-site or concurrent-session context, this route silently changes "current page" for whichever site the server process currently considers active, not necessarily the site the caller intended — a session or tab switching sites mid-flight could set the wrong site's current page, or two callers could race and clobber each other's page selection.
**Verdict reasoning:** Textbook ambient-state route: no explicit site id anywhere, entirely dependent on server-global getters/setters the new system's contract forbids — RETIRE on the premise that "current site" as global mutable state is rejected by the rebuild.
## GET /state
**Source:** server/studio-workflows-routes.js:260
**Kind:** route
**Verdict:** RETIRE
**Purpose:** Returns an aggregated Studio dashboard snapshot (site drafts, component drafts, open tasks, learning candidates, media assets/summary, insertions, recipe artifacts, latest actions) across the whole repo, optionally scoped by a `tag` query param.
**Inputs:** query `tag` (optional, validated by `isSafeTag`); reads `sites/_drafts/*/draft.json`, `components/studio-drafts/*/draft.json`, `tasks/tasks.jsonl`, `tasks/studio-learning-candidates.jsonl`, and (only if `tag` given) the media registry and `sites/<tag>/_test/insertion-history.jsonl`.
**Outputs:** `{ ok, state: {...} }` — no writes.
**Side effects:** none observed (pure reads).
**Identity:** partially ambient. `tag` is optional — when omitted, `collectState(repoRoot, null)` still returns global drafts/tasks/learning data with no site scoping at all; media/insertions are the only fields gated behind an explicit tag. Most of the payload is repo-wide state with no site id required.
**Risks:** returns cross-site data in one blob (site drafts across all sites, tasks across all sites) with no per-site authorization boundary; a caller can enumerate all draft/task state without specifying which site they're allowed to see.
**Verdict reasoning:** The dashboard-aggregation shape is exactly the ambient/global pattern the new system forbids — most of the response is not bound to any site id. Retire and rebuild as an explicit per-site (or explicitly-global admin) query if this capability is still needed.

## GET /sites/drafts
**Source:** server/studio-workflows-routes.js:265
**Kind:** route
**Verdict:** RETIRE
**Purpose:** Lists all site-draft records under `sites/_drafts/`.
**Inputs:** none (no params).
**Outputs:** `{ drafts: [...] }` from `readDraftFiles(siteDraftRoot)` — no writes.
**Side effects:** none observed (pure read of a fixed directory).
**Identity:** fully ambient — lists drafts for every site tag in one global directory with no site id parameter at all.
**Risks:** no authorization/scoping; any caller sees every in-progress site draft across the whole studio.
**Verdict reasoning:** No site id parameter exists to convert; the entire concept is a global listing. Retire and replace with a per-caller/per-workspace scoped listing if drafts survive into the new design.

## POST /sites/drafts
**Source:** server/studio-workflows-routes.js:269
**Kind:** route
**Verdict:** ADAPT
**Purpose:** Creates a new site draft record (JSON file) under `sites/_drafts/<site_tag>/draft.json` and appends a follow-up task to the shared tasks ledger.
**Inputs:** body `{ site_name, site_tag, site_type, goal, starting_recipe, notes }`; `site_tag` validated via `isSafeTag`.
**Outputs:** `{ ok, draft, task }`; writes `sites/_drafts/<site_tag>/draft.json` (atomic write via tmp+rename) and appends a record to `tasks/tasks.jsonl` via `appendStudioTaskRecord`.
**Side effects:** filesystem writes (draft file, task ledger append); checks `fs.existsSync(sites/<site_tag>)` to flag `live_site_exists`.
**Identity:** explicit — `site_tag` is a required, validated body param and is used directly as the directory key. Not ambient.
**Risks:** 409 on existing draft is the only collision guard; no auth check on who may create a draft for an arbitrary site_tag.
**Verdict reasoning:** Identity binding is already correct (explicit site_tag), so this is not a RETIRE case, but the JSONL task-ledger side effect and lack of authorization mean it needs new code rather than a straight port. ADAPT: keep the contract (create draft, propose follow-up task), rewrite the persistence/task-emission layer.

## GET /components/drafts
**Source:** server/studio-workflows-routes.js:311
**Kind:** route
**Verdict:** RETIRE
**Purpose:** Lists all component-draft records under `components/studio-drafts/`.
**Inputs:** none.
**Outputs:** `{ drafts: [...] }` — no writes.
**Side effects:** none observed.
**Identity:** ambient — component drafts are a repo-global namespace, not scoped to any site id (components are meant to be reused across sites, so there is no site_id concept here at all).
**Risks:** none beyond unauthenticated visibility of all draft components.
**Verdict reasoning:** Not a site-identity leak in the forbidden sense (components are legitimately cross-site), but the route itself is a trivial global listing with no other logic worth porting mechanically. RETIRE this specific route; reconsider component-draft listing as part of whatever the new component-library capability becomes.

## POST /components/drafts
**Source:** server/studio-workflows-routes.js:315
**Kind:** route
**Verdict:** ADAPT
**Purpose:** Creates a new component-draft record under `components/studio-drafts/<id>/draft.json` and appends a follow-up review task.
**Inputs:** body `{ id, name, purpose, props[], slots[], variants[], media_needs[] }`; `id` validated by `SAFE_COMPONENT_ID_RE`.
**Outputs:** `{ ok, draft, task }`; writes `components/studio-drafts/<id>/draft.json` (atomic) and appends to `tasks/tasks.jsonl`.
**Side effects:** filesystem writes; array fields silently truncated to 20 entries each.
**Identity:** N/A / not site-scoped by design — components are a cross-site resource in this legacy model, so there is no site_id to bind. Not an ambient-site violation, just a different resource kind.
**Risks:** no dedupe/duplicate-detection against the existing component inventory before creating a draft (task text says "decide reuse vs insert path" but the route itself does no reuse check); no auth.
**Verdict reasoning:** The create-draft-plus-follow-up-task contract is reasonable and worth keeping conceptually, but persistence (flat JSON files + JSONL task ledger) needs to be rebuilt against the new component-inventory model. ADAPT.

## GET /tasks
**Source:** server/studio-workflows-routes.js:353
**Kind:** route
**Verdict:** RETIRE
**Purpose:** Returns open Studio-runner tasks from the shared `tasks/tasks.jsonl` ledger, optionally filtered by `section`.
**Inputs:** query `section` (optional, validated against `SAFE_SECTION_RE`); internally calls `collectState(repoRoot, null)` to get `.tasks`.
**Outputs:** `{ tasks: [...] }` — no writes.
**Side effects:** none observed (read-only), but depends on the same repo-global `collectState` used by `/state`.
**Identity:** ambient — tasks are pulled from one global ledger across all sites; `section` filters by workflow area, not by site id, so there is no way to scope this to a single site's tasks.
**Risks:** cross-site task visibility with no authorization boundary.
**Verdict reasoning:** Same ambient-global pattern as `/state`; task lists should be site-scoped (or explicitly admin-scoped) in the new system. RETIRE.

## POST /tasks
**Source:** server/studio-workflows-routes.js:362
**Kind:** route
**Verdict:** ADAPT
**Purpose:** Appends a new arbitrary Studio task record to the shared `tasks/tasks.jsonl` ledger.
**Inputs:** body validated only for `target_section` (must match `SAFE_SECTION_RE`) and non-empty `recommendation`; everything else in `buildTaskRecord` (source_type, source_id, site_tag, title, owner_section, metadata, proof_needed) is accepted with generic length-capping via `safeText`, no further validation.
**Outputs:** `{ ok, task }`; appends one line to `tasks/tasks.jsonl`.
**Side effects:** filesystem append (JSONL); `task.runner` is hardcoded to `'Studio'` and `auto_approved: true` is set unconditionally on every task, regardless of caller.
**Identity:** `site_tag` is an optional free-text field (`safeText(input.site_tag, 96, '')`), not required and not validated against `isSafeTag` — a caller can supply any string or omit it. Effectively ambient/unenforced identity.
**Risks:** `auto_approved: true` is set on every task with no gate — this looks like it silently marks arbitrary caller-supplied tasks as approved, which could let a client fabricate an "approved" work item without review.
**Verdict reasoning:** The task-emission contract is reusable, but the unchecked `auto_approved: true` and unvalidated `site_tag` are exactly the kind of honesty/identity problems the rebuild is meant to fix. ADAPT: keep the shape, rebuild the write with explicit site_id and real approval semantics.

## GET /learning
**Source:** server/studio-workflows-routes.js:374
**Kind:** route
**Verdict:** RETIRE
**Purpose:** Returns the most recent 50 learning-candidate entries from `tasks/studio-learning-candidates.jsonl`, newest first.
**Inputs:** none.
**Outputs:** `{ items: [...] }` — no writes.
**Side effects:** none observed.
**Identity:** ambient — one global learning-candidates file, no site id at all; entries carry only a `section` (e.g. "shay"), not a site id.
**Risks:** none beyond global unauthenticated visibility.
**Verdict reasoning:** Learning candidates in this legacy model are explicitly not site-scoped (they're Shay/operator learnings), so this isn't strictly the site-identity violation, but as a bare global-file listing route it offers nothing mechanical worth porting. RETIRE; revisit if/when a learnings capability is designed fresh.

## POST /learning
**Source:** server/studio-workflows-routes.js:378
**Kind:** route
**Verdict:** ADAPT
**Purpose:** Appends a new learning-candidate note to the shared `tasks/studio-learning-candidates.jsonl` ledger.
**Inputs:** body `{ note (required), section (default 'shay'), source_id }`.
**Outputs:** `{ ok, item }`; appends one line to `tasks/studio-learning-candidates.jsonl`.
**Side effects:** filesystem append (JSONL).
**Identity:** N/A — not site-scoped by design (this is operator/Shay-level learning capture, not a per-site record).
**Risks:** no validation on `section` beyond length-capping (unlike `target_section` elsewhere which is enum-checked); `status: 'candidate'` with no downstream promotion/review path visible in this file.
**Verdict reasoning:** Simple, low-risk write with a clear contract worth keeping conceptually, but persistence (flat JSONL) and the missing section validation mean it should be rebuilt rather than ported verbatim. ADAPT.

## POST /captures
**Source:** server/think-tank-routes.js:141
**Kind:** route
**Verdict:** KEEP-CONVERT
**Purpose:** Writes a new Think-Tank capture (idea/note) to `captures/inbox/<id>.capture.json`.
**Inputs:** body `{ id, title, body, source, tags[] }`; `id` validated against `SAFE_WRITE_ID`; title required; body/source/tags length- and shape-capped.
**Outputs:** `{ ok: true, capture, path }`; writes one JSON file to `captures/inbox/`.
**Side effects:** filesystem write only; explicit containment check (`resolved.startsWith(inboxDir + path.sep)`) and no-overwrite guard (409 if file exists).
**Identity:** N/A — Think-Tank captures are explicitly a global inbox, not site-scoped, per the file's own header comment ("Read-only access to the live capture inbox"). Not an ambient-site violation; this resource genuinely has no site id.
**Risks:** low — path traversal is defended (id regex + containment check + no overwrite); write failures are caught and reported as 500 rather than silently swallowed.
**Verdict reasoning:** Clean validation, explicit id, proper path containment, atomic write, honest error handling — this is close enough to port mechanically. KEEP-CONVERT.

## POST /promote
**Source:** server/think-tank-routes.js:194
**Kind:** route
**Verdict:** KEEP-CONVERT
**Purpose:** Writes a promotion-contract record (moving a capture toward research/sites/components/media) to `captures/promotions/<from_capture_id>-<to>-<timestamp>.promotion.json`.
**Inputs:** body `{ from_capture_id, to, task }`; `from_capture_id` validated against `SAFE_WRITE_ID`; `to` must be one of a fixed target set (`VALID_TARGETS`); `task` object size-capped (`MAX_TASK_BYTES`).
**Outputs:** JSON response with the written promotion record (truncated before I could read past line 230 — response shape not fully confirmed).
**Side effects:** filesystem write to `captures/promotions/`; containment check identical to `/captures`.
**Identity:** N/A — promotions reference a capture id and a target *section* (research/sites/components/media), not a specific site id; this is consistent with Think-Tank's global-inbox model, not an ambient-site leak.
**Risks:** `task` payload is only size-capped, not schema-validated, so downstream consumers of promotion files must defend against arbitrary shapes; UNDETERMINED: exact response JSON past line 230 (file read cut off).
**Verdict reasoning:** Same solid validation/containment pattern as `/captures` — id regex, enum check on `to`, byte cap, no-shell-out, path containment. KEEP-CONVERT with the same mechanical-port confidence.

## POST /verify
**Source:** server/verification-routes.js:54
**Kind:** route
**Verdict:** KEEP-CONVERT
**Purpose:** Runs V1 build verification against a site's `dist-vnext` build output and persists the result to that site's spec as `last_verification`.
**Inputs:** `siteTag` resolved via `siteTagOr400(req, res)` (explicit, required, 400s if missing/invalid) — not from body directly but the helper is the site's own explicit-identity gate; internally calls `getDistVnextDir(siteTag)`, `listPagesInDir`, `runBuildVerification(pages, distVnextDir, siteTag)`, `readSpec(siteTag)`, `writeSpec(spec, { siteTag, source: 'verify_api' })`.
**Outputs:** verification result JSON (`{ status, checks, issues, timestamp }` shape implied by the empty-pages branch); writes `spec.last_verification` atomically via `writeSpec`.
**Side effects:** reads dist-vnext directory tree, mutates the site's spec file; no network calls or subprocess spawns visible in this file (verification logic itself lives in `runBuildVerification`, not shown here).
**Identity:** explicit and exemplary — file header states "V1 never reads the ambient operator site" and both GET and POST call `siteTagOr400(req, res)` before doing anything. This is the pattern the new system wants.
**Risks:** correctness of `runBuildVerification` itself is not visible in this file (delegated); a 409 `no_vnext_build` guard prevents silent fallback to legacy `dist`, which is good practice worth preserving. UNDETERMINED: whether `writeSpec`'s catch-and-ignore (`try {...} catch {}`) around the persistence step could silently drop a verification result on write failure — worth checking in the new implementation.
**Verdict reasoning:** Already built to the target identity contract (explicit siteTag, no ambient fallback, atomic write) and has clean error semantics (409 for missing build). KEEP-CONVERT — port the contract and dependency-injection shape mechanically, but tighten the silent `catch {}` around `writeSpec`.

## GET /verify
**Source:** server/verification-routes.js:48
**Kind:** route
**Verdict:** KEEP-CONVERT
**Purpose:** Returns the last stored build-verification result (`spec.last_verification`) for an explicit site.
**Inputs:** `siteTag` resolved via `siteTagOr400(req, res)` (explicit, required); calls `readSpec(siteTag)`.
**Outputs:** `spec.last_verification || null` — no writes.
**Side effects:** none (pure read).
**Identity:** explicit — same `siteTagOr400` gate as the POST route; comment explicitly disclaims ambient site reads.
**Risks:** none observed beyond dependence on `readSpec` correctness (not shown in this file).
**Verdict reasoning:** Textbook explicit-identity read route with no side effects. KEEP-CONVERT.

## POST /read
**Source:** lib/bridge-routes.js:93
**Kind:** route
**Verdict:** RETIRE
**Purpose:** Reads an arbitrary file's contents from within the repo root (`~/famtastic`), JSON-body variant of the sibling GET /read.
**Inputs:** body or query `path` (relative); resolved via `resolveSafe` which requires the resolved absolute path to stay within `FAM_ROOT` (`path.resolve(__dirname, '..', '..')`).
**Outputs:** `{ content, path }` or 403/404 on escape/missing file.
**Side effects:** filesystem read only; no site concept at all — this is a repo-wide file bridge, not a site route.
**Identity:** fully ambient at the *repo* level — there is no site id anywhere in this router; it operates against the whole FAMtastic monorepo (`FAM_ROOT`), file comment even calls it "the exec bridge" for the whole repo. Far outside a single-site boundary.
**Risks:** this is a generic filesystem-read bridge exposed as an HTTP route; even with path containment, it exposes arbitrary repo file contents (secrets, other sites' data, configs) to any caller who can reach the endpoint — a broad blast-radius capability, not specific to protected revenue but still high-risk.
**Verdict reasoning:** Not merely "ambient site state" but ambient *repo* state with no site boundary whatsoever — the premise (an HTTP-exposed generic file-read bridge scoped only to loopback-adjacent trust) is one the rebuild should reject outright. RETIRE.

## POST /write
**Source:** lib/bridge-routes.js:107
**Kind:** route
**Verdict:** RETIRE
**Purpose:** Writes arbitrary file contents to any path within the repo root.
**Inputs:** body `{ path, content }`; `path` resolved via the same `resolveSafe` containment check as `/read`.
**Outputs:** `{ success: true, path }` or 403/500.
**Side effects:** `fs.mkdirSync` + `fs.writeFileSync` at an arbitrary caller-chosen path anywhere in the repo — this is a full arbitrary-file-write primitive gated only by staying inside `FAM_ROOT`.
**Identity:** fully ambient/repo-wide — no site id, no per-site scoping, operates across the entire monorepo.
**Risks:** high — this is an unauthenticated (at this file's level; auth may exist upstream but is not visible here) arbitrary-file-write endpoint across the whole FAMtastic repo. Could overwrite server code, other sites' specs, configs, or CI files. No dry-run/diff-first requirement enforced by this route itself (that's a separate `/diff` route the caller must remember to call).
**Verdict reasoning:** An unscoped repo-wide file-write HTTP endpoint is exactly the kind of premise the rebuild should reject; even with containment, "any file, any path, via HTTP" is not a capability that should exist ambient to a single-site product. RETIRE.

## POST /diff
**Source:** lib/bridge-routes.js:122
**Kind:** route
**Verdict:** RETIRE
**Purpose:** Computes and returns a unified diff between a file's current on-disk content and caller-supplied proposed content, for any path in the repo root.
**Inputs:** body `{ path, content }`; same `resolveSafe` containment check.
**Outputs:** `{ diff, path }` (hand-rolled unified-diff implementation in `unifiedDiff()`) or 403/500.
**Side effects:** filesystem read only (no write); reads the current file if it exists.
**Identity:** fully ambient/repo-wide, same as `/read` and `/write` — no site id.
**Risks:** lower risk than `/write` since it's read-only, but still exposes arbitrary repo file contents (via the diff output) to any caller; the custom diff algorithm is unproven/hand-rolled (not `git diff` or a vetted library) and could mis-render or crash on binary/large files — UNDETERMINED: how it handles non-text or huge files, no size cap visible.
**Verdict reasoning:** Part of the same generic repo-wide file bridge that should not exist in this shape in the new system; retire alongside `/read` and `/write` rather than porting a piece of a rejected premise.

## POST /exec
**Source:** lib/bridge-routes.js:138
**Kind:** route
**Verdict:** RETIRE
**Purpose:** Executes a whitelisted subset of shell commands (`git` read-only subcommands, `cat`, `ls`) against paths within the repo root, guarded by `requireLoopback` middleware.
**Inputs:** body `{ command }` (a full command string, later parsed into argv); gated by `requireLoopback` (loopback-only), `parseArgv` (rejects any shell metacharacter), `ALLOWED_COMMANDS` allowlist, `ALLOWED_GIT_SUBCOMMANDS` allowlist for git, and `argsStayInRoot` (every non-flag arg must resolve inside `FAM_ROOT`).
**Outputs:** UNDETERMINED — response shape cut off after `// No shell: argv is passed directly...` comment; presumably `execFile` output (stdout/stderr) is returned, given the `execFile` import.
**Side effects:** spawns a child process (`execFile`, no shell) running `git`/`cat`/`ls` against the repo filesystem.
**Identity:** fully ambient/repo-wide — no site id; command execution scope is the entire `FAM_ROOT`, not a single site.
**Risks:** even with the (well-considered) hardening — no shell, metacharacter rejection, command/subcommand allowlists, loopback-only, path containment — this remains a general-purpose command-execution bridge over HTTP. The code comments themselves document a prior worse version ("previously allowed bash, npm, node, sed... unconstrained remote code execution"), which signals this whole capability has a history of scope creep back toward RCE.
**Verdict reasoning:** Same rejected premise as the rest of the bridge router: an HTTP-reachable, repo-wide execution/file-access surface with no site boundary. Despite genuinely careful hardening, the premise itself (ambient repo-wide exec bridge) is one the rebuild should not carry forward. RETIRE — if inspection tooling is needed, it should be a local CLI/dev-only tool, not an HTTP route.

## GET /reviews
**Source:** lib/ops-api.js:234
**Kind:** route
**Verdict:** RETIRE
**Purpose:** Returns the reviews ledger (`reviews/reviews.jsonl`) wrapped in a standard envelope (`snapshot_version, generated_at, source_ledgers, record_count, data`), part of the "Ops Workspace MVP".
**Inputs:** none.
**Outputs:** `{ ..envelope fields.., data: reviews[] }` — no writes; reviews are annotated with freshness via `attachFreshness`.
**Side effects:** none observed (pure read of a repo-wide JSONL ledger).
**Identity:** fully ambient/repo-wide — `ROOT` is the monorepo root (`path.resolve(__dirname, '..', '..')`), and reviews.jsonl is a single global file with no site id field referenced anywhere in this router.
**Risks:** none beyond unauthenticated visibility into cross-project review state.
**Verdict reasoning:** Ops Workspace is explicitly a repo/operator-level tool operating on global ledgers, not per-site data — there is no site id to bind at all, and the file header marks this whole module as an MVP stub (WebSocket support "intentionally NOT in MVP"). RETIRE this route; if operator-wide review tooling is still wanted, it belongs to a distinctly-scoped ops/admin surface in the new system, not something masquerading as a site route.

## POST /command/:action
**Source:** lib/ops-api.js:255
**Kind:** route
**Verdict:** RETIRE
**Purpose:** Gated "destructive command" endpoint for Ops actions (purge, cancel, archive, promote, migrate = destructive; approve, reroute, park, retry = non-destructive); in MVP form it only checks a governance token and otherwise stub-acknowledges — no actual handler wiring.
**Inputs:** route param `:action`; header `x-ops-governance-token` or body `governance_token` for destructive actions; reads `plans/registry.json` for `governance.hard_stop_conditions`.
**Outputs:** `{ ok, action, destructive, message: 'Action accepted (MVP stub — handler wiring pending).', received_at }`, or 403 with `{ error, action, hard_stops }` for a missing/invalid token, or 400 for unknown action.
**Side effects:** none beyond the (weak) token check — the code comment and response message both say explicitly this is a stub with "handler wiring pending"; no destructive action is actually performed.
**Identity:** fully ambient/repo-wide — no site id anywhere; this dispatches repo/ops-level destructive actions, not site-scoped ones.
**Risks:** the "governance token" gate accepts a single hardcoded dev-bypass literal (`'OPS_DEV_BYPASS_DO_NOT_SHIP'`, visible directly in source) as the only valid token — this is a hardcoded backdoor credential checked into the repo. If this route were ever wired to real destructive handlers while that literal remained valid, it would be a serious security hole. As it stands the route is inert (stub), but the pattern itself must not be ported.
**Verdict reasoning:** The route performs no real destructive action today (explicitly a stub) and the "security" gate is a hardcoded bypass string in source — this is not a contract worth keeping even as an idea; a real destructive-action gate needs proper auth from the ground up. RETIRE, and flag the hardcoded token literal specifically so it isn't accidentally copied anywhere.

## POST /api/vnext-build
**Source:** runtime-vnext/register-routes.js:44
**Kind:** route
**Verdict:** ADAPT
**Purpose:** Runs a full vNext site build from a `BuildRequest` body (or a legacy-shaped body normalized via `normalizeLegacyRequest`), returning build status, dist dir, proof report, and gap log.
**Inputs:** body = BuildRequest or legacy shape (mapped by `normalizeLegacyRequest` — biz/brand/content/positioning/deploy/pages fields); calls `runSiteBuild(buildRequest)` from `./server-bridge`.
**Outputs:** `shapeBuildResponse(result)` = `{ status, run_id, dist_dir, workspace_root, proof_report_path, gap_log_path, proof_report, gap_log, error }`.
**Side effects:** triggers a real site build (presumably filesystem writes to a dist/workspace dir, possibly subprocess work inside `runSiteBuild` — not visible in this file); also calls `rejectReasoningAuthority(req, res)` first, which enforces that reasoning-provider/model fields are not set by the caller (Shay owns that authority per a recent repo-wide change).
**Identity:** conditionally explicit. `normalizeLegacyRequest` treats the request as canonical only "if it has a site_tag at the top level" (`legacy.site_tag && legacy.business`); otherwise it builds a request from legacy flat fields (`siteName`, `siteTag`, etc.) — UNDETERMINED from this file alone whether the legacy-shape branch guarantees a resulting `site_tag` is always populated, since that mapping continues past what I read (would need to read the rest of `runtime-vnext/legacy-compat.js` to confirm). Unlike `/api/rebuild-runtime-vnext`, this route does NOT reference the ambient global `TAG` — the site identity comes from the request body in both branches.
**Risks:** if `normalizeLegacyRequest`'s legacy-shape branch can produce a BuildRequest without a populated `site_tag`, a build could run without explicit site identity; also a full build is a heavyweight, possibly slow/resource-intensive operation with no rate limiting visible here.
**Verdict reasoning:** The build-request contract and reasoning-authority guard are worth carrying forward, and identity is body-driven rather than ambient-global, but the legacy-shape normalization path needs verification/rebuilding to guarantee explicit site_tag before it's trusted. ADAPT — keep the BuildRequest contract and the reasoning-authority gate, rebuild request normalization to require an explicit site_tag rather than best-effort deriving one.

## POST /api/vnext-build/cancel
**Source:** runtime-vnext/register-routes.js:75
**Kind:** route
**Verdict:** ADAPT
**Purpose:** Cancels an in-flight runtime-vnext build: aborts either a specific `run_id` or all currently active runs, kills subprocess groups, and broadcasts a `build_cancelled` WebSocket event.
**Inputs:** body `{ run_id }` (optional — if omitted, targets ALL active runs via `activeRunIds()`).
**Outputs:** `{ success: true, cancelled, cancelled_run_ids, killed_pids }`; broadcasts `{ type: 'build_cancelled', content, was_in_progress, cancelled_run_id, killed_pids, timestamp }` over the shared WebSocket (`getWss()`).
**Side effects:** kills OS process groups (`cancelSiteBuild` per target), broadcasts to all connected WS clients regardless of which site/session they belong to.
**Identity:** ambient when `run_id` is omitted — it falls back to `activeRunIds()`, which is process-wide (not scoped to a single site or caller), so a caller with no `run_id` can cancel every build currently running for every site. The WS broadcast also goes to all clients, not just ones interested in the affected site/run.
**Risks:** omitting `run_id` cancels *all* active builds process-wide — a caller for site A could accidentally (or intentionally) cancel site B's in-flight build; the broadcast-to-everyone pattern leaks build-cancellation events across site boundaries too.
**Verdict reasoning:** The kill-subprocess-group mechanics and the "reuse build_cancelled event name" discipline are worth keeping, but the no-run_id-means-cancel-everything fallback and the global broadcast are ambient-scope problems that need explicit per-site/per-caller targeting. ADAPT.

## POST /api/rebuild-runtime-vnext
**Source:** runtime-vnext/register-routes.js:94
**Kind:** route
**Verdict:** RETIRE
**Purpose:** Re-runs a deterministic vNext build for "the current site" by reading its spec, deriving a BuildRequest from that spec, and running the build — used as a rebuild-in-place action.
**Inputs:** no body params consumed for site identity; calls `readSpec()` with zero arguments and `deriveRuntimeVnextRequestFromSpec(spec, tag)` where `tag` is a value captured in the outer closure at route-registration time.
**Outputs:** `shapeBuildResponse(result)`, same shape as `/api/vnext-build`; broadcasts `status` and `runtime-vnext-build-complete` WS events to all clients.
**Side effects:** triggers a real build; broadcasts to all WS clients unconditionally.
**Identity:** confirmed ambient. In `server.js:10123`, this route is registered as `registerRuntimeVnextRoutes({ app, getWss: () => wss, readSpec, tag: TAG })`, and `TAG` is declared at `server.js:93` as `let TAG = process.env.SITE_TAG || readLastSite() || 'site-demo'` — a single mutable, process-global variable representing "whatever site is currently active," reassigned in at least three other places in server.js (lines 5462, 9109, 9172, 20129). This route resolves the site to build purely from that ambient global, never from a request parameter.
**Risks:** this is the textbook case the new system's identity rule exists to prevent — the "current site" is whatever some other, unrelated code path last set `TAG` to, so a request to this endpoint could rebuild the wrong site entirely if another request or background process changed `TAG` in between; also broadcasts build-complete events globally regardless of which site actually rebuilt.
**Verdict reasoning:** Both the route's own `readSpec()` call and its `tag` argument trace directly to the ambient global `TAG` in server.js — this is precisely "resolves a global/ambient site id instead of taking an explicit site id parameter." RETIRE; any rebuild-in-place capability in the new system must take an explicit site_tag/site_id request parameter, following the pattern already correctly used by `server/verification-routes.js`'s `siteTagOr400`.
## USE /api/studio-workflows
**Source:** server.js:1459
**Kind:** route
**Verdict:** ARCHIVE-FOR-FUTURE
**Purpose:** Mounts an external sub-router (`server/studio-workflows-routes.js`) handling multi-step "studio workflow" orchestration, constructed once at boot with `HUB_ROOT`.
**Inputs:** HUB_ROOT only at mount time; per-request inputs are defined inside the sub-router (not read here).
**Outputs:** UNDETERMINED: response shape defined inside `server/studio-workflows-routes.js`, not inspected.
**Side effects:** UNDETERMINED — depends entirely on the sub-router's internals; not traced in this pass.
**Identity:** Mounted with `HUB_ROOT` (hub-wide, not a single site root) — no explicit site id threaded into the sub-router factory at all, so any site scoping happens (or doesn't) inside the sub-router.
**Risks:** Entire capability is opaque from this vantage; sub-router needs its own record before any verdict on the underlying behavior can be trusted.
**Verdict reasoning:** Tagged `event`/workflow orchestration is real product surface but the mount line alone can't establish identity binding or safety — needs a dedicated read of `server/studio-workflows-routes.js` before conversion.

## POST /api/restart
**Source:** server.js:1640
**Kind:** route
**Verdict:** ADAPT
**Purpose:** Restarts the Studio server process by broadcasting a websocket notice and calling `gracefulShutdown()` after a 500ms delay, relying on an external process wrapper to relaunch it.
**Inputs:** No params/body used.
**Outputs:** `{ success: true, message }`; emits a `server-restarting` WS event to all clients; process exits after delay.
**Side effects:** Kills the entire server process for ALL sites/tenants at once — global blast radius, not site-scoped.
**Identity:** No site id at all — this is a whole-process operation, ambient by nature (there is no "site" concept for a process restart). `broadcastJson(wss, ...)` fans out to every connected client regardless of site.
**Risks:** Any operator restarting for one site's sake takes down every other site's live session; no auth/role check visible in this excerpt.
**Verdict reasoning:** The capability (safe restart) is legitimate operator tooling, but the global-process/all-clients shape needs redesign for a multi-tenant new system — take the contract, not the code.

## POST /api/upload
**Source:** server.js:1677
**Kind:** route
**Verdict:** ADAPT
**Purpose:** Handles file uploads: enforces per-site upload limits, sanitizes SVGs, and either imports a page template (HTML/ZIP) or registers a generic asset (optionally promoting it to the canonical site logo).
**Inputs:** `multipart/form-data` file (`upload.single('file')`), `req.body.role/label/notes`; reads `req.ctx.siteTag` only inside the `role === 'template'` branch.
**Outputs:** `{ success, asset, path }` or, for templates, `{ success, message, imported }`; writes to spec.json, `DIST_DIR()/assets/uploads`, and for template ZIPs extracts into `DIST_DIR()`.
**Side effects:** Runs `unzip` via `execSync` on uploaded ZIPs (after path-traversal validation); mutates spec.json; copies files into dist; can overwrite `index.html` and the canonical logo asset; goes through `mutationTx.execute` only for the HTML-template-import sub-case.
**Identity:** Mixed. The `role === 'template'` branch explicitly resolves `uploadSiteTag = req.ctx.siteTag` and calls `requireSiteAuthority(uploadSiteTag, 'upload.template')` (write-safe). Every other branch — the upload-limit check (`currentUploadCapacity()` → ambient `readSpec()`), plain asset registration (`recordUploadedAsset` → ambient `readSpec()`/`writeSpec()`), and logo promotion (ambient `DIST_DIR()`) — resolves the site from the ambient global `TAG`, not an explicit param. Quote: `const { spec, assets: existingUploads, limit: uploadLimit } = currentUploadCapacity();` where `currentUploadCapacity` calls bare `readSpec()`.
**Risks:** ZIP extraction runs a shell command on uploaded content (mitigated by traversal check, but still a spawned process on untrusted input); ambient-site branches would silently upload into whatever site happens to be "active" on the server, not the caller's intended site — a cross-tenant leak risk under concurrent operators.
**Verdict reasoning:** The upload/template-import contract is worth keeping, but the ambient-site paths must be closed (mirror the template branch's explicit `req.ctx.siteTag` everywhere) before this can port — write new code against the same contract rather than pasting.

## PUT /api/upload/:filename
**Source:** server.js:1812
**Kind:** route
**Verdict:** RETIRE
**Purpose:** Updates an uploaded asset's `role`/`label`/`notes` metadata in spec.json by filename.
**Inputs:** `req.params.filename`, `req.body.role/label/notes`.
**Outputs:** `{ success: true, asset }`; writes spec.json.
**Side effects:** Mutates spec.json in place; no file-content changes.
**Identity:** Fully ambient — `readSpec()`/`writeSpec()` take no site argument at all; resolves via the global `TAG`. Quote: `const spec = readSpec();` with no site id anywhere in the handler.
**Risks:** Two operators on different sites could clobber each other's asset metadata if the ambient `TAG` shifts between request start and write (site-switch race).
**Verdict reasoning:** Simple CRUD with zero explicit site binding — the new system forbids exactly this ambient shape, so retire and rebuild the small amount of logic fresh under an explicit-site contract (counts as ADAPT-worthy logic but the route itself, as written, is RETIRE).

## DELETE /api/upload/:filename
**Source:** server.js:1827
**Kind:** route
**Verdict:** RETIRE
**Purpose:** Deletes an uploaded asset file from disk and removes its entry from spec.json.
**Inputs:** `req.params.filename` (validated against `^[a-zA-Z0-9._\-]+$`).
**Outputs:** `{ success: true, filename }`; deletes file via `fs.unlinkSync`; writes spec.json.
**Side effects:** Permanent file deletion from `UPLOADS_DIR()`; spec.json mutation.
**Identity:** Fully ambient — `UPLOADS_DIR()` and `readSpec()`/`writeSpec()` all called with no site argument, resolving via global `TAG`. Quote: `const filePath = path.join(UPLOADS_DIR(), filename);`.
**Risks:** A destructive delete resolved against ambient state is the worst combination — wrong-site deletion is unrecoverable (no version/trash step shown).
**Verdict reasoning:** Destructive + ambient-site is squarely the pattern the new system rejects; retire this exact route and rebuild delete with explicit site id and ideally a soft-delete/versioning step.

## POST /api/remove-background
**Source:** server.js:1959
**Kind:** route
**Verdict:** ADAPT
**Purpose:** Runs background removal (`rembg` worker) on one or more uploaded images, detects dark-section context for shadow styling, injects supporting CSS, and records the resulting knockout image as a new asset in spec.json.
**Inputs:** `req.body.filename` or `req.body.filenames[]`, `req.body.dark_section` (bool); reads files from `UPLOADS_DIR()`.
**Outputs:** `{ results[], errors[], knockout_css_class, rembg_worker }`; writes new `-knockout.png` files to `UPLOADS_DIR()`, mutates spec.json, injects `.fam-knockout` CSS into site pages via `injectKnockoutCss()`.
**Side effects:** Spawns the `rembg` background-removal worker process (`runRembg`) per file — potentially slow/expensive; writes new image files; mutates spec and page CSS.
**Identity:** Fully ambient — `UPLOADS_DIR()`, `readSpec()`/`writeSpec()`, and `injectKnockoutCss()` all called with no site parameter, resolved via global `TAG`.
**Risks:** Expensive external worker invocation with no visible rate limiting beyond the batch loop; ambient site resolution means a concurrent site-switch mid-batch could process the wrong site's uploads or write results into the wrong site.
**Verdict reasoning:** The background-removal + dark-section-detection contract is genuinely useful and worth keeping, but must be rebuilt with explicit site id threaded through every helper call — ADAPT, not port as-is.

## POST /api/cdn-inject
**Source:** server.js:2047
**Kind:** route
**Verdict:** ADAPT
**Purpose:** Injects a CDN `<script>`/`<link>` tag into specified (or all) site pages, idempotently, and records the injection in spec.json.
**Inputs:** `req.body.url/type/pages/position`; validates `url` is `http(s)://` and `type` is `script`/`style`.
**Outputs:** `{ success, tag, updated[], skipped[] }`; writes modified HTML files under `DIST_DIR()`; mutates spec.json `cdn_injections`.
**Side effects:** Direct file writes to every targeted page's HTML in dist; no sanitization of the injected URL content beyond the http(s) check — arbitrary external script tags can be injected into pages.
**Identity:** Fully ambient — `DIST_DIR()` and `readSpec()`/`writeSpec()` called with no site argument. Quote: `const pagePath = path.join(DIST_DIR(), page);`.
**Risks:** Lets a caller inject an arbitrary external `<script src>` into live site pages (supply-chain / XSS-adjacent risk) with only a URL-format check; ambient site resolution risks cross-site injection.
**Verdict reasoning:** The idempotent CDN-injection contract is useful (esp. for the FAM asset variant below) but needs explicit site binding and a stronger allow-list on injectable URLs before it can be trusted — ADAPT.

## DELETE /api/cdn-inject
**Source:** server.js:2094
**Kind:** route
**Verdict:** ADAPT
**Purpose:** Removes a previously injected CDN `<script>`/`<link>` tag matching a URL from specified (or all) site pages, and updates spec.json.
**Inputs:** `req.body.url/pages`.
**Outputs:** `{ success, url, updated[] }`; rewrites page HTML files removing matching tags; mutates spec.json.
**Side effects:** Regex-based removal of script/link tags from live HTML files (regex-based HTML mutation is inherently fragile).
**Identity:** Fully ambient — same `DIST_DIR()`/`readSpec()`/`writeSpec()` pattern with no site parameter.
**Risks:** Regex tag-stripping can silently mis-match or leave partial markup on malformed HTML; ambient site resolution shares the cross-site risk of the POST counterpart.
**Verdict reasoning:** Pairs with the POST injector — same fix needed (explicit site id) and the regex-based HTML surgery should be replaced by a proper DOM-based approach on the way in.

## POST /api/inject-fam-asset
**Source:** server.js:2136
**Kind:** route
**Verdict:** ADAPT
**Purpose:** Copies a first-party FAM asset (fam-motion.js / fam-shapes.css, defined in `lib/fam-assets.js`) into the site's dist and injects its `<script>`/`<link>` tag into target pages, idempotently.
**Inputs:** `req.body.asset/pages`; `asset` must be a key in `FAM_ASSETS`.
**Outputs:** `{ success, asset, dest, updated[], skipped[] }`; copies file into `DIST_DIR()`, writes modified page HTML.
**Side effects:** File copy + HTML mutation across all targeted pages.
**Identity:** Fully ambient — `DIST_DIR()` called with no site argument throughout.
**Risks:** Same ambient cross-site risk as the generic CDN-inject routes; comment in code notes a prior bug where a duplicate local asset table disagreed with the shared one (`lib/fam-assets.js`) — indicates this file has had correctness bugs from divergent sources of truth.
**Verdict reasoning:** Legitimate first-party asset injection, but needs the explicit-site fix; also confirms `lib/fam-assets.js` is the canonical asset table to carry forward, not any inline duplicate.

## GET /api/character-branding
**Source:** server.js:2173
**Kind:** route
**Verdict:** ARCHIVE-FOR-FUTURE
**Purpose:** Returns current character-branding placements for the site plus a summary and available position presets.
**Inputs:** None (no params).
**Outputs:** `{ placements, summary, position_presets }`, all derived from ambient `readSpec()`.
**Side effects:** Read-only.
**Identity:** Ambient — `readSpec()` with no site parameter.
**Risks:** Low (read-only), but returns wrong site's data if ambient TAG is stale.
**Verdict reasoning:** Niche decorative feature (mascot/character placement) not core MVP scope; archive the read contract for a future phase rather than porting now.

## POST /api/character-branding
**Source:** server.js:2184
**Kind:** route
**Verdict:** ARCHIVE-FOR-FUTURE
**Purpose:** Adds or updates a character-branding placement (character/pose/position with styling) for a page, persisting it to spec.json and returning rendered HTML.
**Inputs:** `req.body.page/character/pose/position/classes/inline_style/alt/dark_section`; validates page name regex.
**Outputs:** `{ success, placement, rendered_html }`; mutates spec.json via `characterBranding.addPlacement`.
**Side effects:** spec.json write only (does not itself write to page HTML files — `rendered_html` is returned, presumably inserted client-side or by another route).
**Identity:** Ambient — `readSpec()`/`writeSpec()` with no site argument.
**Risks:** Ambient site write risk; otherwise low-impact (decorative feature).
**Verdict reasoning:** Same niche-feature reasoning as the GET route — real but non-MVP; archive rather than convert now.

## DELETE /api/character-branding
**Source:** server.js:2215
**Kind:** route
**Verdict:** ARCHIVE-FOR-FUTURE
**Purpose:** Removes a character-branding placement (by page/position, optionally character) from spec.json.
**Inputs:** `req.body.page/position/character`.
**Outputs:** `{ success, page, position }`; mutates spec.json via `characterBranding.removePlacement`.
**Side effects:** spec.json write only.
**Identity:** Ambient — `readSpec()`/`writeSpec()` with no site argument.
**Risks:** Ambient site write risk; low blast radius otherwise.
**Verdict reasoning:** Same niche-feature reasoning as its sibling routes — archive as a set for a future phase.

## POST /api/rollback
**Source:** server.js:2257
**Kind:** route
**Verdict:** ADAPT
**Purpose:** Rolls a page back to a prior saved version by timestamp, delegating to `rollbackToVersion(page, timestamp)`.
**Inputs:** `req.body.page/timestamp`; validates page name via `isValidPageName`.
**Outputs:** Whatever `rollbackToVersion` returns — `{ error }` (400) or a success result (200); UNDETERMINED: exact success shape not inspected (defined outside this excerpt).
**Side effects:** Presumably overwrites the live page file with a prior version's content — UNDETERMINED: exact mechanism inside `rollbackToVersion`, not read in this pass.
**Identity:** No `req.ctx.siteTag` visible in the handler itself; `rollbackToVersion` is called with no site argument, so it almost certainly resolves the site ambiently like the sibling version routes (`VERSIONS_DIR()` pattern seen elsewhere in this file takes no site arg by default).
**Risks:** Version rollback is a destructive overwrite of a live page — if resolved against the wrong ambient site, it silently corrupts an unrelated site's content with no visible confirmation step.
**Verdict reasoning:** Rollback/version-history is valuable functionality worth keeping, but must be rebuilt with explicit site id threaded into `rollbackToVersion` and its version-directory resolution — ADAPT, not port.

## PUT /api/brief
**Source:** server.js:2268
**Kind:** route
**Verdict:** ADAPT
**Purpose:** Merges partial fields (goal, audience, tone, visual_direction, content_priorities, must_have_sections, avoid) into the site's `design_brief` in spec.json, with per-field length validation, and broadcasts the update over websockets.
**Inputs:** `req.body` — arbitrary object filtered to an allow-list of keys; 5000-char cap per string field.
**Outputs:** `{ success: true, brief }`; mutates spec.json; broadcasts `{ type: 'spec-updated', spec }` to every connected WS client.
**Side effects:** spec.json write; global WS broadcast to `wss.clients` (all connected clients, not scoped to the site being edited).
**Identity:** Ambient — `readSpec()`/`writeSpec()` with no site argument; the WS broadcast is also unscoped (`wss.clients.forEach`, no site filter), so clients viewing a different site would receive another site's spec update.
**Risks:** Cross-site WS leak — any connected client (regardless of which site it's viewing) receives the full updated spec of whatever site was ambiently active, which could leak another tenant's brief content.
**Verdict reasoning:** The brief-editing contract and validation approach are sound and worth keeping, but both the spec I/O and the WS broadcast need explicit site scoping before this is safe in a multi-tenant system — ADAPT.

## PUT /api/decisions
**Source:** server.js:2293
**Kind:** route
**Verdict:** ADAPT
**Purpose:** CRUD for the site's `design_decisions` log (add/update/delete) with category/status validation, driven by an `action` discriminator in the body.
**Inputs:** `req.body.action/index/decision` (`decision.category/decision/status`); category and status are validated against fixed enums.
**Outputs:** UNDETERMINED beyond the visible add/update/delete branches — final response line not in the read excerpt (likely `res.json({ success: true, decisions: spec.design_decisions })` based on sibling routes, but not confirmed).
**Side effects:** spec.json mutation (push/update/splice on `design_decisions`).
**Identity:** Ambient — `readSpec()` with no site argument at the top of the handler.
**Risks:** Ambient-site write risk shared with all sibling spec-mutation routes in this section; index-based update/delete is race-prone under concurrent edits (no optimistic locking visible).
**Verdict reasoning:** Reasonable CRUD contract worth keeping, but same ambient-site problem as `/api/brief` — rebuild with explicit site id and consider replacing index-based addressing with stable ids.

## POST /api/bulk-generate-placeholders
**Source:** server.js:2839
**Kind:** route
**Verdict:** ADAPT
**Purpose:** Manually triggers bulk placeholder image generation for the site via `bulkGeneratePlaceholders(null)`.
**Inputs:** None (no body fields read); calls the helper with `null`.
**Outputs:** Whatever `bulkGeneratePlaceholders` returns — signature shown earlier in file as `{ generated, replaced }`.
**Side effects:** Generates and presumably writes placeholder images/content — UNDETERMINED exact write targets, since `bulkGeneratePlaceholders`'s body isn't in this excerpt, but its call pattern (`null` arg) mirrors the other ambient helpers in this file.
**Identity:** Ambient — `bulkGeneratePlaceholders(null)` takes no site id; the `null` argument suggests the function itself resolves site state internally via globals.
**Risks:** Bulk generation against ambient site state risks generating/overwriting placeholders for the wrong site.
**Verdict reasoning:** Useful bulk-operation contract, but the ambient resolution must be replaced with an explicit site id parameter — ADAPT.

## POST /api/sync-content-fields
**Source:** server.js:2847
**Kind:** route
**Verdict:** ADAPT
**Purpose:** Syncs `data-field-id` attributes from built HTML pages back into `spec.content`, idempotently (adds new fields, never overwrites existing spec content).
**Inputs:** `req.body.pages` (array or null for all pages).
**Outputs:** `{ success: true, total_fields, pages }` where `pages` is the list of registered page keys in `spec.content`.
**Side effects:** Calls `syncContentFieldsFromHtml(pages)` (writes into spec presumably) and reads `readSpec()` afterward.
**Identity:** Ambient — `syncContentFieldsFromHtml(pages)` takes no site id, and `readSpec()` is called with no argument.
**Risks:** Ambient site resolution; errors are caught and returned as 500 with message (reasonable error handling, at least).
**Verdict reasoning:** Sound idempotent-sync contract worth keeping, but needs explicit site id threading — ADAPT.

## POST /api/sync-nav
**Source:** server.js:2860
**Kind:** route
**Verdict:** ADAPT
**Purpose:** Extracts nav markup from a source page (default `index.html`) and syncs it into a shared nav partial applied across pages.
**Inputs:** `req.body.page` (defaults to `index.html`).
**Outputs:** `{ success: true, source, synced }` from `syncNavPartial(null)`'s result.
**Side effects:** Calls `syncNavFromPage(null, sourcePage)` then `syncNavPartial(null)` — both take `null` as a first arg, mutating nav content across site pages.
**Identity:** Ambient — both helper calls pass `null` where a site id would go; no `req.ctx.siteTag` used.
**Risks:** Cross-page nav sync mutates multiple files at once; wrong-site resolution multiplies the blast radius across every page of the wrong site.
**Verdict reasoning:** The nav-sync-from-source-page contract is valuable and should be kept, but the `null`-site-id calling convention needs to become an explicit parameter — ADAPT.

## POST /api/sync-footer
**Source:** server.js:2871
**Kind:** route
**Verdict:** ADAPT
**Purpose:** Same as `/api/sync-nav` but for the footer partial — extracts footer markup from a source page and syncs it across the site.
**Inputs:** `req.body.page` (defaults to `index.html`).
**Outputs:** `{ success: true, source, synced }`.
**Side effects:** `syncFooterFromPage(null, sourcePage)` then `syncFooterPartial(null)` — multi-file mutation across pages.
**Identity:** Ambient — identical `null`-site-id pattern as `/api/sync-nav`.
**Risks:** Same as sync-nav: multi-file mutation multiplies wrong-site blast radius.
**Verdict reasoning:** Same reasoning as its nav sibling — keep the contract, close the ambient-site gap.

## POST /api/replace-placeholder
**Source:** server.js:2883
**Kind:** route
**Verdict:** ADAPT
**Purpose:** Replaces an exact image `src` value with a new one across all pages of the site, via regex substitution inside `<img>` tags.
**Inputs:** `req.body.oldSrc/newSrc`.
**Outputs:** `{ replaced: totalReplaced, pages: modifiedPages }`.
**Side effects:** Regex-based rewrite of every page's HTML file where the src matches; direct `fs.writeFileSync` per modified page.
**Identity:** Fully ambient — `DIST_DIR()` called with no site argument; `listPages()` likewise ambient.
**Risks:** Regex replacement on raw HTML is fragile (could match unintended occurrences of the string, e.g. inside a different attribute or a URL substring); no escaping/validation of `newSrc` content before insertion into HTML (self-XSS-adjacent if `newSrc` is attacker-influenced).
**Verdict reasoning:** Legitimate bulk-replace utility, but needs both explicit site id and a safer (DOM-based, not regex) replacement strategy — ADAPT.

## POST /api/replace-slot
**Source:** server.js:2912
**Kind:** route
**Verdict:** ADAPT
**Purpose:** Replaces the image at a named `data-slot-id` with a new src across the site's pages using `patchSlotImg`, updates `media_specs` status, records the mapping in `spec.slot_mappings` for rebuild persistence, and deletes any stale stock photo for that slot.
**Inputs:** `req.body.slot_id` (validated `^[a-z0-9-]+$`), `req.body.newSrc` (validated string, ≤1000 chars).
**Outputs:** `{ success: updated, slot_id, page: updatedPage }`.
**Side effects:** Writes modified page HTML, deletes an old stock-photo file if present (`fs.unlinkSync`), mutates spec.json (`media_specs`, `slot_mappings`).
**Identity:** Fully ambient — `DIST_DIR()`, `listPages()`, `readSpec()`/`writeSpec()` all called with no site argument. Quote: `const distDir = DIST_DIR();` with no site parameter anywhere in the handler.
**Risks:** Deletes a file (`oldStockPath`) based on ambient site resolution — wrong-site deletion risk compounds the wrong-site-write risk already present in this file's pattern.
**Verdict reasoning:** The slot-based replacement + persistence-mapping contract is exactly the kind of mechanism the rebuild wants, but it must be re-anchored on an explicit site id before conversion — ADAPT.

## POST /api/clear-slot-mapping
**Source:** server.js:2964
**Kind:** route
**Verdict:** ADAPT
**Purpose:** Clears a single slot's stored mapping from `spec.slot_mappings` (used by a "Clear" button in the QSF UI).
**Inputs:** `req.body.slot_id` (validated `^[a-z0-9-]+$`).
**Outputs:** UNDETERMINED: final response line not in the read excerpt (cut off after the `delete`/`writeSpec` block), but pattern strongly suggests `res.json({ success: true, slot_id })`.
**Side effects:** Deletes a key from `spec.slot_mappings` and writes spec.json if the mapping existed.
**Identity:** Ambient — `readSpec()`/`writeSpec()` with no site argument.
**Risks:** Low-impact mutation (metadata only, no file deletion), but still ambient-site-scoped.
**Verdict reasoning:** Small, safe utility worth keeping; needs the same explicit-site-id fix as its sibling slot routes — ADAPT.

## POST /api/sites
**Source:** server.js:5329
**Kind:** route
**Verdict:** RETIRE
**Purpose:** A compatibility alias that proxies to `/api/new-site` by making a loopback HTTP request to `localhost:PORT/api/new-site`.
**Inputs:** `req.body` (forwarded verbatim as JSON).
**Outputs:** Proxies whatever `/api/new-site` returns, forwarding status code and body (JSON or raw text on parse failure).
**Side effects:** Makes an internal HTTP self-call (`http.request` to its own port) — a self-network-hop for no apparent reason other than legacy client compatibility.
**Identity:** No explicit site id itself (site creation happens downstream in `/api/new-site`); the self-proxy pattern adds latency and failure surface with zero benefit.
**Risks:** A same-process HTTP loopback call is a known anti-pattern — it can deadlock or exhaust connections under load, and silently duplicates whatever `/api/new-site` already does.
**Verdict reasoning:** This is dead-weight compatibility shimming, not a distinct capability — the premise (proxy to another route via HTTP) is one the rebuild should reject outright; retire and have old clients call `/api/new-site` directly.

## GET /api/sites
**Source:** server.js:5348
**Kind:** route
**Verdict:** ADAPT
**Purpose:** Lists all sites under `SITES_ROOT` with display name, state, deployed URL, "is current" flag, last-updated timestamp, and client-approval metadata (client_name, monthly_rate, approved_at) read per-site from each site's own spec.json.
**Inputs:** None (scans `SITES_ROOT` directory).
**Outputs:** `{ sites: [...] }` array, each entry per-site metadata; read-only, no writes.
**Side effects:** None — pure filesystem read across all sites.
**Identity:** Reads every site's spec.json individually by its own tag (`path.join(SITES_ROOT, d, 'spec.json')`) — this is the one place identity is handled correctly, since it's inherently a cross-site listing. The only ambient reference is `d === TAG` to flag which site is "current" for the UI, which is a legitimate UI-only comparison, not a mutation authority.
**Risks:** Reads every site's spec.json synchronously in a loop (`fs.statSync`/`fs.readFileSync` per site) — could be slow with many sites; comments note prior correctness bugs around not conflating a "field" (updated_at) with a "capability."
**Verdict reasoning:** A cross-site listing route is legitimately allowed to touch multiple sites by tag; keep the contract (per-site explicit reads) but rebuild for efficiency/pagination — ADAPT.

## POST /api/projects/:tag/archive
**Source:** server.js:5402
**Kind:** route
**Verdict:** KEEP-CONVERT
**Purpose:** Archives a site (moves it out of the active working set into `.archive`, keeping all bytes) via `siteLifecycle.archiveSite`, refusing if the site is live or protected.
**Inputs:** `req.params.tag`, `req.body.dryRun`.
**Outputs:** `{ ok, tag, archivedTo, bytes, dryRun }` on success; `{ ok: false, refusals, tag }` (409) on refusal.
**Side effects:** Moves site directory to `SITES_ROOT/.archive`; logs the archive action.
**Identity:** Explicit — `tag = req.params.tag` is used directly to build `siteDir`; `activeTag: TAG` is passed in only as a comparison value (to detect "is this the currently active site"), not as the resolution target — the operated-on site is always the explicit `:tag` param.
**Risks:** None major — comments describe this as deliberately the "softer default," safe even for live sites since bytes are preserved.
**Verdict reasoning:** Already built to explicit-site-id discipline with the ambient `TAG` used only for a legitimate is-current comparison; the safety-first archive-before-delete design is exactly right — port mechanically.

## DELETE /api/projects/:tag
**Source:** server.js:5429
**Kind:** route
**Verdict:** KEEP-CONVERT
**Purpose:** Deletes a site via `siteLifecycle.deleteSite`, which refuses to delete a live site (checked by liveness response, not a spec flag) or the sole copy of something live, and archives first so deletion stays recoverable.
**Inputs:** `req.params.tag`, `req.query.dryRun`; reads the target site's own spec.json to get `deployed_url`/`production_url`/`staging_url` for the liveness check.
**Outputs:** `{ ok, success, tag, archivedTo, bytes, dryRun }` on success; `{ ok: false, success: false, tag, refusals, facts }` (409) on refusal.
**Side effects:** Archives then deletes the site directory; async liveness check presumably makes a network request to `liveUrl` (inside `siteLifecycle.deleteSite`, not shown here).
**Identity:** Explicit — `tag = req.params.tag` drives every path constructed (`siteDir`, spec read); `activeTag: TAG` is passed only as a comparison value, same pattern as the archive route.
**Risks:** Comment documents a real historical incident: a prior version trusted a spec field for liveness and nearly destroyed a 17-file site that was live and had no other copy — this version fixes it by checking liveness "BY RESPONSE." Any regression on that liveness check is high severity (irrecoverable data loss for the wrong reason).
**Verdict reasoning:** Explicit site-id addressing plus a hard-won safety design (archive-first, response-verified liveness) makes this genuinely worth porting close to as-is — KEEP-CONVERT, but preserve the liveness-by-response check exactly.

## POST /api/switch-site
**Source:** server.js:5450
**Kind:** route
**Verdict:** RETIRE
**Purpose:** Switches the server's globally active site: ends the current session, reassigns the module-level `TAG` variable to the new site, resets in-memory state (current page, mode, message count, session timers, shay-shay sessions), reloads studio state, and broadcasts the change to every connected websocket client.
**Inputs:** `req.body.tag`.
**Outputs:** `{ success: true, tag: TAG, pages, currentPage }`; broadcasts `site-switched`/`pages-updated`/`spec-updated` WS events to ALL connected clients.
**Side effects:** Mutates the process-wide global `TAG` variable — literally the ambient-state mechanism this entire file is built on. Quote: `TAG = newTag;`. Also calls `invalidateSpecCache()`, `writeLastSite(TAG)`, resets session counters, and force-pushes state to every WS client regardless of which site they were viewing.
**Identity:** This route IS the ambient-state authority — it is the single place that sets the global site context every other ambient route (`readSpec()`, `DIST_DIR()`, etc.) implicitly reads afterward. Quote: `TAG = newTag; ... invalidateSpecCache();`.
**Risks:** In a multi-operator/multi-tab environment this is catastrophic: one client switching sites silently redirects every other connected client's ambient context and broadcasts another site's data to them (`spec-updated` sent to all `wss.clients`) — a direct cross-tenant data leak, and the root cause of the ambient-state pattern flagged throughout this file.
**Verdict reasoning:** This route is the premise the rebuild explicitly rejects — a single mutable global site pointer shared by all requests/connections. There is no mechanical fix; the new system must carry site id per-request/per-connection from the start, so retire outright rather than adapt.

## POST /api/new-site
**Source:** server.js:5494
**Kind:** route
**Verdict:** KEEP-CONVERT
**Purpose:** Creates a new site: sanitizes the caller-supplied tag, validates an allow-listed `tier` value, builds an initial design brief from body fields, and delegates to the shared `createSite()` helper for sanitization, identity check, directory creation, atomic spec write, and (per its own comment) a TAG switch + WS notification.
**Inputs:** `req.body.tag/name/business_type/tier/client_brief`.
**Outputs:** `{ success: true, tag: result.tag }` on success; `{ error, error_code }` (400) on tag collision or invalid tier.
**Side effects:** Creates a new site directory + spec.json via `createSite()`; per the route's own comment, `createSite()` also performs "TAG switch + WS notification" as part of creation — i.e. this route indirectly triggers the same global-`TAG`-mutation side effect flagged in `/api/switch-site`.
**Identity:** The route itself passes an explicit `tag: newTag` into `createSite()` — genuinely explicit at the call site — but `createSite()`'s documented behavior (switching the global `TAG` after creation) means the underlying helper still participates in the ambient-state pattern. Quote (route comment): "createSite() ... performs sanitization, identity check, directory creation, atomic spec write, and TAG switch + WS notification."
**Risks:** New-site creation forcing an ambient TAG switch means creating a site automatically (and invisibly to other connected operators) redirects the whole server's active context — same cross-tenant leak class as `/api/switch-site`, just triggered as a side effect of creation rather than the primary intent.
**Verdict reasoning:** The validation (tier allow-list, tag sanitization, collision handling via `on_collision: 'error'`) and brief-construction logic are solid and worth porting close to as-is; strip out the `createSite()`-internal TAG-switch/broadcast side effect on the way in so creation no longer mutates ambient state — KEEP-CONVERT with that one surgical removal.

## POST /api/interview/start
**Source:** server.js:5554
**Kind:** route
**Verdict:** ADAPT
**Purpose:** Starts or resumes a client-onboarding interview for "the active site" — returns the first question, resumes a partial interview in progress, or immediately completes if the interview was already done or `mode === 'skip'`.
**Inputs:** `req.body.mode` (`quick`/`detailed`/`skip`, defaults `quick`).
**Outputs:** `{ completed, client_brief, message }` / `{ resumed, question, mode }` / `{ question, mode }` depending on state; mutates spec.json (`interview_state`, `interview_completed`, `interview_pending`, `client_brief`) via `writeSpec`.
**Side effects:** spec.json write(s) recording interview progress.
**Identity:** Fully ambient — `readSpec()`/`writeSpec()` called with no site argument; the phrase "for the active site" in the doc comment is itself the ambient-state premise made explicit.
**Risks:** An interview answered while the ambient site context is mid-switch (racing `/api/switch-site`) would silently write into the wrong site's client_brief — data corruption for a client-facing intake flow.
**Verdict reasoning:** The state-machine contract (start/resume/skip/complete) is sound and worth keeping, but must be rebuilt against an explicit site id rather than "the active site" — ADAPT.

## POST /api/interview/answer
**Source:** server.js:5602
**Kind:** route
**Verdict:** ADAPT
**Purpose:** Records an answer to the current interview question and advances to the next question or completion.
**Inputs:** `req.body.question_id/answer`.
**Outputs:** UNDETERMINED beyond the guard clauses shown: `{ completed: true, client_brief }` if already done, 400 if no interview in progress or missing `question_id`; the actual answer-processing/advance logic (`try { result = ... }`) is cut off in this excerpt — would need to check what follows line 5618 (`recordAnswer`/similar) for full behavior.
**Side effects:** Presumably mutates `spec.interview_state`/`client_brief` via `writeSpec` (consistent with the sibling `/start` route), though the exact write is past the read window.
**Identity:** Fully ambient — `readSpec()` called with no site argument at the top of the handler, same as `/api/interview/start`.
**Risks:** Same cross-site-write race risk as `/api/interview/start`.
**Verdict reasoning:** Same reasoning as its sibling — keep the interview state-machine contract, close the ambient-site gap on the way in.

## PUT /api/media-specs
**Source:** server.js:5712
**Kind:** route
**Verdict:** ADAPT
**Purpose:** CRUD for the site's `media_specs` array (image slot definitions: slot_id, role, dimensions, status, page), driven by an `action` discriminator (add/update/delete) with per-field enum validation.
**Inputs:** `req.body.action/index/media_spec`; `slot_id` validated `^[a-z0-9-]+$` (≤100 chars); `role` validated against a fixed enum; `status` validated against a fixed enum.
**Outputs:** `{ success: true, media_specs: spec.media_specs }`.
**Side effects:** spec.json mutation (push/Object.assign/splice on `media_specs`).
**Identity:** Ambient — `readSpec()`/`writeSpec()` with no site argument.
**Risks:** Index-based update/delete is race-prone under concurrent edits, same as `/api/decisions`; ambient-site write risk.
**Verdict reasoning:** Solid validated CRUD contract worth keeping; needs explicit site id and ideally stable-id addressing instead of array index — ADAPT.

## POST /api/rescan
**Source:** server.js:5766
**Kind:** route
**Verdict:** ADAPT
**Purpose:** Rescans all site pages to re-register `data-slot-id` media slots into `spec.media_specs` and reconcile/remove orphaned slot mappings that no longer exist in the HTML.
**Inputs:** None.
**Outputs:** `{ success: true, slots_registered, orphans_removed, pages_scanned, orphans }`.
**Side effects:** Calls `extractAndRegisterSlots(listPages())` and `reconcileSlotMappings()` — both mutate spec.json's slot registry.
**Identity:** Fully ambient — `readSpec()`, `listPages()`, `extractAndRegisterSlots()`, `reconcileSlotMappings()` all called with no site argument.
**Risks:** A full-site reconciliation pass against the wrong ambient site could silently delete legitimate slot mappings it believes are orphaned.
**Verdict reasoning:** Useful self-healing reconciliation logic worth keeping, but needs explicit site id threaded through every helper — ADAPT.

## POST /api/generate-image-prompt
**Source:** server.js:5783
**Kind:** route
**Verdict:** ADAPT
**Purpose:** Generates an AI image-generation prompt for a given slot, inferring suggested image dimensions from the slot's role/name (logo, favicon, hero, gallery, team, testimonial, service, etc.) or from a matched `media_specs` entry, using the site's design brief for context.
**Inputs:** `req.body.slot/context`; reads `spec.design_brief` and `spec.media_specs`.
**Outputs:** UNDETERMINED beyond the dimension-inference logic shown — final prompt-construction and response shape are past the read window (cut off after the dimension `if`/`else if` chain).
**Side effects:** Read-only against spec (no `writeSpec` call visible in the read portion) — UNDETERMINED whether the unread remainder writes anything.
**Identity:** Ambient — `readSpec()` called with no site argument.
**Risks:** Low if genuinely read-only; ambient site read could return the wrong site's brief/media_specs context, producing a prompt themed for the wrong business.
**Verdict reasoning:** The dimension-inference heuristics (regex-matched slot-name → aspect ratio) are a nice, reusable piece of domain logic worth keeping; needs explicit site id and a full read of the untruncated remainder before final conversion — ADAPT.

## POST /api/stock-photo
**Source:** server.js:5941
**Kind:** route
**Verdict:** ADAPT
**Purpose:** Fills an image slot with a stock photo: resolves or auto-registers the slot spec, builds a contextual search query from the site's business name/industry, spawns a `scripts/stock-photo` CLI script (with provider API keys from settings) to fetch and save the image, then patches the slot's `src` in every page and records the mapping/status in spec.json.
**Inputs:** `req.body.slot_id/query/width/height`; reads `loadSettings().stock_photo` for provider API keys (Unsplash/Pexels/Pixabay).
**Outputs:** `{ success: true, slot_id, src, query: finalQuery, updated }`.
**Side effects:** Spawns a child process (`execFileSync` on `scripts/stock-photo`, 30s timeout) with API keys injected via env; writes the downloaded image to `DIST_DIR()/assets/stock/<slot_id>.jpg`; mutates HTML across all pages; writes spec.json.
**Identity:** Fully ambient — `readSpec()`, `DIST_DIR()`, `listPages()`, `writeSpec()` all called with no site argument throughout.
**Risks:** Spawns an external process with third-party API keys — a failure/hang could exhaust the 30s timeout per request; ambient site resolution means the wrong site's business name/industry could leak into a stock-photo search query, and the result could be written into the wrong site's dist entirely.
**Verdict reasoning:** The auto-register-then-fill contextual stock-photo contract is valuable and worth keeping, but requires explicit site id threading and probably moving the CLI spawn to a proper async job — ADAPT.

## POST /api/stock-apply
**Source:** server.js:6031
**Kind:** route
**Verdict:** ADAPT
**Purpose:** Applies a pre-selected (already-searched) stock photo URL to a slot: validates the URL, downloads it (following one redirect) into `dist/assets/stock`, patches the slot in every page's HTML, updates spec.json's slot status/mapping, and logs a media-operation telemetry entry.
**Inputs:** `req.body.slot_id/image_url/credit/provider/query/width/height`; validates `image_url` is a well-formed http(s) URL.
**Outputs:** `{ success: true, slot_id, src, updated }`.
**Side effects:** Downloads a remote file via raw `http`/`https` (following exactly one redirect, no size cap visible) to `DIST_DIR()/assets/stock/<slot_id>.jpg`; mutates HTML across pages; writes spec.json; calls `logMediaOperation({..., site: TAG, siteDir: SITE_DIR(), ...})`.
**Identity:** Mostly ambient — `DIST_DIR()`, `listPages()`, `readSpec()`/`writeSpec()` called with no site argument; the telemetry call is the one place that's explicit-looking but actually still ambient underneath: `site: TAG, siteDir: SITE_DIR()` both read the global `TAG`, not a request-scoped id. Quote: `logMediaOperation({... site: TAG, ... siteDir: SITE_DIR() ...})`.
**Risks:** Downloading an arbitrary user-supplied URL server-side with only a protocol check is an SSRF-adjacent risk (no host allow-list, could target internal network addresses); no download size limit visible, so a large/slow response could tie up the request; ambient site write risk shared with `/api/stock-photo`.
**Verdict reasoning:** The apply-pre-selected-photo contract and its telemetry logging are worth keeping, but needs explicit site id everywhere (including in the telemetry call) plus SSRF hardening on the download step — ADAPT.

## POST /api/share
**Source:** server.js:6111
**Kind:** route
**Verdict:** ADAPT
**Purpose:** Shares the current site via email (SMTP through nodemailer-style provider config) or (per the truncated remainder) presumably other channels, falling back to a `mailto:` link if email isn't configured.
**Inputs:** `req.body.type/recipient/message/subject`; reads `loadSettings().email` for SMTP credentials (Gmail/Outlook/SendGrid/custom).
**Outputs:** For unconfigured email: `{ success: false, fallback: 'mailto', error, mailto }`; for configured email: UNDETERMINED — the actual send call and final response are past the read window (cut off mid-provider-map construction).
**Side effects:** Sends an outbound email carrying user-controlled `recipient/message/subject` through configured SMTP credentials — a real external network call with the site owner's mail credentials.
**Identity:** No explicit site id used in the excerpt read; the "current site" being shared is implicitly whatever `readSpec()`/ambient state would resolve for content (not directly shown in this excerpt, but consistent with every neighboring route).
**Risks:** Sending email through the account's own SMTP credentials on arbitrary caller-supplied `recipient` is an abuse vector (could be used to spam/phish through the site's own mail reputation) if this endpoint isn't otherwise gated by auth; UNDETERMINED whether the untruncated remainder validates `recipient` format or rate-limits.
**Verdict reasoning:** Share-via-email is a legitimate feature worth keeping, but needs explicit site-id binding for the content being shared, plus abuse controls (recipient validation/rate limiting) on the way in — ADAPT; needs a follow-up read of the untruncated handler before a confident final call.

## POST /api/summarize
**Source:** server.js:6276
**Kind:** route
**Verdict:** ADAPT
**Purpose:** Kicks off asynchronous session-summary generation for the current site (fire-and-forget — returns immediately without waiting for completion).
**Inputs:** None.
**Outputs:** `{ status: 'summary generation started' }`; does not report the actual summary result to the caller.
**Side effects:** Calls `generateSessionSummary()` which (based on sibling functions in this file, e.g. `SUMMARIES_DIR(siteTag)`) writes a summary file/log — exact target UNDETERMINED without reading `generateSessionSummary`'s body.
**Identity:** `generateSessionSummary()` is called with no arguments, so it resolves site context ambiently, consistent with the ambient `SUMMARIES_DIR()` pattern used elsewhere in this file.
**Risks:** Fire-and-forget with no completion signal — the caller has no way to know if the summary actually generated or errored, and no site id means it could silently summarize/misattribute the wrong site's session if TAG shifts mid-flight.
**Verdict reasoning:** Async summary generation is a reasonable feature, but the ADAPT verdict is driven by two issues: (1) ambient site resolution, and (2) a fire-and-forget response that reports success it hasn't verified — both need fixing before this ports; rebuild with explicit site id and either a job id to poll or a completion callback.

## POST /api/blueprint
**Source:** server.js:6630
**Kind:** route
**Verdict:** ADAPT
**Purpose:** Merges incoming page/global blueprint changes (titles, sections, components, layout_notes per page) into the site's `blueprint.json`, validating page names and preserving existing fields not present in the incoming payload.
**Inputs:** `req.body.pages` (map of page name → `{title, sections, components, layout_notes}`), `req.body.global`.
**Outputs:** The merged blueprint object `bp` (full JSON).
**Side effects:** Writes `blueprint.json` via `writeBlueprint(bp)`.
**Identity:** Fully ambient — `readBlueprint()`/`writeBlueprint()` resolve their file path via `BLUEPRINT_FILE()` → `SITE_DIR()` → the global `TAG`, with no site parameter anywhere in the route or the helper functions. Quote (helper, server.js:533): `function BLUEPRINT_FILE() { return path.join(SITE_DIR(), 'blueprint.json'); }`.
**Risks:** Ambient-site write risk shared with every other spec/blueprint route in this file; per-page merge logic is otherwise sound (preserves unspecified fields).
**Verdict reasoning:** The merge-preserving-unspecified-fields contract is worth keeping, but `SITE_DIR()`'s ambient resolution must be replaced with an explicit site id parameter threaded through `BLUEPRINT_FILE`/`readBlueprint`/`writeBlueprint` — ADAPT.

## POST /api/build/cancel
**Source:** server.js:6650
**Kind:** route
**Verdict:** KEEP-CONVERT
**Purpose:** Cancels an in-progress build: kills the active build's child processes (via `killBuildProcesses(buildOwnerWs)`) before clearing the in-progress lock flag, specifically to avoid the bug of clearing the lock while work silently continues in the background.
**Inputs:** None (operates on module-level `buildInProgress`/`buildOwnerWs`/`currentBuildRunId` state).
**Outputs:** UNDETERMINED: final response body is past the read window (cut off after the cancellation log line), but the shape is almost certainly `{ success: true, wasInProgress, cancelledRunId }` based on the captured locals.
**Side effects:** Terminates spawned build subprocesses (kill signal via `killBuildProcesses`); clears the `buildInProgress` lock via `setBuildInProgress(false)`.
**Identity:** No explicit site id — build state (`buildInProgress`, `buildOwnerWs`, `currentBuildRunId`) is tracked as module-level globals, implicitly scoped to whatever site's build was running. In a single-build-at-a-time server this is a process-wide lock rather than strictly a "site id" ambient read, but it inherits the same single-tenant assumption as the rest of the file.
**Risks:** Kill-before-clear-lock ordering is explicitly the fix for a real prior bug (background work continuing after lock clear) — this is hard-won correctness worth preserving exactly; in a concurrent-builds world this would need per-build-run identity rather than a single global lock.
**Verdict reasoning:** The kill-then-clear-lock sequencing is a genuine correctness fix worth porting mechanically; the underlying single-global-build-lock model will need to become per-site/per-run in the new system, but the cancellation sequencing itself is right — KEEP-CONVERT with the lock generalized to be run-scoped.

## POST /api/shay-shay/new-conversation
**Source:** server.js:6866
**Kind:** route
**Verdict:** KEEP-CONVERT
**Purpose:** Clears the Shay-Shay conversation session cookie(s) for one or both surfaces ("lite" and/or "desk"), forcing a fresh conversation id to be minted on next use.
**Inputs:** `req.body.surface` (`'lite' | 'desk' | 'all'`, defaults `'all'`).
**Outputs:** `{ ok: true, cleared: [...] }` listing which surfaces were cleared.
**Side effects:** Clears cookies via `_clearShaySessionCookie(res, ...)` for the targeted surface(s); logs a diagnostic line to stderr (`console.error('[session-diag] ...')`).
**Identity:** No site id involved at all — this operates purely on a per-browser-session cookie for conversation identity (lite/desk surface), not on site data. Not an ambient-site-state case; it's a session/cookie operation scoped correctly to the request/response pair.
**Risks:** Low — cookie clearing is inherently scoped to the requesting client's cookies; the diagnostic `console.error` for a non-error condition is a minor logging-hygiene issue, not a correctness risk.
**Verdict reasoning:** Clean, small, correctly-scoped capability (per-request cookie clearing) with no ambient-site problem to fix — port mechanically, optionally downgrading the diagnostic log from `console.error` to `console.log`/`debug`.
## POST /api/shay-shay
**Source:** server.js:6914
**Kind:** route
**Verdict:** ADAPT
**Purpose:** Main Shay-Shay conversational orchestrator endpoint — routes a chat message through tier-0 deterministic intents, slash commands (`/studio on|off|status`), bridge-result handling, and async job dispatch (character pipeline, autonomous build, build request/confirm).
**Inputs:** body: `message`, `context`, `bridge_result`, `surface`, `handoff_context`, `images`; cookie-based `conversation_id` session; env for reasoning-provider gating.
**Outputs:** JSON response varying by intent (text response, job dispatch confirmation, studio-tier state); side-channel WS broadcasts for async jobs; queues notifications for later turns.
**Side effects:** Mints/reads session cookies, spawns async pipelines (character generation, autonomous build) via `setImmediate`, writes to suggestion logger, mutates `shayShaySessions` map, sets global "current Shay context" for tool handlers.
**Identity:** Ambient fallback — `requestContext.site_tag = context.site_tag || TAG` (line ~6989 area). Explicit `site_tag` can be passed in `context` but silently falls back to the module-global active-site `TAG` when absent.
**Risks:** Enormous, deeply stateful handler (hundreds of lines); reasoning-authority gate (`shayProvider.findReasoningAuthority`) is safety-critical and easy to regress; ambient TAG fallback means a misconfigured client silently talks about the wrong site.
**Verdict reasoning:** The conversational contract (tier-0 routing, notification draining, bridge state) is the right idea and clearly load-bearing, but the implementation mixes ambient site resolution with per-request context — rewrite with mandatory explicit site_id, no TAG fallback.

## POST /api/shay-shay/gap
**Source:** server.js:7345
**Kind:** route
**Verdict:** RETIRE
**Purpose:** Explicit gap-logging endpoint — records a capability gap message under the active site.
**Inputs:** body: `message`, `category`, `capability_id`.
**Outputs:** `{ logged: true, entry }` from `gapLogger.logGap`.
**Side effects:** Writes a gap-log entry via `gapLogger.logGap(TAG, ...)`.
**Identity:** Fully ambient — `gapLogger.logGap(TAG, message, ...)` passes the module-global `TAG` directly; no request-supplied site id exists at all.
**Risks:** Any gap logged here is silently mis-attributed if the server's ambient TAG doesn't match the site the caller actually means.
**Verdict reasoning:** No explicit site id path exists to adapt from — this is a pure ambient-state route with a trivial contract, cheaper to rebuild from scratch than to salvage.

## POST /api/shay-shay/outcome
**Source:** server.js:7360
**Kind:** route
**Verdict:** KEEP-CONVERT
**Purpose:** Records whether Fritz accepted or dismissed a previously logged Shay-Shay suggestion.
**Inputs:** body: `suggestion_id`, `outcome`.
**Outputs:** `{ logged: true }`.
**Side effects:** Calls `suggestionLogger.logOutcome(suggestion_id, outcome)` — write to suggestion log.
**Identity:** No site binding involved at all (keyed by `suggestion_id`, not site) — not an ambient-state violation.
**Risks:** None observed beyond missing input validation on `outcome` value (not checked against an allowed set in this snippet).
**Verdict reasoning:** Small, mechanical, site-agnostic — ports directly with minor validation hardening.

## POST /api/studio-patches/applied
**Source:** server.js:8374
**Kind:** route
**Verdict:** ADAPT
**Purpose:** Webhook called by `fam-hub studio patches apply <id>` after a proposed Studio patch is applied/fails; recovers the owning conversation from the patch JSON, broadcasts a WS event, and queues a notification for that conversation's next turn.
**Inputs:** body: `id`, `path`, `status`, `error`, `conversation_id`; reads patch JSON from `.studio-patches/{applied,pending,rejected}/<id>.json`.
**Outputs:** `{ ok: true, broadcasted: true, patch: payload }`; WS broadcast; queued notification.
**Side effects:** Filesystem read of patch record; `wss` broadcast to all connected clients; mutates an in-memory notification queue keyed by conversation_id.
**Identity:** Keyed by `conversation_id`, not site id — bound explicitly (either from patch JSON or body), so no ambient-site leak, but it is part of the self-modifying "Shay edits Studio's own source" patch loop.
**Risks:** This is part of the self-patching control loop (Shay proposing/applying code changes to the Studio codebase itself) — high blast radius if the patch pipeline is trusted incorrectly; broadcasts to all WS clients rather than a scoped audience.
**Verdict reasoning:** The conversation-scoped notification contract is sound and worth keeping, but the self-patch-apply mechanism it supports needs a fresh design in the new system rather than a straight port.

## POST /api/autonomous-build
**Source:** server.js:10104
**Kind:** route
**Verdict:** ARCHIVE-FOR-FUTURE
**Purpose:** Shay-Shay's autonomous site build endpoint — given a natural-language message, drives an end-to-end site creation/build without additional confirmation steps.
**Inputs:** body: `message`, `context`; reasoning-authority gate via `shayProvider.findReasoningAuthority`.
**Outputs:** JSON result of `runAutonomousBuild` — includes `tag` of the newly created site, `build_dispatched`.
**Side effects:** Calls `runAutonomousBuild`, which (per adjacent helper code) creates a new site record and dispatches a build — filesystem/site-registry mutation and async build pipeline trigger.
**Identity:** Explicit — the site is newly created by the call itself (`siteResult.tag`), not resolved from ambient state, though `runAutonomousBuild`'s internals were not fully traced.
**Risks:** UNDETERMINED: full internals of `runAutonomousBuild` (not read in this pass) — need to verify it doesn't fall back to ambient TAG anywhere inside; fully autonomous build-without-confirmation is a higher-risk automation surface than the confirm/cancel two-step used elsewhere in the same file.
**Verdict reasoning:** Real capability (autonomous site scaffolding) but not MVP scope for the rebuild and carries elevated risk as a one-shot autonomous action — archive with a note to revisit once the confirm/cancel pattern (used by `build_request`) is the standard.

## POST /api/research/query
**Source:** server.js:10217
**Kind:** route
**Verdict:** ADAPT
**Purpose:** Ask a research question for a given business vertical and return Shay's synthesized answer.
**Inputs:** body: `vertical`, `question`; gated by `rejectResearchRoutingAuthority` (blocks any request trying to override reasoning provider/source).
**Outputs:** JSON result of `researchRouter.queryResearch(vertical, question)`.
**Side effects:** UNDETERMINED: internals of `researchRouter.queryResearch` not read in this pass — likely network call to a research/LLM backend and possible caching.
**Identity:** Scoped by `vertical`, not by site id — no explicit site_id parameter exists; sibling routes (`/api/research/manual-ingest`, `/api/research/trigger`) that share the same research directory concept use ambient `SITE_DIR()`, so this route likely inherits the same ambient site scoping via `researchRouter`.
**Risks:** UNDETERMINED: whether `researchRouter` internally reads/writes `SITE_DIR()`-scoped files ambiently.
**Verdict reasoning:** The vertical-scoped research-question contract is a reasonable idea to keep, but given the sibling routes' confirmed ambient site coupling, treat the whole research subsystem as needing an explicit-site rewrite rather than a direct port.

## POST /api/research/rate
**Source:** server.js:10235
**Kind:** route
**Verdict:** RETIRE
**Purpose:** Formerly rated research answer quality; now a dead stub.
**Inputs:** none processed.
**Outputs:** `410 { error: 'reasoning telemetry is owned by Shay', code: 'shay_owned' }`.
**Side effects:** none observed — pure stub response.
**Identity:** N/A — no logic executes.
**Risks:** None; already inert in the legacy codebase.
**Verdict reasoning:** Already retired in place (returns 410) — the premise (client-side reasoning telemetry) was explicitly rejected in favor of Shay owning it; nothing to carry forward.

## POST /api/research/manual-ingest
**Source:** server.js:10250
**Kind:** route
**Verdict:** ADAPT
**Purpose:** Accepts manually pasted research content (competitor analysis, articles, etc.), classifies it into structured categories via the Claude SDK, and stores it as a research finding.
**Inputs:** body: `content`, `vertical`, `source_url`, `title`; falls back to `spec?.business_type` for vertical via `readSpec()`.
**Outputs:** UNDETERMINED beyond initial classification setup shown (truncated before full response construction) — writes a structured finding.
**Side effects:** Calls `readSpec()` (ambient), invokes an LLM classification call, writes a research finding record.
**Identity:** Ambient — `readSpec()` reads the module-global active site's spec file with no site_id parameter; `effectiveVertical = vertical || spec?.business_type` leans on that ambient spec when `vertical` is omitted.
**Risks:** LLM classification step could mis-file content under the wrong site's research corpus if TAG/SITE_DIR() is stale.
**Verdict reasoning:** The manual-ingest-and-classify idea is valuable for the research pipeline, but the ambient `readSpec()` fallback needs to become an explicit site_id parameter — rewrite the contract, don't port the ambient read.

## POST /api/memory
**Source:** server.js:10484
**Kind:** route
**Verdict:** KEEP-CONVERT
**Purpose:** Manually add a memory entry (entity_type/entity_id/content) to the memory store.
**Inputs:** body: `entity_type`, `entity_id`, `content`, `category`, `importance`.
**Outputs:** `{ ok: true, id }`.
**Side effects:** `memory.remember(...)` — writes a memory record, source tagged `manual`.
**Identity:** No site_id concept in this contract at all — memory is scoped by `entity_type`/`entity_id`, which the caller supplies explicitly. Not an ambient-site violation.
**Risks:** None observed; straightforward validated write.
**Verdict reasoning:** Small, explicit-input, mechanical route — ports directly.

## POST /api/jobs/approve/:id
**Source:** server.js:10513
**Kind:** route
**Verdict:** ADAPT
**Purpose:** Transition a queued job from pending to approved.
**Inputs:** URL param `id` (job id).
**Outputs:** `{ ok: true, job }`, or `410` with `code: 'shay_owned'` if the job type is a retired reasoning-job type.
**Side effects:** `jobQueue.approveJob(id)` mutates job state in the job store.
**Identity:** Job-id scoped, not site-id scoped in this handler; sibling `GET /api/jobs` supports an optional `site_tag` query filter, implying the underlying job records carry a site tag, but the approve/park handlers here don't validate that the caller's intended site matches the job's site.
**Risks:** No cross-check that the approving caller "owns" the site the job belongs to — a caller from one site context could approve a job belonging to another site (UNDETERMINED whether `jobQueue.approveJob` enforces this internally).
**Verdict reasoning:** Job approval as a concept is sound and worth keeping, but the identity/authorization boundary around job-to-site ownership needs to be designed explicitly rather than assumed — adapt, don't port as-is.

## POST /api/jobs/park/:id
**Source:** server.js:10523
**Kind:** route
**Verdict:** ADAPT
**Purpose:** Transition a pending/blocked job to parked.
**Inputs:** URL param `id` (job id).
**Outputs:** `{ ok: true, job }`.
**Side effects:** `jobQueue.parkJob(id)` mutates job state.
**Identity:** Same as `/api/jobs/approve/:id` — job-id scoped, no explicit site ownership check visible here.
**Risks:** Same site-ownership ambiguity as approve/:id.
**Verdict reasoning:** Same reasoning as the approve endpoint — keep the job-lifecycle idea, redesign the identity/ownership contract.

## POST /api/research/trigger
**Source:** server.js:10588
**Kind:** route
**Verdict:** ADAPT
**Purpose:** Create a stub research markdown file for a given vertical so the operator has a placeholder to fill in.
**Inputs:** body: `vertical` (string, sanitized to a filename-safe slug).
**Outputs:** `{ file, status: 'stub', vertical }`.
**Side effects:** `fs.mkdirSync`/`fs.writeFileSync` under `path.join(SITE_DIR(), 'research')` — creates a new markdown stub file with placeholder headings.
**Identity:** Fully ambient — `SITE_DIR()` resolves the active site directory from module-global state; the route accepts no site_id.
**Risks:** Idempotent-by-filename but scoped entirely to whatever site is currently ambient, not to a caller-specified site — a misrouted request writes into the wrong site's research corpus.
**Verdict reasoning:** The "create a research stub" contract is simple and worth keeping, but it must take an explicit site_id instead of resolving `SITE_DIR()` ambiently.

## POST /api/research/to-brief
**Source:** server.js:10662
**Kind:** route
**Verdict:** ADAPT
**Purpose:** Parse an existing research markdown file (must-haves, key messages sections) into a structured content brief.
**Inputs:** body: `filename`; reads from `path.join(SITE_DIR(), 'research')`, validated against an allowlist of files that actually exist there, with a symlink-escape check.
**Outputs:** UNDETERMINED beyond the extraction loop shown (musthaves/messages arrays) — final brief shape not fully read.
**Side effects:** Filesystem read only in the portion inspected (no write observed in the excerpt).
**Identity:** Fully ambient — same `SITE_DIR()` pattern as `/api/research/trigger`; no explicit site_id in the request.
**Risks:** Path-traversal defenses (realpath check, allowlist) are good practice worth keeping; but still ambient-site scoped.
**Verdict reasoning:** The markdown-to-brief extraction logic and its path-traversal guard are worth carrying forward as a pattern, but re-implemented against an explicit site_id rather than ambient `SITE_DIR()`.

## POST /api/context/refresh
**Source:** server.js:11123
**Kind:** route
**Verdict:** ADAPT
**Purpose:** Manually trigger regeneration of the Studio context file (`studioContextWriter`) used to brief agents on current site state.
**Inputs:** body: `event` (defaults to `'manual_refresh'`).
**Outputs:** `{ success: true, file: ctxFile }` or `500` on failure.
**Side effects:** `studioContextWriter.generate(eventType, { tag: TAG })` — writes a context file to `HUB_ROOT`.
**Identity:** Ambient — passes the module-global `TAG` into the generator; no request-supplied site id.
**Risks:** Context file could describe the wrong site if TAG is stale when triggered externally (e.g., by a script/cron).
**Verdict reasoning:** Regenerating an agent-context brief on demand is a useful capability to keep, but needs an explicit site_id argument instead of ambient TAG.

## POST /api/intel/promote
**Source:** server.js:11175
**Kind:** route
**Verdict:** ADAPT
**Purpose:** Promote an intelligence-report finding into the build backlog/pipeline for follow-up.
**Inputs:** body: `finding_id`.
**Outputs:** `{ promoted_at, finding_id, action_taken }`.
**Side effects:** Calls `generateIntelReport()` (no site param — ambient), reads/writes `intelligence-promotions.json` under `path.join(SITE_DIR(), ...)`.
**Identity:** Fully ambient — both the report generation and the promotions file path resolve via ambient `SITE_DIR()`/default site, no site_id in the request.
**Risks:** A promoted finding could be attributed to the wrong site if the server's ambient state doesn't match caller intent; promotions file is read-modify-written without locking (race risk under concurrent requests, not observed to be handled).
**Verdict reasoning:** Promoting findings into a backlog is a valuable audit-trail pattern worth adapting, but the ambient site resolution and lack of write-locking need redesign.

## POST /api/intel/dismiss
**Source:** server.js:11208
**Kind:** route
**Verdict:** ADAPT
**Purpose:** Dismiss an intelligence finding for the active site, persisted across sessions so it doesn't resurface.
**Inputs:** body: `severity`, `title`, `category`.
**Outputs:** `{ dismissed: true, key }`.
**Side effects:** `loadDismissed()`/`saveDismissed()` — read-modify-write of a dismissed-findings JSON keyed by site tag.
**Identity:** Fully ambient — `const siteTag = TAG;` is a hardcoded line, no request-supplied site id at all despite the data being explicitly site-keyed internally.
**Risks:** Since the store *is* keyed by site tag internally but the tag always comes from ambient global state, a stale/misconfigured server dismisses findings under the wrong site's key.
**Verdict reasoning:** The site-keyed dismissal-persistence idea is sound (worth adapting) — the fix is trivial: accept `site_id` from the request instead of hardcoding `TAG`.

## POST /api/intel/backlog
**Source:** server.js:11226
**Kind:** route
**Verdict:** ADAPT
**Purpose:** Log an intelligence finding directly to the build backlog (bypassing the promote step).
**Inputs:** body: `severity`, `title`, `description`, `category`.
**Outputs:** `{ logged: true, id }`.
**Side effects:** Read-modify-write of `BUILD_BACKLOG_PATH` JSON file; reads a session counter from `STUDIO_FILE()`.
**Identity:** Ambient — entry is stamped `site_tag: TAG` directly; no explicit site id accepted from the request.
**Risks:** Same mis-attribution risk as `/api/intel/promote` and `/dismiss`; backlog file is global (not visibly site-partitioned by path, only by the `site_tag` field), so a corrupted/lost TAG mixes entries across sites in one file.
**Verdict reasoning:** Backlog logging is worth keeping conceptually, but move from a shared file annotated with ambient TAG to an explicit site-scoped store.

## POST /api/intel/run-research
**Source:** server.js:11253
**Kind:** route
**Verdict:** ADAPT
**Purpose:** Run intelligence-driven research (best practices/trends for a vertical) through the shared Shay research seam, storing results for later retrieval (embedding path referenced but not fully shown).
**Inputs:** body: `vertical`, `question`, `topic`; falls back to `spec?.business_type` via ambient `readSpec()` when `vertical` omitted; gated by `rejectResearchRoutingAuthority`.
**Outputs:** UNDETERMINED full shape — truncated before the Pinecone-storage try block completes; on no-answer path returns `{ status: 'no_answer', capability: 'shay', vertical, question, reason }`.
**Side effects:** `researchRouter.queryResearch(...)`; attempts to store results "via integrated embedding path" (likely Pinecone) — network calls to both a research backend and a vector store.
**Identity:** Ambient — `readSpec()` fallback for vertical has no site id; UNDETERMINED whether the embedding-store write is site-scoped.
**Risks:** UNDETERMINED: exact vector-store write path and whether it could cross-contaminate site research indexes; reasoning-authority gate present and appears correctly enforced in the excerpt.
**Verdict reasoning:** The research-to-vector-store pipeline idea is worth adapting given intelligence workflows depend on it, but ambient spec fallback and unverified embedding-write scoping mean it needs a redesigned identity contract, not a straight port.

## GET /api/mutations
**Source:** server.js:11349
**Kind:** route
**Verdict:** ADAPT
**Purpose:** Serve a paginated view of the site's mutation journal (append-only log of applied changes), with retention trimming.
**Inputs:** query: `page`, `limit` (clamped).
**Outputs:** `{ mutations, total, page, topFields }` (topFields construction not fully shown).
**Side effects:** Reads `path.join(SITE_DIR(), 'mutations.jsonl')`; if the log exceeds 1200 lines, **rewrites the file trimmed to the last 1000 entries** (a mutating side effect inside a GET handler).
**Identity:** Fully ambient — `SITE_DIR()` with no site_id parameter.
**Risks:** A GET request causing a file rewrite (retention trim) is a surprising side effect for a read endpoint — could race with concurrent writers to the same mutations.jsonl; ambient site resolution risks trimming/serving the wrong site's journal.
**Verdict reasoning:** The mutation-journal-as-audit-trail concept is exactly the "journaling" pattern the new system wants, but this implementation needs an explicit site_id and the retention-trim side effect moved out of the GET path.

## POST /api/media/log
**Source:** server.js:11494
**Kind:** route
**Verdict:** ADAPT
**Purpose:** Record a media-operation telemetry entry (provider, cost, etc.) for the active site.
**Inputs:** body: arbitrary `data` object; requires `data.provider`.
**Outputs:** `{ success: true, entry }`.
**Side effects:** `logMediaOperation(data)` — writes a telemetry entry; sets `data.siteDir = SITE_DIR()`.
**Identity:** Partial ambient fallback — `data.site = data.site || TAG` accepts an explicit `site` in the body but silently defaults to ambient `TAG` when absent, and always forces `data.siteDir = SITE_DIR()` regardless of the supplied `site`, so even an explicit `site` value doesn't actually change which directory the entry is attributed to.
**Risks:** The `siteDir` is always ambient even when `site` is explicit — a real identity bug: caller-supplied site name and the directory it's logged against can diverge.
**Verdict reasoning:** Media-usage telemetry is worth keeping, but this handler has a genuine site/siteDir mismatch bug on top of the ambient-fallback pattern — needs a full rewrite of the identity binding, not a port.

## POST /api/character/create-anchor
**Source:** server.js:12197
**Kind:** route
**Verdict:** ARCHIVE-FOR-FUTURE
**Purpose:** Generates a reference/anchor character image via Imagen 4 and stores it in the site's character-set spec.
**Inputs:** body forwarded to `createCharacterAnchorCore({ name, description, style, prompt, site_tag })`.
**Outputs:** `{ character_id, anchor_path, character_set }`.
**Side effects:** Calls Google Imagen API (`runGoogleMediaScript`), writes an image file under `assets/characters/<id>/anchor.png`, mutates and writes `spec.character_sets` via `writeSpecForSite`.
**Identity:** Explicit but optional — `getCharacterSiteDir(site_tag)` (server.js:11817) falls back to ambient `SITE_DIR()` only when `site_tag` is falsy/empty; when supplied, it binds correctly to `SITES_ROOT/<tag>`.
**Risks:** Real cost impact (paid Imagen API call) per invocation; falls back to ambient site when `site_tag` omitted, same class of bug as `/api/media/log`.
**Verdict reasoning:** Character/media generation is real, valuable, non-MVP capability with genuine cost and complexity — archive it for a future phase rather than dragging the Imagen/character-pipeline complexity into the rebuild now.

## POST /api/character/generate-poses
**Source:** server.js:12210
**Kind:** route
**Verdict:** ARCHIVE-FOR-FUTURE
**Purpose:** Generates pose variations for an existing character using Leonardo AI (or OpenAI) with the anchor image as init.
**Inputs:** body forwarded to `generateCharacterPosesCore({ character_id, poses, site_tag })`.
**Outputs:** UNDETERMINED full response shape (function body continues past what was read) — builds per-pose prompts and generates images.
**Side effects:** Paid image-generation API calls (Leonardo/OpenAI); writes pose images under the character's asset directory; requires `character_id` to already exist in `spec.character_sets`.
**Identity:** Same `getCharacterSiteDir(site_tag)` pattern as create-anchor — explicit-with-ambient-fallback.
**Risks:** Real API cost per pose; depends on `create-anchor` having run first (hidden coupling via `spec.character_sets`); same ambient-fallback identity issue.
**Verdict reasoning:** Same reasoning as create-anchor — genuine, costly, non-MVP capability; archive for a future phase with the same identity-binding fix noted.

## POST /api/video/generate
**Source:** server.js:12223
**Kind:** route
**Verdict:** ARCHIVE-FOR-FUTURE
**Purpose:** Fire-and-forget Veo video generation from an image + prompt; returns a jobId immediately and streams progress over WebSocket.
**Inputs:** body forwarded to `startVideoGenerateCore({ image_path, prompt, duration_seconds, site_tag })`.
**Outputs:** `{ jobId, status: 'started' }` immediately; async `video-progress`/`video-complete`/`video-error` WS broadcasts.
**Side effects:** Calls `runVeoGeneration` (paid Google Veo API), writes the output mp4 under the site's `assets/video/` dir, writes a video-job status file via `writeVideoJob`, broadcasts to **all** WS clients (not scoped to the requester).
**Identity:** Same `getCharacterSiteDir(site_tag)` explicit-with-ambient-fallback pattern.
**Risks:** Real, potentially significant API cost (video generation); broadcasts progress/completion to every connected WS client regardless of who requested it — cross-session leakage; ambient site fallback.
**Verdict reasoning:** Real capability with meaningful cost and complexity, not MVP — archive; note the unscoped WS broadcast as a bug to fix whenever revisited.

## POST /api/video/promo
**Source:** server.js:12237
**Kind:** route
**Verdict:** ARCHIVE-FOR-FUTURE
**Purpose:** Async pipeline that stitches multiple Veo-generated pose clips into a promo video via ffmpeg xfade concat plus a text overlay.
**Inputs:** body forwarded to `startVideoPromoCore({ character_id, site_tag, site_name, tagline, pose_indices })`.
**Outputs:** `{ jobId, status: 'started' }` immediately; async `promo-step` WS broadcasts per clip/step.
**Side effects:** Multiple paid Veo generation calls (one per selected pose), shells out to `/opt/homebrew/bin/ffmpeg` via `execFile`, writes temp clips to `/tmp/promo-clip-<jobId>-<i>.mp4`, requires character to have `poses` with `status === 'done'`.
**Identity:** Same `getCharacterSiteDir(site_tag)` pattern; additionally depends on `character_id` existing in that site's `spec.character_sets`.
**Risks:** Hardcoded ffmpeg binary path (`/opt/homebrew/bin/ffmpeg`) is a portability/deploy hazard; multiple paid API calls per promo; writes to unscoped `/tmp` (potential collision/cleanup gap); ambient site fallback; hidden coupling to prior pose-generation having succeeded.
**Verdict reasoning:** Genuinely valuable but complex, costly, environment-coupled (hardcoded local ffmpeg path) capability — archive for a future phase rather than porting the brittle shell-out pipeline as-is.

## POST /api/media/generate-asset
**Source:** server.js:12264
**Kind:** route
**Verdict:** RETIRE
**Purpose:** Generates a branded static asset (logo/icon/hero/etc.) by shelling out to a script.
**Inputs:** body: `asset_type` (allowlisted), `description`.
**Outputs:** Result of `generateAsset(assetType, description)` — includes a generated PNG path.
**Side effects:** Spawns `scripts/asset-generate` as a child process via `spawn(scriptPath, [TAG, assetType, description], ...)`.
**Identity:** Fully ambient — `const args = [TAG, assetType]` (server.js:19450) hardcodes the module-global `TAG` as the first CLI argument; the route accepts no site id whatsoever.
**Risks:** Shells out to an external script with the ambient site tag baked in; no way for a caller to target a different site even if they wanted to.
**Verdict reasoning:** No explicit-site path exists to adapt — this is a straightforward ambient-state violation with no salvageable identity contract; simpler to rebuild the asset-generation call with a real site_id parameter than to adapt this one.

## POST /api/media/generate-image
**Source:** server.js:12277
**Kind:** route
**Verdict:** ARCHIVE-FOR-FUTURE
**Purpose:** Generate an image via a chosen provider (OpenAI gpt-image-2 or Google Imagen4), with per-request provider override falling back to a site-level default.
**Inputs:** body: `prompt` (required), `provider`, `aspect_ratio`, `size`, `transparent`, `reference_images`, `role`, `label`, `notes`, `brand_family_id`, `model`.
**Outputs:** Result of `createOpenAiImageAsset` or `createGoogleImageAsset` — presumably an asset record with file path.
**Side effects:** Paid calls to OpenAI or Google image-generation APIs; requires `OPENAI_API_KEY`/Google key configured; writes generated image asset (via the create*ImageAsset helpers, not fully traced).
**Identity:** UNDETERMINED — no `site_tag`/`site_id` parameter appears anywhere in this handler; `createOpenAiImageAsset`/`createGoogleImageAsset` were not read to confirm whether they resolve site ambiently internally (likely, given the pattern elsewhere in this file).
**Risks:** Real per-call API cost across two providers; provider-selection logic (`pickImageProvider`) adds branching complexity; likely shares the ambient-site pattern seen in sibling media routes.
**Verdict reasoning:** Multi-provider image generation with brand-family tagging is a real, non-trivial capability worth revisiting later — archive rather than porting now, and re-verify site-id binding in the two asset-creation helpers before any future adoption.

## POST /api/media/generate-video
**Source:** server.js:12330
**Kind:** route
**Verdict:** ARCHIVE-FOR-FUTURE
**Purpose:** Generate a video via Google's video model from a prompt and/or existing image, with configurable aspect ratio and duration.
**Inputs:** body: `provider` (only `auto`/`google` supported), `prompt`, `video_prompt`, `image_filename`, `aspect_ratio`, `duration`, `label`, `notes`, `brand_family_id`.
**Outputs:** Result of `createGoogleVideoAsset(...)`.
**Side effects:** Paid Google video-generation API call; requires configured Google key; writes a generated video asset (internals not traced).
**Identity:** UNDETERMINED — no site_id/site_tag parameter visible in this handler; asset creation helper not traced for ambient-site coupling.
**Risks:** Real per-call API cost; single-provider lock-in (`google` only) baked into the 409 error for other providers.
**Verdict reasoning:** Same class as generate-image — real but non-MVP, costly capability; archive for future revisit alongside the image-generation route.

## POST /api/validation-plan/step/:id
**Source:** server.js:12398
**Kind:** route
**Verdict:** RETIRE
**Purpose:** Marks a single step of a hardcoded "Session 15" Studio UI validation plan as passed/failed/skipped, tracking progress through a fixed JSON checklist file.
**Inputs:** URL param `id` (step id); body: `status` (`passed|failed|skipped`), `data`.
**Outputs:** `{ ok: true, next_step, plan_status }`.
**Side effects:** Read-modify-write of `validation-plan.json` (a single file at `path.join(__dirname, 'validation-plan.json')`, not site-scoped at all).
**Identity:** Not site-scoped by design — this is a single global validation checklist file, not per-site; the plan title is overridden with the ambient `TAG` for display only (`GET /api/validation-plan`).
**Risks:** Entirely single-file, single-tenant, session-specific (named for "Session 15" / "Session 16" in the code) — not a general capability.
**Verdict reasoning:** This is a one-off, dated internal QA checklist tool for a specific historical session, not a durable product capability — retire; the premise (a single hardcoded global validation plan) doesn't generalize to multi-site.

## POST /api/validation-plan/report
**Source:** server.js:12425
**Kind:** route
**Verdict:** RETIRE
**Purpose:** Generates a markdown gap report summarizing the same hardcoded "Session 15" validation plan's pass/fail/skip/pending steps.
**Inputs:** none from the request.
**Outputs:** `{ ok: true, path, passed, failed, skipped }`.
**Side effects:** Writes `docs/session15-validation-report.md` to a path derived from `__dirname` (two levels up + `docs/`) — writes outside the site tree entirely, into the repo's own docs.
**Identity:** N/A — not site-scoped; reads/writes the same global `validation-plan.json`.
**Risks:** Hardcoded output filename (`session15-validation-report.md`) — every call overwrites the same session-specific file regardless of when/why it's invoked.
**Verdict reasoning:** Same premise rejection as `/api/validation-plan/step/:id` — a dated, single-session, non-site-scoped internal tool; retire.

## PATCH /api/patch-spec
**Source:** server.js:12484
**Kind:** route
**Verdict:** ADAPT
**Purpose:** Update a small allowlisted set of "safe" spec fields (monthly_rate, client_name, client_email, custom_domain, paypal_handle) on the active site's spec.
**Inputs:** body: any subset of `PATCHABLE_SPEC_FIELDS` keys.
**Outputs:** `{ ok: true, fields_updated }`.
**Side effects:** `readSpec()`/`writeSpec(spec)` — read-modify-write of the active site's spec file.
**Identity:** Fully ambient — `readSpec()`/`writeSpec()` operate on whatever site is module-globally active; no site_id in the request.
**Risks:** This directly edits **billing-adjacent fields** (`monthly_rate`, `paypal_handle`) — an ambient-site mismatch here silently changes another site's billing/client info. Protected-revenue-adjacent even though it isn't the FAMtastic Designs proof pipeline itself.
**Verdict reasoning:** The allowlist-patch pattern for safe spec fields is a good idea worth adapting, but given it touches billing fields, the ambient site resolution must become an explicit, validated site_id before this is safe to carry forward.

## POST /api/approve-site
**Source:** server.js:12497
**Kind:** route
**Verdict:** ADAPT
**Purpose:** Marks the active site as `client_approved`, optionally updates `monthly_rate`/`client_name`, and returns a PayPal.me payment link built from the site's rate/handle.
**Inputs:** body: `monthly_rate` (optional), `client_name` (optional).
**Outputs:** `{ ok: true, state: 'client_approved', approved_at, paypal_link }`.
**Side effects:** `readSpec()`/`writeSpec(spec)` — mutates site spec state and timestamp; **constructs a real PayPal.me payment link** (`https://www.paypal.com/paypalme/<handle>/<rate>`).
**Identity:** Fully ambient — same `readSpec()`/`writeSpec()` pattern, no site_id in the request; the PayPal handle defaults to a hardcoded `'famtasticfritz'` if not set on the spec.
**Risks:** Direct customer/money impact — this is the client-approval-and-billing-link step for a site. An ambient site mismatch would approve/quote the wrong site's client. Not part of the FAMtastic Designs *proof* pipeline specifically, but is protected-revenue-adjacent (billing/payment surface) and must not be RETIREd or KEEP-CONVERTed without deliberate identity redesign.
**Verdict reasoning:** The approval-and-payment-link contract is core business logic worth keeping, but must be rebuilt with an explicit, validated site_id given its direct billing impact — do not port the ambient version.

## POST /api/visual-verify
**Source:** server.js:12527
**Kind:** route
**Verdict:** RETIRE
**Purpose:** Returns a static, hardcoded description of a "visual audit" prompt (page list, fixed agent-name list, a fixed localhost preview URL) for an external agent to act on.
**Inputs:** none used from the request.
**Outputs:** `{ ready: true, pages, previewUrl: 'http://localhost:3333', agents: [...], prompt }` — entirely static/hardcoded except `pages` from `listPages()`.
**Side effects:** none — no writes, no external calls; `listPages()` is a read.
**Identity:** Not site-bound by parameter, but `listPages()` reads whatever site is ambient.
**Risks:** Hardcoded `localhost:3333` preview URL and a fixed list of agent names (`famtastic-visual-layout`, etc.) that this route doesn't actually invoke — it just returns their names as a suggestion. Despite the name, this is not itself the FAMtastic Designs proof pipeline; it appears to be a defunct scaffold for one.
**Verdict reasoning:** This route does no real verification work — it returns a canned prompt string for a human/agent to act on manually, built on a hardcoded local dev URL that won't generalize. The premise (a static hint payload) is superseded by real verification tooling; retire.

## PUT /api/settings
**Source:** server.js:12548
**Kind:** route
**Verdict:** KEEP-CONVERT
**Purpose:** Validate and persist a patch to Studio settings, explicitly stripping any legacy reasoning-authority fields (`anthropic_api_key`, `model`) since Shay now owns those, and logging the change to the developer-mode audit trail.
**Inputs:** body: arbitrary settings patch, validated via `validateStudioSettingsPatch`.
**Outputs:** `projectStudioSettings(current)` — the sanitized, saved settings.
**Side effects:** `loadSettings()`/`saveSettings(current)`; `logShayDeveloperModeEvent({ event: 'settings_updated', ... })` — audit log write.
**Identity:** Not site-scoped — this is instance/process-level Studio configuration (developer mode, etc.), not per-site data, so ambient-state rules don't directly apply here the same way; still worth confirming in the new system whether settings should be per-site or per-instance.
**Risks:** None observed beyond the general risk of a settings-mutation endpoint; the explicit stripping of reasoning-authority fields is a good safety pattern already enforced here.
**Verdict reasoning:** Validated-patch-plus-audit-log is exactly the right shape for a settings endpoint and already enforces the reasoning-authority boundary correctly — port mechanically.

## GET /api/shay-shay/developer-mode/audit
**Source:** server.js:12571
**Kind:** route
**Verdict:** KEEP-CONVERT
**Purpose:** Returns the developer-mode audit trail (a log of settings/mode changes) plus current developer-mode summary.
**Inputs:** query: `limit`.
**Outputs:** `{ ok: true, developer_mode, entries }`.
**Side effects:** none — pure read via `readShayDeveloperModeAudit(limit)` and `summarizeShayDeveloperMode()`.
**Identity:** Not site-scoped — instance-level developer-mode audit, consistent with `PUT /api/settings`.
**Risks:** None observed; read-only.
**Verdict reasoning:** Simple, read-only, well-scoped audit endpoint that pairs with the settings-mutation route above — port mechanically.

## POST /api/terminal/create
**Source:** server.js:19862
**Kind:** route
**Verdict:** RETIRE
**Purpose:** Spawns a real interactive PTY shell process (`pty.spawn`) on the server and registers it in an in-memory `terminals` map for later WS attachment.
**Inputs:** none from the request body; uses `process.env` (stripped of `CLAUDE_*`/`CLAUDECODE` vars) and `process.env.SHELL`.
**Outputs:** `{ termId }`.
**Side effects:** Spawns an actual OS shell process with `cwd: path.join(__dirname, '..')` — i.e. a full interactive terminal into the server's own filesystem, reachable via the paired WS terminal upgrade handler.
**Identity:** No site concept at all — this is a raw, unscoped remote-shell-spawn endpoint tied to `HUB_ROOT`'s parent directory, not any particular site.
**Risks:** This is effectively unauthenticated (at the route level — auth happens elsewhere via `authorizeUpgrade`/`isLoopbackRequest`/`terminalEnabled` on the WS upgrade path, not visible in this handler itself) remote code execution surface: any caller who can POST here gets a live shell process spawned server-side. Extremely high blast radius if exposed beyond loopback.
**Verdict reasoning:** The premise — a generic HTTP-spawnable PTY shell embedded in the product server — is exactly the kind of unsafe, ambient, non-site-scoped surface the rebuild should reject outright; the new system should have no equivalent unless deliberately redesigned as an explicit, audited, site-scoped dev-only feature.

## POST /api/terminal/:termId/inject
**Source:** server.js:19897
**Kind:** route
**Verdict:** RETIRE
**Purpose:** Writes raw text/commands into an existing spawned PTY terminal's stdin, optionally executing (appending `\r`).
**Inputs:** URL param `termId`; body: `command` (string), `execute` (boolean).
**Outputs:** `{ success: true }` or `404`/`400`.
**Side effects:** `term.ptyProcess.write(...)` — injects arbitrary text/commands directly into a live shell process.
**Identity:** No site concept — scoped only by `termId`, an in-memory map key with no ownership/auth check visible in this handler.
**Risks:** Arbitrary command injection into a live shell with no visible per-request authorization in this handler (relies entirely on upstream network/loopback gating); classic RCE-adjacent surface once terminal creation is reachable.
**Verdict reasoning:** Directly dependent on the `/api/terminal/create` premise being retired — same unsafe, unscoped remote-shell-control pattern; retire.

## POST /api/terminal/:termId/resize
**Source:** server.js:19906
**Kind:** route
**Verdict:** RETIRE
**Purpose:** Resizes the PTY's terminal dimensions (cols/rows) for a given terminal session.
**Inputs:** URL param `termId`; body: `cols`, `rows`.
**Outputs:** `{ success: true }` or `404`.
**Side effects:** `term.ptyProcess.resize(cols, rows)`.
**Identity:** No site concept — same in-memory `termId` scoping as the other terminal routes.
**Risks:** Low risk in isolation (just a resize call), but exists only to support the retired PTY-spawn premise.
**Verdict reasoning:** Ancillary to `/api/terminal/create`; retires along with the parent capability.

## DELETE /api/terminal/:termId
**Source:** server.js:19914
**Kind:** route
**Verdict:** RETIRE
**Purpose:** Kills a spawned PTY process and removes it from the in-memory terminal registry.
**Inputs:** URL param `termId`.
**Outputs:** `{ success: true }` or `404`.
**Side effects:** `term.ptyProcess.kill()`; deletes the entry from the `terminals` map.
**Identity:** No site concept — same `termId` scoping.
**Risks:** Cleanup path for the retired PTY-spawn capability; no independent risk beyond what creating the terminal already introduced.
**Verdict reasoning:** Retires along with `/api/terminal/create` — same rejected premise (server-spawned interactive shell reachable over HTTP/WS).
