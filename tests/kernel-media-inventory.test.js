// buildMediaInventory() is the one place the Media screen gets "every real
// image across the real portfolio" from. Same temp-portfolio isolation
// pattern as tests/kernel-portfolio-specs.test.js -- see that file for the
// scaffold this one deliberately does not reinvent.
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
import { buildMediaInventory } from '../server/kernel/media-inventory.js';

let tmpRoot;
let portfolioRoot;
let baseConfig;
let config;
let kit;

// Same shape as kernel-portfolio-specs.test.js's writeRealSite, extended to
// accept a map of {filename: html} so a test can give a site more than one
// real page (the default single index.html is unchanged for callers that
// don't need that).
function writeRealSite(id, files = null) {
  const dir = path.join(portfolioRoot, id);
  fs.mkdirSync(path.join(dir, '.site-context'), { recursive: true });
  const pages = files || {
    'index.html': `<!doctype html><html><head><title>${id} Home</title></head>
      <body><h1>Real headline</h1><p>Real body copy.</p></body></html>`,
  };
  for (const [name, html] of Object.entries(pages)) {
    fs.writeFileSync(path.join(dir, name), html);
  }
  return dir;
}

beforeEach(() => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'media-inventory-studio-'));
  portfolioRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'media-inventory-portfolio-'));
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

describe('buildMediaInventory: real images across the real portfolio', () => {
  it('returns not_configured when no portfolio_roots are declared, rather than an empty list', () => {
    const noPortfolioPaths = createPaths({ ...baseConfig, portfolio_roots: {} });
    const result = buildMediaInventory({ paths: noPortfolioPaths });
    expect(result.status).toBe('not_configured');
    expect(result.assets).toEqual([]);
    expect(result.unfilled).toEqual([]);
    expect(result.skipped_sites).toEqual([]);
  });

  it('reports a real site with no spec yet under skipped_sites, not silently absent', () => {
    writeRealSite('site-unimported');
    const result = buildMediaInventory({ paths: kit.paths });
    expect(result.status).toBe('ok');
    expect(result.assets).toEqual([]);
    expect(result.skipped_sites).toEqual([{ id: 'site-unimported', reason: 'spec_not_found' }]);
  });

  it('aggregates an image used on 2 pages of the same site into one asset with usage_count 2', () => {
    writeRealSite('site-a', {
      'index.html': `<!doctype html><html><head><title>site-a Home</title></head>
        <body><h1>Home</h1><img src="/img/hero.jpg" alt="Team at work"></body></html>`,
      'about.html': `<!doctype html><html><head><title>site-a About</title></head>
        <body><h1>About</h1><img src="/img/hero.jpg" alt="Team at work"></body></html>`,
    });
    kit.importer.importSite('site-a');

    const result = buildMediaInventory({ paths: kit.paths });
    expect(result.status).toBe('ok');
    expect(result.assets).toHaveLength(1);
    const [asset] = result.assets;
    expect(asset.site_id).toBe('site-a');
    expect(asset.src).toBe('/img/hero.jpg');
    expect(asset.alt).toBe('Team at work');
    expect(asset.usage_count).toBe(2);
    expect(asset.pages.slice().sort()).toEqual(['about.html', 'index.html']);
  });

  it('treats the same filename on two different sites as two separate assets', () => {
    writeRealSite('site-b1', {
      'index.html': `<!doctype html><html><head><title>site-b1 Home</title></head>
        <body><h1>Home</h1><img src="/img/logo.png" alt="Site B1 logo"></body></html>`,
    });
    writeRealSite('site-b2', {
      'index.html': `<!doctype html><html><head><title>site-b2 Home</title></head>
        <body><h1>Home</h1><img src="/img/logo.png" alt="Site B2 logo"></body></html>`,
    });
    kit.importer.importSite('site-b1');
    kit.importer.importSite('site-b2');

    const result = buildMediaInventory({ paths: kit.paths });
    expect(result.assets).toHaveLength(2);
    const bySite = Object.fromEntries(result.assets.map((a) => [a.site_id, a]));
    expect(bySite['site-b1']).toMatchObject({ src: '/img/logo.png', alt: 'Site B1 logo' });
    expect(bySite['site-b2']).toMatchObject({ src: '/img/logo.png', alt: 'Site B2 logo' });
  });

  it('produces zero assets for a site with zero images, not an error', () => {
    writeRealSite('site-c'); // default fixture: headline + body copy, no <img>
    kit.importer.importSite('site-c');

    const result = buildMediaInventory({ paths: kit.paths });
    expect(result.status).toBe('ok');
    expect(result.assets).toEqual([]);
    expect(result.skipped_sites).toEqual([]);
  });

  it('reports an image with no alt attribute honestly as alt: null, never silently dropped', () => {
    writeRealSite('site-d', {
      'index.html': `<!doctype html><html><head><title>site-d Home</title></head>
        <body><h1>Home</h1><img src="/img/no-alt.jpg"></body></html>`,
    });
    kit.importer.importSite('site-d');

    const result = buildMediaInventory({ paths: kit.paths });
    expect(result.assets).toHaveLength(1);
    expect(result.assets[0]).toMatchObject({
      site_id: 'site-d',
      src: '/img/no-alt.jpg',
      alt: null,
      usage_count: 1,
      pages: ['index.html'],
    });
  });

  it('reports zero unfilled media slots honestly when none exist anywhere, rather than inventing any', () => {
    writeRealSite('site-e', {
      'index.html': `<!doctype html><html><head><title>site-e Home</title></head>
        <body><h1>Home</h1><img src="/img/x.jpg" alt="x"></body></html>`,
    });
    kit.importer.importSite('site-e');

    const result = buildMediaInventory({ paths: kit.paths });
    // Every real HTML import produces media_slots: [] (importer.js) -- this
    // is the honest, current-state assertion, not a guess about a future
    // capability.
    expect(result.unfilled).toEqual([]);
  });
});
