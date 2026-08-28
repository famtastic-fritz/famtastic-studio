// discoverPages() had no dedicated test file before this. It exists to solve
// one real conflict (MBSH's backend/ and frontend/ both carrying the site's
// real pages) without reopening the two bugs its predecessors each had:
// contentRootFor() alone missed MBSH's real pages entirely (picked a stale
// two-file dist/ over 27 real ones), and an early unbounded whole-tree
// version of this function swept an unrelated marketing/ directory into one
// synthetic fixture, then -- against the REAL portfolio -- swept 861 files
// out of site-famtastic-designs's Drupal backend/, including its
// backend/web/proofs/ directory: the live FAMtastic Designs proof pipeline's
// own output, protected revenue scope that must never be treated as page
// content. That is the test this file exists to never let regress.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { discoverPages } from '../server/kernel/thumbnails.js';

let dir;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'discover-pages-test-'));
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

function write(relPath, content = '<html></html>') {
  const full = path.join(dir, relPath);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content);
}

describe('discoverPages: MBSH-shaped backend/frontend conflict', () => {
  beforeEach(() => {
    for (const name of ['index', 'capsule', 'rsvp']) {
      write(`backend/${name}.html`);
      write(`frontend/${name}.html`);
    }
    write('backend/admin/login.php', '<?php'); // not .html, and under an excluded dir either way
    write('backend/admin/dashboard.html'); // excluded by dir name even though it IS .html
    write('frontend/extras/only-here.html'); // no backend counterpart -- must survive
  });

  it('resolves every collision to backend and reports frontend as shadowed, when includeBackend is true', () => {
    const r = discoverPages(dir, { includeBackend: true });
    const chosen = r.pages.map((p) => p.path).sort();
    expect(chosen).toEqual(['backend/capsule.html', 'backend/index.html', 'backend/rsvp.html', 'frontend/extras/only-here.html']);
    expect(r.shadowed).toHaveLength(3);
    for (const s of r.shadowed) {
      expect(s.path).toMatch(/^frontend\//);
      expect(s.shadowed_by).toMatch(/^backend\//);
    }
  });

  it('never walks admin/, regardless of file extension', () => {
    const r = discoverPages(dir, { includeBackend: true });
    const all = [...r.pages.map((p) => p.path), ...r.shadowed.map((s) => s.path)];
    expect(all.some((p) => p.includes('admin/'))).toBe(false);
  });

  // REGRESSION GUARD, found running against the real portfolio: a
  // brochure-class site's backend/ (site-famtastic-designs, pure Drupal) held
  // 861 files including its own live proof-pipeline output, none of which
  // collided with anything real, so precedence alone never filtered them --
  // they all "won" their own groups outright. backend/ must never be walked
  // at all unless the caller has actual backend evidence for this site.
  it('never walks backend/ at all when includeBackend is false, even when nothing there collides', () => {
    const r = discoverPages(dir, { includeBackend: false });
    const all = [...r.pages.map((p) => p.path), ...r.shadowed.map((s) => s.path)];
    expect(all.some((p) => p.startsWith('backend/'))).toBe(false);
    expect(r.pages.map((p) => p.path).sort()).toEqual(['frontend/capsule.html', 'frontend/extras/only-here.html', 'frontend/index.html', 'frontend/rsvp.html']);
  });
});

describe('discoverPages: a nested build output beats a stray sibling source file', () => {
  it('walks frontend/dist/ (the real build output) and never the sibling frontend/index.html template or an unrelated marketing/ directory', () => {
    write('frontend/dist/index.html', '<html><title>Home</title></html>');
    write('frontend/dist/about/index.html', '<html><title>About</title></html>');
    write('frontend/index.html', '<html><title>Source template, never built</title></html>');
    write('frontend/node_modules/somepkg/readme.html');
    write('marketing/proof.html');

    const r = discoverPages(dir, { includeBackend: false });
    expect(r.pages.map((p) => p.path).sort()).toEqual(['frontend/dist/about/index.html', 'frontend/dist/index.html']);
    expect(r.shadowed).toEqual([]);
  });
});

describe('discoverPages: real pages at the site root alongside an unrelated named subtree', () => {
  // REGRESSION: an application-class site can keep nothing but a database
  // schema under backend/, with its actual pages sitting at its own top
  // level -- not every application-class site is MBSH-shaped. The first
  // version of the root-as-candidate logic only added the site's own root
  // when NO named subtree existed at all, so a bare, content-free backend/
  // silently swallowed the whole site: zero pages found, importer refused
  // with no_pages_found, even though index.html sat right there on disk.
  it('finds pages at the root even when a same-named subtree exists but holds no HTML', () => {
    write('index.html');
    write('about.html');
    write('backend/schema.sql', 'CREATE TABLE x (id INT);');

    const r = discoverPages(dir, { includeBackend: true });
    expect(r.pages.map((p) => p.path).sort()).toEqual(['about.html', 'index.html']);
    expect(r.shadowed).toEqual([]);
  });

  // Same shape, but includeBackend is false (a brochure-class site) -- the
  // root candidate's own fallback walk must not become a second, unguarded
  // path into backend/ now that backend/ is no longer its own candidate at
  // all. This is the exact backdoor skipNames exists to close.
  it('still excludes backend/ via the root fallback walk when includeBackend is false', () => {
    write('index.html');
    write('backend/should-never-appear.html');

    const r = discoverPages(dir, { includeBackend: false });
    const all = [...r.pages.map((p) => p.path), ...r.shadowed.map((s) => s.path)];
    expect(all).toEqual(['index.html']);
  });
});

describe('discoverPages: no named subtree at all', () => {
  it('falls back to the site root directly, the same shape a small brochure repo has', () => {
    write('index.html');
    write('contact.html');

    const r = discoverPages(dir);
    expect(r.pages.map((p) => p.path).sort()).toEqual(['contact.html', 'index.html']);
    expect(r.shadowed).toEqual([]);
  });

  it('reports a genuinely empty site honestly rather than inventing a page', () => {
    fs.mkdirSync(path.join(dir, 'app'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'app', 'page.tsx'), 'export default function Page() {}');

    const r = discoverPages(dir);
    expect(r.pages).toEqual([]);
    expect(r.shadowed).toEqual([]);
  });
});
