// Builds + Recipes: a run list across every site (GET /api/builds), a DNA
// inspector for one selected run (GET /api/builds/run?site_id=&run_id=,
// server/kernel/dna.js's full replay-manifest record), a "save as recipe"
// action on a successful run (POST /api/builds/save-as-recipe), and a
// recipes list (GET /api/recipes, server/kernel/recipe.js).
//
// The inspector is the point of this page: an operator must be able to see
// exactly what happened in a run and locate a failed stage, so every stage
// attempt is rendered with its model/agent, timing, cost, verification
// result, and the replay-manifest fields recordStage() captured for it.
import { render as renderShell } from "/kit/shell.js";
import { createRegion } from "/kit/region.js";
import { table } from "/kit/table.js";
import { pill } from "/kit/pill.js";
import { formatRelative, formatTimestamp } from "/kit/format.js";
import { renderRecipeDag } from "/kit/recipe-builder.js";
import { renderNewSiteBuilder } from "/kit/new-site-builder.js";

const root = renderShell({ pageId: "builds" });

// -- small local formatters (kit/format.js has no duration/cost helpers) ---

function formatDuration(ms) {
  if (ms === null || ms === undefined || Number.isNaN(ms)) return "not recorded";
  if (ms < 1000) return `${ms}ms`;
  const totalSec = ms / 1000;
  if (totalSec < 60) return `${totalSec.toFixed(1)}s`;
  const minutes = Math.floor(totalSec / 60);
  const seconds = Math.round(totalSec % 60);
  return `${minutes}m ${String(seconds).padStart(2, "0")}s`;
}

function formatCost(cost) {
  if (cost === null || cost === undefined) return "not recorded";
  if (typeof cost === "number") return `$${cost.toFixed(4)}`;
  if (typeof cost === "object") {
    if (typeof cost.value === "number") {
      const currency = cost.currency || "USD";
      return `${cost.value.toFixed(4)} ${currency}`;
    }
    return JSON.stringify(cost);
  }
  return String(cost);
}

// The pipeline finishes runs with an OBJECT outcome ({ status, ... }); stringifying
// it rendered "[object Object]" in the runs table. Normalise the same way the
// save-as-recipe route does, and surface the detail rather than dropping it.
function outcomeStatusOf(outcome) {
  if (outcome === null || outcome === undefined) return null;
  return typeof outcome === "string" ? outcome : outcome.status ?? null;
}

function outcomeDetailOf(outcome) {
  if (!outcome || typeof outcome === "string") return "";
  const { status, ...rest } = outcome;
  const parts = Object.entries(rest)
    .filter(([, v]) => v !== null && v !== undefined && v !== "")
    .map(([k, v]) => `${k}: ${typeof v === "object" ? JSON.stringify(v) : v}`);
  return parts.join(", ");
}

function outcomePill(outcome) {
  const status = outcomeStatusOf(outcome);
  if (status === "success") return pill("success", "ok");
  if (status === null) return pill("in progress", "unknown");
  const node = pill(status, "error");
  const detail = outcomeDetailOf(outcome);
  if (detail) node.title = detail;
  return node;
}

