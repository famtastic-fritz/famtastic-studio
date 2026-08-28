# SITE STUDIO — SESSION RECORD (Claude / claude.ai)

> **Mirrored into the repo 2026-08-26** from Google Drive:
> `Site Studio / 07 Claude Session Record — Console + Quality Engine /
> SESSION-RECORD-2026-08-26-console-and-quality-engine.md`
> (Drive file id `1x1bCJ7HbBo4IVgheAo6JULtZ8Cr6Mr8i`).
>
> Fetched through the Drive connector, which returns an escaped rendering rather
> than raw bytes, so this copy is **unescaped and reflowed, not byte-identical**
> to the Drive original. Content is unedited. Drive remains the authored source;
> this copy exists so the record is version-controlled and readable with no Drive
> access. Required reading for a cold start — see `docs/RESUME.md`.

**Period covered:** 2026-08-21 through 2026-08-26
**Participants:** Fritz (owner) · Claude on claude.ai (design + planning collaborator, no repo access) · Claude Code (builder, full repo access) · Codex (adversarial reviewer)
**Purpose of this file:** so no lesson from this session is lost, and any future session — mine, another Claude, or another agent — can pick this up cold.

---

## 0. WHERE WE ARE, IN ONE PARAGRAPH

Site Studio was down for close to four months across repeated rewrites, blocked by a monolithic `server.js` carrying old `claude -p` code that predated Shay as orchestrator. This session started as a deliberate blank canvas: Fritz withheld the legacy at first so the rebuild would not inherit its assumptions, then fed it in as an evidence library. The greenfield kernel shipped and cut over. The console surface and the generation quality were then found to be the real gaps. As of this writing the pipeline has been fixed through three systemic defects (outline-as-copy, brand-by-luck, orphaned imagery), the after-set of five rebuilt samples went from 0% prose to 100% prose with 7–10 images each, and the next steps are: place the aesthetic cutoff with Fritz's own verdicts, build the console surface, and implement typed research modules with sites-as-projects.

---

## 1. THE SIX (NOW SEVEN) INSTANCES OF ONE PATTERN

Almost every defect in this project is one of two shapes: **something computed and then not consumed**, or **something true once that stayed recorded after it stopped being true.** Every one passed green gates.

1. **Outline published as copy.** No copy stage existed. Research declared `"Hero: <instruction>"`, spec split on the colon, compose rendered the half after it. Five consecutive builds published their own outline. 0 of 10 paragraphs ended in sentence punctuation.
2. **Brand direction reached nothing.** `deriveTokens` read hex only. Whether a brand reached the render depended on whether research happened to emit a hex code. Four siblings got lucky; Tidepool rendered default blue. **Working by luck is indistinguishable from working.**
3. **Generated imagery discarded.** Starlight generated 10 distinct images and rendered 1, repeated seven times. Eight paid-for images orphaned on disk. Nothing failed.
4. **A ratified plan document contradicted a boot invariant.** The cutover amendment said Studio would serve the proof webhook; `assertNoProofRoutes()` refuses boot if it does. Both had passed review. Found only by executing the cutover instead of describing it again.
5. **"Research is 99% of build time."** True when measured. Stopped being true the moment two model-backed stages were added. Repeated as fact. Actual: spec stage 70–74%, research 24–32%.
6. **The copy-stage bypass hid the stage from its own tests.** Derivation wrote `body` directly; `writeCopy` only fills a falsy body; so the copy stage never ran in any pipeline test. Every green run tested a pipeline with the stage skipped.
7. **A worktree-only ruling became architecture.** The 2026-08-23 "preview ownership resides in FAMtastic" ruling existed only in a worktree copy of SITE-LEARNINGS, never in the canonical file. It hardened into boot invariant P0-I1 without ever being weighed against the two older rulings it contradicted.

**The lesson that binds them:** the failure was never in the code. It was in what the code could see, and in what the record still claimed.

---

## 2. RULES ADOPTED THIS SESSION (all in force)

