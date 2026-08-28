# ENDGAME: shortest honest path to M5

**Written:** 2026-08-22 | **Owner directive:** project wraps now. No new scope, no polish loops, no deferred-nicety lists. Every remaining decision optimizes for DONE.
**Status at write time:** Phase 2 wave 1 complete and themed. Phases 0 and 1 closed and merged. Branch `studio-rebuild/phase-2` at `5e7a756f`.

## THE TWO NUMBERS

| | |
|---|---|
| **Ship-blocking items remaining** | **0** |
| **Honest working-hours estimate to M5** | **COMPLETE.** Actual: roughly 9 working hours of orchestrated time against an initial 55 hour estimate. |

**On the estimate being wrong by that much:** the 55 hours priced construction serially. What actually happened is that maximum fan-out collapsed the build phases, and the expensive part turned out to be the four adversarial gate rounds, not the code. The estimate was honest when made and wrong in the direction that flatters me, which is worth recording rather than quietly celebrating.

Estimate basis, stated plainly so it can be judged: Phases 0, 1 and 2-wave-1 together consumed roughly 12 working hours at maximum fan-out, and produced the kernel, the console shell, the salvage census and the editing surface. What remains is larger than what is built, because the pipeline (Phase 3) is the single biggest unbuilt thing in the plan and has never been started. No optimism is priced in. If this estimate moves, the heartbeat says so and says why.

## Owner's ship-blocking definition (the bar)
The console operates Fritz's sites; the pipeline builds a real site from a brief with DNA captured and a recipe saved; deploy works to FAMtasticInc; proofs visible read-only; isolation and revenue-safety tests green; shadow-run evidence ready for the cutover call.

Everything else is CUT and logged in `POST-SHIP.md`. Cuts are recorded, not debated.

---

## SHIP-BLOCKING (27 items)

### Phase 2 close (4 items, ~4h)
| # | Item | Why ship-blocking |
|---|---|---|
| 1 | Accessibility blockers only on the themed screens (keyboard traps, missing accessible names, contrast failures) | The operator uses this daily; a keyboard trap is a defect, not polish. Full critique is CUT. |
| 2 | M2 integration run and Codex gate | The gate has caught a live cross-site leak, a boot-order hole and a data-loss bug. It stays. |
| 3 | M2 evidence + retro with per-tier usage | Contract requirement, cheap. |
| 4 | Phase 2 premise exit record closed at a tested SHA | Contract requirement, cheap. |

### Phase 3 pipeline (11 items, ~28h) — the big one
| # | Item | Why ship-blocking |
|---|---|---|
| 5 | Research Packet v1 schema + validator (schema_version, execution_status, brief_hash, import_ref, facts with source_uri and verification_state, customer_claims, not_found) | Amendment A3. The pipeline's input contract; everything downstream consumes it. |
| 6 | `shay-native` research adapter | Named MVP adapter (D7). Without it there is no packet. |
| 7 | `notebooklm-import` adapter + normalizer | Named MVP adapter (D7). Cheap once the schema exists. |
| 8 | Model routing layer for pipeline stages (which model runs which stage, recorded) | The pipeline cannot generate without models. Distinct from the conversational rail, which is CUT. |
| 9 | Spec generation from packet | Structured spec before generated code is a cannot-lose item. |
| 10 | Compose stage (spec -> page artifacts) | Without it nothing is built. |
| 11 | Build stage | Same. |
| 12 | Verify stage, browser-first via Playwright | Browser-first verification is a cannot-lose item, and a deferred browser lane already fails the gate. |
| 13 | DNA capture with the full replay manifest (A4) | D7: automatic and total from run one. Retro-fitting is explicitly what the amendment forbids. |
| 14 | Recipes: save-as-recipe from a DNA record, edit, run against a new packet (Rung 2) | Owner's stated ship bar names a recipe saved. |
| 15 | Builds + Recipes page: run list, DNA inspector, recipe editor | The only surface where DNA and recipes are visible. |

### Phase 4 deploy and integrations (8 items, ~16h)
| # | Item | Why ship-blocking |
|---|---|---|
| 16 | FAMtasticInc deploy adapter: push built site to a path under the FAMtasticInc root | ADR-0003. The primary and only MVP target. |
| 17 | Go-live step: record DNS pointed at the created folder, with evidence | ADR-0003. Separate explicit action; Site Studio records, does not mutate DNS. |
| 18 | Deploy receipts with provider release id, prior target, artifact-manifest hash | Amendment A7. Rollback has no oracle without it. |
| 19 | Rollback, verified by recomputing the manifest hash | PROVE list. |
| 20 | `live` denominator fed by real deploy receipts | Today customer/deployable/live are honestly zero because no spec carries deploy data. Deploy closes it. |
| 21 | G4-0 offline consumer-driven contract test against the real Drupal client at a pinned SHA | Amendment A12. Revenue safety. Prevents the schema_version class of break recurring. |
| 22 | G4-1 fail-closed shadow boundary: isolated roots and IDs, stubbed callback, no production secrets, zero-write audit before and after | Amendment A12. **This is the revenue-safety gate.** |
| 23 | Proofs page fed by real integration events, read-only verified (no mutation route reachable) | D3 and the owner's ship bar. |

