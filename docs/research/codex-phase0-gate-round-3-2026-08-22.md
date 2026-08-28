# Codex Phase 0 exit gate, round 3

Verdict: NOT SAFE (5 resolved, 4 not).

Four of the nine items remain unresolved. The Phase 0 gate is not safe to clear.

1. **F1 boot ordering — NOT RESOLVED.** Static ordering is corrected, and `assertNoProofRoutes` runs after registration. However, [server/index.js](/Users/famtastic-fritz/Development/famtastic-wt-phase-0/site-studio-next/server/index.js:23) preflights only `index.js` plus module entries. The generic `load(rel)` calls are not literal imports the scanner can follow. A direct probe found only 13 files checked and omitted seven executed kernels: `app.js`, `events.js`, `identity.js`, `journal.js`, `modules.js`, `paths.js`, and `registry.js`.

   Minimal fix: use literal dynamic imports or explicitly include every boot kernel in `entryFiles`; add a regression assertion that all executed kernels appear in `preflight.files`.

2. **F2 identity — RESOLVED.** [app.js](/Users/famtastic-fritz/Development/famtastic-wt-phase-0/site-studio-next/server/kernel/app.js:35) binds once and supplies a frozen identity. Sites and Pages consume it without rebinding. [events.js](/Users/famtastic-fritz/Development/famtastic-wt-phase-0/site-studio-next/server/kernel/events.js:140) uses the same binder and assigns 4400/4409. A direct router probe returned the expected 400 required, 409 conflict, frozen valid/global identities, and 400 invalid results. Minimal fix: none.

3. **F3 lint — RESOLVED.** [lint-no-ambient-site.mjs](/Users/famtastic-fritz/Development/famtastic-wt-phase-0/site-studio-next/scripts/lint-no-ambient-site.mjs:40) now has a no-`=` dotted-access rule covering reads and writes for the forbidden site-state names on `global` and `globalThis`. `npm run lint` passed. Minimal fix: none.

4. **F4 torn tail — RESOLVED.** [events.js](/Users/famtastic-fritz/Development/famtastic-wt-phase-0/site-studio-next/server/kernel/events.js:75) quarantines malformed terminal fragments inside the sequence lock before sequence allocation and terminates valid unterminated records. [kernel-events.test.js](/Users/famtastic-fritz/Development/famtastic-wt-phase-0/site-studio-next/tests/kernel-events.test.js:119) asserts replayability, sequences 3 then 4, quarantine creation, and the valid-line case. Minimal fix: none.

5. **F6 live denominator — NOT RESOLVED.** The binding A6 contract identifies the evidence as a target URL, but [site.js](/Users/famtastic-fritz/Development/famtastic-wt-phase-0/site-studio-next/server/kernel/site.js:55) does not treat `/` as a production-shape separator. A direct probe against the actual `classify()` returned `live` for:

   - `https://staging.acme.com`
   - `https://preview.acme.com`
   - `https://prod.acme.com/staging`

   Minimal fix: validate a parsed URL’s hostname/path—or use non-alphanumeric token boundaries—and add URL-shaped negative tests.

6. **F10+F11 browser gates — NOT RESOLVED.** Full tuples, written exemption, `requestfailed`, and distinct `not_implemented`/`NOT_FOUND` rendering are present. But [playwright-smoke.mjs](/Users/famtastic-fritz/Development/famtastic-wt-phase-0/site-studio-next/scripts/playwright-smoke.mjs:178) compares only `not_implemented` and `NOT_FOUND`; `empty`, `available`, non-object, and HTTP-error outcomes are skipped. It also accepts duplicate regions when any one sharing the endpoint is correct. Direct probes returned zero mismatches for “API empty, UI available” and for one incorrect region masked by a correct sibling.

   Minimal fix: derive the expected state for every refetched HTTP/body outcome and compare each region individually; also require the configured page endpoint to be represented.

7. **F12 census — RESOLVED.** The generator is committed at `692e840a`, its committed blob matches the working file, and SHA-256 `94d796…b5ae` matches [the report](/Users/famtastic-fritz/Development/famtastic-wt-phase-0/site-studio-next/docs/salvage/census-2026-08-22.json:4). Declaration filtering is present, and every tree reports 21 dynamic registrations. Minimal fix: none.

8. **F13 branch state — RESOLVED.** [The premise](/Users/famtastic-fritz/Development/famtastic-wt-phase-0/site-studio-next/docs/decisions/premises/phase-0.md:31) records tested SHA `5d0c717e`; [the brief](/Users/famtastic-fritz/Development/famtastic-wt-phase-0/site-studio-next/docs/plans/BRIEF-phase-0-2026-08-21.md:22) is completed; `cdc682f9` is the Phase 0 merge and remains in `main` ancestry. The worktree is clean on Phase 1 at `cdc682f9`. `main` subsequently advanced to doc-only descendant `d6043074`. Minimal fix: none.

9. **F14 guidance — NOT RESOLVED.** [CONVENTIONS.md](/Users/famtastic-fritz/Development/famtastic-wt-phase-0/site-studio-next/CONVENTIONS.md:8) still says modules export `routes: [{ method, path, handler }]`. The claimed `app.route(method, path, handler, { scope })` correction is absent at both `cdc682f9` and current `main`.

   Minimal fix: replace that sentence with the actual `register()` plus scoped `app.route(...)` contract.

Verification note: lint, `git diff --check`, and the plan audit passed. The committed smoke report records 11/11. Vitest could not be independently rerun in this read-only review sandbox because it received `EPERM` creating its temporary transform directory; that does not contradict the recorded 77/77 result.

**Verdict: NOT SAFE**

**Fix first: F1 — make the P0-I1 preflight cover every kernel that boot actually executes.**