// Pages tab: real data from GET /api/sites/pages?site_id=
import { createRegion } from "/kit/region.js";
import { table } from "/kit/table.js";
import { formatRelative } from "/kit/format.js";

export function build(panelEl, { siteId }) {
  createRegion(panelEl, {
    collection: 'pages',
    endpoint: `/api/sites/pages?site_id=${encodeURIComponent(siteId)}`,
    render(data) {
      const pages = data.pages || [];
      if (!pages.length) {
        const empty = document.createElement("div");
        empty.className = "region__status region__status--empty";
        empty.textContent = `No HTML pages found for "${siteId}".`;
        return empty;
      }
      return table({
        columns: [
          { key: "path", label: "Path" },
          { key: "title", label: "Title" },
          { key: "bytes", label: "Bytes" },
          { key: "modified", label: "Modified" },
        ],
        rows: pages,
        cellRender(row, col) {
          if (col.key === "title") return row.title || "(no <title>)";
          if (col.key === "modified") return formatRelative(row.modified);
          return row[col.key];
        },
      });
    },
  });
}