- **R2 — circumstance and expiry on rulings.** Every ruling records `circumstance: normal | outage | deadline`. Anything not normal carries `review_by` and expires unless re-ratified. Tagged `outage`, the preview ruling would have expired ~2026-09-22 instead of becoming law.
- **R2 extended to measurements.** `server/kernel/measurements.js` refuses a record without `measured_at` and `conditions`, and carries `expires_at` plus **`invalidated_by`**. A timestamp alone would have missed "research is 99%" — it went stale on a structural change, not on time.
- **`invalidated_by` generalizes.** Competitor research invalidates on a new competitor or a site redesign; token audits on token change; screenshot baselines on renderer change; rulings on the end of the circumstance that produced them.
- **Every write path to `body` passes the copy stage echo guard.** No direct writes, no exceptions — promotions, repairs, fallbacks included. Enforced by `assertNoPreWrittenBody` plus a source-level test.
- **Score only after the run reports success.** Three defects in one session were claimed from incomplete measurements (chat bubble, lazy-loaded images, in-flight builds).
- **A gate that fails good pages is worse than no gate.** Learned twice: the WebAIM check false-positived on MBSH by treating an `rgba(255,255,255,0.04)` overlay as opaque; the fork detector flagged a separate document as a fork.
- **Never substitute.** Imagery declares slots unfilled with reason rather than filling with stock. Research returns `not_found` rather than plausible answers.
- **Cheap deterministic checks run before any model is asked.**

---

## 3. THE DECISIONS (ratified, with reasoning)

- **Greenfield, legacy as evidence library.** Salvage via capability records with verdicts KEEP-CONVERT / ADAPT / ARCHIVE-FOR-FUTURE / RETIRE. The prior two "rewrite it cleanly" attempts failed by starting from `server.js` and being absorbed by it.
- **Boundary: doctrine vs workaround.** Designs keeps customer identity, intake, purchases, proof decisions, email, timeline, consent (**doctrine**). Preview generation, Build DNA, artifact hosting, media generation, and build-time credentials are **workarounds** from Studio's outage. A 2026-05-05 ruling ("provider authentication belongs to Site Studio, not generated sites; MBSH is the first proof") predates and contradicts the 08-23 inversion, and was never rescinded on the merits.
- **Stage 3 reclamation, never Stage 4.** P0-I1 forbids Studio *serving* proof ingress, not *generating* and handing over. Designs receives and serves; Studio is a callee, never a listener. Direct ingress is permanently off the table. Credentials return to Studio last, as a gated step after Stage 3 is proven.
- **Proofs read-only in Studio.** Full pipeline visibility with dual status (customer status + studio status + owner + blocker + last sync); action happens in Designs.
- **Vanilla JS, multi-page, no framework, no build step.** Protects the click-to-edit path. Backend is modular Node; the 20K-line `server.js` is a named anti-pattern.
- **`capability_class: brochure | application`.** Derivation can only emit `brochure`; an application is declared, never inferred. MBSH is an application (5 tables, ~14 endpoints, 12 authenticated admin pages, cron) and Studio **cannot rebuild it** — it deploys and verifies the backend as an opaque attachment with `studio_understands_contents: false`.
- **No operator auth ceremony.** Network-layer access control, local preview port 3400, loopback only.
- **Rolling gates.** Notify and continue. "Show me" is never a stop instruction. Two hard stops only: touching the live proof pipeline, and a cutover decision.

---

## 4. WHAT THE RESEARCH ACTUALLY ESTABLISHED

Run through NotebookLM via the research kernel, every source independently re-fetched, nothing substituted.

**Sourced and adopted**
- Feedback timing: 100ms instantaneous · 50ms input processing · 1.0s flow-of-thought breaks · 10s attention breaks
- Progress form: <1s no indicator (a spinner here causes anxiety) · 2–9s indeterminate · ≥10s determinate + estimate + interrupt · lower the cutoff when duration is variable
- INP ≤200ms good · LCP ≤2.5s · CLS ≤0.1
- WCAG (all `mutable: false`): text 4.5:1, large 3:1, non-text 3:1, targets 24×24 CSS px, state preserved 20 hours removes the timeout-warning requirement
- Aesthetic rubric: **40 alignment / 30 aesthetics-readability / 30 structure-responsiveness on 0–100**; bands 90/70/50/30; imagery ≥85 vs placeholders <50; broken sections <50
- **A rubric raises human inter-annotator agreement from 65% to 92%.** The wording is worth ~27 points of reproducibility; the threshold is worth almost nothing by comparison.
- **Human ceiling 68.7%** — never gate stricter than people manage on the same task
- WebAIM Million 2026: 95.9% of a million pages fail; six categories are 96% of all errors (low contrast 83.9%, alt text 53.1%, form labels 51%, empty links 46.3%, empty buttons 30.6%, document language 13.5%) — all deterministically detectable, unchanged for seven years
- Anthropic evals: one isolated judge per dimension, an explicit "Unknown" escape hatch, partial credit over binary
- Retry: initial 1s, multiplier 2 (adopted); max-backoff and retry-count figures rejected as object-storage defaults inapplicable to our workloads

