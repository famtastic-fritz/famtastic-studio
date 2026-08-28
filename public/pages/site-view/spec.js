// Spec tab: real read from GET /api/sites/spec?site_id=, real write via
// PUT with { spec, expectedRevision }. A 409 stale_revision never overwrites
// silently: it tells the operator the record changed and offers a reload.
//
// This does not use kit/region.js's createRegion: a spec read response
// always carries a `spec.read()` `errors[]` metadata array (per the endpoint
// contract), and region.js's generic "first array in the body is the
// collection" empty-detection latches onto that field and misreports a
// present spec as an empty collection. A spec is a single record, not a
// collection, so this renders its own small loading/available/empty/error
// state machine instead.
//
// The read view renders a sectioned, human-readable summary of spec.json
// instead of a raw JSON dump. Fields are only ever pulled from data the API
// actually returned -- a field that is absent is described as absent, never
// shown as a blank value that could be mistaken for real data. Any top-level
// key not explicitly summarized by a named section lands in "Other" so
// nothing is silently hidden from the operator.
import { card } from "/kit/card.js";
import {
  IDENTITY_KEYS,
  el, rawToggle,
  buildIdentitySection, buildPagesSection, buildMediaSection, buildBrandSection,
  buildInterviewSection, buildSeoSection, buildOtherSection,
} from "/pages/site-view/spec-sections.js";

