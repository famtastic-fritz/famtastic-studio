// Components: the recurring section types (server/kernel/component-inventory.js
// group by section.type over every real, imported site's spec) discovered in
// the portfolio, with real site usage counts. There is no fixed catalog here
// -- the table shows exactly the `type` values real specs carry today (hero,
// text, cta), never an invented taxonomy like "feature grid" or "form".
import { render as renderShell } from "/kit/shell.js";
import { createRegion } from "/kit/region.js";
import { table } from "/kit/table.js";
import { panel } from "/kit/panel.js";
import { pill } from "/kit/pill.js";

const root = renderShell({ pageId: "components" });

const section = document.createElement("section");

const heading = document.createElement("h2");
heading.textContent = "Components";

const sub = document.createElement("p");
sub.className = "card__meta";
sub.textContent = "Recurring section types discovered across every real, imported site in the portfolio.";

const jumpOffEl = document.createElement("p");
jumpOffEl.className = "components-jump-off";

const regionEl = document.createElement("div");

section.append(heading, sub, jumpOffEl, regionEl);
root.appendChild(section);

// The jump-off is page chrome, not inventory data -- it must show regardless
// of whether any component types were found, so it is fetched from the
// registry route directly rather than riding along on the (possibly empty)
// components region. Pattern matches public/pages/proofs.js's own jump-off.
fetch("/api/platform/registry", { headers: { Accept: "application/json" } })
  .then((res) => (res.ok ? res.json() : null))
  .then((body) => {
    const entries = body && Array.isArray(body.entries) ? body.entries : [];
    renderJumpOff(entries.find((entry) => entry.id === "component-studio") || null);
  })
  .catch(() => renderJumpOff(null));

function renderJumpOff(componentStudio) {
  jumpOffEl.textContent = "";
  if (!componentStudio) return;
  if (componentStudio.jump_off) {
    const link = document.createElement("a");
    link.className = "btn";
    link.href = componentStudio.jump_off;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    link.textContent = "Component Studio →";
    jumpOffEl.appendChild(link);
  } else {
    jumpOffEl.textContent = componentStudio.authority
      ? `Component Studio: not configured yet. ${componentStudio.authority}.`
      : "Component Studio: not configured yet.";
  }
}

// Display-only: title-cases a real `type` value for the table (hero -> Hero).
// "cta" renders as the acronym it already is; every other type gets generic
// title-case. This never changes or invents the underlying type value --
// only how that same real string is capitalized on screen.
const ACRONYMS = new Set(["cta"]);
function displayType(type) {
  const words = String(type || "").split(/[-_\s]+/).filter(Boolean);
  if (!words.length) return "(untyped)";
  return words
    .map((w) => (ACRONYMS.has(w.toLowerCase()) ? w.toUpperCase() : w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()))
    .join(" ");
}

createRegion(regionEl, {
  collection: "components",
  endpoint: "/api/components",
  render(data) {
    const rows = data.components || [];
    const skipped = data.skipped_sites || [];

    const wrap = document.createElement("div");

    const head = document.createElement("p");
    head.className = "card__meta";
    head.textContent = `${rows.length} recurring section type${rows.length === 1 ? "" : "s"} across the real portfolio`
      + (skipped.length ? ` -- ${skipped.length} real site(s) not counted yet (not imported): ${skipped.map((s) => s.id).join(", ")}.` : ".");
    wrap.appendChild(head);

    const typeTable = table({
      columns: [
        { key: "type", label: "Type" },
        { key: "used_on", label: "Used on" },
        { key: "total_occurrences", label: "Occurrences" },
      ],
      rows,
      cellRender(row, col) {
        if (col.key === "type") {
          const span = document.createElement("span");
          span.textContent = displayType(row.type);
          if (row.example_heading) span.title = `e.g. "${row.example_heading}"`;
          return span;
        }
        if (col.key === "used_on") {
          const n = (row.sites || []).length;
          const p = pill(`${n} site${n === 1 ? "" : "s"}`, "ok");
          if (n) p.title = row.sites.map((s) => `${s.site_id}: ${s.count}`).join(", ");
          return p;
        }
        if (col.key === "total_occurrences") return String(row.total_occurrences);
        return row[col.key];
      },
    });

    wrap.appendChild(panel({
      title: "Recurring section types",
      route: "/api/components",
      children: typeTable,
    }));

    return wrap;
  },
});
