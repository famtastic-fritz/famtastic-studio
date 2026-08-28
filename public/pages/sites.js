import { render as renderShell } from "/kit/shell.js";
import { createRegion } from "/kit/region.js";
import { pill } from "/kit/pill.js";
import { panel } from "/kit/panel.js";
import { emptyState } from "/kit/empty-state.js";
import { formatRelative } from "/kit/format.js";

// The Sites page per site-studio-console-v2.html: a CARD GRID where each card
// SHOWS the site -- a rendered thumbnail of its actual entry page -- with name,
// domain, and status pills. Real properties lead; test builds and undeclared
// directories sit behind a disclosure, flagged, never silently hidden.
//
// Honest-values rule: a number we have not computed renders as "not scored" or
// "not probed", never as an invented score. The mockup's SEO 91 is the shape;
// the value arrives when the SEO lane lands.

const root = renderShell({ pageId: "sites" });

function cardFor(site) {
  const card = document.createElement("a");
  card.className = "pcard";
  card.href = `/site?site_id=${encodeURIComponent(site.id)}`;
  card.title = site.origin_reason || "";

  const thumb = document.createElement("div");
  thumb.className = "pcard__thumb";
  const img = document.createElement("img");
  img.loading = "lazy";
  img.alt = `Rendered preview of ${site.id}`;
  img.src = `/api/portfolio/thumbnail?site=${encodeURIComponent(site.id)}`;
  thumb.appendChild(img);
  card.appendChild(thumb);

  const body = document.createElement("div");
  body.className = "pcard__body";

  const nm = document.createElement("div");
  nm.className = "pcard__name";
  nm.textContent = site.id.replace(/^site-/, "").replace(/-/g, " ");
  body.appendChild(nm);

  const dm = document.createElement("div");
  dm.className = "pcard__domain";
  dm.textContent = site.domain || site.id;
  body.appendChild(dm);

  const crow = document.createElement("div");
  crow.className = "pcard__row";
  crow.appendChild(pill(site.capability_class, site.capability_class === "application" ? "warn" : "ok"));
  if (site.domain) crow.appendChild(pill(site.domain.replace(/^www\./, ""), "ok"));
  else crow.appendChild(pill("not deployed", "unknown"));
  // Not yet computed -> said plainly, never faked.
  const seo = pill("SEO not scored", "unknown");
  seo.title = "SEO scoring lands with the SEO lane; no number is invented meanwhile";
  crow.appendChild(seo);
  if (site.origin === "experiment") crow.appendChild(pill(`experiment on ${(site.variant_of || "").replace(/^site-/, "")}`, "warn"));
  else if (site.origin === "test") crow.appendChild(pill("test build", "unknown"));
  else if (site.origin === "unclassified") crow.appendChild(pill("unclassified", "unknown"));
  body.appendChild(crow);

  const touch = document.createElement("div");
  touch.className = "pcard__touch";
  touch.textContent = site.last_touch ? `last touch ${formatRelative(site.last_touch)}` : "";
  body.appendChild(touch);

  card.appendChild(body);
  return card;
}

function grid(sites) {
  const g = document.createElement("div");
  g.className = "pgrid";
  for (const s of sites) g.appendChild(cardFor(s));
  return g;
}

const region = document.createElement("div");
root.appendChild(region);

createRegion(region, {
  collection: "sites",
  endpoint: "/api/portfolio",
  render(data) {
    const wrap = document.createElement("div");

    const o = data.origin_counts || {};
    const headerBar = document.createElement("div");
    headerBar.style.display = "flex";
    headerBar.style.alignItems = "center";
    headerBar.style.justifyContent = "space-between";
    headerBar.style.marginBottom = "var(--space-4)";

    const head = document.createElement("p");
    head.className = "card__meta";
    head.style.margin = "0";
    head.textContent = `${o.site || 0} real sites · ${(data.roots || []).map((r) => r.root).join(" · ")} · ${(o.experiment || 0)} experiments · ${(o.test || 0)} test builds · ${(o.unclassified || 0)} unclassified — below`;

    const newBtn = document.createElement("a");
    newBtn.href = "/builds";
    newBtn.className = "btn btn--pri";
    newBtn.textContent = "＋ New site build";

    headerBar.append(head, newBtn);
    wrap.appendChild(headerBar);

    const sites = data.sites || [];
    const real = sites.filter((s) => s.origin === "site");
    const rest = sites.filter((s) => s.origin !== "site");

    wrap.appendChild(real.length
      ? grid(real)
      : emptyState({ state: "empty", reason: "no directory in the portfolio roots carries a git repo or .site-context, so nothing classifies as a real property yet" }));

    if (rest.length) {
      const details = document.createElement("details");
      details.className = "pcard__more";
      const sum = document.createElement("summary");
      sum.textContent = `${o.experiment || 0} experiments · ${o.test || 0} test builds · ${o.unclassified || 0} unclassified — show`;
      details.appendChild(sum);
      details.appendChild(grid(rest));
      wrap.appendChild(details);
    }

    const c = data.capability_counts || {};
    const countsBody = document.createElement("p");
    countsBody.className = "card__meta";
    countsBody.textContent = `${data.total} directories scanned · ${o.site || 0} qualify as sites, ${o.experiment || 0} experiments, ${o.test || 0} test builds, ${o.unclassified || 0} unclassified. A directory qualifies through a deliberate signal only: its own repo, a managed-site record, a declared domain, or deploy evidence. Overrides: config/portfolio-overrides.json · ${c.brochure || 0} brochure, ${c.application || 0} application (deployed and verified by Studio, not rebuildable by it). Computed from signals on disk, nothing inferred from a list.`;
    wrap.appendChild(panel({ title: "Counts, and what they mean", route: "/api/portfolio", children: countsBody }));

    return wrap;
  },
});