**Explicitly NOT sourceable — four of five build-plan guesses had no backing**
- Aesthetic pass score (guessed 7.0/10): no absolute threshold exists in any paper → must be **calibrated** against Fritz's own verdicts, recorded as calibrated-not-cited
- Token adherence threshold (guessed 85%): no published threshold → **reported with warning band, not blocking**
- Repair loop cap (3) and recalibration interval (weekly): marked `sourced: false, status: OURS, provisional`
- Screenshot tolerance: `maxDiffPixels` exists, no default stated

---

## 5. VNEXT — THE PATTERNS WORTH KEEPING (from the legacy engine)

- 27-stage DAG; **only 4 stages use judgment.** Everything else is reproducible machinery.
- **The critic judges the rendered page in a real browser at 1440 and 390 using laid-out geometry, never the markup** — markup produced the defects, so asking it to confirm them is asking the suspect for an alibi.
- **A lane returns a verdict (pass/repair/block), not a warning.** "A lane that only advises gets ignored, which is how a page with no imagery shipped past four green lanes."
- **The creative director rewrites downstream manifests** so direction cannot be bypassed. A direction downstream stages must remember to consult is another thing computed, stored, and read by nothing.
- Repair is **instruction-driven and bounded** — issue codes map to written instructions. Regenerating without knowing what was wrong is rolling dice, not retrying.
- **Proof and gaps are separate artifacts.** What failed and what is missing are different questions.
- Proof contract **fails closed** on a missing evidence path and documents what it does not prove.
- A generator may never approve its own output.
- Art direction as a cost decision: **"if CSS keyframes can fake the motion, don't pay for video."** Now a real routing rule reporting `avoided_paid_slots`.

**Standing finding:** MBSH's quality comes from commissioned assets (mascot, backgrounds, video, premiere work). **Generation is not the gap — art direction is.** A direction must be able to declare "this needs commissioned work" and mark a slot `unfilled-pending-human` rather than settling for competent and generic.

---

## 6. THE MOCKUPS (directional references, never pixel-parity targets)

Three files, in `docs/plans/reference/`:
- `shay-operator-console-mockup.html` — first pass: needs-me/broken-now open, diff slider, Shay rail, ingestion triage, ⌘K plan preview, kill switch
- `site-studio-editor-v3.html` — the property inspector: Content/Style/Advanced, collapsible groups, spacing box model, floating toolbar, bottom command strip
- `site-studio-vision.html` — **the fullest statement of intent.** Nav grouped Operate / Produce / Know. Adds the quality gate screen (BLOCK verdict, six lanes, token audit, bounding-box critiques, repair queue, gaps separate from failures, what-this-does-not-prove), the 27-stage DAG build run, System Truth (capability truth, cost/approval, run ledger, proof packet, blockers vs non-blockers, gap log, artifact provenance, deferred decisions — **every panel showing the API route it reads from**), and Learning (critic misses, routing proposals, ground truth, efficiency trend)

