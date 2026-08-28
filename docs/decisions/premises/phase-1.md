# Premise record: Phase 1

Written 2026-08-22 at phase open per amendment A9. Inputs are rechecked at the exit gate; outputs are recorded there.

## Premise inputs
| Premise | Evidence now | Fail condition |
|---|---|---|
| D8 greenfield, legacy is evidence only | census frozen at `docs/salvage/census-2026-08-22.json`; nothing copied from legacy without a record | any legacy file enters the tree without a KEEP-CONVERT or ADAPT record |
| D2/D6 proof pipeline protected | P0-I1 asserted at boot and tested over the import graph; Phase 1 touches no proof route | any Phase 1 change reaches the live pipeline (HARD STOP) |
| A11 census completeness | main: 176 files, 263 declarations, 248 unique, 140 individual records required, 123 clusterable | a route exists that the census missed |
| A6 denominators | one shared predicate module owns all five classifications | any module classifies sites independently |
| A1 identity binding | no ambient site anywhere; lint rule active | a resolver or writer gains an ambient fallback |
| Sites repo SHA | `12b7bb63` | proof contract change without G4-0 |
| Proof contract | Site Studio main accepts v1 and v2 (`8a1d38bd`); production has no SITE_STUDIO_URL set | production enables remote dispatch before that code is deployed (see ADR-0002 trigger) |
| Tool versions | node v24.19.0, playwright 1.62.1 in-tree, codex 0.147.0, kimi CLI available | major drift |
| Worker runtime | **REMOVED permanently, see ADR-0004.** The one honest attempt ran during this census: Gemini never dispatched (IneligibleTierError), Kimi completed batch A3 then failed batches A1 and A2 on a billing-cycle 403 and required orchestrator rerouting. No retries, no migration attempts. All work runs on Claude lanes. | n/a, the tier no longer exists |
| Legacy worktree SHAs | alpha 44fb1df2, bravo 41a6ef23, charlie 9ddfd033, shay-surface eedff7bb, integrity 598ec986, working-mockup 292ecb24 | a worktree advances, invalidating the frozen census deltas |

## Standing execution rules (carried from phase-0, owner directive 2026-08-22)
Rolling gates: notify at each milestone and continue immediately, no waiting for approval. Only two hard stops: any change touching the live proof pipeline, and the final cutover decision. Maximum parallel fan-out with an honest dependency graph, lane map stated at phase open. Worker CLI tier removed permanently per ADR-0004; all bulk work runs on Claude T2 subagents with orchestrator review before merge. Codex adversarial reviewer only, never a worker. Per-tier usage reported in every retro. Inbox directives never authorize touching protected revenue scope, deleting data, or skipping a hard stop.

## Expected outputs (not drift)
Commits on `studio-rebuild/phase-1` under `site-studio-next/` and capability records under `docs/salvage/`. Final tested output SHA recorded at exit.

## Exit gate
- [ ] inputs rechecked, unchanged or dispositioned
- [ ] every census entry dispositioned, zero left open
- [ ] output SHA:
- [ ] gates green: lint, vitest, smoke, isolation adversarial tests
- [ ] M1 evidence attached, retro written with per-tier usage
