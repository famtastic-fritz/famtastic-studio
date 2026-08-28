# Codex Phase 0 exit gate, round 4 (final)

Reviewed at 706d1696. Verdict: SAFE TO CONTINUE PHASE 1, all four remaining findings resolved.

All four findings are resolved at `706d1696`.

1. **F1 — RESOLVED.** `BOOT_KERNELS` feeds the preflight entry set, and `load()` realpaths each target and refuses anything absent from `preflight.files` ([server/index.js](/Users/famtastic-fritz/Development/famtastic-wt-phase-0/site-studio-next/server/index.js:27)). The closure contains all 20 current server JS files. My adversarial in-memory run removed `kernel/paths.js` and received the expected `P0-I1: refusing to load...` error.  
   Minimal fix: none required. The first new test assertion scans the entire file and is therefore weaker than its title; optionally restrict it to the `BOOT_KERNELS` initializer. Runtime safety remains fail-closed.

2. **F6 — RESOLVED.** `namesNonProduction()` lowercases and tokenizes on every non-alphanumeric boundary before `isLive()` accepts the receipt ([site.js](/Users/famtastic-fritz/Development/famtastic-wt-phase-0/site-studio-next/server/kernel/site.js:55)). Direct execution rejected all three URL-shaped negative cases and accepted `https://prod.acme.com`; regression cases are present in [kernel-site.test.js](/Users/famtastic-fritz/Development/famtastic-wt-phase-0/site-studio-next/tests/kernel-site.test.js:224).  
   Minimal fix: none.

3. **F10+F11 — RESOLVED.** The expected-state derivation mirrors the relevant `region.js` branches ([playwright-smoke.mjs](/Users/famtastic-fritz/Development/famtastic-wt-phase-0/site-studio-next/scripts/playwright-smoke.mjs:167)), compares every sibling region individually, and enforces each page’s configured endpoint unless documented as exempt ([playwright-smoke.mjs](/Users/famtastic-fritz/Development/famtastic-wt-phase-0/site-studio-next/scripts/playwright-smoke.mjs:192)). Independent in-memory probes passed all state branches, detected only the incorrect sibling, and detected a missing configured endpoint. The committed report records 11/11 pages passing with zero honesty mismatches.  
   Minimal fix: none.

4. **F14 — RESOLVED.** [CONVENTIONS.md](/Users/famtastic-fritz/Development/famtastic-wt-phase-0/site-studio-next/CONVENTIONS.md:8) now accurately documents `register()`, `app.route(..., { scope })`, and the absence of a `routes` export. This matches [modules.js](/Users/famtastic-fritz/Development/famtastic-wt-phase-0/site-studio-next/server/kernel/modules.js:8) and [app.js](/Users/famtastic-fritz/Development/famtastic-wt-phase-0/site-studio-next/server/kernel/app.js:17).  
   Minimal fix: none.

Independent lint and `git diff --check` passed. Fresh Vitest/Playwright execution was blocked by the read-only review sandbox at temporary-directory creation; the committed smoke artifact and targeted read-only behavioral probes were used instead. `HEAD` advanced concurrently to `4770a319`, but that commit only changed unrelated decision/salvage documents; all reviewed paths remain byte-identical to `706d1696`.

**Verdict: SAFE TO CONTINUE PHASE 1.**