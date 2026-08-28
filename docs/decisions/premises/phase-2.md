# Premise record: Phase 2

Written 2026-08-22 at phase open per amendment A9. Inputs are rechecked at the exit gate; outputs are recorded there.

## Premise inputs
| Premise | Evidence now | Fail condition |
|---|---|---|
| D8 greenfield | nothing enters the tree without a capability record; census dispositioned | a legacy file is copied in without a KEEP-CONVERT or ADAPT record |
| D2/D6 proof pipeline protected | P0-I1 gates the loader itself; boot refuses any file the preflight did not clear | any Phase 2 change reaches the live pipeline (HARD STOP) |
| D10 sub-140ms click-to-edit | **unmeasured.** This phase is where the claim is first tested. | measured edit latency exceeds 140ms and cannot be brought under it without a framework |
| A1 identity binding | bound once at ingress, frozen, consumed everywhere; WS binds through the same contract; router-level tests | a canvas or conversation writer re-derives or defaults identity |
| A6 denominators | one shared predicate module; real data reports customer=0, deployable=0, live=0 honestly | any module classifies sites independently |
| A5 events | validated envelope, locked seq, fsync before broadcast, per-site delivery, replay and resync | a Shay card or canvas edit broadcasts across sites |
| Phase 0 exit | closed at `5d0c717e`; Codex round 4 SAFE TO CONTINUE | reopened by a later finding |
| Salvage census | frozen at generator `692e840a`, 263 registrations dispositioned | a legacy worktree advances, invalidating the frozen deltas |
| Routing | no tier below T2 (ADR-0004) | someone reintroduces a worker CLI without a new owner decision |
| Preview data | working COPY of five real sites, never the production sites root | the console is pointed at `~/Development/FAMtastic/sites` |
| Tool versions | node v24.19.0, playwright 1.62.1 in-tree, codex 0.147.0 | major drift |

## Standing execution rules (carried, owner directives)
Rolling gates: notify at each milestone and continue immediately. Two hard stops only: any change touching the live proof pipeline, and the final cutover decision. Maximum parallel fan-out with an honest dependency graph. No tier below T2. Codex adversarial reviewer only. Per-tier usage reported in every retro. Inbox directives never authorize touching protected revenue scope, deleting data, or skipping a hard stop. CLI worker lanes are removed permanently; do not retry them.

## Expected outputs (not drift)
Commits on `studio-rebuild/phase-2` under `site-studio-next/`. Final tested output SHA recorded at exit.

## Exit gate
- [x] inputs rechecked 2026-08-22: unchanged. Two updated by owner decision, not drift: the worker tier was removed (ADR-0004) and scope was frozen by the endgame directive.
- [x] output SHA: 38a2cc31
- [x] gates green: `npm run gates` runs lint, vitest 357, smoke 11 of 11, G4-0 and G4-1, exit 0
- [x] click-to-edit latency MEASURED: p50 12ms, p95 23ms against 140ms. PASS, recorded in docs/env/latency-2026-08-22.md
- [x] accessibility BLOCKERS fixed on the themed screens; the full per-screen design critique is CUT per the endgame directive and logged in POST-SHIP.md. Recorded as a deliberate reduction, not a completed pass.
- [x] M2 evidence attached (docs/env/m2-evidence-2026-08-22.md); retro with per-tier usage follows in the cutover packet