function verificationCell(verification, status) {
  if (verification && typeof verification === "object" && typeof verification.passed === "boolean") {
    return pill(verification.passed ? "verified" : "verification failed", verification.passed ? "ok" : "error");
  }
  if (status === "success") return pill("no verification recorded", "unknown");
  return pill(status || "unknown", status === "failed" ? "error" : "unknown");
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

// -- page shell --------------------------------------------------------

const newSiteSection = famSection("New Site Build from Brief");
const newSiteDesc = document.createElement("p");
newSiteDesc.className = "card__meta";
newSiteDesc.textContent = "Autonomous build factory · brief in → research grounds it → you watch every stage";
newSiteSection.body.appendChild(newSiteDesc);
newSiteSection.body.appendChild(renderNewSiteBuilder({
  onStartBuild(brief) {
    const notice = document.createElement("div");
    notice.className = "region__status region__status--ok";
    notice.style.marginBottom = "var(--space-2)";
    notice.textContent = `Build pipeline initiated for "${brief.business_name}" in ${brief.location}. Watch live telemetry in Shay's Workspace!`;
    newSiteSection.body.prepend(notice);
  },
}));

const runsSection = famSection("Runs");
const runsCount = document.createElement("p");
runsCount.className = "card__meta";
const runsRegionEl = document.createElement("div");
runsSection.body.append(runsCount, runsRegionEl);

const inspectorSection = famSection("Run detail");
const inspectorBody = document.createElement("div");
inspectorBody.className = "region__status region__status--empty";
inspectorBody.textContent = "Select a run above to inspect it.";
inspectorSection.body.appendChild(inspectorBody);

const recipesSection = famSection("Recipe Visualizer & Stage Graph");
const dagSlot = document.createElement("div");
dagSlot.appendChild(renderRecipeDag(null, {
  onRun(recipe, params) {
    const notice = document.createElement("div");
    notice.className = "region__status region__status--ok";
    notice.style.marginBottom = "var(--space-2)";
    notice.textContent = `Workflow dispatched for ${params.business_name || "active site"}. Telemetry streaming in Shay's Workspace!`;
    recipesSection.body.prepend(notice);
  },
}));

const recipesListHeading = document.createElement("h3");
recipesListHeading.textContent = "Saved Recipes";
recipesListHeading.style.margin = "var(--space-3) 0 var(--space-2) 0";

const recipesCount = document.createElement("p");
recipesCount.className = "card__meta";
const recipesRegionEl = document.createElement("div");
recipesSection.body.append(dagSlot, recipesListHeading, recipesCount, recipesRegionEl);

root.append(newSiteSection.section, runsSection.section, inspectorSection.section, recipesSection.section);

// -- recipes list --------------------------------------------------------

const recipesRegion = createRegion(recipesRegionEl, {
  collection: "recipes",
  endpoint: "/api/recipes",
  render(data) {
    const rows = data.recipes || [];
    recipesCount.textContent = `${rows.length} recipe${rows.length === 1 ? "" : "s"} (source: ${data.source || "unknown"})`;
    return table({
      columns: [
        { key: "recipe_id", label: "Recipe" },
        { key: "name", label: "Name" },
        { key: "latest_version", label: "Latest version" },
        { key: "versions", label: "Versions" },
      ],
      rows,
      cellRender(row, col) {
        if (col.key === "versions") return Array.isArray(row.versions) ? row.versions.join(", ") : "not recorded";
        if (col.key === "name") return row.name || "(unnamed)";
        return row[col.key];
      },
    });
  },
});
recipesCount.textContent = "";

// -- run inspector --------------------------------------------------------

function renderReplayManifest(manifest) {
  if (!manifest) {
    const empty = document.createElement("div");
    empty.className = "fam-empty-note";
    empty.textContent = "No replay manifest on this record.";
    return empty;
  }
  return kvBlock([
    ["source_commit", manifest.source_commit || "not recorded"],
    ["tree_hash", manifest.tree_hash || "not recorded"],
    ["recipe_snapshot_hash", manifest.recipe_snapshot_hash || "not recorded"],
    ["model_tool_versions", Object.keys(manifest.model_tool_versions || {}).length
      ? JSON.stringify(manifest.model_tool_versions)
      : "not recorded"],
    ["external_assets", manifest.external_assets?.length ? `${manifest.external_assets.length} asset(s)` : "none"],
  ]);
}

// The operator's verdict, set in one click. This is the only ground truth for
// whether a build was worth sending, and without it the efficiency telemetry can
// only ever push toward cheaper and faster.
//
// 'pending' is shown as pending, never as an implied pass: an unreviewed build
// must not read as an accepted one.
const DECISIONS = [
  { value: "shipped", label: "Shipped", status: "ok" },
  { value: "edited_then_shipped", label: "Edited, shipped", status: "warn" },
  { value: "rejected", label: "Rejected", status: "error" },
];

function decisionControl(row) {
  const wrap = document.createElement("div");
  wrap.className = "decision-control";
  const current = row.outcome_capture?.operator_decision || "pending";

  if (current !== "pending") {
    const known = DECISIONS.find((d) => d.value === current);
    wrap.appendChild(pill(known ? known.label : current, known ? known.status : "unknown"));
  } else {
    wrap.appendChild(pill("pending", "unknown"));
  }

  for (const d of DECISIONS) {
    if (d.value === current) continue;
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "btn btn--small";
    btn.textContent = d.label;
    btn.addEventListener("click", async () => {
      btn.disabled = true;
      try {
        const res = await fetch(`/api/builds/outcome?site_id=${encodeURIComponent(row.site_id)}`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ run_id: row.run_id, operator_decision: d.value }),
        });
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body.message || `HTTP ${res.status}`);
        }
        // Re-read rather than patching the row in place, so what is shown is
        // what the server actually stored.
        runsRegion.refresh();
      } catch (error) {
        btn.disabled = false;
        const err = document.createElement("span");
        err.className = "region__status region__status--error";
        err.textContent = `could not record: ${error.message}`;
        wrap.appendChild(err);
      }
    });
    wrap.appendChild(btn);
  }
  return wrap;
}

