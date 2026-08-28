// Adversarial coverage for the symlink-escape gap in server/kernel/paths.js
// `within()`. The lexical checks (absolute segments, `..` traversal) never
// touch the filesystem, so a symlink planted inside one site's directory can
// alias a sibling site or an external location without ever writing `..`
// into the path string handed to `within()`. These tests prove the
// realpath-based containment closes that gap while still allowing every
// legitimate shape of call (existing files, not-yet-created files, and a
// symlinked data root, which is the real, non-hypothetical case on macOS
// where /tmp itself is a symlink to /private/tmp).
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createPaths, loadPathsConfig } from '../server/kernel/paths.js';

const config = loadPathsConfig();
let tmpRoot;
let prevEnvValue;

beforeEach(() => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-next-symlink-'));
  prevEnvValue = process.env[config.data_root_env];
  process.env[config.data_root_env] = tmpRoot;
});

afterEach(() => {
  if (prevEnvValue === undefined) delete process.env[config.data_root_env];
  else process.env[config.data_root_env] = prevEnvValue;
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

function makeSites(paths) {
  const sitesRoot = paths.ensure('sites');
  const siteA = path.join(sitesRoot, 'site-a');
  const siteB = path.join(sitesRoot, 'site-b');
  fs.mkdirSync(siteA, { recursive: true });
  fs.mkdirSync(siteB, { recursive: true });
  fs.writeFileSync(path.join(siteB, 'secret.json'), '{"secret":true}');
  fs.mkdirSync(path.join(siteA, 'real-assets'), { recursive: true });
  fs.writeFileSync(path.join(siteA, 'real-assets', 'logo.svg'), '<svg/>');
  return { sitesRoot, siteA, siteB };
}

describe('within() symlink containment', () => {
  it('refuses a symlink inside site A that points at site B\'s directory', () => {
    const paths = createPaths();
    const { siteA } = makeSites(paths);
    fs.symlinkSync(path.join(siteA, '..', 'site-b'), path.join(siteA, 'evil'));

    expect(() => paths.within('sites', 'site-a', 'evil', 'secret.json')).toThrow(/symlink|escapes/);
  });

  it('refuses a symlink that points entirely outside the data root', () => {
    const paths = createPaths();
    const { siteA } = makeSites(paths);
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-next-outside-'));
    fs.writeFileSync(path.join(outside, 'passwd.txt'), 'root:x:0:0');
    fs.symlinkSync(outside, path.join(siteA, 'escape'));

    expect(() => paths.within('sites', 'site-a', 'escape', 'passwd.txt')).toThrow(/symlink|escapes/);

    fs.rmSync(outside, { recursive: true, force: true });
  });

  it('refuses when the entity segment itself is a symlink escaping the root', () => {
    const paths = createPaths();
    makeSites(paths);
    const sitesRoot = paths.root('sites');
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-next-outside-entity-'));
    fs.symlinkSync(outside, path.join(sitesRoot, 'site-c'));

    expect(() => paths.within('sites', 'site-c', 'anything.json')).toThrow(/symlink|escapes/);

    fs.rmSync(outside, { recursive: true, force: true });
  });

  it('allows a symlink that points to a legitimate location inside the same site', () => {
    const paths = createPaths();
    const { siteA } = makeSites(paths);
    fs.symlinkSync(path.join(siteA, 'real-assets'), path.join(siteA, 'assets'));

    const resolved = paths.within('sites', 'site-a', 'assets', 'logo.svg');
    expect(resolved).toBe(path.join(siteA, 'assets', 'logo.svg'));
  });

  it('allows a not-yet-existing file inside a site', () => {
    const paths = createPaths();
    const { siteA } = makeSites(paths);

    const resolved = paths.within('sites', 'site-a', 'dist', 'index.html');
    expect(resolved).toBe(path.join(siteA, 'dist', 'index.html'));
    expect(fs.existsSync(resolved)).toBe(false);
  });

  it('still enforces containment when the data root itself is reached through a symlink', () => {
    // macOS resolves /tmp -> /private/tmp, so mkdtemp under os.tmpdir() already
    // exercises this path on this platform. Make it explicit and deliberate
    // with our own symlinked data root so the case is asserted, not incidental.
    const realDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-next-real-'));
    const symlinkedDataDir = path.join(os.tmpdir(), `studio-next-link-${process.pid}-${Date.now()}`);
    fs.symlinkSync(realDataDir, symlinkedDataDir);
    process.env[config.data_root_env] = symlinkedDataDir;

    try {
      const paths = createPaths();
      const { siteA } = makeSites(paths);

      // Legitimate access still resolves, through the symlinked root.
      const dist = paths.within('sites', 'site-a', 'dist', 'index.html');
      expect(dist.startsWith(siteA)).toBe(true);

      // And an attack symlink inside a site is still refused even though the
      // whole data root is itself reached through a symlink.
      const sitesRoot = paths.root('sites');
      const siteB = path.join(sitesRoot, 'site-b');
      fs.symlinkSync(siteB, path.join(siteA, 'evil-through-link'));
      expect(() => paths.within('sites', 'site-a', 'evil-through-link', 'secret.json')).toThrow(/symlink|escapes/);
    } finally {
      fs.rmSync(symlinkedDataDir, { force: true });
      fs.rmSync(realDataDir, { recursive: true, force: true });
    }
  });

  it('canvas/mutation/deploy style access through within() cannot reach another site via a symlink', () => {
    // This mirrors how server/kernel/canvas.js, mutation.js, and deploy.js
    // all call paths.within('sites', siteId, relPath) — they never touch the
    // filesystem themselves, so the containment guarantee has to live here.
    const paths = createPaths();
    const { siteA, siteB } = makeSites(paths);
    fs.symlinkSync(siteB, path.join(siteA, 'alias-of-site-b'));

    // A canvas/mutation-style read of a page path that walks through the
    // symlink must be refused before any fs.readFile/writeFile ever runs.
    expect(() => paths.within('sites', 'site-a', 'alias-of-site-b', 'secret.json')).toThrow(/symlink|escapes/);

    // Confirm the boundary is intact for the legitimate identity too: site A
    // can still address its own files normally.
    const ownFile = paths.within('sites', 'site-a', 'real-assets', 'logo.svg');
    expect(ownFile).toBe(path.join(siteA, 'real-assets', 'logo.svg'));
  });
});
