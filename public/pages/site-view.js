// LINT-EXCEPTION: unified Antigravity IDE layout, file explorer, canvas stage, and property inspector
// Site View: Antigravity IDE-style Web Studio cockpit for active site development
import { render as renderShell } from "/kit/shell.js";
import { formatRelative } from "/kit/format.js";

const root = renderShell({ pageId: "site-view" });

const params = new URLSearchParams(window.location.search);
const siteId = (params.get("site_id") || "").trim();

if (!siteId) {
  const section = document.createElement("section");
  section.style.padding = "32px";
  const heading = document.createElement("h2");
  heading.textContent = "No site selected";
  const empty = document.createElement("div");
  empty.className = "region__status region__status--empty";
  empty.innerHTML = `No site_id was given in the URL. <a href="/sites">Choose a site from the portfolio</a>.`;
  section.append(heading, empty);
  root.appendChild(section);
} else {
  // Main IDE Workspace
  const workspace = document.createElement("div");
  workspace.className = "ide-workspace";
  workspace.id = "ide-workspace";

  // State
  let filesData = { pages: [], styles: [], configs: [], assets: [] };
  let openEditors = [{ file: "index.html", type: "html", dirty: false }];
  let activeFile = "index.html";
  let activeMode = "visual"; // 'visual' | 'code' | 'diff'
  let activeDevice = "desktop"; // 'desktop' | 'tablet' | 'mobile'
  let activeSection = "hero";
  let activeInspTab = "content";
  let dirtyCount = 0;

  // 1. LEFT INNER SIDEBAR (File Explorer, Open Editors, Outline, Components)
  const sidebar = document.createElement("aside");
  sidebar.className = "ide-sidebar";
  sidebar.setAttribute("aria-label", "Site Explorer");

  // Open Editors Section
  const openEditorsSec = document.createElement("div");
  openEditorsSec.className = "ide-section";
  openEditorsSec.innerHTML = `
    <div class="ide-section-head">
      <span>Open Editors</span>
      <span class="count" id="open-editors-count">1</span>
    </div>
    <ul class="ide-tree" id="open-editors-tree"></ul>
  `;

  // File Explorer Section
  const fileExplorerSec = document.createElement("div");
  fileExplorerSec.className = "ide-section";
  fileExplorerSec.innerHTML = `
    <div class="ide-section-head">
      <span>Site Files</span>
      <span class="count" id="site-files-count">0</span>
    </div>
    <div style="padding:4px 0">
      <div style="font-size:10px;font-family:var(--font-mono);color:var(--color-text-faint);padding:4px 14px;text-transform:uppercase">Pages</div>
      <ul class="ide-tree" id="pages-tree"></ul>
      <div style="font-size:10px;font-family:var(--font-mono);color:var(--color-text-faint);padding:4px 14px;text-transform:uppercase">Styles & Tokens</div>
      <ul class="ide-tree" id="styles-tree"></ul>
      <div style="font-size:10px;font-family:var(--font-mono);color:var(--color-text-faint);padding:4px 14px;text-transform:uppercase">Spec & Config</div>
      <ul class="ide-tree" id="configs-tree"></ul>
    </div>
  `;

  // Outline / Sections Section
  const outlineSec = document.createElement("div");
  outlineSec.className = "ide-section";
  outlineSec.innerHTML = `
    <div class="ide-section-head">
      <span>Page Outline</span>
      <span class="count" id="outline-count">4</span>
    </div>
    <ul class="ide-tree" id="outline-tree">
      <li class="ide-tree-item sub active" data-sec="hero">◧ Hero Section</li>
      <li class="ide-tree-item sub" data-sec="grid">▦ Feature Grid</li>
      <li class="ide-tree-item sub" data-sec="offer">🏷️ Offer / Coupon</li>
      <li class="ide-tree-item sub" data-sec="foot">▬ Footer</li>
    </ul>
  `;

  // Component Palette Section
  const compSec = document.createElement("div");
  compSec.className = "ide-section";
  compSec.style.marginTop = "auto";
  compSec.innerHTML = `
    <div class="ide-section-head">
      <span>Components</span>
      <span class="count">4</span>
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;padding:8px 10px">
      <div class="card" style="padding:6px 8px;font-size:11px;cursor:pointer;background:var(--color-bg-raised)" onclick="insertComp('hero')">Hero split</div>
      <div class="card" style="padding:6px 8px;font-size:11px;cursor:pointer;background:var(--color-bg-raised)" onclick="insertComp('grid')">Grid 3-up</div>
      <div class="card" style="padding:6px 8px;font-size:11px;cursor:pointer;background:var(--color-bg-raised)" onclick="insertComp('cta')">CTA Banner</div>
      <div class="card" style="padding:6px 8px;font-size:11px;cursor:pointer;background:var(--color-bg-raised)" onclick="insertComp('form')">RSVP Form</div>
    </div>
  `;

  sidebar.append(openEditorsSec, fileExplorerSec, outlineSec, compSec);

  // 2. CENTER STAGE (Tab bar, Visual Canvas, Code Editor, Diff)
  const stage = document.createElement("main");
  stage.className = "ide-stage";

  // Tab Bar
  const tabBar = document.createElement("div");
  tabBar.className = "ide-tab-bar";

  const tabStrip = document.createElement("div");
  tabStrip.className = "ide-tab-strip";
  tabStrip.id = "ide-tab-strip";

  const stageTools = document.createElement("div");
  stageTools.className = "ide-stage-tools";
  stageTools.innerHTML = `
    <div style="display:flex;gap:3px;margin-right:8px">
      <button class="ide-device-btn active" id="btn-desktop" title="Desktop View">🖥️ 960px</button>
      <button class="ide-device-btn" id="btn-tablet" title="Tablet View">📱 768px</button>
      <button class="ide-device-btn" id="btn-mobile" title="Mobile View">📱 390px</button>
    </div>
    <div style="width:1px;height:16px;background:var(--color-border);margin-right:8px"></div>
    <div style="display:flex;gap:3px;margin-right:8px">
      <button class="ide-device-btn active" id="btn-mode-visual">🎨 Visual</button>
      <button class="ide-device-btn" id="btn-mode-code">💻 Code</button>
    </div>
    <div style="width:1px;height:16px;background:var(--color-border);margin-right:8px"></div>
    <button class="btn btn--sm" id="btn-preview-tab">Preview ↗</button>
    <button class="btn btn--pri btn--sm" id="btn-save-file">Save</button>
  `;

  tabBar.append(tabStrip, stageTools);

  // Viewport Container
  const viewportContainer = document.createElement("div");
  viewportContainer.style.flex = "1";
  viewportContainer.style.display = "flex";
  viewportContainer.style.overflow = "hidden";
  viewportContainer.style.position = "relative";

  // 2a. Visual Canvas Frame
  const canvasFrame = document.createElement("div");
  canvasFrame.className = "ide-frame";
  canvasFrame.id = "ide-canvas-frame";

  const canvasEl = document.createElement("div");
  canvasEl.className = "ide-canvas";
  canvasEl.id = "ide-canvas";

  canvasFrame.appendChild(canvasEl);

  // 2b. Code View
  const codeView = document.createElement("div");
  codeView.className = "ide-code-view";
  codeView.id = "ide-code-view";
  codeView.style.display = "none";

  const codeTextarea = document.createElement("textarea");
  codeTextarea.className = "ide-code-textarea";
  codeTextarea.id = "ide-code-textarea";
  codeTextarea.spellcheck = false;

  codeView.appendChild(codeTextarea);

  viewportContainer.append(canvasFrame, codeView);
  stage.append(tabBar, viewportContainer);

  // 3. RIGHT PROPERTY INSPECTOR
  const inspector = document.createElement("aside");
  inspector.className = "ide-inspector";
  inspector.id = "ide-inspector";
  inspector.setAttribute("aria-label", "Property Inspector");

  inspector.innerHTML = `
    <div class="ide-insp-head">
      <b style="font-size:12px" id="insp-elem-name">Hero Section</b>
      <span class="type-tag" style="margin-left:auto;font-size:9.5px;color:var(--color-accent)" id="insp-elem-type">hero-split</span>
    </div>
    <div class="ide-insp-tabs">
      <button class="ide-insp-tab active" data-tab="content">Content</button>
      <button class="ide-insp-tab" data-tab="style">Style</button>
      <button class="ide-insp-tab" data-tab="adv">Advanced</button>
    </div>
    <div class="ide-insp-body" id="insp-body"></div>
  `;

  workspace.append(sidebar, stage, inspector);
  root.innerHTML = "";
  root.appendChild(workspace);

  // Functions to render file explorer & open editors
  function renderOpenEditors() {
    const tree = document.getElementById("open-editors-tree");
    if (!tree) return;
    tree.innerHTML = "";
    document.getElementById("open-editors-count").textContent = openEditors.length;

    openEditors.forEach((ed) => {
      const li = document.createElement("li");
      li.className = `ide-tree-item ${ed.file === activeFile ? "active" : ""}`;
      li.innerHTML = `
        <span>${ed.file}</span>
        ${ed.dirty ? '<span style="color:var(--color-warn)">●</span>' : ""}
        <span class="type-tag">${ed.type}</span>
        <button class="close-btn" title="Close">✕</button>
      `;

      li.addEventListener("click", () => switchFile(ed.file));
      li.querySelector(".close-btn").addEventListener("click", (e) => {
        e.stopPropagation();
        closeEditor(ed.file);
      });
      tree.appendChild(li);
    });

    renderTabStrip();
  }

  function renderTabStrip() {
    const strip = document.getElementById("ide-tab-strip");
    if (!strip) return;
    strip.innerHTML = "";

    openEditors.forEach((ed) => {
      const tab = document.createElement("div");
      tab.className = `ide-tab ${ed.file === activeFile ? "active" : ""}`;
      tab.innerHTML = `
        <span>${ed.file}</span>
        ${ed.dirty ? '<span style="color:var(--color-warn)">●</span>' : ""}
        <button class="tab-close" title="Close file">✕</button>
      `;
      tab.addEventListener("click", () => switchFile(ed.file));
      tab.querySelector(".tab-close").addEventListener("click", (e) => {
        e.stopPropagation();
        closeEditor(ed.file);
      });
      strip.appendChild(tab);
    });
  }

  function renderFileTrees() {
    const pagesTree = document.getElementById("pages-tree");
    const stylesTree = document.getElementById("styles-tree");
    const configsTree = document.getElementById("configs-tree");

    if (pagesTree) {
      pagesTree.innerHTML = "";
      filesData.pages.forEach((p) => {
        const li = document.createElement("li");
        li.className = `ide-tree-item ${p.name === activeFile ? "active" : ""}`;
        li.innerHTML = `<span>${p.name}</span><span class="type-tag">${p.isIndex ? "home" : "page"}</span>`;
        li.addEventListener("click", () => openFile(p.name, "html"));
        pagesTree.appendChild(li);
      });
    }

    if (stylesTree) {
      stylesTree.innerHTML = "";
      filesData.styles.forEach((s) => {
        const li = document.createElement("li");
        li.className = `ide-tree-item ${s.name === activeFile ? "active" : ""}`;
        li.innerHTML = `<span>${s.name}</span><span class="type-tag">${s.type}</span>`;
        li.addEventListener("click", () => openFile(s.name, s.type));
        stylesTree.appendChild(li);
      });
    }

    if (configsTree) {
      configsTree.innerHTML = "";
      filesData.configs.forEach((c) => {
        const li = document.createElement("li");
        li.className = `ide-tree-item ${c.name === activeFile ? "active" : ""}`;
        li.innerHTML = `<span>${c.name}</span><span class="type-tag">${c.type}</span>`;
        li.addEventListener("click", () => openFile(c.name, c.type));
        configsTree.appendChild(li);
      });
    }

    const totalCount = filesData.pages.length + filesData.styles.length + filesData.configs.length;
    const countEl = document.getElementById("site-files-count");
    if (countEl) countEl.textContent = totalCount;
  }

  async function openFile(filename, type) {
    let ed = openEditors.find((e) => e.file === filename);
    if (!ed) {
      ed = { file: filename, type: type || "file", dirty: false };
      openEditors.push(ed);
    }
    await switchFile(filename);
  }

  function closeEditor(filename) {
    if (openEditors.length <= 1) return; // Keep at least one editor open
    const idx = openEditors.findIndex((e) => e.file === filename);
    if (idx !== -1) {
      openEditors.splice(idx, 1);
      if (activeFile === filename) {
        switchFile(openEditors[Math.max(0, idx - 1)].file);
      } else {
        renderOpenEditors();
      }
    }
  }

  async function switchFile(filename) {
    activeFile = filename;
    renderOpenEditors();
    renderFileTrees();

    // Fetch file content
    try {
      const resp = await fetch(`/api/sites/file?site_id=${encodeURIComponent(siteId)}&file=${encodeURIComponent(filename)}`);
      const data = await resp.json().catch(() => ({}));
      const content = data.content || "";

      codeTextarea.value = content;

      if (filename.endsWith(".html")) {
        renderVisualCanvas(content);
        if (activeMode === "visual") {
          canvasFrame.style.display = "flex";
          codeView.style.display = "none";
        }
      } else {
        // Auto-switch to code mode for css/json
        canvasFrame.style.display = "none";
        codeView.style.display = "flex";
      }
    } catch {
      // Fallback
    }
  }

  function renderVisualCanvas(htmlContent) {
    const canvas = document.getElementById("ide-canvas");
    if (!canvas) return;

    if (!htmlContent) {
      canvas.innerHTML = `
        <div style="padding:48px 32px;text-align:center;color:#6b7280">
          <div style="font-size:24px;margin-bottom:8px">📄</div>
          <div style="font-size:14px;font-weight:600">Empty Page Template</div>
          <div style="font-size:12px;margin-top:4px">Add content or select a component to begin editing.</div>
        </div>
      `;
      return;
    }

    // Wrap sections with interactive selection attributes
    canvas.innerHTML = htmlContent;

    // Attach click listeners for inline elements & property inspector
    canvas.querySelectorAll("h1, h2, h3, p, a, button, section, header, footer, div").forEach((el) => {
      el.addEventListener("click", (e) => {
        e.stopPropagation();
        canvas.querySelectorAll(".ide-elem-selected").forEach((s) => s.classList.remove("ide-elem-selected"));
        el.classList.add("ide-elem-selected");
        selectElement(el);
      });
    });
  }

  function selectElement(el) {
    const tag = el.tagName.toLowerCase();
    const nameEl = document.getElementById("insp-elem-name");
    const typeEl = document.getElementById("insp-elem-type");
    if (nameEl) nameEl.textContent = `<${tag}> ${el.className ? `.${el.className.split(" ")[0]}` : ""}`;
    if (typeEl) typeEl.textContent = tag;

    renderInspector(el);
  }

  function renderInspector(el) {
    const body = document.getElementById("insp-body");
    if (!body) return;
    body.innerHTML = "";

    if (!el) {
      body.innerHTML = `<div style="font-size:11.5px;color:var(--color-text-faint);text-align:center;padding:24px 0">Click any element in the canvas to inspect & edit properties.</div>`;
      return;
    }

    if (activeInspTab === "content") {
      const textGroup = document.createElement("div");
      textGroup.className = "ide-insp-group";
      textGroup.innerHTML = `
        <div class="ide-insp-group-title">Text Content</div>
        <textarea class="form__textarea" rows="3" style="width:100%;font-size:12px">${el.textContent || ""}</textarea>
      `;
      textGroup.querySelector("textarea").addEventListener("input", (e) => {
        el.textContent = e.target.value;
        markDirty();
      });
      body.appendChild(textGroup);

      if (el.tagName.toLowerCase() === "a" || el.tagName.toLowerCase() === "button") {
        const linkGroup = document.createElement("div");
        linkGroup.className = "ide-insp-group";
        linkGroup.innerHTML = `
          <div class="ide-insp-group-title">Action / Link URL</div>
          <input class="form__input" style="width:100%;font-size:12px" value="${el.getAttribute("href") || "#"}" />
        `;
        body.appendChild(linkGroup);
      }
    } else if (activeInspTab === "style") {
      const boxGroup = document.createElement("div");
      boxGroup.className = "ide-insp-group";
      boxGroup.innerHTML = `
        <div class="ide-insp-group-title">Box Model (Margin / Padding)</div>
        <div class="box-model-grid">
          <span class="lbl">MARGIN / PADDING</span>
          <div style="grid-column:1/4;display:flex;justify-content:center"><input class="box-input" value="16px" /></div>
          <input class="box-input" value="20px" />
          <div style="font-family:var(--font-mono);font-size:9px;color:var(--color-text-faint);text-align:center">ELEMENT</div>
          <input class="box-input" value="20px" />
          <div style="grid-column:1/4;display:flex;justify-content:center"><input class="box-input" value="16px" /></div>
        </div>
      `;
      body.appendChild(boxGroup);
    } else {
      const advGroup = document.createElement("div");
      advGroup.className = "ide-insp-group";
      advGroup.innerHTML = `
        <div class="ide-insp-group-title">Classes & Identifier</div>
        <div style="margin-bottom:8px">
          <label style="font-size:10px;color:var(--color-text-faint)">Class Name</label>
          <input class="form__input" style="width:100%;font-size:11.5px" value="${el.className || ""}" />
        </div>
        <div>
          <label style="font-size:10px;color:var(--color-text-faint)">Element ID</label>
          <input class="form__input" style="width:100%;font-size:11.5px" value="${el.id || ""}" />
        </div>
      `;
      body.appendChild(advGroup);
    }
  }

  function markDirty() {
    dirtyCount++;
    const ed = openEditors.find((e) => e.file === activeFile);
    if (ed) ed.dirty = true;
    renderOpenEditors();
  }

  // Load site files initially
  async function loadInitialFiles() {
    try {
      const resp = await fetch(`/api/sites/files?site_id=${encodeURIComponent(siteId)}`);
      filesData = await resp.json().catch(() => ({ pages: [], styles: [], configs: [], assets: [] }));
      renderFileTrees();
      await openFile("index.html", "html");
    } catch {
      // Fallback
    }
  }

  // Event Listeners for Tools
  document.getElementById("btn-desktop").addEventListener("click", (e) => {
    document.querySelectorAll(".ide-device-btn").forEach((b) => b.classList.remove("active"));
    e.target.classList.add("active");
    canvasEl.className = "ide-canvas";
  });

  document.getElementById("btn-tablet").addEventListener("click", (e) => {
    document.querySelectorAll(".ide-device-btn").forEach((b) => b.classList.remove("active"));
    e.target.classList.add("active");
    canvasEl.className = "ide-canvas viewport-tablet";
  });

  document.getElementById("btn-mobile").addEventListener("click", (e) => {
    document.querySelectorAll(".ide-device-btn").forEach((b) => b.classList.remove("active"));
    e.target.classList.add("active");
    canvasEl.className = "ide-canvas viewport-mobile";
  });

  document.getElementById("btn-mode-visual").addEventListener("click", (e) => {
    activeMode = "visual";
    document.getElementById("btn-mode-code").classList.remove("active");
    e.target.classList.add("active");
    canvasFrame.style.display = "flex";
    codeView.style.display = "none";
  });

  document.getElementById("btn-mode-code").addEventListener("click", (e) => {
    activeMode = "code";
    document.getElementById("btn-mode-visual").classList.remove("active");
    e.target.classList.add("active");
    canvasFrame.style.display = "none";
    codeView.style.display = "flex";
  });

  document.getElementById("btn-preview-tab").addEventListener("click", () => {
    window.open(`/api/sites/file?site_id=${encodeURIComponent(siteId)}&file=${encodeURIComponent(activeFile)}`, "_blank");
  });

  document.getElementById("btn-save-file").addEventListener("click", async () => {
    const content = activeMode === "code" ? codeTextarea.value : canvasEl.innerHTML;
    try {
      await fetch(`/api/sites/file?site_id=${encodeURIComponent(siteId)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ file: activeFile, content }),
      });
      const ed = openEditors.find((e) => e.file === activeFile);
      if (ed) ed.dirty = false;
      dirtyCount = Math.max(0, dirtyCount - 1);
      renderOpenEditors();
    } catch {
      // Fallback
    }
  });

  // Inspector Tabs
  inspector.querySelectorAll(".ide-insp-tab").forEach((tab) => {
    tab.addEventListener("click", (e) => {
      inspector.querySelectorAll(".ide-insp-tab").forEach((t) => t.classList.remove("active"));
      tab.classList.add("active");
      activeInspTab = tab.dataset.tab;
      const sel = canvasEl.querySelector(".ide-elem-selected");
      renderInspector(sel);
    });
  });

  loadInitialFiles();
}
