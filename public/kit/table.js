// Small table render helper. columns: [{ key, label }]. rows: array of objects.
// cellRender(row, col) optionally returns a Node or string for a cell.

export function table({ columns, rows, cellRender }) {
  const el = document.createElement("table");
  el.className = "table";

  const thead = document.createElement("thead");
  const headRow = document.createElement("tr");
  for (const col of columns) {
    const th = document.createElement("th");
    th.textContent = col.label;
    headRow.appendChild(th);
  }
  thead.appendChild(headRow);
  el.appendChild(thead);

  const tbody = document.createElement("tbody");
  for (const row of rows) {
    const tr = document.createElement("tr");
    for (const col of columns) {
      const td = document.createElement("td");
      const value = cellRender ? cellRender(row, col) : row[col.key];
      if (value instanceof Node) {
        td.appendChild(value);
      } else {
        td.textContent = value ?? "";
      }
      tr.appendChild(td);
    }
    tbody.appendChild(tr);
  }
  el.appendChild(tbody);

  return el;
}