function renderStageAttempts(run) {
  const stages = run.stages || [];
  if (!stages.length) {
    const empty = document.createElement("div");
    empty.className = "region__status region__status--empty";
    empty.textContent = "This run has no recorded stage attempts.";
    return empty;
  }

  const stageTable = table({
    columns: [
      { key: "stage", label: "Stage" },
      { key: "status", label: "Status" },
      { key: "model", label: "Model" },
      { key: "agent", label: "Agent" },
      { key: "duration_ms", label: "Duration" },
      { key: "cost_estimate", label: "Cost" },
      { key: "verification", label: "Verification" },
    ],
    rows: stages,
    cellRender(row, col) {
      if (col.key === "status") return row.retry_of ? pill(`${row.status} (retry)`, row.status === "failed" ? "error" : "unknown") : pill(row.status || "unknown", row.status === "success" ? "ok" : row.status === "failed" ? "error" : "unknown");
      if (col.key === "duration_ms") return formatDuration(row.duration_ms);
      if (col.key === "cost_estimate") return formatCost(row.cost_estimate);
      if (col.key === "verification") return verificationCell(row.verification, row.status);
      if (col.key === "model" || col.key === "agent") return row[col.key] || "not recorded";
      return row[col.key];
    },
  });

  const details = document.createElement("div");
  for (const attempt of stages) {
    const wrap = document.createElement("details");
    wrap.className = "fam-section";
    const summary = document.createElement("summary");
    summary.className = "fam-toggle";
    summary.textContent = `Replay fields: ${attempt.stage}${attempt.retry_of ? ` (retry of ${attempt.retry_of})` : ""}`;
    const body = document.createElement("div");
    body.className = "fam-section__body";
    body.appendChild(kvBlock([
      ["attempt_id", attempt.attempt_id],
      ["prompt_template", attempt.prompt_template || "not recorded"],
      ["prompt_snapshot_hash", attempt.prompt_snapshot_hash || "not recorded"],
      ["inputs_hash", attempt.inputs_hash || "not recorded"],
      ["outputs_ref", attempt.outputs_ref?.length ? attempt.outputs_ref.join(", ") : "none"],
      ["evidence_ref", attempt.evidence_ref || "not recorded"],
      ["verifier_version", attempt.verifier_version || "not recorded"],
      ["error", attempt.error ? JSON.stringify(attempt.error) : "none"],
      ["started_at", formatTimestamp(attempt.started_at)],
      ["finished_at", formatTimestamp(attempt.finished_at)],
    ]));
    wrap.append(summary, body);
    details.appendChild(wrap);
  }

  const wrapper = document.createElement("div");
  wrapper.append(stageTable, details);
  return wrapper;
}

let saveMessageEl = null;

