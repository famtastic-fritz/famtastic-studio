// Shared chrome: top bar, left nav, and the Shay rail (when the page has
// one). The page list mirrors config/pages.json. Kept hardcoded here (rather
// than a duplicate JSON file under public/) so there is exactly one place a
// change to config/pages.json needs to be echoed, and no static asset can
// drift out of sync silently.
//
// Visual language lifted from the Shay operator console mockup (see
// public/app.css header). This module owns chrome structure and styling
// only -- it does not decide which pages carry a rail (see each entry's
// `rail` flag, unchanged from before this pass).
import { mount as mountRail } from "./rail.js";

// MIRRORS config/pages.json, which is the source of truth. Kept in sync by
// tests/kit-primitives.test.js -- a divergence between the two is the same
// producer/consumer duplication that discarded every media slot name.
export const NAV_GROUPS = ['Operate', 'Produce', 'Know'];

export const PAGES = [
  // Operate
  { id: "work", title: "Ingestion Hub", path: "/", rail: true, group: "Operate", endpoint: "/api/work/items" },
  { id: "sites", title: "Sites", path: "/sites", rail: false, group: "Operate", endpoint: "/api/portfolio" },
  { id: "site-view", title: "Editor", path: "/site", rail: true, group: "Operate", endpoint: "/api/sites/current" },
  { id: "proofs", title: "Proofs", path: "/proofs", rail: false, group: "Operate", endpoint: "/api/proofs" },

  // Produce
  { id: "applications", title: "Applications", path: "/applications", rail: false, group: "Produce", endpoint: "/api/applications" },
  { id: "deployments", title: "Deployments", path: "/deployments", rail: true, group: "Produce", endpoint: "/api/deployments" },
  { id: "media", title: "Media", path: "/media", rail: false, group: "Produce", endpoint: "/api/media" },
  { id: "components", title: "Components", path: "/components", rail: false, group: "Produce", endpoint: "/api/components" },
  { id: "seo", title: "SEO", path: "/seo", rail: false, group: "Produce", endpoint: "/api/seo" },
  { id: "gate", title: "Quality Gate", path: "/gate", rail: false, group: "Produce", endpoint: "/api/gate" },
  { id: "builds", title: "Build run", path: "/builds", rail: true, group: "Produce", endpoint: "/api/builds" },
  { id: "automations", title: "Shay's Skills Leash", path: "/automations", rail: false, group: "Produce", endpoint: "/api/automations" },
  { id: "shadow", title: "Shadow Runs", path: "/shadow", rail: false, group: "Produce", endpoint: "/api/shadow/runs" },

  // Know
  { id: "settings", title: "Settings / Admin", path: "/settings", rail: false, group: "Know", endpoint: "/api/admin/paths" },
];

