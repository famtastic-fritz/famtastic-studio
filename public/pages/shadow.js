// Shadow comparison view (ENDGAME items 24-25, amendment A12). Lists shadow
// runs (GET /api/shadow/runs), inspects one (GET /api/shadow/run?shadow_id=),
// and lets an operator launch a new shadow run against a site (POST
// /api/shadow/run). This page is intentionally NOT wired into config/pages.json
// or the shared nav (public/kit/shell.js) -- see server/modules/shadow/index.js
// for why -- so it builds its own minimal header instead of shell.render().
//
// The honest-states rule (convention 7) applies here too, with one addition:
// this page's whole reason to exist is to keep an operator from mistaking a
// clean run for proof the legacy and new paths agree. Every run's caveats are
// rendered from the record itself (never hardcoded here), and rendered above
// the fold, not buried at the bottom.
import { render as renderShell } from "/kit/shell.js";
import { createRegion } from "/kit/region.js";
import { table } from "/kit/table.js";
import { pill } from "/kit/pill.js";
import { formatTimestamp, formatRelative } from "/kit/format.js";

const root = document.getElementById("root");
if (!root) throw new Error("shadow.js: page is missing <main id=\"root\">");

// header() removed: the shared shell supplies the nav and brand. Keeping a
// second header builder produced two <h1> on the page.
function pageHead() {
  // No <h1> here: the shared shell already renders one from config/pages.json.
  // Emitting a second gave the page two, which the smoke gate correctly failed.
  const head = document.createElement("div");
  head.className = "page-head";
  const p = document.createElement("p");
  p.className = "card__meta";
  p.textContent = "Each row runs the real greenfield pipeline inside an isolated data root and records what it produced next to whatever legacy evidence was supplied. This never contacts the live FAMtastic Designs proof pipeline; see the caveats on every run below before treating a clean result as agreement between the two paths.";
  head.append(p);
  return head;
}

function famSection(titleText) {
  const section = document.createElement("section");
  section.className = "fam-section";
  const title = document.createElement("div");
  title.className = "fam-section__title";
  title.textContent = titleText;
  const body = document.createElement("div");
  body.className = "fam-section__body";
  section.append(title, body);
  return { section, body };
}

function kvBlock(pairs) {
  const kv = document.createElement("dl");
  kv.className = "fam-kv";
  for (const [key, value] of pairs) {
    const dt = document.createElement("dt");
    dt.className = "fam-kv__key";
    dt.textContent = key;
    const dd = document.createElement("dd");
    dd.className = "fam-kv__value";
    if (value instanceof Node) dd.appendChild(value);
    else dd.textContent = value;
    kv.append(dt, dd);
  }
  return kv;
}

function caveatsBox(caveats) {
  const box = document.createElement("div");
  box.className = "shadow-caveats";
  const title = document.createElement("div");
  title.className = "shadow-caveats__title";
  title.textContent = "What this run does NOT establish";
  const list = document.createElement("ul");
  list.className = "shadow-caveats__list";
  for (const c of caveats || []) {
    const li = document.createElement("li");
    li.textContent = c;
    list.appendChild(li);
  }
  box.append(title, list);
  return box;
}

function boundaryList(boundaryCheck) {
  const wrap = document.createElement("div");
  const summary = document.createElement("p");
  summary.className = "card__meta";
  summary.textContent = boundaryCheck?.ok
    ? "All boundary checks passed before and during this run."
    : "At least one boundary check did not pass -- see below.";
  const list = document.createElement("ul");
  list.className = "shadow-checklist";
  for (const check of boundaryCheck?.checks || []) {
    const li = document.createElement("li");
    li.appendChild(pill(check.status, check.status === "PASS" ? "ok" : "error"));
    li.append(` ${check.name}`);
    if (check.detail) {
      const detail = document.createElement("div");
      detail.className = "shadow-checklist__detail";
      detail.textContent = check.detail;
      li.appendChild(detail);
    }
    list.appendChild(li);
  }
  wrap.append(summary, list);
  return wrap;
}

