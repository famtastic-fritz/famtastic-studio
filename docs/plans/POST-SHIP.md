# POST-SHIP: everything cut from the endgame

Cut on 2026-08-22 under the endgame directive. Recorded so nothing is lost, not so it can be relitigated. Nothing here blocks M5. Each entry says what it is and what it would cost, so a future decision has real numbers.

## Console polish
- **Full per-screen design critique across 11 pages.** Only accessibility blockers are being fixed. ~4h.
- **Doubled page headings** (h1 "Sites" then section title "Sites") on most pages. ~1h.
- **Spec "Other" section alignment**: renders key and value on separate lines instead of the aligned key/value grid used elsewhere. ~30m.
- **Settings and Automations depth** beyond the honest read views that exist. ~3h.

## Canvas
- **Structural edits** (adding or removing nodes), **image replacement**, **multi-element commits in one transaction**. Text content editing ships; the rest render as honest not-in-this-milestone states. ~8h.

## Shay
- **Conversational rail wired to a model.** The card transport, the typed schema, per-site conversation persistence and the rendering all exist and are tested; only the model connection is cut. The rail states plainly that it is not wired. See the note in ENDGAME.md: this touches premise D2. ~12h.

## Pipeline
- **`research-center` adapter.** The platform does not exist yet; the adapter slot is live. ~2h once it exists.
- **Live NotebookLM API adapter.** Blocked externally on Google exposing one. Import adapter covers MVP.
- **Rung 3 learning and suggestion engine.** The DNA schema already carries every comparison key (stage timings, cost, verification scores, operator edit counts) so this bolts on without re-instrumenting, which was the whole point of capturing them now. ~20h.

## Deploy
- **Netlify, Vercel and Cloudflare adapters.** FAMtasticInc is the primary target per ADR-0003 and Netlify is being retired. Provider choice is already a per-site config field, so adding one later is an adapter, not a refactor. ~4h each.
- **Connections dual-status projection** beyond what the read-only Proofs page needs. ~6h.

> **STATUS: this is now the STANDING BACKLOG.** Site Studio shipped and cut over
> on 2026-08-23. Nothing below blocks anything; each entry says what it is and
> what it would cost so a future decision has real numbers. Item #1 is the only
> one with a named owner and a reason to be first.

## Cross-platform migrations

- **[#1 — THE NEXT THING] The Designs proof webhook migration.**
  **Owner: Designs.** Ratified by Fritz's ruling of 2026-08-23: the P0-I1
  invariant wins permanently and **Site Studio never serves proof ingress.**
  Proof generation is Designs-owned and this is Designs' migration, not a Studio
  route. It is first because it is the only remaining piece of the old world with
  no home in the new architecture.

  What it needs: the modular process the salvage pass documented (provider
  preflight, live-source-fetch before research, creative direction, visual art,
  prototype construction, bounded repair loop against executable quality gates),
  fed by the Selected Build Packet contract that already exists and is tested.
  Studio's research kernel is reachable through `research-center.js` without a
  fork. Notes: `docs/salvage/SALVAGE-2026-08-23-vnext-build-recipes.md`.
  **~2 to 3 days.**

- **Proof generation's Studio-side residue.**
  Ratified 2026-08-23 (ADR-0007, CUTOVER-AMENDMENT-2026-08-23). Studio keeps
  serving the proof webhook in the interim, but with the research-grounded path
  rather than the `no_image_pilot_v1` stamp logic. Target: the webhook is served
  by Designs' modular process (provider preflight, live-source-fetch before
  research, creative direction, visual art, prototype construction, bounded
  repair loop against executable quality gates) and Studio leaves the proof path
  entirely. The seam is the Selected Build Packet, already contracted and tested.
  Salvage notes for the target process:
  `docs/salvage/SALVAGE-2026-08-23-vnext-build-recipes.md`. ~2 to 3 days.
- **Research Center relocation.** `research.js` / `spec-derive.js` / `packet.js`
  move out from under Studio to their own home behind the existing
  `research-center.js` interface (ADR-0008). Because the facade is already in
  place this is a relocation, not a rewrite: callers keep calling the same four
  functions. ~4h plus deployment.

## Peer platforms
- **Media Studio and Component Studio** beyond the honest read views that already exist. Registry entries are live and the panels upgrade when the platforms land.
- **Marketing Studio and Research Center** registry entries going live. Documented contracts only today.
- **App Producer optimization.** Phase 6 in the original plan; owner said it does not have to be perfect yet.

## Infrastructure
- **Mobile-ready console and Cloudflare Tunnel.** Phase 6. Tunnel is a product milestone, not build infrastructure (D9).
- **SQLite migration.** Files-first until query pain is demonstrated. No pain demonstrated.

## Salvage debt
- **52 UNDETERMINED markers** across the capability records, where an agent honestly could not trace a helper rather than guessing. ~6h to resolve.
- **Second-opinion pass** on the 100 RETIRE and 16 ARCHIVE-FOR-FUTURE verdicts before any becomes irreversible. Nothing is deleted at M5, so nothing is irreversible yet. ~4h.

## Known small debt
- **`readJsonBody` duplicated** in `server/modules/sites/index.js` and `server/modules/pages/index.js`; belongs in the kernel. ~20m.
- **Real specs carry no `customer` or `deploy` block**, so three of five denominators are honestly zero until deploy lands (item 20 closes the `live` one). The `customer` denominator needs a schema decision that is not urgent.

## Added 2026-08-22, from the PROVE run
- **The smoke's fixture blind spot.** The region-honesty cross-check can only judge states the smoke fixture actually produces. It never seeds a real deploy, which is why the deployments false-empty defect survived until PROVE seeded one. Widening the fixture to cover every page's populated path is real work and would have caught it. ~3h.
- **Proposal review flow (PROVE item 5)** stays untestable until a Shay reasoning layer exists. Tied to the cut conversational rail.

## First post-cutover task: the one-honest-attempt CLI trial (owner directive 2026-08-23)

The worker-tier trial that ADR-0004 removed was for BUILD orchestration. This is a different question: which brain runs which PIPELINE stage, and it is the first recipe-tuning task after cutover.

**The trial.** On one real build, dispatch the cheap stages (copy variants, alt text, summaries) to the gemini and kimi CLI adapters, keep creative direction and spec synthesis on claude, then compare quality and cost per stage. Kill or keep each lane under the standing one-honest-attempt rule: failure means immediate and permanent removal, no retry loops, no debugging worker infrastructure.

**The seam already exists and is now real.** `resolveStageRouting()` in `server/kernel/pipeline.js` reads model and agent PER STAGE from the resolved recipe, falling back to `MODEL_ROUTING` defaults, and records `routing_source` on every DNA stage entry so a run can be audited for where its routing came from. Assigning a different brain to a stage is a recipe edit, not a code change.

**Known state going in, do not rediscover it:** gemini fails with `IneligibleTierError` (individual Code Assist retired, Antigravity migration required) and kimi returned a billing-cycle 403. Both may have changed by then; both must be probed honestly rather than assumed either way.

**Out of scope unless the trial shows a gap they would fill:** local models (Ollama) and Antigravity.
