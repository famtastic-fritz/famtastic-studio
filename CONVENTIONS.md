# site-studio-next conventions (binding for every agent touching this tree)

Source of truth: `~/Development/FAMtastic/site-studio/docs/plans/SITE-STUDIO-REBUILD-PLAN-2026-08-21.md` (v1.0) plus `SITE-STUDIO-REBUILD-PLAN-v1.1-AMENDMENTS-2026-08-21.md` (revision v1.1.2, BINDING) and `docs/decisions/ADR-0001..0003` in that same tree. This file is the short form; where it and the amendments disagree, the amendments win and this file is the defect.

1. Greenfield. Do not copy files from `../site-studio/`. Legacy is evidence, read it, do not paste it.
2. Runtime: Node 24, CommonJS or ESM (pick ESM), no TypeScript, no bundler, no framework. Frontend is plain HTML + vanilla JS + CSS variables served as static files. Zero build step.
3. Layout:
   - `server/index.js` boots. It imports only node builtins and `kernel/invariants.js` statically, runs the P0-I1 preflight over the module closure, then dynamically imports the kernels and `server/modules/*/index.js`, calling each module's `register({ app, paths, events, journal, registry })`. Route registration happens inside `register()` via `app.route(method, path, handler, { scope })`, where `scope` is `'site'` (default, identity required at ingress) or `'global'` (explicitly site-independent). There is no `routes: [...]` export; the loader ignores one.
   - `server/kernel/` holds shared primitives: `paths.js` (the only place raw filesystem roots are resolved), `events.js`, `journal.js`, `identity.js`, `registry.js` (platform registry).
   - `public/` holds the console: one HTML file per page under `public/pages/`, shared `public/kit/` (console-kit JS + CSS), `public/app.css` tokens.
   - `tests/` vitest; `tests/e2e/` Playwright.
4. No file over 500 lines. `npm run lint` fails otherwise (script: `scripts/lint-no-monolith.mjs`). Justifications, if ever, go in `docs/decisions/`.
5. Identity binding: every request that reads or writes site state carries `site_id` (and `conversation_id` where relevant) explicitly. No global current-site variable anywhere on the server. `scripts/lint-no-ambient-site.mjs` greps for the forbidden patterns (`global.TAG`, `process.env.SITE`, module-level `let currentSite`).
6. P0-I1: the server must never `import`/`require` anything named `famtastic-proof-job-routes` nor read any `FAMTASTIC_PROOF_*` env var. `server/kernel/invariants.js` asserts at boot; `tests/invariant-p0-i1.test.js` walks the import graph.
7. Honest states only. Every page region renders one of `loading | available | empty | error | stale` from a real fetch. Empty is a real 200 with an empty collection. Never hardcode sample rows. NOT_FOUND is rendered as such.
8. Paths registry: `config/paths.json` with roots `sites, apps, previews, media, components, dna, recipes, journal, conversations, events`. All relative to `STUDIO_DATA_ROOT` (default `../.studio-next-data`, gitignored). Only `kernel/paths.js` joins paths.
9. Events: envelope `{ event_id, schema_version: 1, type, site_id, run_id?, seq, ts, causation_id?, idempotency_key?, payload }`; persist to `<events root>/<site_id>.jsonl` before WebSocket broadcast; seq is per site, monotonic, derived from the file.
10. Journal: append-only JSONL per site `<journal root>/<site_id>.jsonl`, entry `{ entry_id, ts, site_id, initiator, intent, changes, result, evidence, rollback_ref }`.
11. Port: `PORT` env, default 3400. Bind 127.0.0.1 unless `BIND_LAN=1`.
12. No em-dashes in any text. No model or provider selectors in the OPERATING surfaces (Work, Site View, canvas, conversation rail, Builds): nothing may let a model be chosen at the moment of doing work. A single admin-level Shay provider field in Settings/Admin IS allowed per ADR-0006, as is per-stage routing declared in a recipe, because both are configuration recorded in advance rather than a control in the chrome. No tenant, team or billing chrome, no login.
13. Commit messages: plain, human, no AI attribution.
