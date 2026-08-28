---
name: site-studio-conventions
description: Structural rules for the site-studio-next tree. Load before writing or editing any file under site-studio-next: module layout, declarative routes, the paths resolver, identity binding, honest states, the no-monolith and no-ambient-site rules, and the P0-I1 invariant.
---

# site-studio-next conventions

Authority: `~/Development/FAMtastic/site-studio/docs/plans/SITE-STUDIO-REBUILD-PLAN-2026-08-21.md` plus `SITE-STUDIO-REBUILD-PLAN-v1.1-AMENDMENTS-2026-08-21.md` (revision v1.1.2, BINDING) and ADR-0001 through ADR-0003 in that same tree. `CONVENTIONS.md` at the root of this tree is the short form. When they disagree, the plan wins and the drift is a defect.

## Non-negotiable
1. **Greenfield.** Never copy a file from the legacy `site-studio/` tree. Read it as evidence, write fresh code. Anything salvaged needs a capability record first (see the `capability-record` skill).
2. **No monolith.** No file over 500 lines. `npm run lint` enforces it. A file needing an exception carries `LINT-EXCEPTION: <reason>` in its first ten lines and an ADR.
3. **No ambient site.** There is no current-site variable anywhere on the server. Every request that reads or writes site state binds `site_id` (and `conversation_id` where relevant) at ingress via `server/kernel/identity.js`. Missing identity is a 400, never a fallback. This is the fix for the legacy leak paths that let Site A's prompt write into Site B.
4. **P0-I1.** The server never loads `famtastic-proof-job-routes` and never reads `FAMTASTIC_PROOF_*`. Asserted at boot, tested over the import graph. The live proof pipeline is protected revenue scope.
5. **Honest states.** Every region renders `loading | available | empty | error | stale` from a real fetch. Empty means the server really returned an empty collection and said why. A missing root is `NOT_FOUND`, not an empty list. Never hardcode sample rows, never show a green light you did not verify.
6. **No build step.** Vanilla ES modules and CSS custom properties served as static files. No framework, no bundler, no TypeScript.

## Layout
- `server/index.js` boots: asserts invariants, builds kernel primitives, loads `server/modules/*/index.js`, each of which default-exports `{ name, register({ app, paths, events, journal, registry }) }`.
- `server/kernel/` holds `paths.js` (the only place raw roots resolve), `app.js`, `identity.js`, `events.js`, `journal.js`, `registry.js`, `invariants.js`. Modules never touch the filesystem except through `paths.within()`.
- `public/pages/<id>.{html,js}` is one page per URL; `public/kit/` holds shared primitives; `public/app.css` holds tokens.
- `config/paths.json` is the paths registry, `config/pages.json` the page inventory, `config/providers.json` the deploy providers.

## Adding things
- **A route:** add it to an existing module's `register()` via `app.route(method, path, handler)`. A handler returns `{ status, body }` or a body. Throwing an error with `statusCode` produces that status.
- **A storage location:** add a root to `config/paths.json`. Never join paths outside `kernel/paths.js`.
- **A page:** add an entry to `config/pages.json`, create `public/pages/<id>.html` and `.js`, and let the console module register it. The Shay rail appears only where `rail: true`.
- **An event:** `events.emit({ type, site_id, payload })` where `site_id` comes from the bound identity, never from module state. It validates the envelope, allocates `seq` under a cross-process lock, fsyncs before broadcasting, and delivers only to clients bound to that site. Clients reconnect with `?site_id=&after_seq=` and get replay or `resync_required`.
- **A mutation:** journal it, using the bound `site_id` and `conversation_id`. `journal.append({ site_id, initiator, intent, changes, result, evidence, rollback_ref })`. Journaling happens BEFORE the write is visible, and if the journal cannot be written the mutation is refused (fail closed, 503 `journal_unavailable`). A mutation with no journal entry is a defect.

## Style
Plain, human writing in comments and UI copy. No em-dashes. No model or provider selectors in operator chrome, no tenant, team, billing, or login surfaces. Commit messages read as if a human wrote them, with no AI attribution.
