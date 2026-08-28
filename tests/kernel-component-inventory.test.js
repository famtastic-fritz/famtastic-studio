// buildComponentInventory() groups every real, imported site's real section
// types into portfolio-wide counts. Same temp-portfolio isolation pattern as
// tests/kernel-portfolio-specs.test.js -- real fixture HTML, run through the
// real importer, so the section `type` values grouped here are the same
// values extractPageStructure() actually produces (hero, text, cta), never
// hand-authored.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createPaths, loadPathsConfig } from '../server/kernel/paths.js';
import { createJournal } from '../server/kernel/journal.js';
import { createEvents } from '../server/kernel/events.js';
import { createMutation } from '../server/kernel/mutation.js';
import { createSpec } from '../server/kernel/spec.js';
import { createImporter } from '../server/kernel/importer.js';
import { buildComponentInventory } from '../server/kernel/component-inventory.js';

let tmpRoot;
let portfolioRoot;
let baseConfig;
let config;
let kit;

// A real page carrying all three section types the importer currently
// produces: an <h1> (hero), a second heading (text), and a short
// call-to-action anchor (cta, folded in by foldCtasIntoSections).
function pageHtml({ title, h1, h2, ctaLabel, ctaHref }) {
  return `<!doctype html><html><head><title>${title}</title></head>
    <body>
      <h1>${h1}</h1><p>Hero body copy for ${title}.</p>
      <h2>${h2}</h2><p>Real body copy under ${h2}.</p>
      <a href="${ctaHref}">${ctaLabel}</a>
    </body></html>`;
}

function writeRealSite(id, pages) {
  const dir = path.join(portfolioRoot, id);
  fs.mkdirSync(path.join(dir, '.site-context'), { recursive: true }); // qualifies as origin: 'site'
  for (const [fileName, html] of Object.entries(pages)) {
    fs.writeFileSync(path.join(dir, fileName), html);
  }
  return dir;
}

beforeEach(() => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'component-inventory-studio-'));
  portfolioRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'component-inventory-portfolio-'));
  baseConfig = loadPathsConfig();
  process.env[baseConfig.data_root_env] = tmpRoot;
  config = { ...baseConfig, portfolio_roots: { sites: portfolioRoot } };
  const paths = createPaths(config);
  const journal = createJournal({ paths });
  const events = createEvents({ paths });
  const mutation = createMutation({ paths, journal, events });
  const spec = createSpec({ paths, mutation });
  const importer = createImporter({ paths, spec });
  kit = { paths, journal, events, mutation, spec, importer };
});

afterEach(() => {
  delete process.env[baseConfig.data_root_env];
  fs.rmSync(tmpRoot, { recursive: true, force: true });
  fs.rmSync(portfolioRoot, { recursive: true, force: true });
});