// Minimal line-icon set, one per nav destination. Purely decorative --
// 24x24 viewBox, stroke=currentColor, matching the mockup's nav-item svg
// convention. No icon implies a claim about data; these are static shapes.
const NAV_ICONS = {
  work: '<rect x="3" y="3" width="7" height="9" rx="1"/><rect x="14" y="3" width="7" height="5" rx="1"/><rect x="14" y="12" width="7" height="9" rx="1"/><rect x="3" y="16" width="7" height="5" rx="1"/>',
  sites: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c2.5 2.6 4 5.7 4 9s-1.5 6.4-4 9c-2.5-2.6-4-5.7-4-9s1.5-6.4 4-9z"/>',
  "site-view": '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 9h18"/>',
  applications: '<path d="M21 8l-9 6-9-6"/><rect x="3" y="5" width="18" height="14" rx="2"/>',
  proofs: '<path d="M9 12l2 2 4-4"/><rect x="3" y="3" width="18" height="18" rx="2"/>',
  deployments: '<path d="M12 19V5M5 12l7-7 7 7"/>',
  media: '<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5L5 21"/>',
  components: '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>',
  seo: '<circle cx="11" cy="11" r="7"/><path d="M21 21l-4.35-4.35M11 8v6M8 11h6"/>',
  gate: '<path d="M12 3l8 3.5v5c0 5-3.4 8.5-8 10-4.6-1.5-8-5-8-10v-5z"/><path d="M9 12l2 2 4-4"/>',
  builds: '<path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.2 2.2M16.2 16.2l2.2 2.2M5.6 18.4l2.2-2.2M16.2 7.8l2.2-2.2"/><circle cx="12" cy="12" r="3.5"/>',
  automations: '<path d="M13 2 4 14h6l-1 8 9-12h-6z"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.9 2.9l-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.6V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.6 1.7 1.7 0 0 0-1.9.3l-.1.1a2 2 0 1 1-2.9-2.9l.1-.1a1.7 1.7 0 0 0 .3-1.9 1.7 1.7 0 0 0-1.6-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.6-1 1.7 1.7 0 0 0-.3-1.9l-.1-.1a2 2 0 1 1 2.9-2.9l.1.1a1.7 1.7 0 0 0 1.9.3H9a1.7 1.7 0 0 0 1-1.6V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.6 1.7 1.7 0 0 0 1.9-.3l.1-.1a2 2 0 1 1 2.9 2.9l-.1.1a1.7 1.7 0 0 0-.3 1.9V9a1.7 1.7 0 0 0 1.6 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.6 1z"/>',
};

function svgIcon(pageId) {
  const inner = NAV_ICONS[pageId] || '<circle cx="12" cy="12" r="8"/>';
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-width", "2");
  svg.setAttribute("stroke-linecap", "round");
  svg.setAttribute("stroke-linejoin", "round");
  svg.setAttribute("aria-hidden", "true");
  svg.innerHTML = inner;
  return svg;
}

function buildTopbar(page) {
  const topbar = document.createElement("header");
  topbar.className = "topbar";

  const brand = document.createElement("div");
  brand.className = "brand";
  const orb = document.createElement("div");
  orb.className = "orb";
  orb.setAttribute("aria-hidden", "true");
  const name = document.createElement("span");
  name.className = "brand__name";
  name.textContent = "SITE STUDIO";
  const sub = document.createElement("span");
  sub.className = "brand__sub";
  sub.textContent = "powered by Shay";
  brand.append(orb, name, sub);

  const spacer = document.createElement("div");
  spacer.className = "topbar__spacer";

  // Active Site Switcher & Root chip
  const params = new URLSearchParams(window.location.search);
  const currentSite = params.get("site_id");

  const siteChip = document.createElement("div");
  siteChip.className = "env-chip site-chip";
  const rootLabel = document.createElement("span");
  rootLabel.textContent = "sites root: ";
  const rootPath = document.createElement("b");
  rootPath.textContent = "~/FAMtastic/sites";
  siteChip.append(rootLabel, rootPath);

  if (currentSite) {
    const divider = document.createElement("span");
    divider.textContent = " · ";
    const activeBadge = document.createElement("span");
    activeBadge.className = "active-site-tag";
    activeBadge.textContent = currentSite;
    siteChip.append(divider, activeBadge);
  }

  const newSiteBtn = document.createElement("a");
  newSiteBtn.href = "/builds";
  newSiteBtn.className = "btn btn--pri topbar__newsite-btn";
  newSiteBtn.textContent = "＋ New site";

  const cmdkBtn = document.createElement("button");
  cmdkBtn.type = "button";
  cmdkBtn.className = "topbar__cmdk-btn";
  cmdkBtn.setAttribute("aria-label", "Command palette");
  cmdkBtn.innerHTML = `<span>Ask Shay anything</span> <kbd>⌘K</kbd>`;
  cmdkBtn.addEventListener("click", () => {
    window.dispatchEvent(new CustomEvent("site-studio:open-palette"));
  });

  const envChip = document.createElement("div");
  envChip.className = "env-chip";
  const strong = document.createElement("b");
  strong.textContent = "single-operator";
  envChip.append(strong, document.createTextNode(" · local"));

  topbar.append(brand, spacer, siteChip, newSiteBtn, cmdkBtn, envChip);
  return topbar;
}

