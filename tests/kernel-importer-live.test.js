// The importer's orchestration layer against real files on a real (temp,
// isolated) filesystem: walk pages, read CSS, write a journaled spec. The
// pure extraction logic is covered separately in kernel-importer.test.js;
// this is "does it actually happen to a real site directory."
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

let tmpRoot;
let portfolioRoot;
let baseConfig;
let kit;

function writeRealSite(id, { backend = false } = {}) {
  const dir = path.join(portfolioRoot, id);
  fs.mkdirSync(path.join(dir, '.site-context'), { recursive: true }); // qualifies it as origin: 'site'
  fs.writeFileSync(path.join(dir, 'styles.css'), 'body { background-color: #f4f1ec; color: #1a1c1e; } .cta { background-color: #e2601f; }');
  fs.writeFileSync(path.join(dir, 'index.html'), `<!doctype html><html><head><title>${id} Home</title>
    <meta name="description" content="A real business, imported.">
    <link rel="stylesheet" href="styles.css"></head>
    <body><h1>Real headline text</h1><p>Real body copy that already exists.</p>
    <img src="hero.jpg" alt="Storefront"><h2>Services</h2><p>What we actually do.</p>
    <a href="/book">Book now</a></body></html>`);
  fs.writeFileSync(path.join(dir, 'about.html'), `<!doctype html><html><head><title>About</title></head>
    <body><h1>About us</h1><p>Some history.</p></body></html>`);
  if (backend) {
    fs.mkdirSync(path.join(dir, 'backend'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'backend', 'schema.sql'), 'CREATE TABLE x (id INT);');
  }
  return dir;
}

beforeEach(() => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'importer-studio-'));
  portfolioRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'importer-portfolio-'));
  baseConfig = loadPathsConfig();
  process.env[baseConfig.data_root_env] = tmpRoot;
  const config = { ...baseConfig, portfolio_roots: { sites: portfolioRoot } };
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

describe('importSite: a real brochure site', () => {
  it('writes a readable, journaled spec from real HTML', () => {
    writeRealSite('site-real-biz');
    const result = kit.importer.importSite('site-real-biz');
    expect(result.pages_imported).toBe(2);
    expect(result.capability_class).toBe('brochure');
    expect(result.tokens_detected).toBe(true);
    expect(result.journal_entry_id).toBeTruthy();

    const read = kit.spec.read('site-real-biz');
    expect(read.valid).toBe(true);
    expect(read.spec.brand.name).toBeTruthy();
    expect(read.spec.pages.map((p) => p.path).sort()).toEqual(['about.html', 'index.html']);
    expect(read.spec.generated_from.derivation).toBe('imported');
  });

  it('carries the real body copy verbatim, with no instruction to echo against', () => {
    writeRealSite('site-real-biz-2');
    kit.importer.importSite('site-real-biz-2');
    const { spec } = kit.spec.read('site-real-biz-2');
    const home = spec.pages.find((p) => p.path === 'index.html');
    // Hero body is the text FOLLOWING the h1 (already the tested contract in
    // kernel-importer.test.js), not the h1's own text -- the h1 becomes the
    // page's title/heading instead.
    expect(home.sections[0].body).toBe('Real body copy that already exists.');
    expect(home.heading).toBe('Real headline text');
    expect(home.sections[0].instruction).toBeNull();
  });

  it('is journaled and undoable, exactly like any other mutation', () => {
    writeRealSite('site-real-biz-3');
    const result = kit.importer.importSite('site-real-biz-3');
    const specPath = path.join(portfolioRoot, 'site-real-biz-3', 'spec.json');
    expect(fs.existsSync(specPath)).toBe(true);

    expect(result.undo_token).toBeTruthy();
    kit.mutation.undo('site-real-biz-3', result.undo_token);
    expect(fs.existsSync(specPath)).toBe(false);
  });

  it('detects real CSS tokens rather than falling back to defaults silently', () => {
    writeRealSite('site-real-biz-4');
    kit.importer.importSite('site-real-biz-4');
    const { spec } = kit.spec.read('site-real-biz-4');
    expect(spec.tokens.bg.toLowerCase()).toBe('#f4f1ec');
    expect(spec.tokens_provenance.source).toBe('detected_from_css');
  });

  it('reports what it could not determine across the whole site', () => {
    writeRealSite('site-real-biz-5');
    const result = kit.importer.importSite('site-real-biz-5');
    // about.html has no meta description -- the extractor must have said so.
    expect(result.could_not_determine.some((s) => /about\.html.*meta description/.test(s))).toBe(true);
  });
});

describe('importSite: MBSH-shaped application site', () => {
  it('carries the backend rather than parsing it', () => {
    writeRealSite('site-app-biz', { backend: true });
    const result = kit.importer.importSite('site-app-biz');
    expect(result.capability_class).toBe('application');

    const { spec } = kit.spec.read('site-app-biz');
    expect(spec.backend.studio_understands_contents).toBe(false);
    expect(spec.backend.authored_by).toBe('external');
    // The importer never touched backend/ at all -- confirm it is untouched
    // on disk, not merely unmentioned in the spec.
    const schemaContents = fs.readFileSync(path.join(portfolioRoot, 'site-app-biz', 'backend', 'schema.sql'), 'utf8');
    expect(schemaContents).toBe('CREATE TABLE x (id INT);');
  });
});

describe('importSite: refusals', () => {
  it('refuses to import a studio-generated site, which already has a spec', () => {
    const paths = kit.paths;
    fs.mkdirSync(paths.within('sites', 'a-studio-site'), { recursive: true });
    fs.writeFileSync(paths.within('sites', 'a-studio-site', 'index.html'), '<html></html>');
    try {
      kit.importer.importSite('a-studio-site');
      throw new Error('should have thrown');
    } catch (e) {
      expect(e.code).toBe('not_a_portfolio_site');
    }
  });

  it('refuses an unknown site with a real 404, not a crash', () => {
    try {
      kit.importer.importSite('nothing-here');
      throw new Error('should have thrown');
    } catch (e) {
      expect(e.code).toBe('site_not_found');
    }
  });
});
