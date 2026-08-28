# Phase 1 wave 1 endpoint contract (fixed before lanes start)

Lanes code against this. It does not change mid-wave; a lane that needs a change raises it to the orchestrator rather than inventing one.

## Kernel modules (new in Phase 1)
- `server/kernel/site.js` exports `createSite({ paths })` with:
  - `list()` -> `{ sites: [ { id, denominator_class, spec_present, last_touch } ], denominators, root, status }` where `status` is `ok | NOT_FOUND`.
  - `get(siteId)` -> `{ site_id, spec, denominator_class, pages_count, last_touch }` or throws 404 `site_not_found`.
  - `classify(siteDir)` -> one of `directories | valid_spec | customer | deployable | live`. **This is the single shared predicate module for A6. No other file may classify a site.**
  - Denominator rules and their evidence fields are exported as `DENOMINATORS` so the UI can render the rule text.
- `server/kernel/page.js` exports `createPage({ paths })` with `list(siteId)` -> `{ site_id, pages: [ { path, title, bytes, modified } ], status }`, and `get(siteId, pagePath)` -> `{ site_id, path, html, bytes, modified, revision }`. Revision is a content hash.
- `server/kernel/spec.js` exports `createSpec({ paths })` with `read(siteId)` -> `{ site_id, spec, valid, errors[] }` and `write(siteId, spec, { initiator, expectedRevision })` -> validated write that journals and returns `{ revision, journal_entry_id }`. A stale `expectedRevision` throws 409 `stale_revision`.
- `server/kernel/mutation.js` exports `createMutation({ paths, journal, events })` with `apply({ site_id, initiator, intent, changes, expectedRevision })`. Every apply: writes a journal entry BEFORE the file write completes visibly, emits an event, and returns `{ journal_entry_id, revision, undo_token }`. `undo(site_id, undo_token)` restores the exact prior bytes of every file in the entry's manifest and journals the undo as its own entry. Journal unavailable means fail closed: refuse the mutation.

## HTTP surface (module `server/modules/sites` extended, plus `server/modules/pages`)
Every route below requires `site_id` at ingress via `bindIdentity` except `GET /api/sites`.
- `GET /api/sites` -> site.list()
- `GET /api/sites/current?site_id=` -> site.get()
- `GET /api/sites/pages?site_id=` -> page.list()
- `GET /api/sites/page?site_id=&path=` -> page.get()
- `GET /api/sites/spec?site_id=` -> spec.read()
- `PUT /api/sites/spec?site_id=` -> spec.write(), body `{ spec, expectedRevision }`
- `GET /api/sites/history?site_id=&limit=` -> journal.read()
- `POST /api/sites/undo?site_id=` -> mutation.undo(), body `{ undo_token }`

Errors: 400 `identity_required`, 404 `site_not_found` / `NOT_FOUND`, 409 `stale_revision`, 503 `journal_unavailable`. Never 200 with a fabricated body.

## Console (Site View)
`public/pages/site-view.{html,js}` gains tabs: **Pages** (real, from `/api/sites/pages`), **Spec** (real, read plus edit posting to PUT), **History** (real, from `/api/sites/history`, with an undo control per entry), **Canvas** (honest placeholder: "click to edit lands in Phase 2"), **Conversation** (honest placeholder: "Shay is not wired yet (Phase 2)"). No tab may show invented content. `public/pages/sites.js` renders real rows from `/api/sites`, each row links to `/site?site_id=<id>`, and every displayed count names its denominator.

## Rules that override anything a lane infers
No ambient site state. No file over 500 lines. Honest states only: an empty or missing thing says which, and why. Nothing from the legacy tree is copied; it may only be read as evidence.
