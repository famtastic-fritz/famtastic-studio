// LINT-EXCEPTION: unified conversational feed, proposal cards, and event stream
// Shay rail: the live workspace panel mounted by kit/shell.js on the four
// pages that carry one (work, site-view, deployments, builds -- see
// shell.js PAGES `rail` flags, unchanged by this module).
//
// Honesty contract (PHASE-2-CONTRACTS.md section 2, BINDING): Shay is not
// wired to a model provider in this build. This module renders exactly what
// the server sends back -- real per-site conversation history via
// GET /api/sites/conversation, real typed cards structurally via
// /kit/card.js renderCard -- and never simulates a reply or dresses up an
// "active" state that isn't real. When GET /api/shay/status reports no
// provider, the rail says so plainly and the composer still records the
// operator's note (through POST /api/shay/ask, which persists it via the
// same conversation kernel the console composer already used before this
// module existed) rather than pretending to send anything anywhere.
//
// No ambient site state (CONVENTIONS.md #5): the rail never guesses a site.
// It reads site_id from the current page's own URL (the same query param
// every site-scoped page already uses) and, finding none, renders an
// explicit "no site selected" state and stops.
import { renderCard } from "./card.js";
import { formatTimestamp } from "./format.js";
import { createShayWorkspace } from "./shay-workspace.js";

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

function currentSiteIdFromUrl() {
  const params = new URLSearchParams(window.location.search);
  const raw = (params.get("site_id") || "").trim();
  return raw || null;
}

async function fetchJson(url, options = {}) {
  const { headers, ...rest } = options;
  const response = await fetch(url, { ...rest, headers: { Accept: "application/json", ...headers } });
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    const detail = (body && (body.message || body.error)) || response.statusText;
    throw new Error(detail);
  }
  return body;
}

async function ensureConversationId(siteId) {
  const stored = readStoredConversationId(siteId);
  if (stored) return stored;
  const body = await fetchJson(`/api/sites/conversation/new?site_id=${encodeURIComponent(siteId)}`, { method: "POST" });
  storeConversationId(siteId, body.conversation_id);
  return body.conversation_id;
}

function statusPill(providerConfigured) {
  const pill = document.createElement("span");
  pill.className = `pill ${providerConfigured ? "pill--ok" : "pill--empty"}`;
  pill.style.marginLeft = "auto";
  pill.textContent = providerConfigured ? "provider connected" : "not wired";
  return pill;
}

