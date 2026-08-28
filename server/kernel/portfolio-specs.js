/**
 * The one place that combines "every real portfolio site" with "that site's
 * current spec". Media, Components, SEO, and the Quality Gate screens are all
 * portfolio projections -- a read over every real site's already-imported
 * spec -- and without this they would each grow their own copy of the same
 * scanPortfolio() + spec.read() loop. Composing scanPortfolio() (kernel/
 * portfolio.js, which sites exist) with createSpec().read() (kernel/spec.js,
 * what each one's spec actually says) is deliberate reuse, not a new read
 * path: this never touches the filesystem itself.
 */
import { loadPathsConfig } from './paths.js';
import { scanPortfolio } from './portfolio.js';
import { createSpec } from './spec.js';

/**
 * listPortfolioSpecs({paths, config}): every real (origin: 'site') portfolio
 * entry that has a valid, importable spec, paired with that spec.
 *
 * `config` must be the SAME config object `paths` was built from (`const
 * config = loadPathsConfig(); const paths = createPaths(config)`) -- not
 * independently reloaded here -- so a caller that overrides portfolio_roots
 * (every test in this codebase that isolates a temp portfolio directory does
 * exactly this) gets consistent results from both. Defaults to a fresh
 * loadPathsConfig() only for the common real-server case where paths was
 * also built from the real, unmodified file.
 *
 * Experiments and test/unclassified directories are excluded by default --
 * a portfolio projection screen is about the operator's real properties, the
 * same "nine real sites, not fifty-nine honest ones" bar Sites already
 * applies. Pass includeExperiments to widen it.
 *
 * Returns { status: 'ok' | 'not_configured', entries: [{entry, spec}],
 * skipped: [{id, reason}] } -- skipped covers a real site with no spec yet
 * (not imported) or an invalid spec, reported by reason rather than silently
 * dropped, so a caller can say "3 of 9 real sites are not imported yet"
 * instead of just showing fewer rows with no explanation.
 */
export function listPortfolioSpecs({ paths, config = loadPathsConfig(), includeExperiments = false } = {}) {
  const roots = config.portfolio_roots || {};
  if (!Object.keys(roots).length) {
    return { status: 'not_configured', reason: 'no portfolio_roots are declared in config/paths.json, so there is nowhere to look', entries: [], skipped: [] };
  }

  const scan = scanPortfolio({ roots });
  const wanted = includeExperiments ? ['site', 'experiment'] : ['site'];
  const candidates = scan.sites.filter((s) => wanted.includes(s.origin));

  const spec = createSpec({ paths });
  const entries = [];
  const skipped = [];
  for (const entry of candidates) {
    const result = spec.read(entry.id);
    if (!result.valid || !result.spec) {
      skipped.push({ id: entry.id, reason: result.errors?.[0] || 'spec_invalid' });
      continue;
    }
    entries.push({ entry, spec: result.spec, revision: result.revision });
  }
  return { status: 'ok', entries, skipped };
}
