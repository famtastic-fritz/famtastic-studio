# ADR-0005: Dispositions of the Codex M2 exit gate

**Date:** 2026-08-22 | **Status:** closed. Round 4 returned SAFE TO ASSEMBLE THE CUTOVER PACKET at 38a2cc31. | **Gate output:** docs/research/codex-m2-gate-round-1-2026-08-22.md
**Verdict received:** NOT SAFE.

## Standing note on staleness
The gate reviewed `85933f0c`, which predates the PROVE run, the shadow module and the deploy plan work. Several findings were already fixed when it wrote them. Each disposition below says whether the finding was live at review time, so the record is not flattering.

## Dispositions

| # | Finding | Disposition |
|---|---|---|
| 5 | Pipeline retry executes against the site in an arbitrary run record, not the bound identity | **ACCEPTED and FIXED.** Verified live before fixing: the route dropped `identity.site_id` and the kernel took `site_id` from the record, while `/api/builds` lists run ids across every site. The bound identity now decides, and a mismatch is refused *before the record is inspected*, so a foreign run leaks nothing about its stages. Tests in `tests/isolation-boundaries.test.js`. |
| 12 | Rerun verifier certifies a stage whose verification explicitly failed | **ACCEPTED and FIXED.** `verification.passed === true OR status === 'success'` let `{status:'success', verification:{passed:false}}` certify itself. Explicit failure now always loses. |
| 6 | Cross-site containment is lexical, follows symlinks | **ACCEPTED, in progress.** Third containment issue in this build. Being fixed at the shared resolver rather than per caller. |
| 8 | Go-live and rollback have no active-target oracle | **ACCEPTED, in progress.** Go-live manufactured `environment: 'production'` and a `verified_at` without resolving anything, and rollback verified directory bytes without switching any active pointer. |
| 9 | Receipt does not limit the artifact and journals before the copy completes | **ACCEPTED, in progress.** Operational files entered the release and a failed copy left durable evidence of a deploy that never happened. |
| 10 | Successful DNA is not a true A4 replay manifest | **ACCEPTED, in progress.** Tree identity was commit plus porcelain rather than content, so two different dirty trees share a hash. |
| 13 | Composer emits a broken default CTA while verification reports success | **ACCEPTED, in progress.** The verifier skipped every fragment link, which is the more serious half. |
| 14 | Proofs collapses unreadable and not-configured into empty | **ACCEPTED, in progress.** |
| 7 | Deploy dispatches on first POST with no plan boundary | **ALREADY FIXED at review time.** `deploy.plan()` and `POST /api/sites/plan-deploy` landed with the PROVE fixes; the gate reviewed an older SHA. |
| 4 | Shadow writes its record to the wrong root | **PARTLY STALE.** The shadow lane found and fixed the record-root half itself before the gate ran. The global `fetch` and env mutation remain, recorded in POST-SHIP as a concurrency limitation rather than fixed: shadow runs are operator-initiated and serial today. |
| 11 | Recipe references decorative; successful runs cannot be saved | **PARTLY ACCEPTED.** The outcome-shape mismatch is real and folded into the DNA work. A full pipeline-to-recipe-to-rerun route is CUT scope per ENDGAME. |
| 15 | The declared gate command does not run the revenue gates | **ACCEPTED.** A single final-SHA gate command is assembled as part of the cutover packet. |

## The pattern worth naming
Three of these are the same defect wearing different clothes: containment or authority is established at one layer and then bypassed by a newer surface that resolves its own path or takes its own site. The kernel was hardened three times; each time a new caller reintroduced the hole. That is a design signal, not three unlucky bugs, and it belongs in the cutover packet as a standing risk with a named mitigation: every new surface that touches site state must go through the shared resolver and the bound identity, and the adversarial suites must gain a case per surface.


## Outcome
Four rounds. Every finding was fixed rather than argued, and three rounds found defects introduced by the previous round's fix:

- Round 2 found that the deploy publish ordering fix still journaled success before the rename.
- Round 3 found that the fix for THAT called a helper which did not exist, with the error swallowed, so the cleanup path could never run. The regression test written alongside it passed, because it failed earlier than the broken path.
- Round 4 confirmed the corrected version and cleared the gate.

The lesson is recorded here rather than in a retro nobody reads: a test that passes proves the case its author imagined, not the case that matters. Each of those fixes looked complete and was verified green before the next round found it wanting.