function buildNav(currentId) {
  const nav = document.createElement("nav");
  nav.className = "shell__nav";
  nav.setAttribute("aria-label", "Primary");

  const brand = document.createElement("div");
  brand.className = "shell__nav-brand";
  brand.textContent = "Console";
  nav.appendChild(brand);

  // Grouped Navigation (Two-Tier Structure)
  for (const groupName of NAV_GROUPS) {
    const groupPages = PAGES.filter((p) => p.group === groupName);
    if (!groupPages.length) continue;

    const groupTitle = document.createElement("div");
    groupTitle.className = "shell__nav-group-title";
    groupTitle.textContent = groupName;
    nav.appendChild(groupTitle);

    const list = document.createElement("ul");
    list.className = "shell__nav-list";

    for (const page of groupPages) {
      const li = document.createElement("li");
      const a = document.createElement("a");
      a.className = "shell__nav-link";
      a.href = page.path;
      a.appendChild(svgIcon(page.id));
      a.appendChild(document.createTextNode(page.title));
      if (page.id === currentId) a.setAttribute("aria-current", "page");
      li.appendChild(a);
      list.appendChild(li);
    }
    nav.appendChild(list);
  }

  // Emergency brake killswitch card at bottom of nav
  const killCard = document.createElement("div");
  killCard.className = "shell__killcard";
  const killTitle = document.createElement("div");
  killTitle.className = "shell__killcard-title";
  killTitle.textContent = "Emergency Brake";
  const killDesc = document.createElement("div");
  killDesc.className = "shell__killcard-desc";
  killDesc.textContent = "Pause background cron & workers";
  const killBtn = document.createElement("button");
  killBtn.type = "button";
  killBtn.className = "btn btn--sm shell__killbtn";
  killBtn.textContent = "Freeze all jobs";
  let frozen = false;
  killBtn.addEventListener("click", () => {
    frozen = !frozen;
    killBtn.textContent = frozen ? "Resume all jobs" : "Freeze all jobs";
    killBtn.classList.toggle("btn--warn", frozen);
  });
  killCard.append(killTitle, killDesc, killBtn);
  nav.appendChild(killCard);

  return nav;
}

function buildPageHead(page) {
  const head = document.createElement("div");
  head.className = "page-head";
  const h1 = document.createElement("h1");
  h1.textContent = page.title;
  head.appendChild(h1);
  return head;
}

function buildCmdbar() {
  const bar = document.createElement("div");
  bar.className = "cmdbar";

  const prompt = document.createElement("span");
  prompt.className = "prompt";
  prompt.textContent = "shay ›";

  const input = document.createElement("input");
  input.id = "cmdinput";
  input.type = "text";
  input.placeholder = "Tell Shay what to do — she'll show you the plan before touching anything";
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && input.value.trim()) {
      const val = input.value.trim();
      input.value = "";
      openPalette(val);
    }
  });

  const hint = document.createElement("span");
  hint.className = "hint";
  hint.textContent = "↵ to preview plan · nothing executes without your confirm";

  bar.append(prompt, input, hint);
  return bar;
}

