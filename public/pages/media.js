// Media page: a real tile grid of real images found across the imported
// portfolio sites (asset name, which site uses it, and provenance/unfilled
// slots) -- Fritz's own definition of this screen. This is NOT the
// AI-generated-media concept (cost, provider, prompt hash); spec.media_slots
// exists for that and is always empty on a real HTML import today, so any
// entry it does carry renders as an honestly-labeled unfilled placeholder,
// never a fabricated row.
import { render as renderShell } from "/kit/shell.js";
import { createRegion } from "/kit/region.js";
import { pill } from "/kit/pill.js";
import { panel } from "/kit/panel.js";

const root = renderShell({ pageId: "media" });

const section = document.createElement("section");

const heading = document.createElement("h2");
heading.textContent = "Media";

const sub = document.createElement("p");
sub.className = "card__meta";
sub.textContent = "Real images found across the imported portfolio sites. Not AI-generated media -- that capability has not shipped yet.";

const jumpOffEl = document.createElement("p");
jumpOffEl.className = "proofs-jump-off";

const count = document.createElement("p");
count.className = "card__meta";

const regionEl = document.createElement("div");

section.append(heading, sub, jumpOffEl, count, regionEl);
root.appendChild(section);

// The jump-off is page chrome, not media data -- it must show regardless of
// whether any asset was found, so it is fetched from the registry route
// directly rather than riding along on the (possibly empty) media region.
// Same pattern as public/pages/proofs.js.
fetch("/api/platform/registry", { headers: { Accept: "application/json" } })
  .then((res) => (res.ok ? res.json() : null))
  .then((body) => {
    const entries = body && Array.isArray(body.entries) ? body.entries : [];
    renderJumpOff(entries.find((entry) => entry.id === "media-studio") || null);
  })
  .catch(() => renderJumpOff(null));

function renderJumpOff(mediaStudio) {
  jumpOffEl.textContent = "";
  if (!mediaStudio) return;
  if (mediaStudio.jump_off) {
    const link = document.createElement("a");
    link.href = mediaStudio.jump_off;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    link.textContent = "Media Studio ->";
    jumpOffEl.appendChild(link);
  } else {
    jumpOffEl.textContent = mediaStudio.authority
      ? `No jump-off URL configured yet for Media Studio. ${mediaStudio.authority}.`
      : "No jump-off URL configured yet for Media Studio.";
  }
}

