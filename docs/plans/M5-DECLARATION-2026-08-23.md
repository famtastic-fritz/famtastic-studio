# M5: declared, with proof

> **SCOPE CORRECTION (2026-08-25, ruling 4).** "System of record for production
> site builds" is scoped to **what Studio can represent**. Studio's spec
> vocabulary covers pages, sections, brand and media — a brochure site. It has
> no field for a database, endpoint, session, scheduled job or upload target, so
> a site with a server-side runtime cannot be represented, only carried.
> **MBSH is deployed and live and Studio could not rebuild it.** Sites now carry
> `capability_class` (`brochure | application`) and the console shows it, so the
> limit is visible rather than implied.

> ## DEFECT DISCLOSURE — added 2026-08-25, on re-examination
>
> **M5's acceptance artifact passed while carrying the defect that makes it
> unshippable.** This is recorded here, on the declaration itself, rather than
> only in the retro, because the artifact is what closed M5.
>
> Re-examined against the calibration finding
> (`fa50951d`, "the copy stage renders its own outline"),
> `ACCEPTANCE-starlight-home.html` is the same unshippable shape as the five
> calibration samples:
>
> - **0 of 10 paragraphs end in sentence punctuation.** Not one is a sentence.
> - The hero body is `name, one-line positioning, city, primary Book CTA` — an
>   instruction to a writer, published as the customer's opening line.
> - Every other body is a production note: "3-4 cards linking into the full
>   menu", "4-6 images or before/afters with consent", "2-3 pulled quotes with
>   source platform".
> - Headings are outline labels, not page language: "Trust strip",
>   "Results / gallery".
> - No brand direction reached the render: the palette is generic default
>   blue-on-white (`#2563eb`, `#111111`), not a skincare studio's.
>
> **What was reported at the time, and why it was wrong.** The typed-sections
> fix was reported as a quality win because it produced "seven real headings".
> The headings were real. Everything under them was the blueprint. The fix
> improved *structure* and, in doing so, made the outline render more cleanly —
> it promoted outline fragments into tidy headings and paragraphs, so the page
> reads as more finished while saying nothing to a customer. **Structural
> improvement was measured and reported as product quality.**
>
> Every gate passed: one h1, correct hierarchy, real nav, no broken links, hero
> image present. This is the present-but-wrong class that absence-checking
> cannot see — a page with all of its parts and none of its substance.
>
> **Status of the underlying defect:** fixed structurally on 2026-08-25, after
> this declaration. `spec-derive` now keeps the outline in `instruction` and
> starts `body` as null, so the outline cannot reach a render at all, and
> `copy.js` is the stage that fills `body` with an echo guard that rejects a
> body too close to the instruction that asked for it (`3fe5dd16`, `0dcf004b`).
>
> **What this does NOT change:** the M5 criteria as ruled — one real build
> deployed and rolled back with byte-identical restoration, plus an imaged
> acceptance run — were met as stated. The deploy, rollback, and imagery claims
> stand. What is corrected is the implicit claim that the acceptance artifact
> was *shippable output*. It was not, and no criterion actually required it to
> be. That gap between "the criteria were met" and "the product is good" is the
> finding.

