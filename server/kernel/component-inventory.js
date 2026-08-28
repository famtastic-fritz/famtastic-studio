/**
 * The Components screen's data source: which section types actually recur
 * across the operator's real portfolio, and where.
 *
 * WHY THIS EXISTS
 *
 * Fritz's own framing for this screen: "A table of the recurring section
 * types (heroes, forms, feature grids) discovered in the imported specs,
 * with site usage counts." That is a claim about what is REALLY in
 * spec.pages[].sections[] across every real site, not a catalog of layouts
 * Studio knows how to build. The importer (server/kernel/importer.js) today
 * produces exactly three section `type` values -- hero, text, cta -- so this
 * file groups by whatever `type` actually appears, rather than mapping onto
 * an invented taxonomy (a "feature grid" or "form" type does not exist in a
 * real spec yet, and pretending otherwise would be showing a number nothing
 * computed).
 *
 * WHAT THIS REUSES, DELIBERATELY
 *
 * listPortfolioSpecs() (kernel/portfolio-specs.js) already is "every real
 * site paired with its real spec" -- the exact same read Media, SEO, and the
 * Quality Gate screens are documented to share. This file adds only the
 * grouping step on top of it; it never touches the filesystem itself.
 */
import { listPortfolioSpecs } from './portfolio-specs.js';

/**
 * buildComponentInventory({paths}): every distinct section `type` found
 * anywhere in the portfolio's real, imported specs, with how many times it
 * occurs in total and on which real sites.
 *
 * Reads `paths.config` (createPaths() always returns the exact config
 * object it was built from -- see kernel/paths.js) to hand listPortfolioSpecs
 * the matching config, the same way that function's own doc comment
 * requires. A caller isolating a temp portfolio for a test builds `paths`
 * from its own overridden config, so this stays correct with no second
 * config argument to keep in sync by hand; the real server's `paths` already
 * carries the real, unmodified config.
 *
 * Returns:
 *   status: 'ok' | 'not_configured' (mirrors listPortfolioSpecs's own status
 *     verbatim when it is not 'ok', rather than collapsing a real "nothing
 *     is configured" gap into a merely empty-looking list)
 *   components: [{ type, total_occurrences, sites: [{site_id, count}],
 *     example_heading? }], sorted by total_occurrences descending (most
 *     common first), tied types broken alphabetically by type for a stable
 *     order. `sites` only lists real sites that use this type at least
 *     once, each site's own count summed across every page of that site.
 *     example_heading, when present, is verbatim text from one real
 *     section's own `heading` field -- never invented, and simply absent
 *     when no section of that type carries one (true for every real hero
 *     today; the importer records a hero's text on the page, not the
 *     section).
 *   skipped_sites: carried through from listPortfolioSpecs's own `skipped`
 *     verbatim -- a real site with no spec yet, or an invalid one, reported
 *     by reason rather than silently absent from the counts.
 *
 * A portfolio with no real sites imported yet returns status 'ok' with an
 * empty components array -- a real read that found nothing, not an error.
 */
export function buildComponentInventory({ paths }) {
  const scan = listPortfolioSpecs({ paths, config: paths.config });

  if (scan.status !== 'ok') {
    return { status: scan.status, reason: scan.reason, components: [], skipped_sites: scan.skipped || [] };
  }

  const byType = new Map();

  for (const { entry, spec } of scan.entries) {
    const siteId = entry.id;
    for (const page of spec.pages || []) {
      for (const section of page.sections || []) {
        const type = section && section.type;
        if (!type) continue; // defensive: every real section the importer writes carries a type

        let bucket = byType.get(type);
        if (!bucket) {
          bucket = { type, total_occurrences: 0, sitesByType: new Map(), example_heading: null };
          byType.set(type, bucket);
        }

        bucket.total_occurrences += 1;
        bucket.sitesByType.set(siteId, (bucket.sitesByType.get(siteId) || 0) + 1);

        if (!bucket.example_heading && typeof section.heading === 'string' && section.heading.trim()) {
          bucket.example_heading = section.heading;
        }
      }
    }
  }

  const components = [...byType.values()]
    .map((bucket) => {
      const out = {
        type: bucket.type,
        total_occurrences: bucket.total_occurrences,
        sites: [...bucket.sitesByType.entries()]
          .map(([site_id, count]) => ({ site_id, count }))
          .sort((a, b) => a.site_id.localeCompare(b.site_id)),
      };
      if (bucket.example_heading) out.example_heading = bucket.example_heading;
      return out;
    })
    .sort((a, b) => b.total_occurrences - a.total_occurrences || a.type.localeCompare(b.type));

  return { status: 'ok', components, skipped_sites: scan.skipped || [] };
}