function filenameOf(src) {
  const clean = String(src || "").split(/[?#]/)[0];
  const parts = clean.split("/");
  return parts[parts.length - 1] || src;
}

// Builds the real thumbnail/full-image URL against the asset-serving route:
// site_id + src identify the real file; from (the first real page known to
// reference it) lets the server resolve a plain-relative src against the
// right directory.
function assetUrl(asset) {
  const params = new URLSearchParams({ site_id: asset.site_id, src: asset.src });
  if (Array.isArray(asset.pages) && asset.pages.length) params.set("from", asset.pages[0]);
  return `/api/media/asset?${params.toString()}`;
}

function altPill(asset) {
  const hasAlt = typeof asset.alt === "string" && asset.alt.trim().length > 0;
  const el = pill(hasAlt ? asset.alt : "no alt text", hasAlt ? "ok" : "error");
  el.classList.add("media-alt-pill");
  el.title = hasAlt ? `alt text: ${asset.alt}` : "no alt attribute found on this image tag";
  return el;
}

function assetCard(asset) {
  const card = document.createElement("div");
  card.className = "pcard";

  const thumb = document.createElement("div");
  thumb.className = "pcard__thumb";
  const img = document.createElement("img");
  img.loading = "lazy";
  img.alt = `Real image ${filenameOf(asset.src)} from ${asset.site_id}`;
  img.src = assetUrl(asset);
  thumb.appendChild(img);
  card.appendChild(thumb);

  const body = document.createElement("div");
  body.className = "pcard__body";

  const name = document.createElement("div");
  name.className = "pcard__name";
  name.textContent = filenameOf(asset.src);
  name.title = asset.src;
  body.appendChild(name);

  const row = document.createElement("div");
  row.className = "pcard__row";
  row.appendChild(pill(asset.site_id, "ok"));
  row.appendChild(altPill(asset));
  body.appendChild(row);

  const touch = document.createElement("div");
  touch.className = "pcard__touch";
  const pages = Array.isArray(asset.pages) ? asset.pages : [];
  const usage = typeof asset.usage_count === "number" ? asset.usage_count : pages.length;
  touch.textContent = `used on ${usage} real page${usage === 1 ? "" : "s"}`;
  touch.title = pages.join(", ");
  body.appendChild(touch);

  card.appendChild(body);
  return card;
}

// An unfilled media_slots entry has no real image on disk -- the thumbnail
// is a deliberately different diagonal-stripe placeholder, never an <img>
// pointed at a file that does not exist.
function unfilledCard(slot) {
  const card = document.createElement("div");
  card.className = "pcard";

  const thumb = document.createElement("div");
  thumb.className = "pcard__thumb pcard__thumb--unfilled";
  const label = document.createElement("span");
  label.className = "pcard__nothumb";
  label.textContent = "UNFILLED";
  thumb.appendChild(label);
  card.appendChild(thumb);

  const body = document.createElement("div");
  body.className = "pcard__body";

  const name = document.createElement("div");
  name.className = "pcard__name";
  name.textContent = slot.role || slot.id || "media slot";
  body.appendChild(name);

  const row = document.createElement("div");
  row.className = "pcard__row";
  row.appendChild(pill(slot.site_id, "ok"));
  row.appendChild(pill(slot.state || "unfilled", "warn"));
  body.appendChild(row);

  const touch = document.createElement("div");
  touch.className = "pcard__touch";
  touch.textContent = slot.prompt || slot.reason || "no prompt or reason recorded";
  body.appendChild(touch);

  card.appendChild(body);
  return card;
}

function grid(items, cardFn) {
  const g = document.createElement("div");
  g.className = "pgrid";
  for (const item of items) g.appendChild(cardFn(item));
  return g;
}

// Skipped sites (real sites with no spec yet, not imported) must stay
// visible on this screen too -- same honesty listPortfolioSpecs already
// guarantees for Sites/SEO/Gate. Rendered from the same /api/media body this
// region already fetched, not a second request.
function coveragePanel(data) {
  const body = document.createElement("div");

  const distinctSites = new Set((data.assets || []).map((a) => a.site_id)).size;
  const summary = document.createElement("p");
  summary.className = "card__meta";
  summary.textContent = `${distinctSites} real site(s) contributed at least one real image. ${(data.unfilled || []).length} unfilled media slot(s) recorded (spec.media_slots -- always empty on a real HTML import today; the field exists for future AI-generated media).`;
  body.appendChild(summary);

  const skipped = data.skipped_sites || [];
  const skippedNote = document.createElement("p");
  skippedNote.className = "card__meta";
  skippedNote.textContent = skipped.length
    ? `${skipped.length} real site(s) have no spec yet, not imported: ${skipped.map((s) => `${s.id} (${s.reason})`).join(", ")}.`
    : "Every real portfolio site the scan found already has a spec; none are waiting on import.";
  body.appendChild(skippedNote);

  return panel({ title: "Portfolio coverage", route: "/api/media", children: body });
}

createRegion(regionEl, {
  collection: "assets",
  endpoint: "/api/media",
  render(data) {
    const assets = (data.assets || [])
      .slice()
      .sort((a, b) => a.site_id.localeCompare(b.site_id) || a.src.localeCompare(b.src));
    const unfilled = data.unfilled || [];
    count.textContent = `${assets.length} real asset(s) (source: ${data.source || "unknown"})`;

    const wrap = document.createElement("div");

    if (Array.isArray(data.presets) && data.presets.length) {
      const presetsWrap = document.createElement("div");
      presetsWrap.style.marginBottom = "2rem";

      const pHead = document.createElement("h3");
      pHead.textContent = "Media Studio Library Presets & Backgrounds";
      pHead.style.marginBottom = "0.5rem";

      const pMeta = document.createElement("p");
      pMeta.className = "card__meta";
      pMeta.textContent = `${data.presets.length} curated style backgrounds & texture presets available from media-studio library.`;

      const pGrid = document.createElement("div");
      pGrid.style.display = "grid";
      pGrid.style.gridTemplateColumns = "repeat(auto-fit, minmax(260px, 1fr))";
      pGrid.style.gap = "1.25rem";
      pGrid.style.marginTop = "1rem";

      for (const preset of data.presets) {
        const pCard = document.createElement("div");
        pCard.className = "card";
        pCard.style.border = "1px solid var(--color-border)";
        pCard.style.borderRadius = "8px";
        pCard.style.overflow = "hidden";
        pCard.style.background = "var(--color-bg-raised)";

        const preview = document.createElement("div");
        preview.style.height = "120px";
        preview.style.background = preset.css_background;
        preview.style.display = "flex";
        preview.style.alignItems = "flex-end";
        preview.style.padding = "0.5rem";

        const tag = document.createElement("span");
        tag.textContent = preset.aspect_ratio;
        tag.style.background = "rgba(0,0,0,0.6)";
        tag.style.color = "#fff";
        tag.style.fontSize = "0.75rem";
        tag.style.padding = "2px 6px";
        tag.style.borderRadius = "4px";
        preview.appendChild(tag);
        pCard.appendChild(preview);

        const pBody = document.createElement("div");
        pBody.style.padding = "1rem";

        const nameRow = document.createElement("div");
        nameRow.style.display = "flex";
        nameRow.style.justifyContent = "space-between";
        nameRow.style.alignItems = "center";
        nameRow.style.marginBottom = "0.5rem";

        const title = document.createElement("b");
        title.textContent = preset.name;
        title.style.color = "var(--color-text)";
        nameRow.appendChild(title);
        nameRow.appendChild(pill(preset.category, "ok"));
        pBody.appendChild(nameRow);

        const tagsRow = document.createElement("div");
        tagsRow.style.display = "flex";
        tagsRow.style.gap = "4px";
        tagsRow.style.flexWrap = "wrap";
        for (const t of (preset.tags || []).slice(0, 3)) {
          const tp = document.createElement("span");
          tp.textContent = `#${t}`;
          tp.style.fontSize = "0.75rem";
          tp.style.color = "var(--color-text-dim)";
          tagsRow.appendChild(tp);
        }
        pBody.appendChild(tagsRow);
        pCard.appendChild(pBody);

        pGrid.appendChild(pCard);
      }

      presetsWrap.append(pHead, pMeta, pGrid);
      wrap.appendChild(panel({
        title: "Media Studio Library",
        route: "media-studio",
        children: presetsWrap,
      }));
    }

    const portfolioHead = document.createElement("h3");
    portfolioHead.textContent = "Discovered Portfolio Images";
    portfolioHead.style.margin = "1.5rem 0 0.5rem";
    wrap.appendChild(portfolioHead);

    wrap.appendChild(grid(assets, assetCard));

    if (unfilled.length) {
      const h3 = document.createElement("h3");
      h3.textContent = "Unfilled media slots";
      wrap.appendChild(h3);
      wrap.appendChild(grid(unfilled, unfilledCard));
    }

    wrap.appendChild(coveragePanel(data));
    return wrap;
  },
});
