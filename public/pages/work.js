// Ingestion Hub (was "Work"). Two real, independently-sourced regions on one
// page: signed briefs from the real, read-only proof projection
// (server/kernel/proofs.js -- reused, not reinvented, from the Proofs page),
// and the existing cross-site open-work-item inbox. Approve & dispatch and
// Edit before sending render as real controls on a real brief, per Fritz's
// ask -- but their click behavior states plainly where dispatch actually
// happens (the famtasticdesigns repo) rather than pretending to call it:
// this server structurally cannot register a proof-job ingress route (see
// server/kernel/invariants.js's P0-I1 check, which fails the server's own
// boot if one is ever registered), so nothing here can honestly do more
// than that.
import { render as renderShell } from "/kit/shell.js";
import { createRegion } from "/kit/region.js";
import { panel } from "/kit/panel.js";
import { pill } from "/kit/pill.js";
import { formatRelative, formatCount } from "/kit/format.js";

const root = renderShell({ pageId: "work" });

const section = document.createElement("section");
const heading = document.createElement("h2");
heading.textContent = "Ingestion Hub";
const sub = document.createElement("p");
sub.className = "card__meta";
sub.textContent = "Signed briefs from famtasticdesigns.com, real proof-pipeline visibility, and open work across your portfolio.";
section.append(heading, sub);
root.appendChild(section);

// ---------------------------------------------------------------------
// Signed briefs (real projection of server/kernel/proofs.js -- the same
// data the Proofs page reads, reused rather than duplicated).
// ---------------------------------------------------------------------

const briefsRegionEl = document.createElement("div");
section.appendChild(
  panel({
    title: "Signed briefs",
    route: "/api/proofs",
    children: briefsRegionEl,
  }),
);

function dispatchStatusLine(connections) {
  const p = document.createElement("p");
  p.className = "card__meta ingestion-dispatch-status";
  p.textContent = connections && connections.authority
    ? `Dispatch happens in the famtasticdesigns repo. ${connections.authority}.`
    : "Dispatch happens in the famtasticdesigns repo, not here.";
  return p;
}

function variantStrip(variants) {
  if (!variants || !variants.length) return null;
  const wrap = document.createElement("div");
  wrap.className = "ingestion-variant-strip";
  for (const v of variants) {
    const item = document.createElement(v.href ? "a" : "div");
    item.className = "ingestion-variant";
    if (v.href) item.href = v.href;
    item.textContent = v.label || v.id || "variant";
    wrap.appendChild(item);
  }
  return wrap;
}

function briefCard(entry, connections) {
  const card = document.createElement("article");
  card.className = "card ingestion-brief-card";

  const head = document.createElement("div");
  head.className = "ingestion-brief-card__head";
  const title = document.createElement("h3");
  const brief = entry.brief || {};
  title.textContent = brief.client_name || `Proof ${entry.proof_id}`;
  const stagePill = pill(entry.stage_label || entry.stage, entry.stage === "proof_ready" ? "warn" : entry.stage === "delivered" ? "ok" : "unknown");
  head.append(title, stagePill);
  card.appendChild(head);

  const meta = document.createElement("p");
  meta.className = "card__meta";
  const metaParts = [`site: ${entry.site_id}`, `last changed ${formatRelative(entry.updated_at)}`];
  if (brief.brief_number) metaParts.unshift(`brief #${brief.brief_number}`);
  metaParts.push(brief.signature_verified === true ? "signed ✓ verified" : brief.signature_verified === false ? "signature not verified" : "signature status unknown");
  meta.textContent = metaParts.join(" · ");
  card.appendChild(meta);

  if (brief.quote_snippet) {
    const quote = document.createElement("p");
    quote.className = "ingestion-quote-snippet";
    quote.textContent = `“${brief.quote_snippet}”`;
    card.appendChild(quote);
  }

  const strip = variantStrip(brief.proof_variants);
  if (strip) card.appendChild(strip);
  else if (entry.stage === "generating" || entry.stage === "ingested") {
    const waiting = document.createElement("p");
    waiting.className = "card__meta";
    waiting.textContent = "No proof variants recorded on this event yet.";
    card.appendChild(waiting);
  }

  if (entry.stage === "proof_ready" || entry.stage === "client_reviewing") {
    const actions = document.createElement("div");
    actions.className = "ingestion-brief-card__actions";
    const statusEl = dispatchStatusLine(connections);
    statusEl.hidden = true;

    const approveBtn = document.createElement("button");
    approveBtn.type = "button";
    approveBtn.className = "btn btn--primary";
    approveBtn.textContent = "Approve & dispatch";
    approveBtn.addEventListener("click", () => { statusEl.hidden = false; });

    const editBtn = document.createElement("button");
    editBtn.type = "button";
    editBtn.className = "btn";
    editBtn.textContent = "Edit before sending";
    editBtn.addEventListener("click", () => { statusEl.hidden = false; });

    actions.append(approveBtn, editBtn);
    card.append(actions, statusEl);
  }

  return card;
}

createRegion(briefsRegionEl, {
  collection: "entries",
  endpoint: "/api/proofs",
  render(data) {
    const rows = data.entries || [];
    const wrap = document.createElement("div");
    // formatCount() is for the "N / possible total" pattern (it deliberately
    // reports "not computed" without a real denominator) -- there is no
    // honest "how many briefs could there be" total here, so this is a
    // plain count, not that helper.
    const count = document.createElement("p");
    count.className = "card__meta";
    count.textContent = `${rows.length} signed brief(s) (source: ${data.source || "unknown"})`;
    wrap.appendChild(count);
    const list = document.createElement("div");
    list.className = "ingestion-brief-list";
    for (const entry of rows) list.appendChild(briefCard(entry, data.connections));
    wrap.appendChild(list);
    return wrap;
  },
});