export function mountPalette() {
  let overlay = document.getElementById("overlay");
  if (overlay) return;

  overlay = document.createElement("div");
  overlay.id = "overlay";
  overlay.className = "overlay";
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) closePalette();
  });

  overlay.innerHTML = `
    <div class="palette">
      <div class="pin">
        <div class="orb" style="width:16px;height:16px" aria-hidden="true"></div>
        <input id="palinput" placeholder="Ask Shay, jump to a site, or run a skill…" autocomplete="off">
        <kbd>esc</kbd>
      </div>
      <div id="palDefault">
        <div class="sect">Suggested</div>
        <div class="pcmd" data-cmd="seo">
          <div class="ic">✦</div>
          <div><div class="t">Fix all red SEO checklist items</div><div class="d">site.audit → meta description, 6 alt texts</div></div>
          <span class="cap">seo.update</span>
        </div>
        <div class="pcmd" data-cmd="newsite">
          <div class="ic">＋</div>
          <div><div class="t">Build a new site from a prompt</div><div class="d">conversational build · proposal-first</div></div>
          <span class="cap">site.create</span>
        </div>
        <div class="sect">Jump to</div>
        <div class="pcmd" data-nav="/"><div class="ic">◈</div><div><div class="t">Ingestion Hub</div><div class="d">Live briefs waiting</div></div></div>
        <div class="pcmd" data-nav="/sites"><div class="ic">◉</div><div><div class="t">All sites</div><div class="d">Portfolio grid</div></div></div>
        <div class="pcmd" data-nav="/builds"><div class="ic">⚡</div><div><div class="t">Builds & Pipeline</div><div class="d">Batch runner & stage logs</div></div></div>
      </div>
      <div class="planprev" id="planPrev" style="display:none">
        <div class="h">✦ Shay's plan preview — confirm before anything runs</div>
        <div style="font-size:13px;font-weight:600;margin-bottom:8px" id="planTitle"></div>
        <ul id="planSteps"></ul>
        <div class="acts">
          <button class="btn btn--pri" id="palConfirmBtn" style="padding:8px 16px;font-size:12px">Confirm — run it</button>
          <button class="btn" id="palCancelBtn" style="padding:8px 16px;font-size:12px">Cancel</button>
        </div>
      </div>
    </div>
  `;

  document.body.appendChild(overlay);

  const palInput = overlay.querySelector("#palinput");
  palInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && palInput.value.trim()) {
      showPlan(`"${palInput.value.trim()}"`, [
        "brain.parse → extract intent, business & offer",
        "pipeline.spec → derive site spec & tokens",
        "pipeline.compose → generate pages & layout",
        "verify.qa → quality gates & live preview"
      ]);
    }
  });

  overlay.querySelectorAll(".pcmd[data-nav]").forEach((el) => {
    el.addEventListener("click", () => {
      closePalette();
      window.location.href = el.dataset.nav;
    });
  });

  const newsiteCmd = overlay.querySelector('.pcmd[data-cmd="newsite"]');
  if (newsiteCmd) {
    newsiteCmd.addEventListener("click", () => {
      showPlan("Build a new site from a prompt", [
        "site.create → scaffold from template & brief",
        "brain.draft → copy + layout from prompt",
        "stage → live preview in canvas editor"
      ]);
    });
  }

  const seoCmd = overlay.querySelector('.pcmd[data-cmd="seo"]');
  if (seoCmd) {
    seoCmd.addEventListener("click", () => {
      showPlan("Fix all red SEO checklist items", [
        "seo.update → meta descriptions & title tags",
        "media.optimize → missing image alt texts",
        "gate.verify → assert 100% SEO pass"
      ]);
    });
  }

  const confirmBtn = overlay.querySelector("#palConfirmBtn");
  if (confirmBtn) {
    confirmBtn.addEventListener("click", async () => {
      const title = overlay.querySelector("#planTitle").textContent;
      closePalette();
      const prompt = palInput.value.trim() || title;
      try {
        const resp = await fetch("/api/shay/ask", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ prompt }),
        });
        const data = await resp.json().catch(() => ({}));
        if (data.site_id) {
          window.location.href = `/site?site_id=${encodeURIComponent(data.site_id)}&tab=canvas`;
        }
      } catch {
        // Fallback
      }
    });
  }

  const cancelBtn = overlay.querySelector("#palCancelBtn");
  if (cancelBtn) {
    cancelBtn.addEventListener("click", resetPalette);
  }
}

