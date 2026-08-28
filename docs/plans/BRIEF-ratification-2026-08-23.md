# Architecture ratification and cutover amendment

**Purpose:** Ratify the FAMtastic Designs / Site Studio boundary, correct the
record on the template-stamp finding, designate the research kernel a shared
capability, amend the cutover scope, and spec the build agent roster.

**Goal:** Every item below landed as a durable artifact in the repo and mirrored
to Drive, with the close-out sequence finished, so the cutover decision rests on
a ratified architecture rather than a snapshot comparison.

- [x] 1a. Correct the retro: Designs-drift and test proofs, not customer deliveries
- [x] 1b. Site-inventory truth pass: spec `origin` flag (test vs legit) + console counts
- [x] 2a. Boundary amendment (ADR): Designs owns intake to proofs, Studio owns build to verify
- [x] 2b. Selected Build Packet versioned contract + validator
- [x] 3. Research kernel designated shared capability, seam documented
- [x] 4. Cutover amendment: production path cuts over, proof webhook served by new path
- [x] 5a. Bounded salvage (30 min): vNext build recipes + agent/telemetry docs
- [x] 5b. Build agent roster spec: ten stage slots, recipe-assigned brains, per-agent telemetry
- [x] 6. Imagery bridge
- [x] 7. Cutover mechanics + rollback runbook
- [x] 8. M5

**Status:** completed
**Started:** 2026-08-23
**Ended:** 2026-08-23
**Execution:** single operator, no subagents (per session directive)
**Research:** bounded salvage against famtasticdesigns repo and local env, 30 min cap
**Review:** gates must stay green (lint, tests, smoke, G4-0, G4-1)
**Skills:** none invoked
**Branch:** worked directly on main (phase-2 already merged); no feature branch needed
**Worktree:** existing phase-0 worktree, no new worktree needed
**Blocked By:** nothing. Cutover execution itself remains a hard stop for Fritz.

**Proof:** each item lands a committed artifact; gates green at every commit;
Drive mirror updated; capture written at close.
