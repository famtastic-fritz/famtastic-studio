# Closing sequence

**Purpose:** Land the last three build items, then execute the cutover.
**Goal:** Imagery wired, a machine-readable quality signal in DNA, operator
outcome captured, and Studio live as system of record for builds.

- [x] 1a. Probe what image generation exists at the authorized worker boundary
- [x] 1b. Imagery adapter: preflight, parallel slots, budget cap, DNA receipts, fail=declared-unfilled
- [x] 1c. Acceptance artifact: one brief rendered end to end with imagery filled
- [x] 2. Brand-voice gate: deterministic forbidden-terms check, pass/fail into DNA
- [x] 3a. Outcome capture: operator_decision + customer_selected_direction
- [x] 3b. One-click decision from the Builds page
- [x] 4a. Rollback rehearsal
- [x] 4b. Cutover execution per runbook
- [~] 4c. One real proof job verified — NOT POSSIBLE. New path is forbidden proof ingress by P0-I1/D3; production has no dispatch path. See CUTOVER-RECORD §3-4.
- [x] 4d. M5 close-out + retro with scorecard and telemetry

**Status:** completed (4c recorded as not possible, with evidence)
**Started:** 2026-08-23
**Ended:** 2026-08-23
**Execution:** single operator, no subagents
**Review:** gates green at every commit
**Branch:** main
**Blocked By:** nothing yet. Item 1 depends on a generator existing at the
authorized boundary; if none does, that is reported as a blocker with evidence
rather than substituted around.

**Standing constraints:** no paid API keys, no new paid accounts. gemini and
Antigravity permanently closed. Never substitute a stand-in image for a real one.

**Proof:** rendered artifact, DNA receipts, gate results, cutover evidence.
