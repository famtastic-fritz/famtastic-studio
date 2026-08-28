# Codex Phase 0 exit gate, round 2

Verdict: NOT SAFE (3 resolved, 9 not).

Round 2 result: **3 RESOLVED, 9 NOT RESOLVED**. The remaining P0-I1 ordering defect and branch contamination prevent merge.

1. **F1 P0-I1 — NOT RESOLVED**

   The discovered modules are preflighted before `loadModules()`, and `/api/proofs` is correctly allowed while the three ingress patterns are blocked. However, ESM evaluates the static kernel imports at [server/index.js:2](/Users/famtastic-fritz/Development/famtastic-wt-phase-0/site-studio-next/server/index.js:2) before executing the preflight at [server/index.js:26](/Users/famtastic-fritz/Development/famtastic-wt-phase-0/site-studio-next/server/index.js:26). A forbidden dependency added through those kernels can therefore execute before detection. The test also does not exercise `preflightModuleClosure()` or `assertNoProofRoutes()`.

   Minimal fix: bootstrap with only built-ins and the preflight primitive, then dynamically import every other local kernel/module after clearance. Reject unresolved/computed local imports and add adversarial tests for both exported guards.

2. **F2 A1 identity — NOT RESOLVED**

   `bindIdentity()` correctly returns a frozen object and produces 409 `identity_conflict`; `app.handler` binds it at ingress. But site handlers ignore that object and call `bindIdentity()` again in [sites/index.js:44](/Users/famtastic-fritz/Development/famtastic-wt-phase-0/site-studio-next/server/modules/sites/index.js:44) and [pages/index.js:35](/Users/famtastic-fritz/Development/famtastic-wt-phase-0/site-studio-next/server/modules/pages/index.js:35). WebSocket ingress independently parses `site_id` without the shared conflict/validation contract at [events.js:110](/Users/famtastic-fritz/Development/famtastic-wt-phase-0/site-studio-next/server/kernel/events.js:110).

   Minimal fix: consume the handler-supplied frozen `identity` everywhere; bind WebSocket query/header identity through the same function; add router-level conflict/freeze tests.

3. **F3 ambient-site lint — NOT RESOLVED**

   The widened lint runs successfully, but dotted globals are only detected when assigned at [lint-no-ambient-site.mjs:31](/Users/famtastic-fritz/Development/famtastic-wt-phase-0/site-studio-next/scripts/lint-no-ambient-site.mjs:31). A read such as `const x = global.currentSite` passes; a direct regex probe confirmed it is not caught.

   Minimal fix: use an AST-based rule, or at minimum cover dotted reads and writes with site-specific names and add positive/negative fixture tests.

4. **F4 events — NOT RESOLVED**

   Envelope creation, site-filtered broadcast, locking, fsync, replay, and cursor-ahead resync exist. Torn-tail recovery is broken: `lastSeq()` skips the malformed tail, but `emit()` appends the next JSON directly onto that unterminated fragment at [events.js:60](/Users/famtastic-fritz/Development/famtastic-wt-phase-0/site-studio-next/server/kernel/events.js:60) and [events.js:82](/Users/famtastic-fritz/Development/famtastic-wt-phase-0/site-studio-next/server/kernel/events.js:82). The returned event is then unreplayable, and subsequent emits can reuse its sequence. The test only checks the returned sequence, not replay after recovery, at [kernel-events.test.js:119](/Users/famtastic-fritz/Development/famtastic-wt-phase-0/site-studio-next/tests/kernel-events.test.js:119).

   Minimal fix: truncate/quarantine the invalid terminal fragment under the sequence lock before appending. Assert the recovered event replays and the following event receives the next sequence; use real child processes for the cross-process lock test.

5. **F6 denominators — NOT RESOLVED**

   Classification is centralized and `DENOMINATORS` exports rules/evidence. But “live” only requires `receipt.target === spec.deploy.target` at [site.js:52](/Users/famtastic-fritz/Development/famtastic-wt-phase-0/site-studio-next/server/kernel/site.js:52). A fresh staging target therefore qualifies as live, contradicting the canonical-production rule above it.

   Minimal fix: require explicit canonical-production evidence, reject preview/staging targets, and add that negative test.

6. **F7+F8 honest server states — RESOLVED**

   Direct route probes confirmed:

   - Deployments and builds return `status: not_implemented` with reasons.
   - Proofs return `not_implemented` with a source reason.
   - Automations return `not_implemented`; `kill_switch.state` is `unknown`.

   Evidence: [operations/index.js:35](/Users/famtastic-fritz/Development/famtastic-wt-phase-0/site-studio-next/server/modules/operations/index.js:35) and [platform/index.js:29](/Users/famtastic-fritz/Development/famtastic-wt-phase-0/site-studio-next/server/modules/platform/index.js:29). Minimal fix: none server-side; the browser misrepresentation remains under F10+F11.