### Phase 5 cutover readiness (4 items, ~7h)
| # | Item | Why ship-blocking |
|---|---|---|
| 24 | Shadow runs: new pipeline processes real briefs in parallel with the untouched legacy path | The evidence Fritz's cutover call rests on. |
| 25 | Shadow comparison view | How that evidence is read. |
| 26 | Full PROVE list executed (plan section 6, as amended by A14) | Ordered BEFORE the owner decision per A13. |
| 27 | Cutover decision packet bound to the tested commit and artifact hashes | The deliverable Fritz decides on. **HARD STOP: the cutover decision itself is his, not mine.** |

---

## CUT (logged in POST-SHIP.md, not built)

**Phase 2:** full per-screen design critique across 11 pages; the doubled page headings; the Spec "Other" section key/value alignment; Site View Canvas structural edits, image replacement, multi-element commits; the conversational Shay rail wired to a model.

**Phase 3:** `research-center` adapter; live NotebookLM API adapter; Rung 3 learning and suggestion engine.

**Phase 4:** Netlify, Vercel and Cloudflare deploy adapters; Connections dual-status projection beyond what Proofs needs; Media and Components beyond the honest read views that already exist; Automations beyond the honest read view.

**Phase 5/6:** App Producer optimization; Marketing Studio and Research Center registry entries going live; mobile-ready console; Cloudflare Tunnel; SQLite migration.

**Cross-cutting:** resolving the 52 UNDETERMINED markers in the salvage records; a second-opinion pass on the 100 RETIRE and 16 ARCHIVE-FOR-FUTURE verdicts; `readJsonBody` duplicated across two modules.

### One cut that deserves a sentence, because it touches a ratified premise
**The conversational Shay rail is CUT.** D2 makes Shay the sole in-product reasoning authority and the plan says the console is operated through Shay. Fritz's ship-blocking definition does not include Shay conversing, and wiring a conversational agent is multi-day work. The pipeline's model usage (item 8) is NOT cut, because the pipeline cannot generate a site without it. So at M5 the console builds, deploys and records through Shay's reasoning **in the pipeline**, while the rail continues to state honestly that it is not wired. If Fritz reads the premise as requiring the rail, this is the one cut to object to, and the objection changes the estimate by roughly +12 hours.

---

## Execution rules for the endgame
Maximum parallel fan-out, continuously, rolling gates, 30-minute heartbeats carrying both numbers. Sessions hitting limits park with a capture and a one-line RESUME command. The only stops are the two hard stops: any change touching the live proof pipeline, and the final cutover decision. Everything else is decided per the contract and logged.

## Heartbeat log
| Time (UTC) | Items remaining | Hours estimate | Note |
|---|---|---|---|
| 2026-08-22 05:40 | 27 | 55 | Endgame opened. Phase 2 close lanes starting. |
| 2026-08-22 06:10 | 25 | 55 | DNA + recipes closed (13, 14). |
| 2026-08-22 06:40 | 22 | 55 | Research packet + both adapters closed (5-7). Worker CLI tier removed per owner rule. |
| 2026-08-22 07:10 | 21 | 55 | G4-0 contract gate PASS (21), verified by the orchestrator directly. |
| 2026-08-22 08:15 | 9 | 28 | Pipeline, deploy, Builds+Recipes, a11y, G4-1 all landed (1, 8-12, 15-22). Estimate revised down: the long pole was construction, and it is built. |
| 2026-08-22 08:50 | 8 | 28 | G4-1 genuinely closed. Corrected a false claim in the revenue safety evidence and a SHA pinning bug. |
| 2026-08-22 09:15 | 7 | 28 | Proofs read-only closed (23). M2 gate, PROVE and shadow lanes running. |
| 2026-08-22 09:45 | 5 | 28 | Shadow runs + comparison closed (24, 25). Awaiting M2 gate and PROVE results. |
| 2026-08-22 10:20 | 4 | 24 | PROVE closed (26). Three real defects found and fixed. |
| 2026-08-22 11:00 | 4 | 34 | M2 gate round 1: NOT SAFE. Estimate raised: real findings including a second cross-site breach. |
| 2026-08-22 12:30 | 4 | 26 | All four gate findings closed. Round 2 running. |
| 2026-08-22 13:45 | 4 | 20 | Rounds 2 and 3 closed all but F9, which was a bug in my own previous fix. |
| 2026-08-22 14:15 | 0 | COMPLETE | Round 4: SAFE TO ASSEMBLE THE CUTOVER PACKET. M2 closed, packet written, merged to main. |