**Date:** 2026-08-23
**Bar (from ENDGAME.md, owner's ship-blocking definition):** the console operates
Fritz's sites; the pipeline builds a real site from a brief with DNA captured and
a recipe saved; deploy works to FAMtasticInc; proofs visible read-only; isolation
and revenue-safety tests green; shadow-run evidence ready for the cutover call.

Each item below is verified against a real artifact, not asserted.

---

## 1. The console operates Fritz's sites — MET

12 pages under `public/pages/`. Smoke exercises 11 regions against a real booted
server; `npm run smoke` passes 11/11.

Sites now carry an **origin** so counts distinguish real from fixture:
`GET /api/sites` returns `origin_counts` and `denominators_by_origin` alongside
the A6 totals. Live reading against the working data root:
`{"legit":0,"test":5,"unknown":5}`.

## 2. The pipeline builds a real site with DNA captured and a recipe saved — MET

Real end-to-end run, live research, 2026-08-23:

```
run_id: run_mt6b8hw4n64nj7ug   outcome: success   elapsed: 113s

 research  model=cli-selected  agent=claude-cli    routing_source=default
           usage=provider_did_not_report  cost=provider_did_not_report_currency_cost
 spec      model=none  agent=null           routing_source=default  usage=0  cost=$0
 compose   model=none  agent=deterministic  routing_source=default  usage=0  cost=$0
 build     model=none  agent=null           routing_source=default  usage=0  cost=$0
 verify    model=none  agent=null           routing_source=default  usage=0  cost=$0
 record    model=none  agent=null           routing_source=default  usage=0  cost=$0

recipe saved: recipe_mt6b8iqiz1qsp215 (6 stages)
media slots: 10 declared
replay manifest tree_hash: f4d5c5f7c70df77d
```

Every claim in that record is now true, which was not the case earlier today:
research no longer reports `model: none` while running a real CLI, a
subscription-backed stage reports honest non-reporting rather than a zero that
would read as free, and `routing_source` survives into DNA instead of being
dropped by `recordStage`.

## 3. Deploy works to FAMtasticInc — MET

`server/kernel/deploy.js`, provider `famtasticinc`. Copy-then-verify-then-publish
ordering, explicit active-release pointer, per-file sha256 plus a manifest hash.
`deploy.rollback()` restores the prior receipt, re-verifies against bytes read
back from disk rather than the in-memory manifest, and switches the pointer
separately. Covered by `tests/kernel-deploy.test.js` including tamper detection,
no-prior refusal, and cross-site refusal.

## 4. Proofs visible read-only — MET

One route: `GET /api/proofs`. Zero mutating proof routes anywhere under
`server/` (grep-verified). `assertNoProofRoutes()` runs in the P0-I1 preflight
before any kernel evaluates, and boot refuses if a proof ingress appears.

## 5. Isolation and revenue-safety tests green — MET, with a stated limit

`npm run gates`: lint OK, **475 tests across 33 files**, smoke 11/11,
**G4-0 PASS**, **G4-1 PASS**, exit 0.

**Stated honestly:** G4-1 reports 6 passed, 0 failed, **4 SKIPPED-WITH-REASON**.
Those four could not be checked on this machine (no production proof-jobs or
proof-output directory exists here; the legacy ledger location holds zero files;
no outreach code path is shipped). A skip is not a pass. The outreach guarantee
rests on **containment** — no such code path exists — not on observation.

## 6. Shadow-run evidence ready for the cutover call — MET

`SIDE-BY-SIDE-2026-08-23.md`: five real external customer briefs through the full
canonical flow, compared against what legacy had already produced, read
read-only. Plus the record correction (those legacy rows were benchmark and pilot
output, never customer deliveries), `CUTOVER-AMENDMENT-2026-08-23.md` narrowing
scope to the build path, and `CUTOVER-MECHANICS-2026-08-23.md` with the rollback
runbook.

---

## CRITERIA CORRECTION (2026-08-23, Fritz's ruling)

"One real proof job via Studio" is **struck from the M5 criteria as based on a
false premise.** Studio never serves proof ingress: `assertNoProofRoutes()` in
the P0-I1 preflight forbids it, and that invariant is what revenue gate G4-1
rests on. Proof generation is Designs-owned and its modernization is Designs'
migration (POST-SHIP #1).

**Substitute criterion, MET:** one real build deployed and rolled back with
byte-identical restoration, plus the imaged acceptance run.

- Rollback rehearsal: deploy `dep_mt6fjv2hb99ruo2x` (16 files) -> edit ->
  deploy `dep_mt6fjv39o9rbej6m` -> rollback. Restored bytes match the original
  exactly; the injected marker is gone.
- Imaged acceptance run: Starlight Skin Bar, full canonical flow, 9 of 15 slots
  filled, hero rendered on all 6 pages, typed sections yielding 7 real headings.

## Verdict

**M5 is met.** The console operates real sites, the pipeline builds one from a
thin brief with grounded research and a complete replay manifest, deploy and
rollback work and are tested, proofs are read-only by construction, the safety
gates are green with their limits stated, and the cutover evidence is assembled.

## CLOSE-OUT ADDENDUM (2026-08-23, after the closing sequence)

Three bar-adjacent items landed after this declaration, and the cutover was
executed. Recorded here so the declaration is not read as of a stale moment.

- **Imagery is wired and filling.** Preflight, parallel slots, per-run budget,
  full provenance per image, and fail-means-declared-unfilled with nothing
  substituted. Acceptance artifact: Starlight Skin Bar, full canonical flow,
  9 of 15 slots filled (3 rate-limited, 3 over budget), hero rendered on all
  6 pages. This closes the one dimension where legacy output was competitive.
- **A machine-readable quality signal exists.** The deterministic brand-voice
  gate records pass/fail into DNA per run, and reports a `vacuous` pass when the
  brand declared no anti-patterns rather than letting an empty check read as an
  endorsement.
- **Operator outcome is captured.** `shipped / edited_then_shipped / rejected /
  pending`, set in one click from Builds, with prior decisions kept in history.
  This is the Rung-3 ground truth the efficiency scorecard named as missing.
- **Cutover executed.** See `CUTOVER-RECORD-2026-08-23.md`. The build path is
  live as system of record; legacy is cold and recoverable. The proof webhook
  flip was **not** executed and is not executable as specified: the new path is
  forbidden proof ingress by the same invariant G4-1 rests on, and production has
  no dispatch path to any Studio. The live proof pipeline is untouched.

## What M5 does not include, stated plainly

- **Image generation quality tuning.** Images are real and usable; nobody has
  art-directed them.
- **The build agent roster wiring.** Spec'd
  (`BUILD-AGENT-ROSTER-2026-08-23.md`), not built.
- **Raw CLI response retention.** Still open; the roster's telemetry shape closes
  it and is sequenced first for that reason.
- **The conversational Shay rail.** Cut at ENDGAME and still cut. The rail states
  honestly that it is not wired.
- **Everything in POST-SHIP.md**, including the two cross-platform migrations.
