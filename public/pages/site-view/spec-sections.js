// Sectioned rendering helpers for the Spec tab.
//
// Extracted from spec.js, which crossed the no-monolith limit. These are pure
// DOM builders: each takes a spec and returns a section element or null when
// the spec has nothing for that section. Returning null rather than an empty
// section is what keeps the view honest -- a section that appears is a section
// with content.
import { pill } from "/kit/pill.js";

export const IDENTITY_KEYS = ["tag", "site_name", "business_type", "vertical", "state"];
const IDENTITY_LABELS = {
  tag: "Tag",
  site_name: "Site name",
  business_type: "Business type",
  vertical: "Vertical",
  state: "State",
};
// ---- Sectioned rendering helpers -----------------------------------

export function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

export function section(title, bodyEl) {
  const wrap = el("div", "fam-section");
  const bodyWrap = el("div", "fam-section__body");
  bodyWrap.appendChild(bodyEl);
  wrap.append(el("div", "fam-section__title", title), bodyWrap);
  return wrap;
}

function subtitle(text) {
  return el("div", "fam-section__subtitle", text);
}

function kvGrid() {
  return el("div", "fam-kv");
}

export function kvRow(grid, label, valueNode) {
  const value = el("div", "fam-kv__value");
  if (valueNode instanceof Node) value.appendChild(valueNode);
  else value.textContent = valueNode;
  grid.append(el("div", "fam-kv__key", label), value);
}

export function textValue(v) {
  return typeof v === "string" ? v : JSON.stringify(v);
}

// Renders a plain-object's entries as a fam-kv grid. `valueFn` maps each
// value to a display node/string (defaults to textValue).
function objectGrid(obj, valueFn = textValue) {
  const grid = kvGrid();
  for (const [name, value] of Object.entries(obj)) kvRow(grid, prettifyKey(name), valueFn(value));
  return grid;
}

// Builds a small colored square + hex/text label. The background color is
// arbitrary operator data, not a design choice, so it can only be set
// inline -- no CSS class can encode a value that isn't known until render.
function swatchValue(colorValue) {
  const wrap = el("span", "fam-swatch-value");
  const swatch = el("span", "fam-swatch");
  if (typeof colorValue === "string") swatch.style.backgroundColor = colorValue;
  wrap.append(swatch, el("span", null, textValue(colorValue)));
  return wrap;
}