7. **F10+F11 gates — NOT RESOLVED**

   A10’s package/version/executable checks pass live: in-tree Playwright 1.62.1 and an existing Chromium executable. The broader gate still has false positives:

   - “Exact inventory” compares only ordered IDs, not title/path/rail/endpoint tuples, at [playwright-smoke.mjs:317](/Users/famtastic-fritz/Development/famtastic-wt-phase-0/site-studio-next/scripts/playwright-smoke.mjs:317).
   - Zero regions automatically passes at [playwright-smoke.mjs:151](/Users/famtastic-fritz/Development/famtastic-wt-phase-0/site-studio-next/scripts/playwright-smoke.mjs:151); the saved Site View result has zero regions and passes.
   - There is no `requestfailed` listener, only HTTP response-status collection.
   - `createRegion()` ignores `status: not_implemented`, finds an empty array, and renders “empty” at [region.js:102](/Users/famtastic-fritz/Development/famtastic-wt-phase-0/site-studio-next/public/kit/region.js:102). The saved report therefore certifies proofs/deployments/builds/automations as empty despite the honest API state.

   Minimal fix: pin full page tuples, require an endpoint-backed terminal region or explicit exception per page, listen for `requestfailed`, and map `not_implemented` to an honest error/unsupported presentation with its reason.

8. **F12 census — NOT RESOLVED**

   The artifact itself is substantially improved: seven trees, 1,480 recorded files, zero missing files, zero current hash mismatches, matching tree SHAs, dynamic entries, exclusions, route deltas, and 37 content deltas.

   However, the named generator [census.mjs:335](/Users/famtastic-fritz/Development/FAMtastic/site-studio/scripts/salvage/census.mjs:335) is untracked in the canonical repository and absent from commit `ca7d0dfb`, while the report claims it as its generator. The dynamic-registration regex also records function declarations such as `function registerDeployRepoRoutes(...)` as registrations at [census.mjs:207](/Users/famtastic-fritz/Development/FAMtastic/site-studio/scripts/salvage/census.mjs:207).

   Minimal fix: commit the generator, record its SHA-256 in the report, exclude declarations/comments through parsing or call-context checks, and regenerate.

9. **F13 branch state — NOT RESOLVED**

   Final snapshot:

   - `studio-rebuild/phase-0` is eight commits ahead of its remote.
   - Relative to current `main`, it is two commits behind and ten ahead.
   - Phase 1 commits and briefs are already on the Phase 0 branch.
   - No `studio-rebuild/phase-1` branch exists.
   - The Phase 0 brief remains `active` with all implementation tasks unchecked, and its exit record has no output SHA at [phase-0.md:31](/Users/famtastic-fritz/Development/famtastic-wt-phase-0/site-studio-next/docs/decisions/premises/phase-0.md:31).
   - The worktree began clean, but [batch-A1-draft.md](/Users/famtastic-fritz/Development/famtastic-wt-phase-0/site-studio-next/docs/salvage/records/batch-A1-draft.md:1) appeared untracked during this read-only review, showing Phase 1 work is still landing in the Phase 0 lane.

   Minimal fix: preserve the untracked draft, stop further Phase 1 writes here, reconcile the two main commits, close Phase 0 with its tested SHA/evidence, then move Phase 1 work onto a dedicated branch.

10. **F14 guidance — NOT RESOLVED**

   Authority and event/mutation guidance were improved, and the skill correctly describes `{name, register(...)}`. But [CONVENTIONS.md:8](/Users/famtastic-fritz/Development/famtastic-wt-phase-0/site-studio-next/CONVENTIONS.md:8) still says modules export `routes: [...]`, contradicting the actual loader and the corrected skill.

   Minimal fix: replace that sentence with the real default-export `{name, register({app, paths, events, journal, registry})}` contract.

11. **Cross-lane spec/mutation contract — RESOLVED**

   A direct spy probe confirmed `spec.write()` passes site-relative `spec.json`, plural `contents`, and no spec hash as mutation `expectedRevision`, matching [spec.js:88](/Users/famtastic-fritz/Development/famtastic-wt-phase-0/site-studio-next/server/kernel/spec.js:88). Minimal fix: none.

12. **Global work/sites/admin scopes — RESOLVED**

   Runtime route-table inspection confirmed `/api/work/items`, `/api/sites`, `/api/admin/paths`, and `/api/admin/health` are all explicitly `scope: global`. Minimal fix: none.

Verification note: lint and syntax checks passed; the plan audit was clean. Vitest could not collect tests because the read-only sandbox denied its temporary worker-cache directory (`EPERM`), so this review does not claim a fresh green Vitest/browser run.

VERDICT: NOT SAFE