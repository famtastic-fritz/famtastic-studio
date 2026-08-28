// Portfolio-wide media inventory: real images already sitting in the
// operator's real HTML pages, aggregated per real site. This is deliberately
// NOT the AI-generated-media concept (cost, provider, prompt hash) that
// spec.media_slots exists for -- on every real HTML import that array is
// always empty today (see importer.js), and this module reports that
// honestly under `unfilled` rather than inventing rows for a capability that
// has not shipped yet.
//
// Composed from three already-built, already-tested pieces -- deliberate
// reuse, not a new read path:
//   listPortfolioSpecs (kernel/portfolio-specs.js): which real sites exist
//     and have a valid, already-imported spec.
//   createPage (kernel/page.js): the real page list/content for a site,
//     resolved through the SAME site-resolution seam (paths.resolveSite)
//     every other real-site reader uses.
//   extractImages (kernel/importer.js): the real <img> inventory for one
//     page's HTML -- already used by the importer itself, not a new parser.
import { listPortfolioSpecs } from './portfolio-specs.js';
import { createPage } from './page.js';
import { extractImages } from './importer.js';

/**
 * buildMediaInventory({paths}): every real image referenced across every
 * real, imported portfolio site's real pages, aggregated by the pair
 * (site_id, src) -- the SAME image referenced from multiple pages of the
 * SAME site becomes ONE asset entry with a `pages` list and a
 * `usage_count`. An identical src on a DIFFERENT site is a different asset;
 * site identity is part of the key and is never collapsed away.
 *
 * `paths` alone is enough: listPortfolioSpecs needs a `config` argument only
 * to avoid re-loading paths.json from disk (which would disagree with a
 * `paths` built from an overridden config, e.g. in a test). `paths.config`
 * is exactly the config `paths` itself was built from (see paths.js's own
 * return value), so passing it through here means a caller only ever hands
 * this function one thing and both stay consistent -- in production and in
 * an isolated test alike.
 *
 * Returns { status: 'ok' | 'not_configured', reason, assets, unfilled,
 * skipped_sites }. `status`, `reason`, and `skipped_sites` (renamed from
 * listPortfolioSpecs's own `skipped`) come straight through, so "N real
 * sites have no spec yet, not imported" stays visible on this screen too,
 * exactly as it is on the projections that already use listPortfolioSpecs.
 */
export function buildMediaInventory({ paths }) {
  const { status, reason, entries, skipped } = listPortfolioSpecs({ paths, config: paths.config });

  if (status !== 'ok') {
    return { status, reason, assets: [], unfilled: [], skipped_sites: skipped || [] };
  }

  const page = createPage({ paths });
  const assets = [];
  const unfilled = [];

  for (const { entry, spec } of entries) {
    const siteId = entry.id;
    // Keyed per site so an identical src on two different sites never
    // collapses into one asset -- site_id is part of the aggregation key,
    // not just a label attached after the fact.
    const bySrc = new Map();

    const { pages: sitePages } = page.list(siteId);
    for (const pageEntry of sitePages) {
      let html;
      try {
        ({ html } = page.get(siteId, pageEntry.path));
      } catch {
        // A page listed a moment ago but unreadable now (raced with a
        // concurrent edit, permissions, etc.) is skipped for this asset
        // walk rather than failing the whole portfolio-wide inventory --
        // every other real site and page still reports honestly.
        continue;
      }
      for (const img of extractImages(html)) {
        let asset = bySrc.get(img.src);
        if (!asset) {
          asset = { site_id: siteId, src: img.src, alt: img.alt ?? null, pages: [], usage_count: 0 };
          bySrc.set(img.src, asset);
        }
        // A real alt found on any page for this asset wins and is kept even
        // if a later page reuses the same image with no alt -- one missing
        // attribute on one page must never erase alt text this asset
        // genuinely has elsewhere, which would downgrade an honest "ok"
        // pill to "error" for no real reason.
        if (!asset.alt && img.alt) asset.alt = img.alt;
        if (!asset.pages.includes(pageEntry.path)) {
          asset.pages.push(pageEntry.path);
          asset.usage_count += 1;
        }
      }
    }
    assets.push(...bySrc.values());

    // media_slots is always [] on a real HTML import today (importer.js),
    // but the field exists for future AI-generated media -- surfaced
    // honestly here, never fabricated, and only entries that are not
    // already filled count as a real gap to show.
    for (const slot of spec.media_slots || []) {
      if (slot.state === 'filled') continue;
      unfilled.push({
        site_id: siteId,
        id: slot.id || null,
        role: slot.role || null,
        prompt: slot.prompt || null,
        reason: slot.fill_error || slot.note || null,
        state: slot.state || 'unfilled',
      });
    }
  }

  return { status: 'ok', reason: null, assets, unfilled, skipped_sites: skipped };
}
