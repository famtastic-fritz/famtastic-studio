# Site Studio rebuild, Phase 0: Foundation to M0

**Purpose:** Stand up the greenfield tree with the structural rules baked in (modules, paths registry, console-kit, event and journal skeletons, P0-I1) so every later phase inherits them, and prove it with M0: an empty console shell on localhost:3400 with honest empty states on all 11 pages.
**Goal:** Fritz opens http://localhost:3400, clicks through all 11 pages, sees truthful empty or NOT_FOUND states backed by real endpoints (no fabricated data), and the build gates (lint, tests, Playwright smoke) are green.

**Tasks**
- [x] Branch `studio-rebuild/phase-0`, worktree `~/Development/famtastic-wt-phase-0`, tree `site-studio-next/`
- [x] Premise record docs/decisions/premises/phase-0.md
- [x] Scaffold: package.json, server entry, module layout, declarative route registration, no-monolith lint (500-line rule), `no-ambient-site` lint placeholder
- [x] Paths registry (config + single resolver) with `events` root; Settings/Admin reads it
- [x] Event spine skeleton: envelope validator, persist-before-broadcast to events root, WebSocket broadcast, seq per site
- [x] Journal skeleton: append-only JSONL writer with identity binding
- [x] P0-I1: startup assertion + dependency-graph test that the proof route and FAMTASTIC_PROOF_* are never loaded
- [x] Console-kit: cards, tables, status pills, Shay rail, command bar, region state machine (loading | available | empty | error | stale)
- [x] 11 pages, each its own URL, honest empty states from real endpoints; Shay rail only on Work, Site View, Deployments, Builds+Recipes
- [x] Platform registry with connections, media-studio, component-studio, marketing-studio, research-center entries (statuses per plan 2.4)
- [x] Playwright pinned locally; clean `npm ci`; launch smoke recording package path, version, executablePath to docs/env/
- [x] Three project skills: site-studio-conventions, capability-record, dna-capture (under site-studio-next/.claude/skills/)
- [x] Gates green: lint, vitest, Playwright smoke of all 11 pages
- [x] Notify Fritz to review M0 live on :3400; retro note

**Status:** completed
**Started:** 2026-08-21
**Ended:** 2026-08-22
**Execution:** Claude Code orchestrator; parallel subagents per lane (kernel, console, harness, skills) in the same worktree on disjoint paths; T2-class agents for implementation, orchestrator verifies.
**Research:** docs/plans/SITE-STUDIO-REBUILD-PLAN-2026-08-21.md sections 2-3, amendments v1.1.2 (A1, A2, A5, A8, A10), ADR-0003
**Review:** orchestrator code review before merge to main; Codex phase-gate review at Phase 0 exit
**Skills:** skill-creator (for the three project skills)
**Branch:** studio-rebuild/phase-0
**Worktree:** ~/Development/famtastic-wt-phase-0
**Main landing path:** PR-style merge to main after Fritz's M0 review
**Truth-surface updates required:** SITE-LEARNINGS.md entry for site-studio-next; FAMTASTIC-STATE.md regeneration (new tree)

**Proof:** vitest output, Playwright smoke report in docs/env/, screenshots of the 11 pages, Fritz's live review.
