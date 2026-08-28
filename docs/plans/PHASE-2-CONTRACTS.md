# Phase 2 contracts (fixed before lanes start)

Binding for wave 1. A lane needing a change raises it to the orchestrator rather than inventing one.

## 1. Canvas edit contract

**Targeting.** Every editable element carries `data-fam-path` (the page path within the site, for example `dist/index.html`) and `data-fam-sel`, a stable selector for the node. The selector is generated server-side when the page is served into the canvas, never guessed in the browser, so an edit always names exactly one node.

**Edit flow.** Click selects, a second click or Enter opens inline editing, Escape cancels, blur or Enter commits. On commit the client sends:
`POST /api/sites/edit?site_id=<id>` with `{ page_path, selector, before_text, after_text, expectedRevision }`.

**Server behavior.** `server/kernel/canvas.js` resolves the page, verifies `before_text` still matches what is on disk at that selector (otherwise 409 `stale_selection`, never a blind overwrite), produces the new page bytes, and applies them through `mutation.apply()` so the edit is journaled with a full before/after manifest before it becomes visible. The response is `{ revision, journal_entry_id, undo_token, applied_ms }`.

**Undo.** Reuses the existing `POST /api/sites/undo`. Canvas undo is not a second mechanism.

**Latency.** `applied_ms` is measured server-side from request receipt to journal commit. The client separately measures click-to-rendered. Both are recorded. **The target is under 100ms for the client-visible path** (revised from 140ms, 2026-08-25). **If it is missed, that is reported as a number, not softened.**

The 140ms figure was chosen before the research packet existed and had no source. 100ms is the documented limit for a user to feel they are directly manipulating an object rather than issuing a command to the system — which is precisely the claim click-to-edit makes. Sources: `docs/research/console-packet.json`, facts citing nngroup.com/articles/response-times-3-important-limits and web.dev/articles/rail (RAIL: "respond to user actions within this time window and users feel like the result is immediate. Any longer, and the connection between action and reaction is broken"). Both are `mutable: false`.

Note the RAIL corollary that constrains the server budget: to land a visible response inside 100ms, input events should be processed within 50ms, because other work may already be occupying the main thread.

**Not in scope for M2:** structural edits (adding or removing nodes), image replacement, multi-element edits in one commit. Text content only. Anything else is an honest "not in this milestone" state.

## 2. Shay card schema

Cards are structured objects end to end. The console never receives flattened prose where a card is meant, and never invents a card the server did not send.

```json
{
  "card_id": "cd_<ulid>",
  "schema_version": 1,
  "type": "plan | proposal | diff | confirm | progress | success | failure | recovery | deploy_receipt",
  "site_id": "<bound identity, never ambient>",
  "conversation_id": "<bound identity>",
  "ts": "<iso8601>",
  "title": "<short human line>",
  "body": "<plain text, may be empty>",
  "evidence": [ { "kind": "file | journal | event | url", "ref": "...", "note": "..." } ],
  "actions": [ { "id": "...", "label": "...", "method": "POST", "path": "/api/...", "confirm_required": true } ],
  "state": "pending | applied | rejected | failed"
}
```

**Rules.**
- `proposal` and `diff` never apply anything by themselves. Applying is a separate operator action, and approval never implies execution (PROVE list).
- `confirm_required: true` means the console must ask before firing, and the ask names what will change.
- A card with no real evidence carries an empty `evidence` array and says so; it never fabricates a reference.
- Unknown card types render as an explicit unsupported state showing the raw type, never silently dropped.
- **Shay is not wired in M2 beyond the card transport and rendering.** The conversation surface may render cards that the server genuinely produced; it must not simulate a model. Where no model is connected, the rail says so plainly.

## 3. Conversation persistence

Per site at `<conversations root>/<site_id>.jsonl`, append-only, one JSON object per line: `{ entry_id, ts, site_id, conversation_id, role, text, card? }`. Read returns newest-last for display. Restart continuity means a reload and a server restart both return the same history. Cross-site bleed is a test failure, not a bug to fix later.