function prettifyKey(key) {
  return String(key).replace(/^q_/, "").replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function rawCodeBlock(value) {
  return el("pre", "fam-code", typeof value === "string" ? value : JSON.stringify(value, null, 2));
}

// A toggle button that reveals/hides a raw-JSON block for the given value.
// Defaults to hidden -- the rendered view is the default, raw stays one
// click away.
export function rawToggle(label, value) {
  const wrap = el("div", "fam-raw-toggle");
  const btn = el("button", "fam-toggle", `View raw ${label}`);
  btn.type = "button";
  btn.setAttribute("aria-expanded", "false");
  const pre = rawCodeBlock(value);
  // Sets both the `hidden` attribute (semantics/a11y) and an explicit
  // inline display: none -- some global reset stylesheets redeclare
  // `display` on `pre` and silently defeat the UA's default `[hidden]`
  // rule, which would otherwise leave large raw blocks visibly expanded.
  pre.hidden = true;
  pre.style.display = "none";
  btn.addEventListener("click", () => {
    const showing = pre.style.display !== "none";
    pre.hidden = showing;
    pre.style.display = showing ? "none" : "block";
    btn.setAttribute("aria-expanded", String(!showing));
    btn.textContent = showing ? `View raw ${label}` : `Hide raw ${label}`;
  });
  wrap.append(btn, pre);
  return wrap;
}

// ---- Section builders -------------------------------------------------

export function buildIdentitySection(spec) {
  const present = IDENTITY_KEYS.filter((k) => spec[k] !== undefined && spec[k] !== null && spec[k] !== "");
  if (!present.length) return null;
  const grid = kvGrid();
  for (const key of present) {
    kvRow(grid, IDENTITY_LABELS[key], textValue(spec[key]));
  }
  return section("Identity", grid);
}

export function buildPagesSection(spec) {
  const pages = spec.pages;
  if (!Array.isArray(pages) || !pages.length) return null;
  const list = el("ul", "fam-list");
  for (const page of pages) list.appendChild(el("li", null, textValue(page)));
  return section("Pages", list);
}

// Media slots are shown even when every one is unfilled, and especially then.
// The failure this corrects is media silently not existing: research declared
// the slots, nothing filled them, and no surface said so.
export function buildMediaSection(spec) {
  const slots = spec.media_slots;
  if (!Array.isArray(slots) || !slots.length) return null;

  const summary = spec.media_summary || {};
  const wrap = el("div");

  const filled = typeof summary.filled === "number" ? summary.filled : slots.filter((m) => m.state === "filled").length;
  const head = el("div", null, `${filled} of ${slots.length} media slots filled`);
  wrap.appendChild(head);

  if (summary.note) wrap.appendChild(el("div", "fam-empty-note", summary.note));

  const list = el("ul", "fam-list");
  for (const slot of slots) {
    const li = el("li");
    const isFilled = slot.state === "filled";
    li.appendChild(el("strong", null, `${slot.role || slot.id} `));
    li.appendChild(pill(isFilled ? "filled" : "unfilled", isFilled ? "ok" : "warn"));
    if (slot.prompt) li.appendChild(el("div", "fam-empty-note", slot.prompt));
    list.appendChild(li);
  }
  wrap.appendChild(list);
  return section("Media", wrap);
}

// Colors/fonts/tone can live under a dedicated `brand` object, or (in the
// shapes this codebase actually produces today) be scattered across
// `style_fingerprint` (palette/typography/mood) and `design_brief.tone`.
// Whichever source is used here, the source object itself still appears in
// full in "Other" below -- this section is a curated highlight, not the
// only place the data is shown.
export function buildBrandSection(spec) {
  const brand = spec.brand && typeof spec.brand === "object" ? spec.brand : null;
  const fingerprint = spec.style_fingerprint && typeof spec.style_fingerprint === "object" ? spec.style_fingerprint : null;
  const designBrief = spec.design_brief && typeof spec.design_brief === "object" ? spec.design_brief : null;

  const colors = brand?.colors ?? fingerprint?.palette ?? null;
  const fonts = brand?.fonts ?? fingerprint?.typography ?? null;
  const tone = brand?.tone ?? designBrief?.tone ?? fingerprint?.mood ?? null;

  if (!colors && !fonts && !tone) return null;

  const wrap = document.createElement("div");

  if (colors && typeof colors === "object") {
    wrap.append(subtitle("Colors"), objectGrid(colors, swatchValue));
  } else if (typeof colors === "string") {
    wrap.append(subtitle("Colors"), swatchValue(colors));
  }

  if (fonts && typeof fonts === "object") {
    wrap.append(subtitle("Fonts"), objectGrid(fonts));
  } else if (typeof fonts === "string") {
    wrap.append(subtitle("Fonts"), el("div", null, fonts));
  }

  if (tone) {
    wrap.appendChild(subtitle("Tone"));
    if (Array.isArray(tone)) {
      const list = el("ul", "fam-list");
      for (const t of tone) list.appendChild(el("li", null, textValue(t)));
      wrap.appendChild(list);
    } else {
      wrap.appendChild(el("div", null, textValue(tone)));
    }
  }

  return section("Brand", wrap);
}

export function buildInterviewSection(spec) {
  const hasStatus = spec.interview_completed !== undefined || spec.interview_pending !== undefined;
  const state = spec.interview_state && typeof spec.interview_state === "object" ? spec.interview_state : null;
  if (!hasStatus && !state) return null;

  const wrap = document.createElement("div");

  const statusFields = [
    ["Interview completed", spec.interview_completed],
    ["Interview pending", spec.interview_pending],
    ["Mode", state?.mode],
    ["State completed", state?.completed],
    ["Started at", state?.started_at],
    ["Completed at", state?.completed_at],
  ].filter(([, v]) => v !== undefined && v !== null && v !== "");
  if (statusFields.length) {
    const statusGrid = kvGrid();
    for (const [label, value] of statusFields) kvRow(statusGrid, label, textValue(value));
    wrap.appendChild(statusGrid);
  }

  const answers = state?.answers && typeof state.answers === "object" ? state.answers : null;
  if (answers && Object.keys(answers).length) {
    wrap.appendChild(subtitle("Recorded answers"));

    // Ordered by interview_state.questions when available; any answer key
    // not covered by that list is still appended, so nothing is dropped.
    const order = Array.isArray(state.questions) ? state.questions : [];
    const remaining = Object.keys(answers).filter((qid) => !order.includes(qid));
    for (const qid of [...order, ...remaining]) {
      if (!Object.prototype.hasOwnProperty.call(answers, qid)) continue;
      const qa = el("div", "fam-qa");
      qa.append(
        el("div", "fam-qa__question", `${prettifyKey(qid)} (${qid})`),
        el("div", "fam-qa__answer", textValue(answers[qid])),
      );
      wrap.appendChild(qa);
    }
  }

  if (!wrap.childNodes.length) return null;
  return section("Interview", wrap);
}

export function buildSeoSection(spec) {
  const seo = spec.seo && typeof spec.seo === "object" ? spec.seo : null;
  const meta = spec.meta && typeof spec.meta === "object" ? spec.meta : null;
  if (!seo && !meta) return null;

  return section("SEO", objectGrid({ ...(seo ?? {}), ...(meta ?? {}) }));
}

// Every top-level key not explicitly summarized above lands here, in full,
// so nothing is silently hidden -- including keys (like `style_fingerprint`
// or `design_brief`) that also fed a curated section above.
export function buildOtherSection(spec, consumedKeys) {
  const remaining = Object.keys(spec).filter((k) => !consumedKeys.has(k));
  if (!remaining.length) return null;

  const wrap = document.createElement("div");
  for (const key of remaining) {
    const value = spec[key];
    const row = el("div", "fam-other-entry");
    row.appendChild(subtitle(key));
    // Object/array values are shown behind a per-field raw toggle (collapsed
    // by default) rather than dumped inline -- some of these (e.g. `content`)
    // are large enough that inlining them would make the tab unusable, and
    // a collapsed toggle is still an honest, undropped representation.
    if (value !== null && typeof value === "object") {
      row.appendChild(rawToggle(key, value));
    } else {
      row.appendChild(el("div", "fam-kv__value", value === undefined ? "(undefined)" : textValue(value)));
    }
    wrap.appendChild(row);
  }
  return section("Other", wrap);
}