describe('buildComponentInventory: real section types, real counts', () => {
  it('returns an empty components list, not an error, when zero sites are imported', () => {
    const result = buildComponentInventory({ paths: kit.paths });
    expect(result.status).toBe('ok');
    expect(result.components).toEqual([]);
    expect(result.skipped_sites).toEqual([]);
  });

  it('propagates not_configured from listPortfolioSpecs rather than reporting a false empty', () => {
    // A fresh `paths` built from an unconfigured-portfolio config, so
    // paths.config carries the override -- buildComponentInventory reads
    // config straight off paths, never as a second argument.
    const unconfiguredPaths = createPaths({ ...config, portfolio_roots: {} });
    const result = buildComponentInventory({ paths: unconfiguredPaths });
    expect(result.status).toBe('not_configured');
    expect(result.components).toEqual([]);
  });

  it('carries a real, un-imported site through as skipped_sites, with a reason', () => {
    fs.mkdirSync(path.join(portfolioRoot, 'site-not-imported', '.site-context'), { recursive: true });
    fs.writeFileSync(path.join(portfolioRoot, 'site-not-imported', 'index.html'), '<html><body><h1>x</h1></body></html>');
    const result = buildComponentInventory({ paths: kit.paths });
    expect(result.components).toEqual([]);
    expect(result.skipped_sites).toEqual([{ id: 'site-not-imported', reason: 'spec_not_found' }]);
  });

  it('counts a section type appearing on 2 different real sites, both', () => {
    writeRealSite('site-alpha', {
      'index.html': pageHtml({ title: 'Alpha Home', h1: 'Alpha headline', h2: 'Services', ctaLabel: 'Book now', ctaHref: '/book' }),
    });
    writeRealSite('site-beta', {
      'index.html': pageHtml({ title: 'Beta Home', h1: 'Beta headline', h2: 'Menu', ctaLabel: 'Order online', ctaHref: '/order' }),
    });
    kit.importer.importSite('site-alpha');
    kit.importer.importSite('site-beta');

    const result = buildComponentInventory({ paths: kit.paths });
    const hero = result.components.find((c) => c.type === 'hero');
    expect(hero.total_occurrences).toBe(2);
    expect(hero.sites).toEqual([
      { site_id: 'site-alpha', count: 1 },
      { site_id: 'site-beta', count: 1 },
    ]);
  });

  it('sums total_occurrences across multiple pages of the same site', () => {
    writeRealSite('site-multi-page', {
      'index.html': pageHtml({ title: 'Home', h1: 'Home headline', h2: 'Team', ctaLabel: 'Contact us', ctaHref: '/contact' }),
      'about.html': pageHtml({ title: 'About', h1: 'About headline', h2: 'History', ctaLabel: 'Learn more', ctaHref: '/history' }),
    });
    kit.importer.importSite('site-multi-page');

    const result = buildComponentInventory({ paths: kit.paths });
    const hero = result.components.find((c) => c.type === 'hero');
    const text = result.components.find((c) => c.type === 'text');
    const cta = result.components.find((c) => c.type === 'cta');

    // 2 pages, each with exactly one h1 -> hero, one h2 -> text, one CTA anchor.
    expect(hero.total_occurrences).toBe(2);
    expect(hero.sites).toEqual([{ site_id: 'site-multi-page', count: 2 }]);
    expect(text.total_occurrences).toBe(2);
    expect(text.sites).toEqual([{ site_id: 'site-multi-page', count: 2 }]);
    expect(cta.total_occurrences).toBe(2);
    expect(cta.sites).toEqual([{ site_id: 'site-multi-page', count: 2 }]);
  });

  it('sorts components by total_occurrences descending, most common first', () => {
    // 3 headings on one page: one h1 (hero) and two h2s (both type 'text'),
    // so 'text' (2) must sort ahead of 'hero' (1).
    const html = `<!doctype html><html><head><title>Sort Test</title></head>
      <body>
        <h1>Main headline</h1><p>Hero body.</p>
        <h2>First section</h2><p>First body.</p>
        <h2>Second section</h2><p>Second body.</p>
      </body></html>`;
    writeRealSite('site-sort', { 'index.html': html });
    kit.importer.importSite('site-sort');

    const result = buildComponentInventory({ paths: kit.paths });
    const types = result.components.map((c) => c.type);
    expect(types.indexOf('text')).toBeLessThan(types.indexOf('hero'));
    expect(result.components.find((c) => c.type === 'text').total_occurrences).toBe(2);
    expect(result.components.find((c) => c.type === 'hero').total_occurrences).toBe(1);
  });

  it('carries a real section heading as example_heading, never an invented one', () => {
    writeRealSite('site-heading', {
      'index.html': pageHtml({ title: 'Heading Test', h1: 'The headline', h2: 'Our Real Services', ctaLabel: 'Call now', ctaHref: '/call' }),
    });
    kit.importer.importSite('site-heading');

    const result = buildComponentInventory({ paths: kit.paths });
    const text = result.components.find((c) => c.type === 'text');
    expect(text.example_heading).toBe('Our Real Services');
  });
});
