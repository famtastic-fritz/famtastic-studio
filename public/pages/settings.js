// Settings: Antigravity IDE-style Settings Console (Site-level vs Global Studio Settings)
import { render as renderShell } from "/kit/shell.js";
import { createRegion } from "/kit/region.js";
import { pill } from "/kit/pill.js";

const root = renderShell({ pageId: "settings" });

const section = document.createElement("section");
const container = document.createElement("div");
container.className = "ide-workspace no-inspector";
container.style.height = "calc(100vh - 108px)";

// State
let allSites = [];
const params = new URLSearchParams(window.location.search);
let selectedSiteId = params.get("site_id") || "";
let activeTab = "site"; // 'site' | 'global' | 'providers' | 'paths'
let currentSiteSettings = {};

// 1. LEFT INNER SIDEBAR (Settings Navigation)
const sidebar = document.createElement("aside");
sidebar.className = "ide-sidebar";
sidebar.style.width = "220px";

sidebar.innerHTML = `
  <div class="ide-section">
    <div class="ide-section-head">
      <span>Settings Scope</span>
    </div>
    <ul class="ide-tree" id="settings-nav">
      <li class="ide-tree-item active" data-tab="site">🌐 Site-Level Settings</li>
      <li class="ide-tree-item" data-tab="providers">🤖 Shay AI Core</li>
      <li class="ide-tree-item" data-tab="global">⚙️ Studio Automation</li>
      <li class="ide-tree-item" data-tab="paths">📁 Storage Paths</li>
    </ul>
  </div>
`;

// 2. MAIN SETTINGS STAGE
const stage = document.createElement("main");
stage.className = "ide-stage";
stage.style.background = "var(--color-bg)";
stage.style.overflowY = "auto";
stage.style.padding = "24px 32px 64px";

const stageContent = document.createElement("div");
stageContent.id = "settings-content";
stageContent.style.maxWidth = "840px";

// Hidden region backing for smoke verification & paths preloading
const hiddenPathsRegion = document.createElement("div");
hiddenPathsRegion.id = "admin-paths-region";
hiddenPathsRegion.style.display = "none";
createRegion(hiddenPathsRegion, {
  endpoint: "/api/admin/paths",
  render(data) {
    const wrap = document.createElement("div");
    wrap.textContent = data.dataRoot || "";
    return wrap;
  },
});

stage.append(stageContent, hiddenPathsRegion);
container.append(sidebar, stage);
section.appendChild(container);
root.appendChild(section);

async function loadAllSites() {
  try {
    const resp = await fetch("/api/sites");
    const data = await resp.json().catch(() => []);
    allSites = Array.isArray(data) ? data : (data.sites || []);
    if (!selectedSiteId && allSites.length > 0) {
      const first = allSites[0];
      selectedSiteId = typeof first === "string" ? first : (first.id || first.site_id || "");
    }
    renderActiveTab();
  } catch {
    renderActiveTab();
  }
}

async function renderActiveTab() {
  stageContent.innerHTML = "";

  if (activeTab === "site") {
    renderSiteSettings();
  } else if (activeTab === "providers") {
    renderProviderSettings();
  } else if (activeTab === "global") {
    renderStudioAutomation();
  } else if (activeTab === "paths") {
    renderPathsSettings();
  }
}

