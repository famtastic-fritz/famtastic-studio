import { createRegion } from "/kit/region.js";

function canvasUrl(siteId, pagePath) {
  return `/api/sites/canvas?site_id=${encodeURIComponent(siteId)}&page_path=${encodeURIComponent(pagePath)}`;
}

export function build(panelEl, { siteId }) {
  const workstation = document.createElement("div");
  workstation.className = "editor-workstation";

  // ---- 1. Left 2nd Side Nav (Layers, Pages, Sections, Blocks) ----
  const layersPane = document.createElement("aside");
  layersPane.className = "editor-layers";

  const layersHead = document.createElement("div");
  layersHead.className = "layers-header";
  layersHead.textContent = "Structure & Layers";

  const pagesTitle = document.createElement("div");
  pagesTitle.className = "layers-section-title";
  pagesTitle.textContent = "Pages";

  const pagesList = document.createElement("ul");
  pagesList.className = "layers-list";

  const sectionsTitle = document.createElement("div");
  sectionsTitle.className = "layers-section-title";
  sectionsTitle.textContent = "Sections";

  const sectionsList = document.createElement("ul");
  sectionsList.className = "layers-list";
  const defaultSections = [
    { name: "Hero Header", icon: "◧" },
    { name: "Feature Cards", icon: "▦" },
    { name: "Call To Action", icon: "▬" },
    { name: "Footer", icon: "■" },
  ];
  for (const s of defaultSections) {
    const sItem = document.createElement("li");
    sItem.className = "layers-item";
    sItem.innerHTML = `<span>${s.icon}</span> <span>${s.name}</span>`;
    sectionsList.appendChild(sItem);
  }

  const compTitle = document.createElement("div");
  compTitle.className = "layers-section-title";
  compTitle.textContent = "Component Library";

  const compGrid = document.createElement("div");
  compGrid.className = "comp-grid";
  const blockTypes = ["Hero Split", "Grid 3-Up", "CTA Band", "Form"];
  for (const b of blockTypes) {
    const card = document.createElement("div");
    card.className = "comp-card";
    card.textContent = b;
    compGrid.appendChild(card);
  }

  layersPane.append(layersHead, pagesTitle, pagesList, sectionsTitle, sectionsList, compTitle, compGrid);

  // ---- 2. Center Stage (Toolbar, Responsive Viewport, Iframe Canvas) ----
  const stagePane = document.createElement("main");
  stagePane.className = "editor-stage";

  const toolbar = document.createElement("div");
  toolbar.className = "stage-toolbar";

  const crumb = document.createElement("div");
  crumb.className = "stage-crumb";
  crumb.innerHTML = `<span>${siteId}</span> <span>/</span> <b id="current-page-label">index.html</b> <span class="badge" style="background:var(--color-ok-bg);color:var(--color-ok);font-size:9px;padding:2px 6px;border-radius:6px">published · live</span>`;

  const viewportSegs = document.createElement("div");
  viewportSegs.className = "viewport-segs";

  const viewports = [
    { id: "desktop", label: "Desktop", widthClass: "" },
    { id: "tablet", label: "Tablet 768px", widthClass: "viewport--tablet" },
    { id: "mobile", label: "Mobile 390px", widthClass: "viewport--mobile" },
  ];

  const frameWrap = document.createElement("div");
  frameWrap.className = "canvas-tab__frame-wrap";

  const frame = document.createElement("iframe");
  frame.className = "canvas-tab__frame";
  frame.setAttribute("title", `Canvas: ${siteId}`);
  frameWrap.appendChild(frame);

  for (const vp of viewports) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = `viewport-btn ${vp.id === "desktop" ? "active" : ""}`;
    btn.textContent = vp.label;
    btn.addEventListener("click", () => {
      viewportSegs.querySelectorAll(".viewport-btn").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      frame.className = `canvas-tab__frame ${vp.widthClass}`;
    });
    viewportSegs.appendChild(btn);
  }

  toolbar.append(crumb, viewportSegs);

  const status = document.createElement("div");
  status.className = "region__status region__status--empty canvas__status";
  status.textContent = "Choose a page to load it into the canvas.";

  stagePane.append(toolbar, status, frameWrap);

  // ---- 3. Right Pane (Visual Property Inspector & Box Model) ----
  const inspectorPane = document.createElement("aside");
  inspectorPane.className = "editor-inspector";

  const inspHead = document.createElement("div");
  inspHead.className = "inspector-header";
  inspHead.innerHTML = `<span>Property Inspector</span> <span style="font-size:9px;color:var(--color-accent-2)">LIVE</span>`;

  const inspBody = document.createElement("div");
  inspBody.className = "inspector-body";

  // Content Group
  const gContent = document.createElement("div");
  gContent.className = "insp-group";
  gContent.innerHTML = `
    <div class="insp-group-title">Content & Copy</div>
    <div class="insp-field"><label>Headline</label><input type="text" value="30 Years. One Weekend." /></div>
    <div class="insp-field"><label>Subhead</label><input type="text" value="Miami Beach Senior High, Class of 1996." /></div>
    <div class="insp-field"><label>Button Text</label><input type="text" value="Reserve your spot" /></div>
  `;

  // Typography Group
  const gTypo = document.createElement("div");
  gTypo.className = "insp-group";
  gTypo.innerHTML = `
    <div class="insp-group-title">Typography & Palette</div>
    <div class="insp-field"><label>Font Family</label><select><option>Space Grotesk</option><option>Playfair Display</option><option>JetBrains Mono</option></select></div>
    <div class="insp-field"><label>Brand Swatches</label>
      <div class="swatch-row">
        <div class="swatch-dot active" style="background:#f0c460"></div>
        <div class="swatch-dot" style="background:#8b7cf6"></div>
        <div class="swatch-dot" style="background:#4fd8e8"></div>
        <div class="swatch-dot" style="background:#0b1e3a"></div>
      </div>
    </div>
  `;

  // Box Model Group
  const gBox = document.createElement("div");
  gBox.className = "insp-group";
  gBox.innerHTML = `
    <div class="insp-group-title">Box Model Inspector</div>
    <div class="box-model-diagram">
      <div class="box-margin-outer">
        <div class="box-label">margin</div>
        <div class="box-vstack">
          <input class="box-input" value="0" aria-label="Margin Top" />
          <div class="box-padding-inner">
            <div class="box-label">padding</div>
            <div class="box-vstack">
              <input class="box-input" value="64" aria-label="Padding Top" />
              <div style="font-size:9px;color:var(--color-text-dim);padding:4px">880 × 320</div>
              <input class="box-input" value="56" aria-label="Padding Bottom" />
            </div>
          </div>
          <input class="box-input" value="0" aria-label="Margin Bottom" />
        </div>
      </div>
    </div>
  `;

  inspBody.append(gContent, gTypo, gBox);
  inspectorPane.append(inspHead, inspBody);

  workstation.append(layersPane, stagePane, inspectorPane);
  panelEl.appendChild(workstation);

  function loadFrame(pagePath) {
    status.textContent = `Loading ${pagePath}...`;
    status.className = "region__status region__status--loading canvas__status";
    frame.src = canvasUrl(siteId, pagePath);
    const label = crumb.querySelector("#current-page-label");
    if (label) label.textContent = pagePath;
  }

  frame.addEventListener("load", () => {
    status.className = "region__status region__status--available canvas__status";
    status.textContent = "Canvas loaded. Click text in the page to select it (or Tab to it), then click again or press Enter to edit.";
  });
  frame.addEventListener("error", () => {
    status.className = "region__status region__status--error canvas__status";
    status.textContent = "The canvas frame failed to load.";
  });

  createRegion(toolbar, {
    endpoint: `/api/sites/pages?site_id=${encodeURIComponent(siteId)}`,
    render(data) {
      const pages = data.pages || [];
      pagesList.innerHTML = "";
      if (!pages.length) {
        const empty = document.createElement("div");
        empty.className = "region__status region__status--empty";
        empty.textContent = `No HTML pages found for "${siteId}".`;
        return empty;
      }

      for (const p of pages) {
        const li = document.createElement("li");
        li.className = "layers-item";
        li.innerHTML = `<span>📄</span> <span>${p.path}</span> <span class="badge">SEO 91</span>`;
        li.addEventListener("click", () => {
          pagesList.querySelectorAll(".layers-item").forEach((item) => item.classList.remove("active"));
          li.classList.add("active");
          loadFrame(p.path);
        });
        pagesList.appendChild(li);
      }

      const preferred = pages.find((p) => /(^|\/)index\.html$/.test(p.path)) || pages[0];
      const firstItem = pagesList.querySelector(".layers-item");
      if (firstItem) firstItem.classList.add("active");

      loadFrame(preferred.path);
      const hiddenSelect = document.createElement("select");
      hiddenSelect.className = "canvas-tab__page-select";
      hiddenSelect.style.display = "none";
      return hiddenSelect;
    },
  });
}
