// Proofs page (plan 3.5, Decision 3): READ-ONLY pipeline visibility over real
// integration events. This page never renders a value the /api/proofs body
// did not return, and it renders no action controls -- dispatch, approval,
// and edit-before-send stay in the famtasticdesigns repo. The jump-off link
// below is read straight from the response's `connections` field (itself
// sourced from the platform registry on the server), never hardcoded here.
import { render as renderShell } from "/kit/shell.js";
import { createRegion } from "/kit/region.js";
import { formatRelative, formatTimestamp } from "/kit/format.js";

const root = renderShell({ pageId: "proofs" });

const section = document.createElement("section");
const heading = document.createElement("h2");
heading.textContent = "Proofs";
const sub = document.createElement("p");
sub.className = "card__meta";
sub.textContent = "Read-only. Dispatch, approval, and edit-before-send happen in the famtasticdesigns repo.";
const jumpOffEl = document.createElement("p");
jumpOffEl.className = "proofs-jump-off";
const count = document.createElement("p");
count.className = "card__meta";
const regionEl = document.createElement("div");
section.append(heading, sub, jumpOffEl, count, regionEl);
root.appendChild(section);

// The jump-off is page chrome, not proof data -- it must show regardless of
// whether any proof events exist, so it is fetched from the registry route
// directly rather than riding along on the (possibly empty) proofs region.
fetch("/api/platform/registry", { headers: { Accept: "application/json" } })
  .then((res) => (res.ok ? res.json() : null))
  .then((body) => {
    const entries = body && Array.isArray(body.entries) ? body.entries : [];
    renderJumpOff(entries.find((entry) => entry.id === "connections") || null);
  })
  .catch(() => renderJumpOff(null));

function renderJumpOff(connections) {
  jumpOffEl.textContent = "";
  if (!connections) return;
  if (connections.jump_off) {
    const link = document.createElement("a");
    link.href = connections.jump_off;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    link.textContent = "Open in Connections / famtasticdesigns";
    jumpOffEl.appendChild(link);
  } else {
    jumpOffEl.textContent = connections.authority
      ? `No jump-off URL configured yet for Connections. ${connections.authority}.`
      : "No jump-off URL configured yet for Connections.";
  }
}

function evidenceTrail(entry) {
  const list = document.createElement("ol");
  list.className = "proofs-trail";
  for (const step of entry.evidence_trail || []) {
    const item = document.createElement("li");
    item.className = "proofs-trail__step";

    const stage = document.createElement("span");
    stage.className = "proof-stage";
    stage.dataset.stage = step.stage;
    stage.textContent = step.label || step.stage;

    const when = document.createElement("span");
    when.className = "proofs-trail__when";
    when.title = formatTimestamp(step.at);
    when.textContent = formatRelative(step.at);

    const evidence = document.createElement("span");
    evidence.className = "proofs-trail__evidence";
    if (step.evidence === null || step.evidence === undefined) {
      evidence.textContent = "no evidence recorded";
      evidence.classList.add("proofs-trail__evidence--none");
    } else if (typeof step.evidence === "object") {
      evidence.textContent = JSON.stringify(step.evidence);
    } else {
      evidence.textContent = String(step.evidence);
    }

    item.append(stage, when, evidence);
    list.appendChild(item);
  }
  return list;
}

function proofCard(entry) {
  const card = document.createElement("article");
  card.className = "card proofs-card";

  const head = document.createElement("div");
  head.className = "proofs-card__head";
  const title = document.createElement("h3");
  title.textContent = entry.proof_id;
  const currentStage = document.createElement("span");
  currentStage.className = "proof-stage proof-stage--current";
  currentStage.dataset.stage = entry.stage;
  currentStage.textContent = entry.stage_label || entry.stage;
  head.append(title, currentStage);

  const meta = document.createElement("p");
  meta.className = "card__meta";
  meta.textContent = `site: ${entry.site_id} - last changed ${formatRelative(entry.updated_at)}`;

  card.append(head, meta, evidenceTrail(entry));
  return card;
}

createRegion(regionEl, {
  collection: "entries",
  endpoint: "/api/proofs",
  render(data) {
    const rows = data.entries || [];
    const stageNote = Array.isArray(data.stages) ? ` (${data.stages.length} stages tracked)` : "";
    count.textContent = `${rows.length} proof(s)${stageNote} (source: ${data.source || "unknown"})`;

    const list = document.createElement("div");
    list.className = "proofs-list";
    for (const entry of rows) list.appendChild(proofCard(entry));
    return list;
  },
});
