// History tab: real journal entries from GET /api/sites/history?site_id=.
// Each entry shows initiator, intent, timestamp, changed file count, and an
// undo control (POST /api/sites/undo) gated behind a confirm() since it
// mutates files on disk.
import { createRegion } from "/kit/region.js";
import { formatTimestamp } from "/kit/format.js";

function extractEntries(data) {
  if (Array.isArray(data.entries)) return data.entries;
  if (Array.isArray(data.history)) return data.history;
  if (Array.isArray(data.journal)) return data.journal;
  return [];
}

function changedFileCount(entry) {
  if (Array.isArray(entry.changes)) return entry.changes.length;
  if (typeof entry.changes === "number") return entry.changes;
  return null;
}

// The endpoint contract documents journal entries with entry_id and
// rollback_ref but does not name an explicit undo token field on read.
// mutation.undo(site_id, undo_token) is the write contract, so this prefers
// an explicit undo_token if the API adds one, falling back to rollback_ref,
// then entry_id.
function undoToken(entry) {
  return entry.undo_token ?? entry.rollback_ref ?? entry.entry_id ?? null;
}

export function build(panelEl, { siteId }) {
  const endpoint = `/api/sites/history?site_id=${encodeURIComponent(siteId)}`;

  const listEl = document.createElement("div");
  const messageEl = document.createElement("div");
  messageEl.className = "history__message";
  messageEl.setAttribute("role", "status");
  panelEl.append(listEl, messageEl);

  const region = createRegion(listEl, {
    collection: 'entries',
    endpoint,
    render(data) {
      const entries = extractEntries(data);
      if (!entries.length) {
        const empty = document.createElement("div");
        empty.className = "region__status region__status--empty";
        empty.textContent = "No history entries recorded for this site yet.";
        return empty;
      }

      const list = document.createElement("ol");
      list.className = "history-timeline";

      for (const entry of entries) {
        const item = document.createElement("li");
        item.className = "history-timeline__entry";

        const head = document.createElement("div");
        head.className = "history-timeline__head";
        const when = document.createElement("span");
        when.className = "history-timeline__time";
        when.textContent = formatTimestamp(entry.ts);
        const who = document.createElement("span");
        who.className = "history-timeline__initiator";
        who.textContent = entry.initiator || "unknown initiator";
        head.append(when, who);

        const intent = document.createElement("div");
        intent.className = "history-timeline__intent";
        intent.textContent = entry.intent || "no intent recorded";

        const count = changedFileCount(entry);
        const changed = document.createElement("div");
        changed.className = "history-timeline__changed";
        changed.textContent = count === null ? "changed files: not recorded" : `changed files: ${count}`;

        const token = undoToken(entry);
        const undoBtn = document.createElement("button");
        undoBtn.type = "button";
        undoBtn.className = "btn btn--danger";
        undoBtn.textContent = "Undo";
        undoBtn.disabled = !token;
        if (!token) undoBtn.title = "No undo reference on this entry.";

        undoBtn.addEventListener("click", async () => {
          const confirmed = window.confirm(
            `Undo "${entry.intent || entry.entry_id}"? This restores the prior file contents for this change and cannot be reversed from here.`,
          );
          if (!confirmed) return;

          undoBtn.disabled = true;
          messageEl.className = "history__message";
          messageEl.textContent = "Applying undo...";

          let response;
          try {
            response = await fetch(`/api/sites/undo?site_id=${encodeURIComponent(siteId)}`, {
              method: "POST",
              headers: { "Content-Type": "application/json", Accept: "application/json" },
              body: JSON.stringify({ undo_token: token }),
            });
          } catch (err) {
            messageEl.className = "history__message history__message--error";
            messageEl.textContent = `Network error, undo not applied: ${err.message}`;
            undoBtn.disabled = false;
            return;
          }

          let body = null;
          try {
            body = await response.json();
          } catch {
            // no body
          }

          if (!response.ok) {
            const detail = (body && (body.message || body.error)) || response.statusText;
            messageEl.className = "history__message history__message--error";
            messageEl.textContent = `Undo failed (${response.status}): ${detail}`;
            undoBtn.disabled = false;
            return;
          }

          messageEl.className = "history__message history__message--ok";
          messageEl.textContent = "Undo applied.";
          region.refresh();
        });

        item.append(head, intent, changed, undoBtn);
        list.appendChild(item);
      }

      return list;
    },
  });
}