**Known corrections to apply when building:** no progress indicator under 1s; research stage needs determinate progress + estimate + interrupt; builds must be backgroundable AND readable cold; all interactive targets ≥24×24 (the mockup's floating toolbar fails); click-to-edit target is 100ms not 140ms.

---

## 7. THE PLAN FROM HERE

**Immediate**
1. Place the aesthetic cutoff — score the after-set with the 40/30/30 rubric, one isolated judge per dimension, harness renders at 1440/390, Fritz gives ship / edit-then-ship / reject. Cutoff goes where his verdicts split. Critic flips from report-only to blocking at that number.
2. Imagery backoff and concurrency (now the bottleneck at ~184s for 10 slots at concurrency 2).
3. Console phase — surface over existing endpoints, mockups as functional spec, screenshot acceptance per screen at both widths.

**Typed research + sites-as-projects (designed, then built)**
- **Research kinds, each with its own schema, provider, TTL, and downstream consumer:** entity · industry · competitor · gap_niche · visual · audience · compliance · local · seo
- **The avoid list is structural** — a required output of visual and gap_niche research, consumed by both the copy stage and image-prompt stage. This is the anti-generic mechanism, and it must be research-derived, never prompt-derived.
- **Research provider registry**, same shape as `media-providers.js`. `auth: subscription | mcp | none` — **never `api_key`**, per the 2026-05-05 ruling. Recipe assigns providers per research kind, like brains per stage.
- **The combination is the point:** claude CLI discovers and verifies sources → verified sources added to the project's notebook → NotebookLM synthesizes across the corpus with citations. Breadth then depth. A future custom module slots into either position.
- **Sites are projects.** A project owns the site, its research corpus (notebook id, sources, every packet over time), conversations, decisions, lessons, DNA history, tokens, deploy target, capability_class, telemetry — and a *link* to the Designs customer record, never a duplicate. **The corpus grows; a rebuild extends research rather than redoing it.**
- **Research TTL and caching** — a rebuild re-runs only expired kinds.
- **Section-supply contract:** each research kind declares which section types it can supply facts for; the sitemap planner may not declare a section whose facts no scheduled research kind will gather. This turns the 98-of-256 empty-section problem from an output warning into a planning-time contract violation.

**Two telemetry metrics we lack**
- **Research utilization** — the fraction of verified findings carrying a `design_use` that actually appear in the output. A direct measure of the computed-then-not-consumed failure class; would have caught the outline defect and brand-by-luck automatically.
- **Edit location** — which sections Fritz edits before shipping. If he rewrites every hero, the copy stage is weak on heroes. Rung 3 fed by real signal instead of a score.

---

## 8. ENHANCEMENTS ENVISIONED (high level, not yet scoped)

- **Research corpus as compounding moat** — year three, MBSH's notebook knows the committee's history, the venue quirks, what worked at the 25th. No other generator has one.
- **Cross-site intelligence** — nine sites, one component library, one token system. "This CTA converts on four sites" is knowable only here.
- **The avoid-list as product** — every generator makes category clichés; ours structurally refuses to.
- **Research utilization as the headline metric** — not tests passed, not cost. "87% of what we learned reached the page."
- **Recipes as sellable IP** — "suite-service-business-v1" is a product, not a config file.
- **Client-facing preview links with evidence attached** — show the customer *why*, not just what.
- **Journal time-travel** — a scrubber across a site's whole history, not just undo.
- **The gate as a service** — point it at any site, yours or a prospect's, get a scored teardown. *Highest-priority enhancement after the console: near-zero additional work, turns the quality engine into customer acquisition.*
- **Studio building Studio** — the console is a site; once the pipeline is good it should rebuild its own surface.
- **Voice-in from the phone** — "add a sponsors page to the reunion site," Shay drafts, Fritz reviews at the machine.

---

## 9. PITFALLS — WHAT NOT TO DO

- **Do not start from `server.js`.** Two prior clean-rewrite attempts were absorbed by it. This session worked because the legacy was withheld at first, then fed in as evidence on Fritz's terms.
- **Do not report structural improvement as quality.** "Seven real headings" was reported as a win on a page whose every paragraph was a production note. Typing the sections made the outline render *more cleanly*. The honest test is not whether the artifact improved but whether it became shippable.
- **Do not treat green gates as proof.** 529 tests green while the acceptance artifact that closed M5 carried the defect. Absence-checking cannot see a page with all its parts and none of its substance. **Nobody read the page.**
- **Do not let a workaround harden into architecture.** Tag circumstance at write time.
- **Do not repeat a measurement as a fact.** Re-measure, or cite `measured_at` and `conditions`.
- **Do not fill a gap with a plausible answer.** `not_found`, `NOT_FOUND`, `provider_did_not_report`, `unfilled-pending-human`, "Unknown" — all exist for this reason.
- **Do not let one agent's ruling live where other agents cannot read it.** 14+ divergent SITE-LEARNINGS copies; the canonical file was smaller than a worktree's by 703 lines.
- **Do not build a detector that cries wolf.** A gate that fails good pages, or a fork detector that flags separate documents, trains the operator to ignore it.

---

## 10. HOW TO PICK THIS UP COLD

1. Read `docs/RESUME.md` in `site-studio-next` — one paste, current state, non-negotiable rules, and the failure mode to expect (**silence, not exceptions**).
2. Read the canonical `SITE-LEARNINGS.md` (8901 lines, 201 sections after convergence).
3. Read `docs/plans/BOUNDARY-CLASSIFICATION.md`, `docs/plans/CROSS-REPO-INDEX.md`, `docs/plans/MBSH-SPEC-GAP.md`, `docs/capabilities/CONTENT-AGENT.md`.
4. Read this file for the reasoning behind the decisions, and `docs/plans/reference/site-studio-vision.html` for the intended surface.
5. Ask Fritz for the two things only he can supply: **ship/reject verdicts** (which set the aesthetic cutoff) and **rulings on boundaries** (doctrine vs workaround).

**Where Claude on claude.ai fits:** no repo or machine access; reads Google Drive; designs, plans, reviews, and writes directives. Claude Code builds. Codex reviews adversarially and never works as a builder. The Drive sync folder (`Site Studio / 06 Build Sync`) is the shared memory between surfaces.