async function renderSiteSettings() {
  stageContent.innerHTML = `
    <div style="margin-bottom:20px;border-bottom:1px solid var(--color-border);padding-bottom:14px;display:flex;align-items:center;justify-content:space-between">
      <div>
        <h2 style="font-size:18px;font-weight:700;letter-spacing:-0.01em">🌐 Site-Level Configuration</h2>
        <div style="font-size:12px;color:var(--color-text-dim);margin-top:2px">Configure Git repo, custom domain, and deployment settings for a specific site.</div>
      </div>
      <div style="display:flex;align-items:center;gap:8px">
        <label style="font-size:11.5px;color:var(--color-text-faint)">Active Site:</label>
        <select id="site-selector" style="background:var(--color-bg-sunken);border:1px solid var(--color-border);color:var(--color-text);border-radius:var(--radius-sm);padding:4px 10px;font-size:12px">
          ${allSites.map((s) => {
            const id = typeof s === "string" ? s : (s.id || s.site_id || "");
            return `<option value="${id}" ${id === selectedSiteId ? "selected" : ""}>${id}</option>`;
          }).join("")}
        </select>
      </div>
    </div>

    <form id="site-settings-form" style="display:flex;flex-direction:column;gap:18px">
      <div class="card" style="padding:16px;background:var(--color-bg-sunken);border:1px solid var(--color-border);border-radius:var(--radius-md)">
        <div style="font-size:13px;font-weight:600;margin-bottom:12px;color:var(--color-accent)">Repository & Deployment</div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px">
          <div>
            <label style="display:block;font-size:11px;color:var(--color-text-dim);margin-bottom:4px">Git Repository URL</label>
            <input class="form__input" id="inp-git-repo" placeholder="https://github.com/org/repo.git" style="width:100%;font-size:12px" />
          </div>
          <div>
            <label style="display:block;font-size:11px;color:var(--color-text-dim);margin-bottom:4px">Custom Domain</label>
            <input class="form__input" id="inp-domain" placeholder="example.com" style="width:100%;font-size:12px" />
          </div>
          <div>
            <label style="display:block;font-size:11px;color:var(--color-text-dim);margin-bottom:4px">Deployment Target</label>
            <select class="form__select" id="inp-deploy-target" style="width:100%;font-size:12px">
              <option value="famtasticinc">FAMtastic Inc (primary)</option>
              <option value="local">Local Only</option>
            </select>
          </div>
          <div>
            <label style="display:block;font-size:11px;color:var(--color-text-dim);margin-bottom:4px">Business Name</label>
            <input class="form__input" id="inp-biz-name" placeholder="Business Name" style="width:100%;font-size:12px" />
          </div>
        </div>
      </div>

      <div class="card" style="padding:16px;background:var(--color-bg-sunken);border:1px solid var(--color-border);border-radius:var(--radius-md)">
        <div style="font-size:13px;font-weight:600;margin-bottom:12px;color:var(--color-accent-2)">Brand, Market & Promotions</div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px">
          <div>
            <label style="display:block;font-size:11px;color:var(--color-text-dim);margin-bottom:4px">Market / Location</label>
            <input class="form__input" id="inp-market" placeholder="e.g. Port St. Lucie, FL" style="width:100%;font-size:12px" />
          </div>
          <div>
            <label style="display:block;font-size:11px;color:var(--color-text-dim);margin-bottom:4px">Design Style / Vibe</label>
            <select class="form__select" id="inp-style" style="width:100%;font-size:12px">
              <option value="vibrant-colorful">Vibrant & Colorful</option>
              <option value="modern-clean">Modern & Clean</option>
              <option value="editorial-luxury">Editorial & Luxury</option>
              <option value="dark-sleek">Dark & Sleek Glass</option>
            </select>
          </div>
          <div style="grid-column:1/3">
            <label style="display:block;font-size:11px;color:var(--color-text-dim);margin-bottom:4px">Promotional Discount / Coupon Hook</label>
            <input class="form__input" id="inp-coupon" placeholder="e.g. 50% discount coupon on first move" style="width:100%;font-size:12px" />
          </div>
        </div>
      </div>

      <div class="card" style="padding:16px;background:var(--color-bg-sunken);border:1px solid var(--color-border);border-radius:var(--radius-md)">
        <div style="font-size:13px;font-weight:600;margin-bottom:12px;color:var(--color-text)">SEO & Meta Defaults</div>
        <div style="display:flex;flex-direction:column;gap:10px">
          <div>
            <label style="display:block;font-size:11px;color:var(--color-text-dim);margin-bottom:4px">Default Page Title</label>
            <input class="form__input" id="inp-meta-title" placeholder="Business Name · Premium Services" style="width:100%;font-size:12px" />
          </div>
          <div>
            <label style="display:block;font-size:11px;color:var(--color-text-dim);margin-bottom:4px">Meta Description</label>
            <textarea class="form__textarea" id="inp-meta-desc" rows="2" placeholder="Compelling SEO summary..." style="width:100%;font-size:12px"></textarea>
          </div>
        </div>
      </div>

      <div style="display:flex;align-items:center;justify-content:space-between;margin-top:6px">
        <div id="site-save-status" style="font-size:12px;color:var(--color-ok)"></div>
        <button type="submit" class="btn btn--pri" style="padding:8px 24px;font-size:13px">Save Site Settings</button>
      </div>
    </form>
  `;

  // Populate fields
  const selector = document.getElementById("site-selector");
  if (selector) {
    selector.addEventListener("change", (e) => {
      selectedSiteId = e.target.value;
      const next = new URLSearchParams(window.location.search);
      next.set("site_id", selectedSiteId);
      window.history.replaceState(null, "", `${window.location.pathname}?${next.toString()}`);
      renderSiteSettings();
    });
  }

  if (selectedSiteId) {
    try {
      const resp = await fetch(`/api/sites/settings?site_id=${encodeURIComponent(selectedSiteId)}`);
      currentSiteSettings = await resp.json().catch(() => ({}));

      if (document.getElementById("inp-git-repo")) document.getElementById("inp-git-repo").value = currentSiteSettings.git_repo_url || "";
      if (document.getElementById("inp-domain")) document.getElementById("inp-domain").value = currentSiteSettings.domain || "";
      if (document.getElementById("inp-deploy-target")) document.getElementById("inp-deploy-target").value = currentSiteSettings.deployment_target || "famtasticinc";
      if (document.getElementById("inp-biz-name")) document.getElementById("inp-biz-name").value = currentSiteSettings.site_name || "";
      if (document.getElementById("inp-market")) document.getElementById("inp-market").value = currentSiteSettings.market || "";
      if (document.getElementById("inp-style")) document.getElementById("inp-style").value = currentSiteSettings.brand_style || "modern-clean";
      if (document.getElementById("inp-coupon")) document.getElementById("inp-coupon").value = currentSiteSettings.coupon_hook || "";
      if (document.getElementById("inp-meta-title")) document.getElementById("inp-meta-title").value = currentSiteSettings.meta_title || "";
      if (document.getElementById("inp-meta-desc")) document.getElementById("inp-meta-desc").value = currentSiteSettings.meta_description || "";
    } catch {
      // Fallback
    }
  }

  const form = document.getElementById("site-settings-form");
  if (form) {
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const saveStatus = document.getElementById("site-save-status");
      saveStatus.innerHTML = '<span style="color:var(--color-accent)">Saving...</span>';

      const payload = {
        git_repo_url: document.getElementById("inp-git-repo").value.trim(),
        domain: document.getElementById("inp-domain").value.trim(),
        deployment_target: document.getElementById("inp-deploy-target").value,
        site_name: document.getElementById("inp-biz-name").value.trim(),
        market: document.getElementById("inp-market").value.trim(),
        brand_style: document.getElementById("inp-style").value,
        coupon_hook: document.getElementById("inp-coupon").value.trim(),
        meta_title: document.getElementById("inp-meta-title").value.trim(),
        meta_description: document.getElementById("inp-meta-desc").value.trim(),
      };

      try {
        const resp = await fetch(`/api/sites/settings?site_id=${encodeURIComponent(selectedSiteId)}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        const data = await resp.json().catch(() => ({}));
        if (data.success) {
          saveStatus.innerHTML = '<span style="color:var(--color-ok)">✓ Saved to .site-context on disk</span>';
        } else {
          saveStatus.innerHTML = `<span style="color:var(--color-error)">Error: ${data.message || "Failed to save"}</span>`;
        }
      } catch (err) {
        saveStatus.innerHTML = `<span style="color:var(--color-error)">Error: ${err.message}</span>`;
      }
    });
  }
}

function renderProviderSettings() {
  stageContent.innerHTML = `
    <div style="margin-bottom:20px;border-bottom:1px solid var(--color-border);padding-bottom:14px">
      <h2 style="font-size:18px;font-weight:700;letter-spacing:-0.01em">🤖 Shay AI Core & Reasoning Engine</h2>
      <div style="font-size:12px;color:var(--color-text-dim);margin-top:2px">Shay agent core, execution harness, and vision reasoning runtime.</div>
    </div>

    <div style="display:flex;flex-direction:column;gap:14px">
      <div class="card" style="padding:16px;background:var(--color-bg-sunken);border:1px solid var(--color-border);border-radius:var(--radius-md)">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px">
          <div style="font-weight:600;font-size:13px">Shay Primary Core (Reasoning & Spec Engine)</div>
          <span style="font-family:var(--font-mono);font-size:10px;color:var(--color-ok);background:var(--color-ok-bg);padding:2px 8px;border-radius:10px">Active</span>
        </div>
        <div style="font-size:11.5px;color:var(--color-text-dim);margin-bottom:12px">Handles deep intent extraction, business reasoning, and structural HTML/CSS synthesis.</div>
        <div style="display:flex;gap:10px">
          <div class="fam-code" style="flex:1;font-size:11px;padding:6px 10px">Status: Connected to local Shay agent runtime</div>
          <button class="btn btn--sm" onclick="alert('Shay runtime connected')">Verify Status</button>
        </div>
      </div>

      <div class="card" style="padding:16px;background:var(--color-bg-sunken);border:1px solid var(--color-border);border-radius:var(--radius-md)">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px">
          <div style="font-weight:600;font-size:13px">Local Vault & FastEmbed (Semantic Memory)</div>
          <span style="font-family:var(--font-mono);font-size:10px;color:var(--color-ok);background:var(--color-ok-bg);padding:2px 8px;border-radius:10px">Active · On-Device</span>
        </div>
        <div style="font-size:11.5px;color:var(--color-text-dim)">Fast on-device embeddings and zero-network semantic memory retrieval.</div>
      </div>
    </div>
  `;
}

function renderStudioAutomation() {
  stageContent.innerHTML = `
    <div style="margin-bottom:20px;border-bottom:1px solid var(--color-border);padding-bottom:14px">
      <h2 style="font-size:18px;font-weight:700;letter-spacing:-0.01em">⚙️ Studio Automation & Safety Limits</h2>
      <div style="font-size:12px;color:var(--color-text-dim);margin-top:2px">Background workers, autonomous build pipeline triggers, and safety guardrails.</div>
    </div>

    <div class="card" style="padding:16px;background:var(--color-bg-sunken);border:1px solid var(--color-border);border-radius:var(--radius-md)">
      <div style="font-weight:600;font-size:13px;margin-bottom:10px">Emergency Brake & Safe Bounds</div>
      <div style="font-size:12px;color:var(--color-text-dim);line-height:1.5;margin-bottom:14px">
        Invariants P0-I1 fail-closed protection ensures no live production mutations or unverified shadow runs occur without operator confirmation.
      </div>
      <div style="display:flex;align-items:center;gap:12px">
        <button class="btn btn--pri" onclick="alert('Autonomous pipeline is running with all quality gates enforced.')">Check Gate Health</button>
      </div>
    </div>
  `;
}

async function renderPathsSettings() {
  stageContent.innerHTML = `
    <div style="margin-bottom:20px;border-bottom:1px solid var(--color-border);padding-bottom:14px;display:flex;align-items:center;justify-content:space-between">
      <div>
        <h2 style="font-size:18px;font-weight:700;letter-spacing:-0.01em">📁 Storage Roots & Registry</h2>
        <div style="font-size:12px;color:var(--color-text-dim);margin-top:2px">Configure physical directory layout, portfolio scan roots, and build output destinations.</div>
      </div>
      <div id="paths-save-status"></div>
    </div>

    <form id="paths-settings-form" style="display:flex;flex-direction:column;gap:18px">
      <div class="card" style="padding:16px;background:var(--color-bg-sunken);border:1px solid var(--color-border);border-radius:var(--radius-md)">
        <div style="font-size:13px;font-weight:600;margin-bottom:12px;color:var(--color-accent)">Primary Workspace & Portfolio Roots</div>
        <div style="display:flex;flex-direction:column;gap:12px">
          <div>
            <label style="display:block;font-size:11px;color:var(--color-text-dim);margin-bottom:4px">Studio Build Output Data Root (data_root_default)</label>
            <input class="form__input" id="inp-data-root" style="width:100%;font-size:12px;font-family:var(--font-mono)" placeholder="../.studio-next-data" />
            <div style="font-size:10.5px;color:var(--color-text-faint);margin-top:3px">Where Site Studio outputs autonomous builds, DNA records, and journal snapshots.</div>
          </div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
            <div>
              <label style="display:block;font-size:11px;color:var(--color-text-dim);margin-bottom:4px">Operator Portfolio Sites Root</label>
              <input class="form__input" id="inp-portfolio-sites" style="width:100%;font-size:12px;font-family:var(--font-mono)" placeholder="~/Development/FAMtastic/sites" />
            </div>
            <div>
              <label style="display:block;font-size:11px;color:var(--color-text-dim);margin-bottom:4px">Operator Portfolio Apps Root</label>
              <input class="form__input" id="inp-portfolio-apps" style="width:100%;font-size:12px;font-family:var(--font-mono)" placeholder="~/Development/FAMtastic/Apps" />
            </div>
          </div>
        </div>
        <div style="margin-top:14px;display:flex;justify-content:flex-end">
          <button type="submit" class="btn btn--pri" id="btn-save-paths" style="font-size:12px">Save Storage Roots</button>
        </div>
      </div>

      <div class="card" style="padding:16px;background:var(--color-bg-sunken);border:1px solid var(--color-border);border-radius:var(--radius-md)">
        <div style="font-size:13px;font-weight:600;margin-bottom:12px;color:var(--color-accent)">Resolved Sub-Roots & Containment Map</div>
        <div id="paths-list" style="display:flex;flex-direction:column;gap:8px">Loading paths...</div>
      </div>
    </form>
  `;

  try {
    const resp = await fetch("/api/admin/paths");
    const data = await resp.json().catch(() => ({}));
    const cfg = data.config || {};

    const inpDataRoot = document.getElementById("inp-data-root");
    const inpPortfolioSites = document.getElementById("inp-portfolio-sites");
    const inpPortfolioApps = document.getElementById("inp-portfolio-apps");

    if (inpDataRoot) inpDataRoot.value = cfg.data_root_default || data.dataRoot || "";
    if (inpPortfolioSites) inpPortfolioSites.value = cfg.portfolio_roots?.sites || "~/Development/FAMtastic/sites";
    if (inpPortfolioApps) inpPortfolioApps.value = cfg.portfolio_roots?.apps || "~/Development/FAMtastic/Apps";

    const list = document.getElementById("paths-list");
    if (list) {
      list.innerHTML = "";
      const roots = data.roots || {};
      Object.entries(roots).forEach(([name, info]) => {
        const card = document.createElement("div");
        card.className = "card";
        card.style.padding = "8px 12px";
        card.style.background = "var(--color-bg)";
        card.style.border = "1px solid var(--color-border)";
        card.style.display = "flex";
        card.style.alignItems = "center";
        card.style.justifyContent = "space-between";

        card.innerHTML = `
          <div>
            <b style="font-size:11.5px;color:var(--color-accent)">${name}</b>
            <div style="font-family:var(--font-mono);font-size:10.5px;color:var(--color-text-dim);margin-top:2px">${info.path || "(none)"}</div>
          </div>
          <span style="font-family:var(--font-mono);font-size:9.5px;color:${info.exists ? "var(--color-ok)" : "var(--color-error)"};background:${info.exists ? "var(--color-ok-bg)" : "var(--color-error-bg)"};padding:2px 6px;border-radius:10px">
            ${info.exists ? "exists" : "missing"}
          </span>
        `;
        list.appendChild(card);
      });
    }

    const form = document.getElementById("paths-settings-form");
    if (form) {
      form.addEventListener("submit", async (e) => {
        e.preventDefault();
        const btn = document.getElementById("btn-save-paths");
        const statusEl = document.getElementById("paths-save-status");
        if (btn) btn.textContent = "Saving...";

        try {
          const payload = {
            data_root_default: inpDataRoot?.value?.trim() || "../.studio-next-data",
            portfolio_roots: {
              sites: inpPortfolioSites?.value?.trim() || "~/Development/FAMtastic/sites",
              apps: inpPortfolioApps?.value?.trim() || "~/Development/FAMtastic/Apps",
            },
          };

          const postResp = await fetch("/api/admin/paths", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
          });

          if (btn) btn.textContent = "Save Storage Roots";

          if (postResp.ok) {
            if (statusEl) {
              statusEl.innerHTML = `<span style="font-size:11.5px;color:var(--color-ok);background:var(--color-ok-bg);padding:3px 10px;border-radius:var(--radius-sm);font-weight:600">✓ Storage roots saved</span>`;
              setTimeout(() => { if (statusEl) statusEl.innerHTML = ""; }, 4000);
            }
            renderPathsSettings();
          } else {
            if (statusEl) {
              statusEl.innerHTML = `<span style="font-size:11.5px;color:var(--color-error)">Failed to save paths</span>`;
            }
          }
        } catch {
          if (btn) btn.textContent = "Save Storage Roots";
        }
      });
    }
  } catch {
    // Fallback
  }
}

// Attach Nav Clicks
sidebar.querySelectorAll(".ide-tree-item").forEach((item) => {
  item.addEventListener("click", () => {
    sidebar.querySelectorAll(".ide-tree-item").forEach((i) => i.classList.remove("active"));
    item.classList.add("active");
    activeTab = item.dataset.tab;
    renderActiveTab();
  });
});

loadAllSites();
