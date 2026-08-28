import { render as renderShell } from "/kit/shell.js";
import { createRegion } from "/kit/region.js";
import { table } from "/kit/table.js";
import { formatRelative, formatCount } from "/kit/format.js";

const root = renderShell({ pageId: "applications" });

const section = document.createElement("section");
const heading = document.createElement("h2");
heading.textContent = "Applications";
const count = document.createElement("p");
count.className = "card__meta";
const regionEl = document.createElement("div");
section.append(heading, count, regionEl);
root.appendChild(section);

createRegion(regionEl, {
    collection: 'items',
  endpoint: "/api/applications",
  render(data) {
    const rows = data.applications || data.items || [];
    count.textContent = `${formatCount(rows.length, data.denominators?.total)} (source: ${data.source || "unknown"})`;
    if (!rows.length) {
      const empty = document.createElement("div");
      empty.className = "region__status region__status--empty";
      empty.textContent = "No rows in the response body.";
      return empty;
    }
    const columns = Object.keys(rows[0]).slice(0, 5).map((key) => ({ key, label: key }));
    return table({
      columns,
      rows,
      cellRender(row, col) {
        const value = row[col.key];
        if (col.key.endsWith("_at")) return formatRelative(value);
        if (value && typeof value === "object") return JSON.stringify(value);
        return value;
      },
    });
  },
});
