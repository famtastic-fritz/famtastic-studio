# Normal record-writer proof, first bounded profile

## Timing and content regressions

Verification after the timing/origin/Home fixes: full Next suite **1,007 tests / 96 files in 51.87s**, all three PHP harness variables enabled; PHP 42 contract assertions and 3 selection-seam cases pass, changed PHP syntax and Next lint/diff checks pass. The multi-cycle normal browser tests now have a bounded 20-second per-case limit after an initial 5-second timeout caused cleanup to race an active browser read; the final full run has no unhandled errors.

Five normal writer cases cover intro and hero assembly, hero-only packaging, delayed callback, and upload failure. In each failure case, the agency receives no source receipt before a new Team request; Next reconciles verified local About content, preserves its bytes, assembles only Team in the same repository after restart, supersedes the old job and does not rebuild on retry. Changed About copy during the callback delay is rejected before another build. Signed incoming packets remain exact; only a separate local execution projection skips proven completed steps.

New Home text is a pending existing-page edit, never silently ignored. Removing a previously built page's supplied copy is a pending review of withdrawn source copy, not an instruction to erase live content. Both invalidate prior acceptance. Studio re-registration updates handoff initiator while retaining original Designs provenance. These tests use synthetic persistence and hosting, not real customer delivery.

## Follow-on verification: durable mapping and normal edits

Full Next suite passed **1,004 tests / 96 files in 44.48s**, with all three PHP harness environment variables enabled. PHP contract assertions (42) and selection seam cases (3) also pass. The added normal regression uses actual service methods with synthetic persistence, no running Drupal database.

- First selection with no linked project creates exactly one project across retry.
- The real worker writes a durable source mapping and exact finalized wire; actual receipt acceptance persists that mapping in agency project storage.
- Actual customer review acceptance followed by serialization-only request update retains the same packet and acceptance.
- Changed existing page copy automatically invalidates acceptance and reports the unsupported edit recipe. Adding Team through the request writer alone emits only Team's assembly step, reuses the original repository after SQLite restart, and preserves completed About bytes.
- Studio `registerSourceExport` can re-register that actual completed mapping idempotently, and the later missing-page packet follows the Studio origin. This is not yet proof of a fresh Studio-first source with no prior mapping.
- A one-page Home source with a hero marker packages unchanged with no recipe, transformations or generation. Initial source import still invokes the pipeline once; this does not claim zero repository initialization.

Remaining: fresh Studio-first mapping writer, media-rights propagation from normal uploads, existing-page edit executor, full portal browser/Drupal integration. Hosting/callback adapters are synthetic; no production, credentials, provider spend, external messages, push/merge or Drive writes occurred.

Verification: 52 tests in 7 files passed in 7.71s with both PHP harnesses and the normal-writer harness enabled; PHP 42 contract assertions and 3 normal-selection seam cases pass, Next lint/diff checks pass, and all three changed JSX files parse with the existing esbuild dependency. An earlier harness wake stub returned no Promise; replacing it with the actual worker tick removed the unhandled errors before this passing sweep.

Actual agency service methods exercised: `ProofCampaignService::acceptCallback` (including protected artifact writes, raw capture and request attachment), `CustomerPortalService::updateWebsiteRequest`, `saveWebsiteRequestProofResearchSnapshot`, `approveWebsiteRequestProof`, `decideWebsiteRequestProof`, derived `SelectedRecordResolver`, existing `AutomationWorker` / `SiteStudioStagingClient`, immutable `readSelectedArtifact`, and `StagingReceiptService::accept`.

Inputs are synthetic upstream HTML/DNA, ordinary customer page names/copy, owner proof-research input and installation-owned target/code policy. Neither project `selected_source_authority`, variant `selected_build_continuation`, nor content/permission record blobs are seeded. The real writers create all internal recipe records. Existing callback and selection retries do not add another staging job.

The test passes actual signed dispatch bytes through Next's HTTP handler, durable queue and worker. Original selected HTML and marked footer remain exact; the requested missing About page contains supplied copy. Real browser QA runs before mocked hosting and callback. The exact resulting receipt is accepted by the actual agency service, with duplicate receipt accepted idempotently and checkout still closed. Node-generated artifact HMAC headers pass the actual PHP reader; invalid signatures, expiry and wrong revisions fail. Missing page copy, unsupported booking scope and absent shell rights become planning issues. Raw callback bytes retain empty-object/array/number distinctions.

Current deterministic profile: root-level static pages, one marked intro component with one typed H1 and paragraph, inline marked shared CSS, no media. Next's strict parser remains authoritative for markup validity. The agency DOM reader only derives field IDs and cannot authorize browser-repaired output. Exact selected source supplies the derived template reference; provenance says no original template was received. `selected-source-preservation-v1` is accepted only with its hash-matched HTML artifact bundle, not as an invented canonical palette.

Still required before completing the original goal: persisted project-source mapping from actual finalized builds; both initiation directions and missing-page revisions in the same existing repository; normal media-asset ownership/license propagation; full authenticated route/controller and portal browser integration coverage. Current test uses synthetic entity/database adapters, actual service writers, real Next filesystem/browser, and mocked hosting/callback transport. It is not full Drupal runtime or production evidence. The new portal page-copy fields were syntax-checked, not browser-proven yet.

No legacy/customer-repository writes, credentials, providers, real jobs/mail, deployments, pushes, service/config activation or Drive mirror writes occurred. Test-created repositories/files live only in disposable temporary directories. The work remains open for the listed connection increments.
