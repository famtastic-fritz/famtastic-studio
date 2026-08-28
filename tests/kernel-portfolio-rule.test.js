import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { scanPortfolio } from '../server/kernel/portfolio.js';

// RULED 2026-08-27: 61 directories is not 61 sites. A directory qualifies as a
// SITE only through a deliberate signal, and same-domain/same-remote
// directories collapse into one site plus its experiments. Better nine correct
// entries than 59 honest ones.
function makeRoot(dirs) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pf-'));
  for (const [name, files] of Object.entries(dirs)) {
    const d = path.join(root, name);
    fs.mkdirSync(d, { recursive: true });
    for (const [rel, content] of Object.entries(files || {})) {
      const f = path.join(d, rel);
      fs.mkdirSync(path.dirname(f), { recursive: true });
      if (content === 'DIR') fs.mkdirSync(f, { recursive: true });
      else fs.writeFileSync(f, content);
    }
  }
  return root;
}

describe('what qualifies as a site', () => {
  it('a bare directory with html does not qualify, even with a spec.json', () => {
    // spec.json is a pipeline artifact every probe emits. It is evidence a
    // build ran here, not that a business exists.
    const root = makeRoot({ 'some-build': { 'index.html': '<html/>', 'spec.json': '{}' } });
    const r = scanPortfolio({ roots: { sites: root } });
    expect(r.sites[0].origin).toBe('unclassified');
  });

  it('a .site-context directory qualifies', () => {
    const root = makeRoot({ 'real-site': { '.site-context/SITE-LEARNINGS.md': '#' } });
    const r = scanPortfolio({ roots: { sites: root } });
    expect(r.sites[0].origin).toBe('site');
    expect(r.sites[0].origin_reason).toMatch(/site-context/);
  });

  it('a declared domain qualifies', () => {
    const root = makeRoot({ 'has-domain': { CNAME: 'example.com\n' } });
    const r = scanPortfolio({ roots: { sites: root } });
    expect(r.sites[0].origin).toBe('site');
    expect(r.sites[0].origin_reason).toMatch(/example\.com/);
  });

  it('deploy evidence qualifies', () => {
    const root = makeRoot({ 'deployed-once': { 'DEPLOY.md': '# prod' } });
    const r = scanPortfolio({ roots: { sites: root } });
    expect(r.sites[0].origin).toBe('site');
  });

  it('a probe name is test regardless of other signals', () => {
    const root = makeRoot({ 'site-dna-probe': { CNAME: 'example.com\n' } });
    const r = scanPortfolio({ roots: { sites: root } });
    expect(r.sites[0].origin).toBe('test');
  });
});

describe('one site plus its experiments, not three sites', () => {
  it('same-domain directories collapse to a primary and experiments', () => {
    const root = makeRoot({
      'site-acme': { CNAME: 'acme.com\n', '.site-context/x.md': '#' },
      'site-acme-cinematic-proof': { CNAME: 'acme.com\n' },
      'site-acme-event-cinema': { CNAME: 'acme.com\n' },
    });
    const r = scanPortfolio({ roots: { sites: root } });
    const sites = r.sites.filter((s) => s.origin === 'site');
    const exps = r.sites.filter((s) => s.origin === 'experiment');
    expect(sites.map((s) => s.id)).toEqual(['site-acme']);
    expect(exps).toHaveLength(2);
    for (const e of exps) expect(e.variant_of).toBe('site-acme');
  });

  it('a backup-named copy is test, not an extra site', () => {
    const root = makeRoot({
      'site-acme': { CNAME: 'acme.com\n' },
      'site-acme.pre-repair-20260722-180426': { CNAME: 'acme.com\n' },
    });
    const r = scanPortfolio({ roots: { sites: root } });
    expect(r.sites.filter((s) => s.origin === 'site').map((s) => s.id)).toEqual(['site-acme']);
    expect(r.sites.find((s) => s.id.includes('pre-repair')).origin).toBe('test');
  });

  it('an api subdomain groups with its apex', () => {
    const root = makeRoot({
      'site-acme': { CNAME: 'acme.com\n' },
      'site-acme-copy': { CNAME: 'api.acme.com\n' },
    });
    const r = scanPortfolio({ roots: { sites: root } });
    expect(r.sites.filter((s) => s.origin === 'site')).toHaveLength(1);
  });
});

describe('the operator rules, the rule infers', () => {
  it('exposes counts in the new vocabulary', () => {
    const root = makeRoot({ 'a': { CNAME: 'a.com\n' }, 'b': {} });
    const r = scanPortfolio({ roots: { sites: root } });
    expect(Object.keys(r.origin_counts).sort()).toEqual(['experiment', 'site', 'test', 'unclassified']);
  });
});