// ---------------------------------------------------------------------
// Webhook ingress status -- a structural fact about this server's own
// code (P0-I1), not data that changes with portfolio state, so it reads
// from what is already loaded on the page rather than its own endpoint.
// ---------------------------------------------------------------------

const webhookBody = document.createElement("div");
const webhookNote = document.createElement("p");
webhookNote.className = "card__meta";
webhookNote.textContent = "This server registers no incoming webhook route for proof jobs, by design: server/kernel/invariants.js refuses to boot if any route matches a proof-job ingress pattern (P0-I1). A real webhook receiver, if one is wanted, needs to live outside this server -- in the famtasticdesigns repo, or a dedicated standalone service this console could then read from, the same read-only way the briefs above are read.";
webhookBody.appendChild(webhookNote);
section.appendChild(
  panel({
    title: "Incoming webhook listener",
    route: "computed",
    children: webhookBody,
  }),
);

// ---------------------------------------------------------------------
// Open work items (unchanged behavior, existing real cross-site sources).
// ---------------------------------------------------------------------

const workHeading = document.createElement("h3");
workHeading.textContent = "Open work items";
const workCount = document.createElement("p");
workCount.className = "card__meta";
const workRegionEl = document.createElement("div");
section.append(workHeading, workCount, workRegionEl);

const SOURCE_ORDER = ["journal_review", "recent_events", "spec_invalid", "no_pages"];

function sourcePill(source) {
  const configured = source.status === "ok";
  return pill(
    configured ? `${source.label}: ${source.count}` : `${source.label}: not configured`,
    configured ? "ok" : "unknown",
  );
}

function renderSources(sources) {
  const wrap = document.createElement("div");
  wrap.className = "work-source-list";
  for (const source of sources) {
    const p = sourcePill(source);
    if (source.status !== "ok" && source.reason) p.title = source.reason;
    wrap.appendChild(p);
  }

  const notConfigured = sources.filter((s) => s.status === "not_configured");
  if (notConfigured.length) {
    const note = document.createElement("p");
    note.className = "card__meta work-not-configured-note";
    note.textContent = notConfigured
      .map((s) => `${s.label} is not configured: ${s.reason}`)
      .join(" ");
    wrap.appendChild(note);
  }
  return wrap;
}

function itemRow(item) {
  const row = document.createElement("li");
  row.className = "work-item";

  const top = document.createElement("div");
  top.className = "work-item__top";
  top.appendChild(pill(item.state.replace(/_/g, " "), "warn"));

  const link = document.createElement("a");
  link.href = item.next_action_href || "#";
  link.textContent = item.site_id;
  link.className = "work-item__site";
  top.appendChild(link);

  const age = document.createElement("span");
  age.className = "card__meta";
  age.textContent = formatRelative(item.age_ts);
  top.appendChild(age);

  row.appendChild(top);

  const decision = document.createElement("p");
  decision.className = "work-item__decision";
  decision.textContent = item.decision;
  row.appendChild(decision);

  const next = document.createElement("p");
  next.className = "card__meta";
  next.textContent = `Next safe action: ${item.next_action}`;
  row.appendChild(next);

  const meta = document.createElement("p");
  meta.className = "card__meta work-item__footer";
  const lastEventText = item.last_event
    ? `${item.last_event.type} (${formatRelative(item.last_event.ts)})`
    : "no events recorded for this site";
  meta.textContent = `Last event: ${lastEventText} · idempotency key: ${item.idempotency_key}`;
  row.appendChild(meta);

  return row;
}

function renderGroups(items, sources) {
  const groupsEl = document.createElement("div");
  groupsEl.className = "work-groups";
  const bySource = new Map();
  for (const item of items) {
    if (!bySource.has(item.source)) bySource.set(item.source, []);
    bySource.get(item.source).push(item);
  }

  const orderedIds = [...SOURCE_ORDER, ...[...bySource.keys()].filter((id) => !SOURCE_ORDER.includes(id))];

  for (const sourceId of orderedIds) {
    const rows = bySource.get(sourceId);
    if (!rows || !rows.length) continue;
    const meta = sources.find((s) => s.id === sourceId);

    const group = document.createElement("section");
    group.className = "work-group";

    const groupHeading = document.createElement("h3");
    groupHeading.textContent = meta ? meta.label : sourceId;
    group.appendChild(groupHeading);

    const list = document.createElement("ul");
    list.className = "work-item-list";
    for (const item of rows) list.appendChild(itemRow(item));
    group.appendChild(list);

    groupsEl.appendChild(group);
  }

  if (!items.length) {
    const empty = document.createElement("div");
    empty.className = "region__status region__status--empty";
    empty.textContent = "No open work items from any configured source right now.";
    groupsEl.appendChild(empty);
  }

  return groupsEl;
}

createRegion(workRegionEl, {
  collection: "items",
  endpoint: "/api/work/items",
  render(data) {
    workCount.textContent = `${formatCount(data.items?.length, data.denominators?.open)} open`;
    const wrap = document.createElement("div");
    wrap.appendChild(renderSources(data.sources || []));
    wrap.appendChild(renderGroups(data.items || [], data.sources || []));
    return wrap;
  },
});