function buildNoSiteState(rail) {
  const container = document.createElement("div");
  container.className = "rail-global-assistant";
  container.style.display = "flex";
  container.style.flexDirection = "column";
  container.style.height = "100%";

  const banner = document.createElement("div");
  banner.className = "rail-global-banner";
  banner.style.padding = "10px 12px";
  banner.style.borderBottom = "1px solid var(--color-border)";
  banner.style.background = "var(--color-bg-subtle)";
  banner.innerHTML = `
    <div style="font-size:12px;font-weight:600;color:var(--color-accent);margin-bottom:2px;display:flex;align-items:center;gap:6px;">
      <span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:var(--color-accent);box-shadow:0 0 6px var(--color-accent);"></span>
      Shay AI Boss — Studio Core
    </div>
    <div style="font-size:11px;color:var(--color-text-dim);line-height:1.4;">Interactive multi-turn intake, design proposals & autonomous site builder.</div>
  `;
  container.appendChild(banner);

  const feed = document.createElement("div");
  feed.className = "rail-global-feed";
  feed.id = "rail-global-feed";
  feed.style.flex = "1";
  feed.style.overflowY = "auto";
  feed.style.padding = "12px";
  feed.style.display = "flex";
  feed.style.flexDirection = "column";
  feed.style.gap = "10px";

  // Initial welcome bubble from Shay
  const welcomeBubble = document.createElement("div");
  welcomeBubble.className = "rail-msg rail-msg--system";
  welcomeBubble.style.fontSize = "12px";
  welcomeBubble.style.lineHeight = "1.4";
  welcomeBubble.style.padding = "8px 10px";
  welcomeBubble.style.borderRadius = "var(--radius-sm)";
  welcomeBubble.style.background = "var(--color-bg-sunken)";
  welcomeBubble.style.border = "1px solid var(--color-border)";
  welcomeBubble.innerHTML = `
    <div style="font-weight:600;color:var(--color-accent);font-size:11px;margin-bottom:2px">Shay</div>
    <div>Hey Fritz! What kind of site are we building today? Tell me what you're thinking.</div>
  `;
  feed.appendChild(welcomeBubble);
  container.appendChild(feed);

  const form = document.createElement("form");
  form.className = "rail-global-composer";
  form.style.padding = "10px 12px";
  form.style.borderTop = "1px solid var(--color-border)";
  form.style.background = "var(--color-bg-surface)";

  const textarea = document.createElement("textarea");
  textarea.className = "form__textarea";
  textarea.id = "rail-global-prompt";
  textarea.rows = 2;
  textarea.placeholder = "Talk to Shay (e.g. 'build a site for my boy's trucking business')...";
  textarea.style.width = "100%";
  textarea.style.fontSize = "12px";
  textarea.style.background = "var(--color-bg-sunken)";
  textarea.style.border = "1px solid var(--color-border)";
  textarea.style.borderRadius = "var(--radius-sm)";
  textarea.style.padding = "8px 10px";
  textarea.style.color = "var(--color-text)";
  textarea.style.resize = "none";

  const btnRow = document.createElement("div");
  btnRow.style.display = "flex";
  btnRow.style.justifyContent = "space-between";
  btnRow.style.alignItems = "center";
  btnRow.style.marginTop = "6px";

  const sendBtn = document.createElement("button");
  sendBtn.type = "submit";
  sendBtn.className = "btn btn--pri";
  sendBtn.id = "rail-global-submit";
  sendBtn.style.padding = "4px 12px";
  sendBtn.style.fontSize = "11.5px";
  sendBtn.textContent = "Send ›";

  const hint = document.createElement("span");
  hint.style.fontSize = "10.5px";
  hint.style.color = "var(--color-text-dim)";
  hint.textContent = "↵ to send";

  btnRow.append(hint, sendBtn);
  form.append(textarea, btnRow);
  container.appendChild(form);

  const conversationId = `shay-gui-${Date.now()}`;

  async function sendMessage(text) {
    const prompt = (text || textarea.value).trim();
    if (!prompt) return;

    textarea.value = "";
    sendBtn.disabled = true;

    // Append operator message
    const opBubble = document.createElement("div");
    opBubble.className = "rail-msg rail-msg--operator";
    opBubble.style.fontSize = "12px";
    opBubble.style.lineHeight = "1.4";
    opBubble.style.padding = "8px 10px";
    opBubble.style.borderRadius = "var(--radius-sm)";
    opBubble.style.background = "rgba(168, 85, 247, 0.12)";
    opBubble.style.border = "1px solid rgba(168, 85, 247, 0.25)";
    opBubble.style.alignSelf = "flex-end";
    opBubble.style.maxWidth = "90%";
    opBubble.innerHTML = `
      <div style="font-weight:600;color:var(--color-text-dim);font-size:10.5px;margin-bottom:2px">You</div>
      <div>${prompt.replace(/</g, "&lt;").replace(/>/g, "&gt;")}</div>
    `;
    feed.appendChild(opBubble);

    // Pending bubble
    const pendingBubble = document.createElement("div");
    pendingBubble.className = "rail-msg rail-msg--system";
    pendingBubble.style.fontSize = "11.5px";
    pendingBubble.style.color = "var(--color-text-dim)";
    pendingBubble.style.padding = "6px 10px";
    pendingBubble.innerHTML = `<em>Shay is thinking...</em>`;
    feed.appendChild(pendingBubble);
    feed.scrollTop = feed.scrollHeight;

    try {
      const resp = await fetch("/api/shay/ask", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt, conversation_id: conversationId }),
      });
      const data = await resp.json().catch(() => ({}));
      pendingBubble.remove();

      // Shay response bubble
      const shayBubble = document.createElement("div");
      shayBubble.className = "rail-msg rail-msg--system";
      shayBubble.style.fontSize = "12px";
      shayBubble.style.lineHeight = "1.4";
      shayBubble.style.padding = "8px 10px";
      shayBubble.style.borderRadius = "var(--radius-sm)";
      shayBubble.style.background = "var(--color-bg-sunken)";
      shayBubble.style.border = "1px solid var(--color-border)";
      shayBubble.style.maxWidth = "95%";

      let contentHtml = `
        <div style="font-weight:600;color:var(--color-accent);font-size:11px;margin-bottom:4px">Shay</div>
        <div style="margin-bottom:6px">${(data.text || data.message || "Ready.").replace(/</g, "&lt;").replace(/>/g, "&gt;")}</div>
      `;

      if (data.card) {
        contentHtml += `
          <div class="card" style="margin-top:8px;padding:8px 10px;background:var(--color-bg-surface);border:1px solid var(--color-border);border-radius:var(--radius-sm)">
            <div style="font-weight:600;font-size:11.5px;color:var(--color-accent);margin-bottom:2px">${data.card.title}</div>
            <div style="font-size:11px;color:var(--color-text-dim);margin-bottom:8px">${data.card.body}</div>
            <div class="card__actions" style="display:flex;gap:6px">
              ${(data.card.actions || []).map((a, i) => `
                <button type="button" class="btn btn--pri btn-card-act" data-idx="${i}" style="padding:4px 10px;font-size:11px">${a.label}</button>
              `).join('')}
            </div>
          </div>
        `;
      }

      shayBubble.innerHTML = contentHtml;

      // Handle card action clicks
      shayBubble.querySelectorAll(".btn-card-act").forEach((btn) => {
        btn.addEventListener("click", () => {
          btn.disabled = true;
          sendMessage("build it");
        });
      });

      feed.appendChild(shayBubble);
      feed.scrollTop = feed.scrollHeight;

      if (data.site_id && data.result && data.result.outcome === "success") {
        setTimeout(() => {
          window.location.href = `/site?site_id=${encodeURIComponent(data.site_id)}&tab=canvas`;
        }, 1200);
      }
    } catch (err) {
      pendingBubble.remove();
      const errBubble = document.createElement("div");
      errBubble.style.color = "var(--color-error)";
      errBubble.style.fontSize = "11.5px";
      errBubble.textContent = `Error: ${err.message}`;
      feed.appendChild(errBubble);
    } finally {
      sendBtn.disabled = false;
      textarea.focus();
    }
  }

  form.addEventListener("submit", (e) => {
    e.preventDefault();
    sendMessage();
  });

  textarea.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  });

  rail.appendChild(container);
}

