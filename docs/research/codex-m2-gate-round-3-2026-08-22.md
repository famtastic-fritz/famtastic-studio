# Codex M2 exit gate, round 3

- **F9 — NOT RESOLVED.** Ordering is corrected, but cleanup is not: [deploy.js](/Users/famtastic-fritz/Development/famtastic-wt-phase-0/site-studio-next/server/kernel/deploy.js:82) calls undefined `receiptPathFor()` instead of `receiptFile()`, then swallows that error. A partially written receipt can therefore survive. The success journal append is also outside the guarded block, and `deploy.completed` references the earlier `publishing` entry. The rename-only regression cannot expose either path.  
  **Minimal fix:** correct the helper name, include/capture the success append inside guarded finalization, use its entry ID in the event, and add a receipt-write-then-throw regression asserting no receipt and no `deployed` claim.

- **F11 — RESOLVED.** The pipeline persists the canonical object outcome in [pipeline.js](/Users/famtastic-fritz/Development/famtastic-wt-phase-0/site-studio-next/server/kernel/pipeline.js:424), while [builds/index.js](/Users/famtastic-fritz/Development/famtastic-wt-phase-0/site-studio-next/server/modules/builds/index.js:125) now accepts both that object and the legacy string before invoking `recipe.fromRun()`.  
  **Minimal fix:** none.

- **F15 — RESOLVED.** [package.json](/Users/famtastic-fritz/Development/famtastic-wt-phase-0/site-studio-next/package.json:12) chains lint, full Vitest, smoke, G4-0, and G4-1 with fail-fast `&&`. I independently confirmed lint and G4-0 exit 0 at `d92825cc`; the committed smoke report records all 11 pages passing. Deploy files are below 500 lines without exceptions. The read-only review sandbox prevented an independent Vitest rerun before collection (`EPERM` creating its temp directory), which does not contradict the supplied exact-SHA gate run.  
  **Minimal fix:** none.

**VERDICT: SAFE WITH FIXES** — fix and regress F9 before assembling the cutover packet.