function selectRun(run) {
  inspectorSection.body.innerHTML = "";

  const overview = kvBlock([
    ["run_id", run.run_id],
    ["site_id", run.site_id || "(no site)"],
    ["recipe_ref", run.recipe_ref || "not recorded"],
    ["outcome", outcomePill(run.outcome)],
    ["started_at", formatTimestamp(run.started_at)],
    ["finished_at", formatTimestamp(run.finished_at)],
  ]);
  inspectorSection.body.appendChild(overview);

  if (outcomeStatusOf(run.outcome) === "success") {
    const saveBtn = document.createElement("button");
    saveBtn.type = "button";
    saveBtn.className = "btn btn--primary";
    saveBtn.textContent = "Save as recipe";
    saveMessageEl = document.createElement("span");
    saveMessageEl.className = "card__meta";
    saveMessageEl.style.marginLeft = "var(--space-3)";
    saveBtn.addEventListener("click", async () => {
      if (!run.site_id) {
        saveMessageEl.textContent = "Cannot save: this run has no site_id, and save-as-recipe requires one.";
        return;
      }
      saveBtn.disabled = true;
      saveMessageEl.textContent = "Saving...";
      let response;
      try {
        response = await fetch(`/api/builds/save-as-recipe?site_id=${encodeURIComponent(run.site_id)}`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Accept: "application/json" },
          body: JSON.stringify({ run_id: run.run_id }),
        });
      } catch (err) {
        saveMessageEl.textContent = `Network error: ${err.message}`;
        saveBtn.disabled = false;
        return;
      }
      let body = null;
      try { body = await response.json(); } catch { /* no body */ }
      if (!response.ok) {
        saveMessageEl.textContent = `Save failed (${response.status}): ${(body && body.message) || response.statusText}`;
        saveBtn.disabled = false;
        return;
      }
      saveMessageEl.textContent = `Saved as recipe ${body.recipe?.recipe_id} v${body.recipe?.version}.`;
      recipesRegion.refresh();
    });
    const actions = document.createElement("div");
    actions.append(saveBtn, saveMessageEl);
    inspectorSection.body.appendChild(actions);
  }

  const stageHeading = document.createElement("h3");
  stageHeading.textContent = "Stages";
  inspectorSection.body.appendChild(stageHeading);

  const detailRegionEl = document.createElement("div");
  inspectorSection.body.appendChild(detailRegionEl);

  const endpoint = run.site_id
    ? `/api/builds/run?site_id=${encodeURIComponent(run.site_id)}&run_id=${encodeURIComponent(run.run_id)}`
    : `/api/builds/run?run_id=${encodeURIComponent(run.run_id)}`;

  createRegion(detailRegionEl, {
    endpoint,
    render(data) {
      const wrap = document.createElement("div");
      wrap.appendChild(renderStageAttempts(data.run));
      const manifestHeading = document.createElement("h3");
      manifestHeading.textContent = "Replay manifest";
      wrap.appendChild(manifestHeading);
      wrap.appendChild(renderReplayManifest(data.run.replay_manifest));
      return wrap;
    },
  });
}

// -- runs list --------------------------------------------------------

const runsRegion = createRegion(runsRegionEl, {
  collection: "runs",
  endpoint: "/api/builds",
  render(data) {
    const rows = data.runs || [];
    runsCount.textContent = `${rows.length} run${rows.length === 1 ? "" : "s"} (source: ${data.source || "unknown"})`;
    return table({
      columns: [
        { key: "run_id", label: "Run" },
        { key: "site_id", label: "Site" },
        { key: "recipe_ref", label: "Recipe" },
        { key: "outcome", label: "Outcome" },
        { key: "duration_ms", label: "Duration" },
        { key: "cost", label: "Cost" },
        { key: "decision", label: "Outcome" },
        { key: "started_at", label: "When" },
        { key: "inspect", label: "" },
      ],
      rows,
      cellRender(row, col) {
        if (col.key === "outcome") return outcomePill(row.outcome);
        if (col.key === "duration_ms") return formatDuration(row.duration_ms);
        if (col.key === "cost") {
          // Some stages run on a provider that hands back no per-call dollar
          // figure. Showing "$0.00" for those would claim the run was free, so
          // the cell says how many stages could not report instead.
          if (row.unreported_cost_stage_count > 0) {
            const n = row.unreported_cost_stage_count;
            return `$${(row.reported_cost_usd || 0).toFixed(2)} + ${n} unreported`;
          }
          if (typeof row.reported_cost_usd === "number") return `$${row.reported_cost_usd.toFixed(2)}`;
          return "not reported";
        }
        if (col.key === "decision") return decisionControl(row);
        if (col.key === "started_at") return formatRelative(row.started_at);
        if (col.key === "site_id") return row.site_id || "(no site)";
        if (col.key === "recipe_ref") return row.recipe_ref || "not recorded";
        if (col.key === "inspect") {
          const btn = document.createElement("button");
          btn.type = "button";
          btn.className = "btn";
          btn.textContent = "Inspect";
          btn.addEventListener("click", () => selectRun(row));
          return btn;
        }
        return row[col.key];
      },
    });
  },
});
runsCount.textContent = "";