export function openPalette(seed = "") {
  mountPalette();
  const overlay = document.getElementById("overlay");
  if (!overlay) return;
  overlay.classList.add("open");
  resetPalette();
  const inp = document.getElementById("palinput");
  if (inp) {
    inp.value = seed || "";
    inp.focus();
    if (seed) {
      showPlan(`"${seed}"`, [
        "brain.parse → intent + target business",
        "pipeline.build → deterministic step list",
        "stage → shadow preview, canvas diff for review"
      ]);
    }
  }
}

export function closePalette() {
  const overlay = document.getElementById("overlay");
  if (overlay) overlay.classList.remove("open");
}

function resetPalette() {
  const prev = document.getElementById("planPrev");
  const def = document.getElementById("palDefault");
  if (prev) prev.style.display = "none";
  if (def) def.style.display = "block";
}

function showPlan(title, steps) {
  const def = document.getElementById("palDefault");
  const prev = document.getElementById("planPrev");
  const titleEl = document.getElementById("planTitle");
  const stepsEl = document.getElementById("planSteps");
  if (def) def.style.display = "none";
  if (prev) prev.style.display = "block";
  if (titleEl) titleEl.textContent = title;
  if (stepsEl) {
    stepsEl.innerHTML = steps.map((s) => {
      const parts = s.split("→");
      return `<li><span class="cap2">${parts[0].trim()}</span>${parts[1] ? " → " + parts[1].trim() : ""}</li>`;
    }).join("");
  }
}

// Global hotkeys
if (typeof window !== "undefined") {
  window.addEventListener("keydown", (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
      e.preventDefault();
      const overlay = document.getElementById("overlay");
      if (overlay && overlay.classList.contains("open")) closePalette();
      else openPalette();
    }
    if (e.key === "Escape") closePalette();
  });

  window.addEventListener("site-studio:open-palette", () => {
    openPalette();
  });
}

// The rail is a live workspace panel (kit/rail.js): real per-site
// conversation history, typed cards rendered structurally, and a composer.
// This function only creates the <aside> synchronously (so it is present in
// the DOM the instant the page renders -- the smoke check looks for
// `.shell__rail` without waiting on a network round trip) and hands it to
// rail.js to fill in. Whatever rail.js cannot yet show honestly (no site
// selected, no provider configured) it states plainly itself; this function
// makes no claim about Shay's state.
function buildRail() {
  const rail = document.createElement("aside");
  rail.className = "shell__rail";
  rail.setAttribute("aria-label", "Shay");
  mountRail(rail, {}).catch((error) => {
    rail.innerHTML = "";
    const errorBox = document.createElement("div");
    errorBox.className = "region__status region__status--error";
    errorBox.textContent = `Shay rail failed to load: ${error.message}`;
    rail.appendChild(errorBox);
  });
  return rail;
}

// render({ pageId }) builds the shell chrome into document.body and returns
// the <main id="root"> element already present in the page HTML, having
// moved it inside the grid layout.
export function render({ pageId }) {
  const page = PAGES.find((p) => p.id === pageId);
  if (!page) throw new Error(`shell.render: unknown pageId "${pageId}"`);

  const existingMain = document.getElementById("root");
  if (!existingMain) throw new Error('shell.render: page is missing <main id="root">');

  const shell = document.createElement("div");
  shell.className = page.rail ? "shell has-rail" : "shell";

  shell.appendChild(buildTopbar(page));
  shell.appendChild(buildNav(page.id));

  existingMain.className = "shell__main";
  existingMain.prepend(buildPageHead(page));
  shell.appendChild(existingMain);

  if (page.rail) shell.appendChild(buildRail());

  shell.appendChild(buildCmdbar());

  document.body.innerHTML = "";
  document.body.appendChild(shell);
  mountPalette();

  return existingMain;
}

export function getPage(pageId) {
  return PAGES.find((p) => p.id === pageId) || null;
}
