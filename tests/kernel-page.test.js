// page.js had no dedicated test file before this. Covering the one behavior
// just changed for a real reason: which directory "list a site's pages"
// actually walks.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createPaths, loadPathsConfig } from '../server/kernel/paths.js';
import { createPage } from '../server/kernel/page.js';

let tmpRoot;
let baseConfig;

beforeEach(() => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'page-test-'));
  baseConfig = loadPathsConfig();
  process.env[baseConfig.data_root_env] = tmpRoot;
});

afterEach(() => {
  delete process.env[baseConfig.data_root_env];
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

// REGRESSION: list() originally walked a site's own top-level directory for
// ANY .html file anywhere. For a real project directory shaped like a
// monorepo -- frontend/node_modules/, marketing/ assets, a SOURCE
// frontend/index.html template alongside the actual BUILT
// frontend/dist/index.html -- that turned up 113 files as "pages" for a site
// with roughly a dozen real routes.
describe('page.list: walks the real content root, not the whole repo', () => {
  it('walks frontend/dist/ when it exists, not the site root, and excludes node_modules and marketing/ siblings', () => {
    const paths = createPaths();
    const dir = paths.within('sites', 'site-with-build-output');
    fs.mkdirSync(path.join(dir, 'frontend', 'dist', 'about'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'frontend', 'dist', 'index.html'), '<html><title>Home</title></html>');
    fs.writeFileSync(path.join(dir, 'frontend', 'dist', 'about', 'index.html'), '<html><title>About</title></html>');
    // The SOURCE template -- must not be double-counted alongside the built page.
    fs.writeFileSync(path.join(dir, 'frontend', 'index.html'), '<html><title>Source template</title></html>');
    // Vendor package docs -- must never be listed as a page.
    fs.mkdirSync(path.join(dir, 'frontend', 'node_modules', 'somepkg'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'frontend', 'node_modules', 'somepkg', 'readme.html'), '<html></html>');
    // An unrelated marketing asset directory at the repo's own top level.
    fs.mkdirSync(path.join(dir, 'marketing'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'marketing', 'proof.html'), '<html></html>');

    const page = createPage({ paths });
    const result = page.list('site-with-build-output');
    expect(result.pages.map((p) => p.path).sort()).toEqual([
      'frontend/dist/about/index.html',
      'frontend/dist/index.html',
    ]);
  });

  it('falls back to the site root when no known build-output shape exists', () => {
    const paths = createPaths();
    const dir = paths.within('sites', 'site-plain');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'index.html'), '<html><title>Home</title></html>');
    fs.writeFileSync(path.join(dir, 'contact.html'), '<html><title>Contact</title></html>');

    const page = createPage({ paths });
    const result = page.list('site-plain');
    expect(result.pages.map((p) => p.path).sort()).toEqual(['contact.html', 'index.html']);
  });

  // The reported pagePath must stay resolvable through the SAME convention
  // resolvePagePath/canvas.js already use: relative to the site's own root,
  // even though the walk itself started from a deeper content root.
  it('reports paths that still resolve correctly through get()', () => {
    const paths = createPaths();
    const dir = paths.within('sites', 'site-roundtrip');
    fs.mkdirSync(path.join(dir, 'dist'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'dist', 'index.html'), '<html><title>Home</title></html>');

    const page = createPage({ paths });
    const listed = page.list('site-roundtrip');
    const got = page.get('site-roundtrip', listed.pages[0].path);
    expect(got.html).toContain('Home');
  });
});