function renderLogEntry(entry, { onAction }) {
  const item = document.createElement("li");
  item.className = `rail-log__entry rail-log__entry--${entry.role || "unknown"}`;

  const head = document.createElement("div");
  head.className = "rail-log__head";
  const role = document.createElement("span");
  role.className = "rail-log__role";
  role.textContent = entry.role || "unknown";
  const when = document.createElement("span");
  when.className = "rail-log__time";
  when.textContent = formatTimestamp(entry.ts);
  head.append(role, when);
  item.appendChild(head);

  if (entry.text) {
    const text = document.createElement("div");
    text.className = "rail-log__text";
    text.textContent = entry.text;
    item.appendChild(text);
  }

  if (entry.card) item.appendChild(renderCard(entry.card, { onAction }));

  return item;
}

// mount(railEl, { siteId? }) renders the rail's live contents into railEl.
// siteId, if not given, is read from the current page URL. Returns nothing;
// the rail updates itself in place as the operator interacts with it.
export async function mount(rail, { siteId } = {}) {
  rail.innerHTML = "";

  const head = document.createElement("div");
  head.className = "shell__rail-head";
  const orb = document.createElement("div");
  orb.className = "orb orb--sm";
  orb.setAttribute("aria-hidden", "true");
  const heading = document.createElement("h2");
  heading.textContent = "Shay";
  head.append(orb, heading);
  rail.appendChild(head);

  const site = siteId || currentSiteIdFromUrl();
  if (!site) {
    const pill = statusPill(false);
    pill.textContent = "no site";
    head.appendChild(pill);
    buildNoSiteState(rail);
    return;
  }

  const pillSlot = document.createElement("span");
  pillSlot.className = "rail-pill-slot";
  head.appendChild(pillSlot);

  const modeTabs = document.createElement("div");
  modeTabs.className = "tabs";
  modeTabs.style.margin = "0 0 var(--space-2) 0";

  const wsTab = document.createElement("button");
  wsTab.type = "button";
  wsTab.className = "tabs__btn is-active";
  wsTab.textContent = "⚡ Workspace";

  const chatTab = document.createElement("button");
  chatTab.type = "button";
  chatTab.className = "tabs__btn";
  chatTab.textContent = "💬 Notes";

  modeTabs.append(wsTab, chatTab);
  rail.appendChild(modeTabs);

  const wsContainer = document.createElement("div");
  wsContainer.className = "rail-workspace-pane";
  const { root: wsRoot } = createShayWorkspace({ siteId: site });
  wsContainer.appendChild(wsRoot);
  rail.appendChild(wsContainer);

  const chatContainer = document.createElement("div");
  chatContainer.className = "rail-chat-pane";
  chatContainer.style.display = "none";

  const noticeEl = document.createElement("div");
  noticeEl.className = "shell__rail-notice";
  noticeEl.setAttribute("role", "status");
  chatContainer.appendChild(noticeEl);

  const logEl = document.createElement("div");
  logEl.className = "rail-log";
  chatContainer.appendChild(logEl);

  const formEl = document.createElement("form");
  formEl.className = "shell__rail-composer";
  const textarea = document.createElement("textarea");
  textarea.rows = 2;
  textarea.placeholder = "Message Shay about this site...";
  textarea.disabled = true;
  const sendBtn = document.createElement("button");
  sendBtn.type = "submit";
  sendBtn.className = "btn";
  sendBtn.textContent = "Send";
  sendBtn.disabled = true;
  formEl.append(textarea, sendBtn);
  chatContainer.appendChild(formEl);

  const messageEl = document.createElement("div");
  messageEl.className = "shell__rail-message";
  messageEl.setAttribute("role", "status");
  chatContainer.appendChild(messageEl);

  rail.appendChild(chatContainer);

  wsTab.addEventListener("click", () => {
    wsTab.className = "tabs__btn is-active";
    chatTab.className = "tabs__btn";
    wsContainer.style.display = "block";
    chatContainer.style.display = "none";
  });

  chatTab.addEventListener("click", () => {
    chatTab.className = "tabs__btn is-active";
    wsTab.className = "tabs__btn";
    chatContainer.style.display = "block";
    wsContainer.style.display = "none";
  });

  function setMessage(text, modifier) {
    messageEl.className = `shell__rail-message${modifier ? ` shell__rail-message--${modifier}` : ""}`;
    messageEl.textContent = text || "";
  }

  async function handleCardAction(action, cardObj) {
    try {
      const response = await fetch(action.path, {
        method: action.method || "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ site_id: site, conversation_id: cardObj.conversation_id, card_id: cardObj.card_id, action_id: action.id }),
      });
      if (!response.ok) {
        const body = await response.json().catch(() => null);
        setMessage(`Action "${action.label}" failed (${response.status}): ${(body && body.message) || response.statusText}`, "error");
        return;
      }
      setMessage(`Action "${action.label}" applied.`, "ok");
      await renderLog();
    } catch (err) {
      setMessage(`Network error running "${action.label}": ${err.message}`, "error");
    }
  }

  async function renderLog() {
    let data;
    try {
      data = await fetchJson(`/api/sites/conversation?site_id=${encodeURIComponent(site)}`);
    } catch (err) {
      logEl.innerHTML = "";
      const errBox = document.createElement("div");
      errBox.className = "region__status region__status--error";
      errBox.textContent = `Could not load conversation: ${err.message}`;
      logEl.appendChild(errBox);
      return;
    }
    const entries = Array.isArray(data.entries) ? data.entries : [];
    logEl.innerHTML = "";
    if (!entries.length) {
      const empty = document.createElement("div");
      empty.className = "region__status region__status--empty";
      empty.textContent = "No conversation entries recorded for this site yet.";
      logEl.appendChild(empty);
      return;
    }
    const list = document.createElement("ol");
    list.className = "rail-log__list";
    for (const entry of entries) list.appendChild(renderLogEntry(entry, { onAction: handleCardAction }));
    logEl.appendChild(list);
    logEl.scrollTop = logEl.scrollHeight;
  }

  let conversationId;
  try {
    conversationId = await ensureConversationId(site);
  } catch (err) {
    setMessage(`Could not establish a conversation: ${err.message}`, "error");
    await renderLog();
    return;
  }

  let providerConfigured = false;
  try {
    const statusBody = await fetchJson("/api/shay/status");
    providerConfigured = Boolean(statusBody.provider_configured);
  } catch {
    // Status is a nicety, not a gate. If it cannot be reached the rail still
    // works honestly -- it just cannot say whether a provider is connected,
    // so it defaults to the same "not wired" language it would show anyway.
    providerConfigured = false;
  }
  pillSlot.replaceWith(statusPill(providerConfigured));
  noticeEl.textContent = providerConfigured
    ? "Shay has a model provider connected for this site."
    : "Shay has no model provider configured in this build. Notes below are recorded to this site's conversation log, not answered. No assistant is listening.";
  noticeEl.className = `shell__rail-notice${providerConfigured ? "" : " shell__rail-notice--empty"}`;

  textarea.disabled = false;
  sendBtn.disabled = false;

  await renderLog();

  formEl.addEventListener("submit", async (event) => {
    event.preventDefault();
    const text = textarea.value.trim();
    if (!text) return;

    sendBtn.disabled = true;
    setMessage("Sending...");
    try {
      const result = await fetchJson(
        `/api/shay/ask?site_id=${encodeURIComponent(site)}&conversation_id=${encodeURIComponent(conversationId)}`,
        { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text }) },
      );
      textarea.value = "";
      setMessage(
        result.status === "provider_unavailable"
          ? "Recorded. No provider is configured, so nothing replied."
          : "Recorded.",
        "ok",
      );
      await renderLog();
    } catch (err) {
      setMessage(`Send failed, note not recorded: ${err.message}`, "error");
    } finally {
      sendBtn.disabled = false;
    }
  });
}
