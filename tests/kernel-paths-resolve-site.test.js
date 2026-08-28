// The seam (2026-08-27): the console only ever worked on sites Studio itself
// generated, because every kernel module hardcoded `within('sites', ...)` --
// the studio build-output root. An operator's real site has no directory
// there, so every screen resolved nothing and rendered honestly empty. Twelve
// nav items, one root cause.
//
// resolveSite() is the fix: one function deciding which root a site_id's files
// live under, reusing within()'s existing hardened containment either way.
// This file is the direct test of THAT function -- the highest-risk new code
// in this change, since it is now resolving into a directory the operator's
// real, uncontrolled git repos live in, not just the studio's own sandbox.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createPaths, loadPathsConfig } from '../server/kernel/paths.js';

let tmpRoot;
let portfolioRoot;
let baseConfig;

beforeEach(() => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'resolve-site-studio-'));
  portfolioRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'resolve-site-portfolio-'));
  baseConfig = loadPathsConfig();
  process.env[baseConfig.data_root_env] = tmpRoot;
});

afterEach(() => {
  delete process.env[baseConfig.data_root_env];
  fs.rmSync(tmpRoot, { recursive: true, force: true });
  fs.rmSync(portfolioRoot, { recursive: true, force: true });
});

// A config pointed at an ISOLATED fake portfolio root, never the operator's
// real ~/Development/FAMtastic/sites -- these tests must not depend on, or be
// able to touch, anything on the real machine.
function configWithPortfolio() {
  return { ...baseConfig, portfolio_roots: { sites: portfolioRoot } };
}

describe('resolveSite: studio sites', () => {
  it('resolves a studio-generated site to the studio root', () => {
    const paths = createPaths(configWithPortfolio());
    fs.mkdirSync(paths.within('sites', 'my-studio-site'), { recursive: true });
    const r = paths.resolveSite('my-studio-site');
    expect(r.source).toBe('studio');
    expect(r.rootName).toBe('sites');
    expect(r.dir).toBe(paths.within('sites', 'my-studio-site'));
  });

  it('prefers the studio directory when a name exists in both', () => {
    const paths = createPaths(configWithPortfolio());
    fs.mkdirSync(paths.within('sites', 'dup'), { recursive: true });
    fs.mkdirSync(path.join(portfolioRoot, 'dup', '.site-context'), { recursive: true });
    expect(paths.resolveSite('dup').source).toBe('studio');
  });
});

describe('resolveSite: real portfolio sites', () => {
  it('resolves a real site found by the portfolio scan', () => {
    const paths = createPaths(configWithPortfolio());
    fs.mkdirSync(path.join(portfolioRoot, 'site-real-biz', '.site-context'), { recursive: true });
    fs.writeFileSync(path.join(portfolioRoot, 'site-real-biz', 'index.html'), '<html></html>');
    const r = paths.resolveSite('site-real-biz');
    expect(r.source).toBe('portfolio');
    expect(r.rootName).toBe('portfolio_sites');
    expect(r.dir).toBe(path.join(portfolioRoot, 'site-real-biz'));
    expect(r.entry.id).toBe('site-real-biz');
  });

  // The same hardened containment as every other root: a symlink planted
  // inside a portfolio entry that escapes it must still be caught.
  it('rejects a symlink escape inside a real portfolio site the same way every other root does', () => {
    const paths = createPaths(configWithPortfolio());
    const realSite = path.join(portfolioRoot, 'site-with-escape');
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'outside-'));
    fs.mkdirSync(path.join(realSite, '.site-context'), { recursive: true });
    fs.writeFileSync(path.join(outside, 'secret.txt'), 'not this site\'s file');
    fs.symlinkSync(outside, path.join(realSite, 'evil'));
    const { rootName } = paths.resolveSite('site-with-escape');
    expect(() => paths.within(rootName, 'site-with-escape', 'evil', 'secret.txt')).toThrow(/path escapes root/);
    fs.rmSync(outside, { recursive: true, force: true });
  });

  it('never resolves into an id the scan did not find, even if the raw directory exists', () => {
    // A directory sitting in the portfolio root that qualifies as nothing
    // (portfolio.js's own rule) must not become resolvable just because a
    // caller asks for its name -- this is the allowlist property, not path
    // arithmetic on a client-supplied string.
    const paths = createPaths(configWithPortfolio());
    fs.mkdirSync(path.join(portfolioRoot, 'random-scratch-dir'), { recursive: true });
    expect(() => paths.resolveSite('random-scratch-dir')).toThrow(/unknown site/);
  });
});

describe('resolveSite: unknown sites', () => {
  it('throws a real 404 by default, for a genuine read', () => {
    const paths = createPaths(configWithPortfolio());
    try {
      paths.resolveSite('totally-unknown');
      throw new Error('should have thrown');
    } catch (e) {
      expect(e.code).toBe('site_not_found');
      expect(e.statusCode).toBe(404);
    }
  });

  // createIfMissing preserves EXACTLY what every caller got before this seam
  // existed: a site_id with no directory yet resolves to where one would be
  // created. The build pipeline writes a new site's first bytes this way.
  it('createIfMissing defaults to the studio root rather than throwing', () => {
    const paths = createPaths(configWithPortfolio());
    const r = paths.resolveSite('brand-new-site', { createIfMissing: true });
    expect(r.source).toBe('studio');
    expect(r.rootName).toBe('sites');
    expect(fs.existsSync(r.dir)).toBe(false); // not created yet, just resolved
  });

  it('requires a site_id', () => {
    const paths = createPaths(configWithPortfolio());
    expect(() => paths.resolveSite('')).toThrow(/requires a site_id/);
    expect(() => paths.resolveSite(null)).toThrow(/requires a site_id/);
  });
});

describe('resolveSite: no portfolio configured', () => {
  it('behaves exactly as before the seam when portfolio_roots is absent', () => {
    const paths = createPaths({ ...baseConfig, portfolio_roots: {} });
    expect(() => paths.resolveSite('anything')).toThrow(/unknown site/);
    expect(paths.resolveSite('anything', { createIfMissing: true }).source).toBe('studio');
  });
});