function pathSummary(titleText, side) {
  const { section, body } = famSection(titleText);
  if (side.legacy_evidence === "absent") {
    const note = document.createElement("div");
    note.className = "region__status region__status--empty";
    note.textContent = `legacy_evidence: absent -- ${side.reason}`;
    body.appendChild(note);
    section.className = "fam-section";
    return section;
  }
  const pairs = [
    ["outcome", side.outcome !== undefined ? pill(String(side.outcome), side.outcome === "success" ? "ok" : "error") : "not recorded"],
    ["page_count", side.page_count ?? "not recorded"],
    ["bytes_total", side.bytes_total ?? "not recorded"],
    ["composer", side.composer || "not recorded"],
  ];
  if (side.verification) {
    pairs.push(["verification", pill(side.verification.passed ? "verified" : "verification failed", side.verification.passed ? "ok" : "error")]);
  }
  if (side.legacy_evidence === "supplied") pairs.unshift(["legacy_evidence", "supplied"]);
  body.appendChild(kvBlock(pairs));

  if (Array.isArray(side.pages) && side.pages.length) {
    body.appendChild(table({
      columns: [{ key: "path", label: "Path" }, { key: "title", label: "Title" }, { key: "bytes", label: "Bytes" }],
      rows: side.pages,
    }));
  }
  if (Array.isArray(side.stage_timings) && side.stage_timings.length) {
    body.appendChild(table({
      columns: [
        { key: "stage", label: "Stage" }, { key: "status", label: "Status" },
        { key: "duration_ms", label: "Duration (ms)" }, { key: "model", label: "Model" }, { key: "agent", label: "Agent" },
      ],
      rows: side.stage_timings,
      cellRender(row, col) {
        if (col.key === "status") return pill(row.status || "unknown", row.status === "success" ? "ok" : row.status === "failed" ? "error" : "unknown");
        if (col.key === "model" || col.key === "agent") return row[col.key] || "not recorded";
        return row[col.key];
      },
    }));
  }
  return section;
}

function differencesTable(differences) {
  if (!Array.isArray(differences) || !differences.length) {
    const empty = document.createElement("div");
    empty.className = "region__status region__status--empty";
    empty.textContent = "No differences recorded.";
    return empty;
  }
  return table({
    columns: [{ key: "field", label: "Field" }, { key: "note", label: "Note" }],
    rows: differences,
  });
}

async function fetchDetail(shadowId) {
  const response = await fetch(`/api/shadow/run?shadow_id=${encodeURIComponent(shadowId)}`, { headers: { Accept: "application/json" } });
  const body = await response.json();
  if (body.status === "NOT_FOUND") return null;
  return body.record;
}

function renderDetail(container, record) {
  container.innerHTML = "";
  if (!record) {
    const note = document.createElement("div");
    note.className = "region__status region__status--empty";
    note.textContent = "Select a run above to inspect it.";
    container.appendChild(note);
    return;
  }

  const overview = famSection("Overview");
  overview.body.appendChild(kvBlock([
    ["shadow_id", record.shadow_id],
    ["site_id", record.site_id],
    ["dna_run_id", record.dna_run_id],
    ["isolated_root", record.isolated_root],
    ["created_at", formatTimestamp(record.created_at)],
    ["duration_ms", record.duration_ms ?? "not recorded"],
  ]));

  container.append(
    caveatsBox(record.caveats),
    overview.section,
    (() => { const s = famSection("Boundary checks"); s.body.appendChild(boundaryList(record.boundary_check)); return s.section; })(),
    pathSummary("New path (greenfield pipeline)", record.new_path),
    pathSummary("Legacy path", record.legacy_path),
    (() => { const s = famSection("Differences"); s.body.appendChild(differencesTable(record.differences)); return s.section; })(),
  );
}

// -- page shell ------------------------------------------------------------

const main = renderShell({ pageId: "shadow" });
main.appendChild(pageHead());

const runsSection = famSection("Runs");
const runsCount = document.createElement("p");
runsCount.className = "card__meta";
const runsRegionEl = document.createElement("div");
runsSection.body.append(runsCount, runsRegionEl);

const detailSection = famSection("Run detail");
renderDetail(detailSection.body, null);

main.append(runsSection.section, detailSection.section);

createRegion(runsRegionEl, {
  collection: "runs",
  endpoint: "/api/shadow/runs",
  render(data) {
    const rows = data.runs || [];
    runsCount.textContent = `${rows.length} shadow run${rows.length === 1 ? "" : "s"} (source: ${data.source || "unknown"})`;
    return table({
      columns: [
        { key: "shadow_id", label: "Shadow run" },
        { key: "site_id", label: "Site" },
        { key: "outcome", label: "Outcome" },
        { key: "legacy_evidence", label: "Legacy evidence" },
        { key: "boundary_ok", label: "Boundary" },
        { key: "created_at", label: "Created" },
        { key: "select", label: "" },
      ],
      rows,
      cellRender(row, col) {
        if (col.key === "outcome") return row.outcome ? pill(row.outcome, row.outcome === "success" ? "ok" : "error") : pill("unknown", "unknown");
        if (col.key === "legacy_evidence") return pill(row.legacy_evidence, row.legacy_evidence === "supplied" ? "ok" : "warn");
        if (col.key === "boundary_ok") return row.boundary_ok === null ? pill("not recorded", "unknown") : pill(row.boundary_ok ? "PASS" : "FAIL", row.boundary_ok ? "ok" : "error");
        if (col.key === "created_at") return formatRelative(row.created_at);
        if (col.key === "select") {
          const btn = document.createElement("button");
          btn.type = "button";
          btn.className = "btn";
          btn.textContent = "Inspect";
          btn.addEventListener("click", async () => {
            const record = await fetchDetail(row.shadow_id);
            renderDetail(detailSection.body, record);
          });
          return btn;
        }
        return row[col.key];
      },
    });
  },
});
runsCount.textContent = "";
