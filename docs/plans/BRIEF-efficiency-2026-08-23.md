# The Efficient Monster Pass

**Purpose:** Establish with measurement, not assumption, that how we build is the
most efficient way available to us. "It works" is settled; "it is the best way we
can currently do it" is what this proves or fixes.

**Goal:** A scorecard with real before/after numbers and an evidence-backed
routing recommendation, shipped without delaying cutover.

- [x] E1a. Instrument: per-stage wall time, usage, cost, retries, routing, idle gaps, parallelism
- [x] E1b. Baseline on 3 briefs (Starlight, P.I.T, Beehive) into docs/efficiency/BASELINE.md
- [x] E2. Rank top 5 cost/time sinks with evidence and candidate fixes
- [x] E3a. Probe CLI account state honestly (claude, gemini, kimi) + Ollama
- [x] E3b. Brain-per-stage trial matrix on one brief; ROUTING-RECOMMENDATION.md
- [x] E4. Implement only what E2 convicts, cap 3, each with before/after on the same brief
- [x] E5a. SCORECARD.md before vs after
- [x] E5b. Standing telemetry: running efficiency log + cost/duration in Builds and Recipes console
- [x] E5c. Rung-3 hook: what the suggestion layer would need that we are not capturing

**Status:** completed
**Started:** 2026-08-23
**Ended:** 2026-08-23
**Execution:** single operator, no subagents (session directive)
**Research:** measurement against real runs only; no synthetic benchmarks
**Review:** gates green at every commit; changes ship only when numbers convict
**Branch:** main (no feature branch; changes are additive and gated)
**Worktree:** none needed
**Blocked By:** nothing. Cutover proceeds independently and does not wait on E2-E5.

**Constraints (standing):** no new paid accounts, no architecture rewrites, no
cutover delay. Kill a CLI lane on one honest failure; record account-state
blockers with exact error text as fixable-by-Fritz.

**Proof:** BASELINE.md, ROUTING-RECOMMENDATION.md, SCORECARD.md, each backed by
recorded runs; standing telemetry visible in the console.
