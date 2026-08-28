// New Site Builder: prompt/brief-to-site factory (site-studio-console-v2.html #p-build)
// Collects business name, location, custom notes, and recipe target, then triggers
// the research-backed pipeline run with streaming telemetry.

export function renderNewSiteBuilder(options = {}) {
  const container = document.createElement("div");
  container.className = "new-site-grid";
  container.style.display = "grid";
  container.style.gridTemplateColumns = "340px 1fr";
  container.style.gap = "var(--space-4)";
  container.style.alignItems = "start";
  container.style.marginBottom = "var(--space-4)";

  // Left column: The Brief Form
  const briefCard = document.createElement("div");
  briefCard.className = "card";
  briefCard.style.padding = "var(--space-4)";

  const briefTitle = document.createElement("div");
  briefTitle.style.fontSize = "var(--text-xs)";
  briefTitle.style.fontWeight = "700";
  briefTitle.style.letterSpacing = "0.08em";
  briefTitle.style.textTransform = "uppercase";
  briefTitle.style.color = "var(--color-text-faint)";
  briefTitle.style.marginBottom = "var(--space-3)";
  briefTitle.textContent = "The Brief";

  const form = document.createElement("div");
  form.style.display = "flex";
  form.style.flexDirection = "column";
  form.style.gap = "var(--space-3)";

  form.innerHTML = `
    <div class="insp-field">
      <label style="display:block;font-size:11px;color:var(--color-text-dim);margin-bottom:4px">Business Name</label>
      <input id="ns-bname" style="width:100%;background:var(--color-bg-sunken);border:1px solid var(--color-border);border-radius:var(--radius-sm);padding:7px 10px;color:var(--color-text);font-size:var(--text-sm)" value="Kim Chang Suk Acupuncture" />
    </div>
    <div class="insp-field">
      <label style="display:block;font-size:11px;color:var(--color-text-dim);margin-bottom:4px">Location / Market</label>
      <input id="ns-bloc" style="width:100%;background:var(--color-bg-sunken);border:1px solid var(--color-border);border-radius:var(--radius-sm);padding:7px 10px;color:var(--color-text);font-size:var(--text-sm)" value="Port St. Lucie, FL" />
    </div>
    <div class="insp-field">
      <label style="display:block;font-size:11px;color:var(--color-text-dim);margin-bottom:4px">Notes / Directives (optional)</label>
      <textarea id="ns-bnote" style="width:100%;background:var(--color-bg-sunken);border:1px solid var(--color-border);border-radius:var(--radius-sm);padding:7px 10px;color:var(--color-text);font-size:var(--text-xs);min-height:54px;resize:vertical" placeholder="Leave blank — research will ground and derive the site spec automatically"></textarea>
    </div>
    <div class="insp-field">
      <label style="display:block;font-size:11px;color:var(--color-text-dim);margin-bottom:4px">Recipe Preset & Architecture</label>
      <select id="ns-recipe" style="width:100%;background:var(--color-bg-sunken);border:1px solid var(--color-border);border-radius:var(--radius-sm);padding:7px 10px;color:var(--color-text);font-size:var(--text-sm)">
        <optgroup label="📄 Static Web (v1.0.0)">
          <option value="minimal-hello-world">minimal-hello-world · 1-page blank canvas + tokens</option>
          <option value="standard-business" selected>standard-business · 3-page brochure (home, about, contact)</option>
          <option value="lead-gen-landing">lead-gen-landing · single landing page with hero, proof & CTA</option>
          <option value="creator-portfolio">creator-portfolio · multi-page portfolio, work & contact</option>
        </optgroup>
        <optgroup label="💧 Drupal CMS (v1.0.0)">
          <option value="drupal-standard-v1">drupal-standard-v1 · Standard Drupal + Custom Theme (Twig/CSS) + Docker</option>
          <option value="drupal-decoupled-tri-tier-v1">drupal-decoupled-tri-tier-v1 · Decoupled Tri-Tier (Drupal JSON:API + React Portal + React Frontend)</option>
        </optgroup>
        <optgroup label="🌐 WordPress CMS (v1.0.0)">
          <option value="wordpress-standard-v1">wordpress-standard-v1 · Standard WordPress + Custom PHP Theme + Docker</option>
          <option value="wordpress-decoupled-tri-tier-v1">wordpress-decoupled-tri-tier-v1 · Decoupled Tri-Tier (Headless WP + React Portal + React Frontend)</option>
        </optgroup>
      </select>
    </div>
  `;

  const runBtn = document.createElement("button");
  runBtn.type = "button";
  runBtn.className = "btn btn--pri";
  runBtn.style.width = "100%";
  runBtn.style.marginTop = "var(--space-2)";
  runBtn.textContent = "Start new site build";

  const hint = document.createElement("p");
  hint.style.fontSize = "11px";
  hint.style.color = "var(--color-text-faint)";
  hint.style.marginTop = "var(--space-2)";
  hint.style.marginBottom = "0";
  hint.textContent = "Autonomous build with full static assets (styles, main.js, package.json, README, 404, robots.txt).";

  briefCard.append(briefTitle, form, runBtn, hint);

  // Right column: Pipeline Progress & Live Preview Deck
  const rightDeck = document.createElement("div");
  rightDeck.style.display = "flex";
  rightDeck.style.flexDirection = "column";
  rightDeck.style.gap = "var(--space-3)";

  const pipelinePanel = document.createElement("div");
  pipelinePanel.className = "card";
  pipelinePanel.style.padding = "var(--space-4)";

  pipelinePanel.innerHTML = `
    <div style="display:flex;justify-content:space-between;font-size:var(--text-xs);font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:var(--color-text-faint);margin-bottom:var(--space-3)">
      <span>Autonomous Pipeline</span>
      <span id="pipeline-status-badge" style="font-family:var(--font-mono);font-size:10px;color:var(--color-ok)">READY</span>
    </div>
    <div class="pipeline-stages" style="display:flex;flex-direction:column;gap:6px">
      <div class="stage-row" id="stg-1" style="display:flex;align-items:center;gap:10px;padding:6px 10px;border-radius:6px;background:var(--color-bg-sunken);font-size:var(--text-sm)">
        <span style="font-family:var(--font-mono);font-size:10px;color:var(--color-accent)">01</span>
        <span style="flex:1">Research the business & brand voice</span>
        <span style="font-family:var(--font-mono);font-size:10px;color:var(--color-text-faint)">researcher</span>
      </div>
      <div class="stage-row" id="stg-2" style="display:flex;align-items:center;gap:10px;padding:6px 10px;border-radius:6px;background:var(--color-bg-sunken);font-size:var(--text-sm)">
        <span style="font-family:var(--font-mono);font-size:10px;color:var(--color-accent)">02</span>
        <span style="flex:1">Derive site spec & section archetypes</span>
        <span style="font-family:var(--font-mono);font-size:10px;color:var(--color-text-faint)">spec-composer</span>
      </div>
      <div class="stage-row" id="stg-3" style="display:flex;align-items:center;gap:10px;padding:6px 10px;border-radius:6px;background:var(--color-bg-sunken);font-size:var(--text-sm)">
        <span style="font-family:var(--font-mono);font-size:10px;color:var(--color-accent)">03</span>
        <span style="flex:1">Art direction, typography & palette</span>
        <span style="font-family:var(--font-mono);font-size:10px;color:var(--color-text-faint)">creative-director</span>
      </div>
      <div class="stage-row" id="stg-4" style="display:flex;align-items:center;gap:10px;padding:6px 10px;border-radius:6px;background:var(--color-bg-sunken);font-size:var(--text-sm)">
        <span style="font-family:var(--font-mono);font-size:10px;color:var(--color-accent)">04</span>
        <span style="flex:1">Compose semantic pages & complete assets</span>
        <span style="font-family:var(--font-mono);font-size:10px;color:var(--color-text-faint)">composer</span>
      </div>
      <div class="stage-row" id="stg-5" style="display:flex;align-items:center;gap:10px;padding:6px 10px;border-radius:6px;background:var(--color-bg-sunken);font-size:var(--text-sm)">
        <span style="font-family:var(--font-mono);font-size:10px;color:var(--color-accent)">05</span>
        <span style="flex:1">Persist site files & initialize git repository</span>
        <span style="font-family:var(--font-mono);font-size:10px;color:var(--color-text-faint)">build-mutator</span>
      </div>
      <div class="stage-row" id="stg-6" style="display:flex;align-items:center;gap:10px;padding:6px 10px;border-radius:6px;background:var(--color-bg-sunken);font-size:var(--text-sm)">
        <span style="font-family:var(--font-mono);font-size:10px;color:var(--color-accent)">06</span>
        <span style="flex:1">Browser-first verification & quality gate</span>
        <span style="font-family:var(--font-mono);font-size:10px;color:var(--color-text-faint)">playwright-qa</span>
      </div>
    </div>
  `;

  const previewPanel = document.createElement("div");
  previewPanel.className = "card";
  previewPanel.style.padding = "var(--space-4)";
  previewPanel.innerHTML = `
    <div style="font-size:var(--text-xs);font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:var(--color-text-faint);margin-bottom:var(--space-2)">Live Build Output</div>
    <div id="new-site-preview-box" style="height:140px;border:1px dashed var(--color-border);border-radius:var(--radius-sm);display:flex;align-items:center;justify-content:center;color:var(--color-text-faint);font-size:var(--text-sm);background:var(--color-bg-sunken)">
      Select a recipe and launch build to generate full static site package.
    </div>
  `;

  rightDeck.append(pipelinePanel, previewPanel);
  container.append(briefCard, rightDeck);

  runBtn.addEventListener("click", async () => {
    const bname = container.querySelector("#ns-bname")?.value.trim() || "New Site";
    const bloc = container.querySelector("#ns-bloc")?.value.trim() || "";
    const bnote = container.querySelector("#ns-bnote")?.value.trim() || "";
    const recipeVal = container.querySelector("#ns-recipe")?.value || "standard-business";

    let pages = ["home", "about", "contact"];
    let archetype = "editorial";
    if (recipeVal === "minimal-hello-world") {
      pages = ["home"];
      archetype = "minimal-showcase";
    } else if (recipeVal === "lead-gen-landing") {
      pages = ["home"];
      archetype = "lead-capture";
    } else if (recipeVal === "creator-portfolio") {
      pages = ["home", "projects", "contact"];
      archetype = "gallery";
    }

    const badge = pipelinePanel.querySelector("#pipeline-status-badge");
    if (badge) {
      badge.textContent = "EXECUTING...";
      badge.style.color = "var(--color-accent)";
    }

    const prevBox = previewPanel.querySelector("#new-site-preview-box");
    if (prevBox) {
      prevBox.innerHTML = `<div style="text-align:center"><div class="orb orb--sm" style="margin:0 auto 8px auto"></div><div><b>Building ${bname} with recipe "${recipeVal}"...</b></div><div style="font-size:11px;color:var(--color-text-dim);margin-top:4px">Generating static assets & verifying in browser...</div></div>`;
    }

    runBtn.disabled = true;
    runBtn.textContent = "Building...";

    try {
      const briefPayload = {
        business: { name: bname, location: bloc },
        site_needs: { archetype, pages, notes: bnote },
      };

      const resp = await fetch("/api/pipeline/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ brief: briefPayload }),
      });

      const resData = await resp.json().catch(() => ({}));
      runBtn.disabled = false;
      runBtn.textContent = "Start new site build";

      if (resp.ok && (resData.outcome === "success" || resData.run_id)) {
        if (badge) {
          badge.textContent = "BUILD SUCCESS";
          badge.style.color = "var(--color-ok)";
        }
        if (prevBox) {
          prevBox.innerHTML = `
            <div style="text-align:center">
              <div style="font-size:14px;font-weight:700;color:var(--color-ok);margin-bottom:6px">✓ Site built & verified!</div>
              <div style="font-size:12px;color:var(--color-text-dim);margin-bottom:10px">Assets created: index.html, styles.css, js/main.js, package.json, README.md, 404.html</div>
              <a href="/site?site_id=${encodeURIComponent(resData.site_id || '')}" class="btn btn--pri" style="font-size:11.5px;padding:5px 14px;text-decoration:none">Open in Canvas Editor →</a>
            </div>
          `;
        }
      } else {
        if (badge) {
          badge.textContent = "BUILD ERROR";
          badge.style.color = "var(--color-error)";
        }
        if (prevBox) {
          prevBox.innerHTML = `<div style="color:var(--color-error);font-size:12px">Build error: ${resData.message || "Failed to complete pipeline run"}</div>`;
        }
      }

      if (typeof options.onStartBuild === "function") {
        options.onStartBuild({ business_name: bname, location: bloc, notes: bnote, recipe: recipeVal, result: resData });
      }
    } catch (err) {
      runBtn.disabled = false;
      runBtn.textContent = "Start new site build";
      if (badge) {
        badge.textContent = "FAILED";
        badge.style.color = "var(--color-error)";
      }
      if (prevBox) {
        prevBox.innerHTML = `<div style="color:var(--color-error);font-size:12px">Failed to initiate build: ${err.message}</div>`;
      }
    }
  });

  return container;
}
