// listPortfolioSpecs() is the one place Media, Components, SEO, and the
// Quality Gate screens all get "every real site's current spec" from. Get
// this wrong and all four screens are wrong the same way.
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
import { listPortfolioSpecs } from '../server/kernel/portfolio-specs.js';

let tmpRoot;
let portfolioRoot;
let baseConfig;
let config;
let kit;

function writeRealSite(id) {
  const dir = path.join(portfolioRoot, id);
  fs.mkdirSync(path.join(dir, '.site-context'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'index.html'), `<!doctype html><html><head><title>${id} Home</title></head>
    <body><h1>Real headline</h1><p>Real body copy.</p></body></html>`);
  return dir;
}

function writeUnclassified(id) {
  // No .site-context, no git remote, no domain, no deploy evidence -- a
  // scratch directory the scan itself refuses to call a site.
  fs.mkdirSync(path.join(portfolioRoot, id), { recursive: true });
  fs.writeFileSync(path.join(portfolioRoot, id, 'index.html'), '<html></html>');
}

beforeEach(() => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'portfolio-specs-studio-'));
  portfolioRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'portfolio-specs-portfolio-'));
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

describe('listPortfolioSpecs: real sites, real specs, honest gaps', () => {
  it('returns not_configured when no portfolio_roots are declared, rather than an empty list', () => {
    const r = listPortfolioSpecs({ paths: kit.paths, config: { ...config, portfolio_roots: {} } });
    expect(r.status).toBe('not_configured');
    expect(r.entries).toEqual([]);
  });

  it('reports a real site with no spec yet as skipped, with a reason, not silently dropped', () => {
    writeRealSite('site-a');
    const r = listPortfolioSpecs({ paths: kit.paths, config });
    expect(r.status).toBe('ok');
    expect(r.entries).toEqual([]);
    expect(r.skipped).toEqual([{ id: 'site-a', reason: 'spec_not_found' }]);
  });

  it('pairs an imported real site with its actual spec content', () => {
    writeRealSite('site-a');
    kit.importer.importSite('site-a');
    const r = listPortfolioSpecs({ paths: kit.paths, config });
    expect(r.entries).toHaveLength(1);
    expect(r.entries[0].entry.id).toBe('site-a');
    expect(r.entries[0].spec.pages[0].heading).toBe('Real headline');
  });

  it('never includes an unclassified scratch directory, imported or not', () => {
    writeUnclassified('scratch-1');
    const r = listPortfolioSpecs({ paths: kit.paths, config });
    expect(r.entries).toEqual([]);
    expect(r.skipped).toEqual([]);
  });

  it('excludes experiments by default and includes them when asked', () => {
    // Two directories with the same domain: portfolio.js dedupes same-domain
    // directories into one 'site' + the rest as 'experiment'.
    const dirA = path.join(portfolioRoot, 'site-primary');
    fs.mkdirSync(dirA, { recursive: true });
    fs.writeFileSync(path.join(dirA, 'CNAME'), 'example.com');
    fs.writeFileSync(path.join(dirA, 'index.html'), '<html><head><title>Primary</title></head><body><h1>Primary</h1></body></html>');
    const dirB = path.join(portfolioRoot, 'site-primary-variant');
    fs.mkdirSync(dirB, { recursive: true });
    fs.writeFileSync(path.join(dirB, 'CNAME'), 'example.com');
    fs.writeFileSync(path.join(dirB, 'index.html'), '<html><head><title>Variant</title></head><body><h1>Variant</h1></body></html>');
    kit.importer.importSite('site-primary');
    kit.importer.importSite('site-primary-variant');

    const withoutExperiments = listPortfolioSpecs({ paths: kit.paths, config });
    const withExperiments = listPortfolioSpecs({ paths: kit.paths, config, includeExperiments: true });
    expect(withExperiments.entries.length).toBeGreaterThan(withoutExperiments.entries.length);
  });
});
