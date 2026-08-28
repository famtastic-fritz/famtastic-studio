// Conversation tab: real per-site history from GET /api/sites/conversation,
// an operator composer that posts to the same endpoint, and typed Shay card
// rendering via /kit/card.js. Honesty requirement (binding): Shay is not
// wired to a model in this milestone. This surface records what the server
// genuinely produced and accepts operator notes -- it never simulates a
// reply or implies anything is listening.
import { createRegion } from "/kit/region.js";
import { formatTimestamp } from "/kit/format.js";
import { renderCard } from "/kit/card.js";

const STORAGE_PREFIX = "site-studio-next:conversation_id:";

function storageKey(siteId) {
  return `${STORAGE_PREFIX}${siteId}`;
}

function readStoredConversationId(siteId) {
  try {
    return window.localStorage.getItem(storageKey(siteId));
  } catch {
    return null;
  }
}

function storeConversationId(siteId, conversationId) {
  try {
    window.localStorage.setItem(storageKey(siteId), conversationId);
  } catch {
    // Best effort only. Losing this just means the next load starts a fresh
    // conversation_id -- prior history is untouched either way.
  }
}

async function startConversation(siteId) {
  const response = await fetch(`/api/sites/conversation/new?site_id=${encodeURIComponent(siteId)}`, {
    method: "POST",
    headers: { Accept: "application/json" },
  });
  const body = await response.json().catch(() => null);
  if (!response.ok || !body || !body.conversation_id) {
    const detail = (body && (body.message || body.error)) || response.statusText;
    throw new Error(`could not start a conversation: ${detail}`);
  }
  return body.conversation_id;
}

export function build(panelEl, { siteId }) {
  panelEl.innerHTML = "";
  panelEl.className = "conversation-tab";

  const notice = document.createElement("div");
  notice.className = "conversation-tab__notice";
  notice.setAttribute("role", "status");
  notice.textContent =
    "Shay is not wired to a model in this milestone. Notes below are recorded to this site's conversation log, not answered. No assistant is listening.";
  panelEl.appendChild(notice);

  const toolbar = document.createElement("div");
  toolbar.className = "conversation-tab__toolbar";
  const conversationLabel = document.createElement("span");
  conversationLabel.className = "conversation-tab__conversation-id";
  conversationLabel.textContent = "Conversation: establishing...";
  const newBtn = document.createElement("button");
  newBtn.type = "button";
  newBtn.className = "btn";
  newBtn.textContent = "New conversation";
  newBtn.disabled = true;
  toolbar.append(conversationLabel, newBtn);
  panelEl.appendChild(toolbar);

  const listEl = document.createElement("div");
  panelEl.appendChild(listEl);

  const formEl = document.createElement("form");
  formEl.className = "conversation-tab__composer";
  const textarea = document.createElement("textarea");
  textarea.rows = 3;
  textarea.placeholder = "Write a note for this site's conversation log. Nothing will reply.";
  textarea.disabled = true;
  const sendBtn = document.createElement("button");
  sendBtn.type = "submit";
  sendBtn.className = "btn";
  sendBtn.textContent = "Send";
  sendBtn.disabled = true;
  formEl.append(textarea, sendBtn);
  panelEl.appendChild(formEl);

  const messageEl = document.createElement("div");
  messageEl.className = "conversation-tab__message";
  messageEl.setAttribute("role", "status");
  panelEl.appendChild(messageEl);

  let conversationId = null;
  let region = null;

  function setMessage(text, modifier) {
    messageEl.className = `conversation-tab__message${modifier ? ` conversation-tab__message--${modifier}` : ""}`;
    messageEl.textContent = text;
  }

  async function handleCardAction(action, cardObj) {
    try {
      const response = await fetch(action.path, {
        method: action.method || "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ site_id: siteId, conversation_id: cardObj.conversation_id, card_id: cardObj.card_id, action_id: action.id }),
      });
      if (!response.ok) {
        const body = await response.json().catch(() => null);
        setMessage(`Action "${action.label}" failed (${response.status}): ${(body && body.message) || response.statusText}`, "error");
        return;
      }
      setMessage(`Action "${action.label}" applied.`, "ok");
      if (region) region.refresh();
    } catch (err) {
      setMessage(`Network error running "${action.label}": ${err.message}`, "error");
    }
  }

  function mountRegion() {
    region = createRegion(listEl, {
      endpoint: `/api/sites/conversation?site_id=${encodeURIComponent(siteId)}`,
      render(data) {
        const entries = Array.isArray(data.entries) ? data.entries : [];
        if (!entries.length) {
          const empty = document.createElement("div");
          empty.className = "region__status region__status--empty";
          empty.textContent = "No conversation entries recorded for this site yet.";
          return empty;
        }

        const list = document.createElement("ol");
        list.className = "conversation-log";
        for (const entry of entries) {
          const item = document.createElement("li");
          item.className = `conversation-log__entry conversation-log__entry--${entry.role || "unknown"}`;

          const head = document.createElement("div");
          head.className = "conversation-log__head";
          const role = document.createElement("span");
          role.className = "conversation-log__role";
          role.textContent = entry.role || "unknown";
          const when = document.createElement("span");
          when.className = "conversation-log__time";
          when.textContent = formatTimestamp(entry.ts);
          head.append(role, when);
          item.appendChild(head);

          if (entry.text) {
            const text = document.createElement("div");
            text.className = "conversation-log__text";
            text.textContent = entry.text;
            item.appendChild(text);
          }

          if (entry.card) {
            item.appendChild(renderCard(entry.card, { onAction: handleCardAction }));
          }

          list.appendChild(item);
        }
        return list;
      },
    });
  }

  formEl.addEventListener("submit", async (event) => {
    event.preventDefault();
    const text = textarea.value.trim();
    if (!text || !conversationId) return;

    sendBtn.disabled = true;
    setMessage("Sending...");
    try {
      const response = await fetch(
        `/api/sites/conversation?site_id=${encodeURIComponent(siteId)}&conversation_id=${encodeURIComponent(conversationId)}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json", Accept: "application/json" },
          body: JSON.stringify({ text }),
        },
      );
      const body = await response.json().catch(() => null);
      if (!response.ok) {
        setMessage(`Send failed (${response.status}): ${(body && body.message) || response.statusText}`, "error");
        return;
      }
      textarea.value = "";
      setMessage("Recorded.", "ok");
      if (region) region.refresh();
    } catch (err) {
      setMessage(`Network error, note not recorded: ${err.message}`, "error");
    } finally {
      sendBtn.disabled = false;
    }
  });

  newBtn.addEventListener("click", async () => {
    newBtn.disabled = true;
    try {
      conversationId = await startConversation(siteId);
      storeConversationId(siteId, conversationId);
      conversationLabel.textContent = `Conversation: ${conversationId}`;
      setMessage("Started a new conversation. Prior history below is preserved, not cleared.", "ok");
    } catch (err) {
      setMessage(err.message, "error");
    } finally {
      newBtn.disabled = false;
    }
  });

  const stored = readStoredConversationId(siteId);
  (stored ? Promise.resolve(stored) : startConversation(siteId).then((id) => { storeConversationId(siteId, id); return id; }))
    .then((id) => {
      conversationId = id;
      conversationLabel.textContent = `Conversation: ${id}`;
      newBtn.disabled = false;
      textarea.disabled = false;
      sendBtn.disabled = false;
      mountRegion();
    })
    .catch((err) => {
      conversationLabel.textContent = "Conversation: not established";
      setMessage(err.message, "error");
      mountRegion();
    });
}
