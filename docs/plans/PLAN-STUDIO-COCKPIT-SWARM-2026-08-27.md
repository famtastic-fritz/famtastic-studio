# Plan: Site Studio Cockpit — Parallel Multi-Swarm

**Title:** Site Studio Cockpit: Live Telemetry, Visual Recipe Builder, Ingestion Hub & Skills Leash  
**Purpose:** Transform Site Studio into an active, real-time cybernetic workstation based on Fritz's 3 reference cockpit designs.  
**Goal:** Deliver Shay's live execution telemetry workspace, interactive Recipe DAG builder, Ingestion Hub with 3-variant proof cards, and the 6-card Skills Leash grid across all 14 screens.

## Tasks

- [x] **Task 1 (Antigravity):** Build Shay's Workspace Live Telemetry Drawer (`public/kit/shay-workspace.js` + CSS) with active execution banner, step ladder, and real-time streaming terminal logs
- [x] **Task 2 (Antigravity):** Build Visual Recipe Builder & Stage DAG Visualizer on `/builds` with model/agent picker per stage and extracted variable form
- [x] **Task 3 (Claude Code):** Upgrade `/work` to the Ingestion Hub with signed brief cards from `famtasticdesigns.com/quote`, 3-variant proof strip, and approve/dispatch revenue gate — shipped with one deliberate deviation: the mockup's webhook path (`POST /api/integrations/famtastic/proof-jobs`) matches this server's own P0-I1 forbidden-route patterns (`server/kernel/invariants.js`) and would fail `assertNoProofRoutes()` at boot, so no ingress route was registered. Brief cards, the proof-variant strip, and the approve/dispatch buttons are all real and wired to the real (already-built) `/api/proofs` projection; Approve & dispatch / Edit before sending reveal inline that dispatch happens in the famtasticdesigns repo rather than calling anything. `gate:g4-1` re-run clean (no proof ingress in the module closure).
- [x] **Task 4 (Claude Code):** Upgrade `/automations` to Shay's Skills Leash grid with interactive toggles, schedules, log links, and emergency kill switch — real toggle component (`<button role="switch">`, not a div), real 6-card grid, all backed by `server/kernel/skills.js`. Repo-wide search found none of the six named skills real anywhere in the FAMtastic tree; five report `implemented: false` honestly with a stated reason per disabled toggle, one (seo-analyzer) is real and on-demand. Kill switch stays `state: 'unknown'` (never a guessed `false`).
- [x] **Task 5 (Joint / Antigravity):** Wire real-time WebSocket event emission from `server/kernel/events.js` to stream live pipeline telemetry into Shay's Workspace
- [x] **Task 6 (Joint / Integration):** Full Quality Suite validation (`npm test`, `npm run smoke`, `npm run gates`, `npm run lint`) with zero regression

## Status
Status: `active`  
Started: `2026-08-27T17:05:00Z`  
Ended: `in-progress`  
Execution: `parallel-multi-swarm (Antigravity + Claude Code)`  
Branch: `main`  
Worktree: `~/Development/FAMtastic/site-studio-next`  

## Proof
- `npm test`: 844+ unit tests passing
- `npm run smoke`: 14/14 console screens passing
- `npm run gates`: G4-0 and G4-1 safety boundaries passing
- Visual verification of live telemetry stream and recipe builder
