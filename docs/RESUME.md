# RESUME — Site Studio, one paste

Paste this whole file into a fresh session to pick the work back up.

---

## Where things stand

**Site Studio (next) shipped and cut over on 2026-08-23.** It is the system of
record for production site builds and deploys **of the sites it can represent**.
Studio models brochure sites: pages, sections, brand, media. It has no field for
a database, endpoint, session, job or upload, so an application site can be
carried and deployed but not rebuilt. MBSH is live and Studio could not
regenerate it. Sites carry `capability_class` and the console shows it.

- **Running:** `com.famtastic.studio-next` LaunchAgent, **port 3400**, loopback
  only, managed by launchd. Never start it by hand.
  - status: `launchctl list | grep famtastic`
  - restart: `launchctl kickstart -k gui/$UID/com.famtastic.studio-next`
  - logs: `platform/ops/logs/studio-next.{out,err}.log`
- **Legacy:** `com.famtastic.studio` (port 3340) is **cold** through
  ~2026-09-22. Plist still installed. Bring it back with
  `launchctl bootstrap gui/$UID ~/Library/LaunchAgents/com.famtastic.studio.plist`
- **Repo:** `~/Development/FAMtastic/site-studio-next`, branch `main`.
  Pre-cutover tag: `pre-cutover-2026-08-23`.
- **Data root:** `~/Development/famtastic-wt-phase-0/.studio-next-data`

## Prove it still works

```bash
cd ~/Development/FAMtastic/site-studio-next && npm run gates
```

Expect: lint OK, **529 tests / 36 files**, smoke 11/11, G4-0 PASS, G4-1 PASS,
exit 0. Anything less, stop and read before changing anything.

## The rules that are not negotiable

1. **Site Studio never serves proof ingress.** P0-I1 (`assertNoProofRoutes()`)
   refuses boot on any proof route, and revenue gate G4-1 rests on it. Proof
   generation is **Designs-owned**. Ruled permanently 2026-08-23.
2. **The live proof pipeline is protected revenue scope.** Read-only, always.
3. **No API keys, no new paid accounts.** Subscriptions and installed CLIs only.
4. **gemini CLI is permanently retired** (terminal `IneligibleTierError`), and
   **Antigravity has no headless path**. Do not re-probe either. See
   `docs/efficiency/GOOGLE-ROUTE-FINDING.md`.
5. **Never substitute a failed asset.** Unfilled means unfilled, with a reason.
6. Commit messages carry no AI attribution. No em-dashes in written output.

## Required reading before anything else

`docs/plans/SESSION-RECORD-2026-08-26-console-and-quality-engine.md` — the
reasoning behind every ratified decision, the seven instances of the one pattern
that produced nearly every defect here, what the research did and did **not**
establish, the vNext patterns worth keeping, and the pitfall list. Mirrored from
Drive so it is readable with no Drive access. **Read it before writing code.**

**The standing quality bar** (ADR-0012): does the output beat what Fritz was
producing **by hand** while Studio was down? Not "better than last build", not
"gates green". The comparison set is real hand-built work, MBSH first.

## Start here if you are picking up work

**`docs/plans/POST-SHIP.md` is the standing backlog.**
**Item #1 is the Designs proof webhook migration** (Designs-owned, ~2-3 days),
the only remaining piece of the old world with no home in the new architecture.

Also open: image art direction; raw CLI response retention; build agent roster
wiring (`docs/plans/BUILD-AGENT-ROSTER-2026-08-23.md`); a quality signal richer
than the brand-voice gate.

## The map

| Question | File |
|---|---|
| How does any of this work? | `../SITE-LEARNINGS.md` (newest entries first) |
| What is the architecture boundary? | `docs/decisions/ADR-0007`, `ADR-0008` |
| What did the rebuild learn? | `docs/retro/RETRO-site-studio-rebuild.md` |
| Is it fast? What did it cost? | `docs/efficiency/SCORECARD.md` |
| Which brain for which stage? | `docs/efficiency/ROUTING-RECOMMENDATION.md` |
| What happened at cutover? | `docs/plans/CUTOVER-RECORD-2026-08-23.md` |
| How do I roll back? | `docs/plans/CUTOVER-MECHANICS-2026-08-23.md` §4 |
| Is M5 actually met? | `docs/plans/M5-DECLARATION-2026-08-23.md` |
| What is parked? | `docs/plans/POST-SHIP.md` |

## Things that will bite you

- **The brief contract is NESTED**: `brief.business = {name, description,
  category, service_area, phone, address, hours}`. Flat keys silently drop every
  customer claim and render the site_id as the page `<h1>`.
- **Research is ~99% of build wall time** and is non-deterministic: the same
  brief has returned 0, 6, 7 and 8 verified facts. One run is not a measurement.
- **Build briefs concurrently** (`pipeline.runBatch`, default 3). 2.39x, free.
- **Imagery rate-limits.** ~60-80% fill per run is normal; the rest are honestly
  declared unfilled.
- **The failure mode in this codebase is silence, not exceptions.** Nearly every
  real defect found here degraded quietly. Assert that claims are *true*, not
  that code ran.
