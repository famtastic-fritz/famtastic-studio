# Site Studio rebuild, Phase 2: Console core

**Purpose:** Turn the read-only console into the operator's working surface: a real Work inbox, direct editing on the canvas with journal and undo, Shay conversing in context with typed cards, and per-site conversation that survives a restart.
**Goal (M2):** the operator opens Work, enters a site, direct-edits under the latency target, undoes exactly, converses with Shay in context, and sees honest history.

**Gate:** per-screen design critique and accessibility pass on all 11 pages, plus the behavioral checks below.

## Lane map (maximum fan-out; dependencies stated honestly)

**Wave 1, independent, start together:**
| Lane | Scope | Depends on |
|---|---|---|
| A | Canvas click-to-edit: element targeting, inline edit, apply through the mutation kernel, undo/redo wiring | mutation kernel (exists) |
| B | Latency harness: measure click-to-edit end to end, record p50/p95 against the 140ms target, fail loudly if missed | canvas contract (fixed below) |
| C | Conversation persistence: per-site `conversation.jsonl`, append, read, restart continuity, zero cross-site bleed | identity kernel (exists) |
| D | Typed Shay cards: plan, proposal, diff, confirm, progress, success, failure, recovery, deploy receipt as structured objects end to end, never flattened text | card schema (fixed below) |
| E | Work inbox: real items from real sources, with honest not_configured when a source does not exist yet | events + journal (exist) |
| F | Isolation adversarial tests: delayed concurrent A/B site switching while a response is in flight, asserting conversation, spec, journal, memory and events stay isolated | all of the above land first for full coverage, but the harness can be written now |
| G | Per-screen design critique and accessibility passes, captured to docs/research | pages exist (they do) |

**Wave 2:** orchestrator integration run, Codex phase gate, M2 evidence, retro.

The canvas contract and the Shay card schema are fixed by the orchestrator before wave 1 starts, exactly as the endpoint contract was for Phase 1, so lanes never negotiate interfaces mid-flight.

**Tasks**
- [x] Premise record `phase-2.md`
- [ ] Canvas contract and Shay card schema fixed
- [ ] Wave 1 lanes A-G
- [ ] Latency measured and recorded honestly, pass or fail
- [ ] Integration run, Codex phase gate, fixes
- [ ] M2 evidence, retro with per-tier usage, notify Fritz

**Status:** active
**Started:** 2026-08-22
**Ended:**
**Execution:** rolling gates; hard stops only for the live proof pipeline and the final cutover. T2 subagents for implementation, orchestrator for contracts, integration and judgment. Codex adversarial only. No tier below T2.
**Branch:** studio-rebuild/phase-2
**Worktree:** ~/Development/famtastic-wt-phase-0 continues
**Main landing path:** merge to main at M2
**Proof:** latency measurements, isolation test output, critique and accessibility captures, gate rounds, M2 evidence.

## Risk carried into this phase
The sub-140ms click-to-edit target is the one measured crown jewel of the legacy system and the stated reason for choosing vanilla JS. It has never been measured in the greenfield tree. Lane B exists to measure it early rather than discover it late, and the premise record names the fail condition explicitly.
