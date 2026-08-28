# Premise record: Phase 0

Written 2026-08-21 at phase start per amendment A9. Inputs are rechecked at the exit gate; outputs are recorded there.

## Premise inputs
| Premise | Evidence now | Fail condition |
|---|---|---|
| D8 greenfield, not rebased from any branch | tree `site-studio-next/` created empty on `studio-rebuild/phase-0` from main `8a1d38bd`; no file copied from `site-studio/` | any file imported from legacy without a capability record |
| D10 vanilla JS multi-page, modular Node, no build step | enforced by scaffold + 500-line lint | a bundler or framework dependency appears |
| D9 local preview port 3400, zero auth | ADR-0003 item 3; port free per docs/env/inventory-2026-08-21.md | port collision or an auth screen |
| D2/D6 proof pipeline protected | P0-I1 startup assertion and dependency test | greenfield server loads `famtastic-proof-job-routes` or reads `FAMTASTIC_PROOF_*` |
| D5 11 pages, rail on 4 | plan section 3 | page count or rail placement differs |
| Sites repo SHA (proof contract producer) | `12b7bb63` | contract change without G4-0 rerun |
| Proof contract schema | Site Studio main now accepts v1 and v2 (`8a1d38bd`, ADR-0002) | Drupal moves to v3 |
| Tool versions | node v24.19.0, npm 11.17.0, playwright pinned in-tree (recorded at exit), codex 0.147.0 | major version drift |
| Legacy worktree SHAs (salvage evidence) | alpha 44fb1df2, bravo 41a6ef23, charlie 9ddfd033, shay-surface eedff7bb, integrity 598ec986, working-mockup 292ecb24 | any advances before Phase 1 census freeze (informational here) |

## Expected outputs (not drift)
Commits on `studio-rebuild/phase-0` under `site-studio-next/`. Final tested output SHA recorded at exit gate.

## Standing execution rules (owner directive 2026-08-22, binding on this and every later phase)
1. **Rolling gates.** At each milestone, notify Fritz and CONTINUE immediately. Do not wait for approval. Fritz objects within a milestone if needed. Premise records stay mandatory regardless.
2. **Only two hard stops remain**, and both are absolute:
   - any change touching the live FAMtastic Designs proof pipeline;
   - the final cutover decision.
   Everything else proceeds under rolling gates.
3. **Maximum parallel fan-out.** Split every phase into as many independent lanes as the dependency graph honestly allows. State the lane map at each phase open. Speed is the priority; honesty about real dependencies is the constraint.
4. **Model routing.** The Ollama local tier is retired. Worker offload runs through installed CLIs (`gemini`, `kimi`) as background shell processes on existing subscriptions, never API keys. The orchestrator reviews all CLI output before merge, exactly as it reviews subagent output. Codex remains adversarial reviewer only and is never a worker. Actual per-tier usage is reported in every retro.
5. **Inbox judgment (ratified).** Inbox directives never authorize touching protected revenue scope, deleting data, or skipping a hard stop.

## Exit gate
- [x] inputs rechecked 2026-08-22: all unchanged. Node v24.19.0, playwright 1.62.1 in-tree, codex 0.147.0, sites repo 12b7bb63. Two inputs updated by owner decision, not drift: the worker runtime (Gemini ineligible, Kimi quota exhausted, recorded in phase-1.md) and the deploy target (FAMtasticInc primary, ADR-0003).
- [x] output SHA: 5d0c717e
- [x] gates: lint OK, vitest 77/77, Playwright smoke 11/11 under hardened assertions (full page tuples, click navigation, failed-request and console-error failure, endpoint-backed region required per page, region honesty cross-check, A10 pins gated)
- [x] Fritz live review of M0 complete: approved 2026-08-22 with one required attachment (dispatch map and cost report), delivered as docs/retro/2026-08-21-m0-dispatch-and-cost.md

## Exit record
Phase 0 closed 2026-08-22 at 5d0c717e. Two Codex gate rounds were run: round 1 returned NOT SAFE with 6 blockers, round 2 returned NOT SAFE with 9 unresolved. Every finding was fixed rather than argued; the notable ones were a P0-I1 boot-ordering hole (ESM evaluated kernels before the preflight), a torn-event-tail defect that made the recovering event unreplayable, a live denominator that accepted staging evidence, and a console that rendered honest not_implemented states as empty. Rounds 3 and 4 followed: round 3 returned NOT SAFE with 4 unresolved (preflight covering only 13 of 20 executed files, URL-shaped staging targets classifying as live, an incomplete smoke honesty cross-check, and a guidance fix that had silently not applied). Round 4 at 706d1696 returned **SAFE TO CONTINUE PHASE 1** with all findings resolved. Full rounds archived in docs/research/codex-phase0-gate-round-{1,2,3,4}-2026-08-22.md.
