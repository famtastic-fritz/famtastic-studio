# Site Studio Next — Parallel Swarm Completion Plan

## Title
Site Studio Next: Real-Portfolio Seam & Operator Surface Completion

## Purpose
Bridge the gap between the greenfield Site Studio engine and Fritz's real websites (`FAMtastic/sites/*`), enabling real site editing, HTML-to-spec derivation, and complete operator UI surfaces via a 2-agent parallel swarm.

## Goal
Connect Site Studio to real workspace site directories, import real HTML structures into editable specs, and deliver working console screens (Editor, SEO, Media, Components, Quality Gate) with full acceptance verification on MBSH.

## Tasks
- [x] Task 1 (Claude Code): Implement `paths.siteDir(id)` site-resolution seam with path containment safety and swap kernel call sites
- [x] Task 2 (Claude Code): Build HTML-to-spec Importer (`derivation: imported`) to extract pages, sections, copy, images, and color tokens from real HTML
- [x] Task 3 (Gemini): Build SEO Module & Screen (`server/modules/seo/` + `public/pages/seo.html` + `public/pages/seo.js`)
- [x] Task 4 (Gemini): Build Media & Components Inventory Screens (`public/pages/media.js` + `public/pages/components.js`)
- [x] Task 5 (Gemini): Build Quality Gate Screen (`public/pages/gate.html` + `public/pages/gate.js`) matching vision mockups
- [x] Task 6 (Claude Code): Wire Canvas Editor & Property Inspector (`public/pages/site-view/` + `public/kit/canvas-edit.js`) to live working-copy files
- [x] Task 7 (Joint): Run batch portfolio importer across all 9 real sites (including MBSH's 24 pages)
- [x] Task 8 (Joint): Execute MBSH end-to-end acceptance run (edit headline -> journal -> undo -> SEO check -> gates green)

## Status
active

## Started
2026-08-27T08:10:00-04:00

## Ended
null

## Execution
- **Surface 1 (Claude Code - Mid/Top Tier with Thinking):** Owns `server/kernel/paths.js`, `server/kernel/site.js`, `server/kernel/importer.js`, `public/pages/site-view/`. Focuses on kernel seam, security containment, HTML extractor, and canvas editor plumbing.
- **Surface 2 (Gemini / Antigravity - High Thinking):** Owns `server/modules/seo/`, `public/pages/seo.*`, `public/pages/media.*`, `public/pages/components.*`, `public/pages/gate.*`. Focuses on rich console UI screens and independent module endpoints.
- **Write Policy:** Direct writes to working-copy files with byte-level journal/undo logging; Deploy remains an explicit separate action.
- **Application Policy:** MBSH PHP backend remains untouched and carried; only static presentation HTML is imported and inspected.

## Research
- `docs/plans/reference/site-studio-vision.html` (Primary visual & functional target)
- `docs/plans/reference/site-studio-editor-v3.html` (Property inspector reference)
- `docs/lanes/LANE-MAP.md` & `docs/lanes/MANIFEST.json` (Lane specifications L1–L13)
- `docs/plans/SESSION-RECORD-2026-08-26-console-and-quality-engine.md`

## Review
Codex / Gemini adversarial review of kernel containment and UI honesty states.

## Skills
- site-studio
- ui-ux-pro-max
- web-design-guidelines

## Blocked By
None

## Proof
- `npm run gates` exits 0 (741+ tests, smoke 11/11, G4-0 PASS, G4-1 PASS).
- Real portfolio sites in `FAMtastic/sites/` appear in the console.
- Real site headline edit persists to disk, generates a journal entry, and restores cleanly on undo.
- Acceptance captures at 1440px and 390px for MBSH.