export function build(panelEl, { siteId }) {
  const endpoint = `/api/sites/spec?site_id=${encodeURIComponent(siteId)}`;

  const readEl = document.createElement("div");
  readEl.setAttribute("aria-live", "polite");
  readEl.setAttribute("aria-atomic", "true");
  const editEl = document.createElement("div");
  editEl.className = "spec-editor";
  panelEl.append(readEl, editEl);

  let currentRevision = null;
  let generation = 0;

  function closeEditor() {
    editEl.innerHTML = "";
  }

  function setMessage(el, text, kind) {
    el.className = kind ? `spec-editor__message spec-editor__message--${kind}` : "spec-editor__message";
    el.textContent = text;
  }

  function openEditor(spec) {
    closeEditor();

    const label = document.createElement("label");
    label.className = "spec-editor__label";
    label.setAttribute("for", "spec-editor-textarea");
    label.textContent = `Editing spec.json for ${siteId}`;

    const textarea = document.createElement("textarea");
    textarea.id = "spec-editor-textarea";
    textarea.className = "spec-editor__textarea";
    textarea.rows = 18;
    textarea.value = JSON.stringify(spec ?? {}, null, 2);

    const message = document.createElement("div");
    message.className = "spec-editor__message";
    message.setAttribute("role", "status");

    const actions = document.createElement("div");
    actions.className = "spec-editor__actions";

    const saveBtn = document.createElement("button");
    saveBtn.type = "button";
    saveBtn.className = "btn btn--primary";
    saveBtn.textContent = "Save";

    const cancelBtn = document.createElement("button");
    cancelBtn.type = "button";
    cancelBtn.className = "btn";
    cancelBtn.textContent = "Cancel";
    cancelBtn.addEventListener("click", closeEditor);

    saveBtn.addEventListener("click", async () => {
      let parsed;
      try {
        parsed = JSON.parse(textarea.value);
      } catch (err) {
        setMessage(message, `Invalid JSON, not saved: ${err.message}`, "error");
        return;
      }

      saveBtn.disabled = true;
      setMessage(message, "Saving...", null);

      let response;
      try {
        response = await fetch(endpoint, {
          method: "PUT",
          headers: { "Content-Type": "application/json", Accept: "application/json" },
          body: JSON.stringify({ spec: parsed, expectedRevision: currentRevision }),
        });
      } catch (err) {
        setMessage(message, `Network error, not saved: ${err.message}`, "error");
        saveBtn.disabled = false;
        return;
      }

      let body = null;
      try {
        body = await response.json();
      } catch {
        // no body, handled below by status
      }

      if (response.status === 409) {
        setMessage(
          message,
          "This spec changed on disk since you loaded it. Your edits were not saved. Reload to see the latest version, then re-apply your change.",
          "error",
        );
        const reloadBtn = document.createElement("button");
        reloadBtn.type = "button";
        reloadBtn.className = "btn";
        reloadBtn.textContent = "Reload latest";
        reloadBtn.addEventListener("click", () => {
          closeEditor();
          load();
        });
        message.appendChild(reloadBtn);
        saveBtn.disabled = false;
        return;
      }

      if (!response.ok) {
        const detail = (body && (body.message || body.error)) || response.statusText;
        setMessage(message, `Save failed (${response.status}): ${detail}`, "error");
        saveBtn.disabled = false;
        return;
      }

      setMessage(message, "Saved.", "ok");
      closeEditor();
      load();
    });

    actions.append(saveBtn, cancelBtn);
    editEl.append(label, textarea, actions, message);
    textarea.focus();
  }

  function renderStatus(text, modifier) {
    readEl.innerHTML = "";
    const status = document.createElement("div");
    status.className = `region__status${modifier ? ` region__status--${modifier}` : ""}`;
    status.textContent = text;
    readEl.appendChild(status);
  }

  // Sectioned rendering helpers live in spec-sections.js (no-monolith split).

  function renderSpecView(spec) {
    const wrap = el("div", "fam-spec-view");

    const consumed = new Set(IDENTITY_KEYS.filter((k) => spec[k] !== undefined));
    for (const key of ["pages", "media_slots", "media_summary", "interview_completed", "interview_pending", "interview_state", "seo", "meta", "brand"]) {
      if (key === "pages" || spec[key] !== undefined) consumed.add(key);
    }

    const sections = [
      buildIdentitySection(spec),
      buildPagesSection(spec),
      buildMediaSection(spec),
      buildBrandSection(spec),
      buildInterviewSection(spec),
      buildSeoSection(spec),
      buildOtherSection(spec, consumed),
    ].filter(Boolean);

    if (!sections.length) wrap.appendChild(el("div", "fam-empty-note", "This spec has no recognizable fields."));
    else wrap.append(...sections);

    wrap.appendChild(rawToggle("spec.json", spec));
    return wrap;
  }

  function renderAvailable(data) {
    readEl.innerHTML = "";
    const wrap = document.createElement("div");

    if (!data.spec) {
      wrap.appendChild(el("div", "region__status region__status--empty", `Site "${siteId}" has no spec.json yet.`));
    } else {
      const metaParts = [`valid: ${data.valid === false ? "no" : "yes"}`];
      if (Array.isArray(data.errors) && data.errors.length) {
        metaParts.push(`errors: ${data.errors.join("; ")}`);
      }
      wrap.appendChild(card({ title: "spec.json", meta: metaParts.join(" | "), body: renderSpecView(data.spec) }));
    }

    const editBtn = el("button", "btn", "Edit spec");
    editBtn.type = "button";
    editBtn.addEventListener("click", () => openEditor(data.spec));
    wrap.appendChild(editBtn);

    readEl.appendChild(wrap);
  }

  async function load() {
    const myGeneration = ++generation;
    renderStatus("Loading...", "loading");

    let response;
    try {
      response = await fetch(endpoint, { headers: { Accept: "application/json" } });
    } catch (err) {
      if (myGeneration !== generation) return;
      return renderStatus(`Network error contacting ${endpoint}: ${err.message}`, "error");
    }
    if (myGeneration !== generation) return;

    let body = null;
    try {
      body = await response.json();
    } catch {
      // handled by response.ok check below
    }
    if (myGeneration !== generation) return;

    if (!response.ok) {
      if (response.status === 400 && body && body.error === "identity_required") {
        return renderStatus("No site selected. Choose a site to see this page's data.", "empty");
      }
      if (response.status === 404) {
        return renderStatus(`No spec found for site "${siteId}".`, "empty");
      }
      const message = (body && (body.message || body.error)) || response.statusText || "request failed";
      return renderStatus(`${endpoint} returned ${response.status}: ${message}`, "error");
    }

    if (!body || typeof body !== "object") {
      return renderStatus(`${endpoint} returned a non-object response body`, "error");
    }

    currentRevision = body.revision ?? null;
    renderAvailable(body);
  }

  load();
}
