// classify() denominator classes (A6) and page.get() traversal rejection.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createPaths, loadPathsConfig } from '../server/kernel/paths.js';
import { createSite, classify, classifyOrigin, DENOMINATORS } from '../server/kernel/site.js';
import { createPage } from '../server/kernel/page.js';

let tmpRoot;
let prevEnvValue;
const config = loadPathsConfig();

beforeEach(() => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-next-site-'));
  prevEnvValue = process.env[config.data_root_env];
  process.env[config.data_root_env] = tmpRoot;
});

afterEach(() => {
  if (prevEnvValue === undefined) delete process.env[config.data_root_env];
  else process.env[config.data_root_env] = prevEnvValue;
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

function makeSite(paths, siteId, spec) {
  const dir = paths.ensure('sites');
  const siteDir = path.join(dir, siteId);
  fs.mkdirSync(siteDir, { recursive: true });
  if (spec !== undefined) {
    fs.writeFileSync(path.join(siteDir, 'spec.json'), JSON.stringify(spec, null, 2));
  }
  return siteDir;
}

describe('DENOMINATORS', () => {
  it('exports rule text and evidence fields for all five denominators', () => {
    expect(Object.keys(DENOMINATORS)).toEqual(['directories', 'valid_spec', 'customer', 'deployable', 'live']);
    for (const key of Object.keys(DENOMINATORS)) {
      expect(typeof DENOMINATORS[key].rule).toBe('string');
      expect(DENOMINATORS[key].rule.length).toBeGreaterThan(0);
      expect(Array.isArray(DENOMINATORS[key].evidence)).toBe(true);
    }
  });
});

describe('classify(siteDir)', () => {
  it('returns null for a directory that does not exist', () => {
    const paths = createPaths();
    expect(classify(paths.within('sites', 'nowhere'))).toBeNull();
  });

  it('classifies a bare directory with no spec.json as directories', () => {
    const paths = createPaths();
    const dir = makeSite(paths, 'site-directories', undefined);
    expect(classify(dir)).toBe('directories');
  });

  it('classifies a directory with unparsable spec.json as directories', () => {
    const paths = createPaths();
    const dir = makeSite(paths, 'site-bad-json', undefined);
    fs.writeFileSync(path.join(dir, 'spec.json'), '{ not json');
    expect(classify(dir)).toBe('directories');
  });

  it('classifies a valid spec.json with no customer as valid_spec', () => {
    const paths = createPaths();
    const dir = makeSite(paths, 'site-valid-spec', { name: 'demo' });
    expect(classify(dir)).toBe('valid_spec');
  });

  it('classifies a spec with customer.id but no deploy target as customer', () => {
    const paths = createPaths();
    const dir = makeSite(paths, 'site-customer', { customer: { id: 'cust-1' } });
    expect(classify(dir)).toBe('customer');
  });

  it('classifies a spec with customer and deploy.target but no fresh receipt as deployable', () => {
    const paths = createPaths();
    const dir = makeSite(paths, 'site-deployable', {
      customer: { id: 'cust-1' },
      deploy: { target: 'production' },
    });
    expect(classify(dir)).toBe('deployable');
  });

  it('classifies deployable with a stale verification probe as deployable, not live', () => {
    const paths = createPaths();
    const staleTs = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();
    const dir = makeSite(paths, 'site-stale-live', {
      customer: { id: 'cust-1' },
      deploy: { target: 'production', receipt: { target: 'production', verified_at: staleTs } },
    });
    expect(classify(dir)).toBe('deployable');
  });

  it('classifies deployable with a receipt naming a different target as deployable, not live', () => {
    const paths = createPaths();
    const dir = makeSite(paths, 'site-mismatched-receipt', {
      customer: { id: 'cust-1' },
      deploy: { target: 'production', receipt: { target: 'staging', verified_at: new Date().toISOString() } },
    });
    expect(classify(dir)).toBe('deployable');
  });

  it('classifies a spec with a fresh verification probe naming the canonical target as live', () => {
    const paths = createPaths();
    const dir = makeSite(paths, 'site-live', {
      customer: { id: 'cust-1' },
      deploy: {
        target: 'acme.example',
        canonical_target: 'acme.example',
        receipt: { target: 'acme.example', environment: 'production', verified_at: new Date().toISOString() },
      },
    });
    expect(classify(dir)).toBe('live');
  });
});

describe('createSite(paths).list()', () => {
  it('counts one site per denominator class and reports honest zero-state when the root is missing', () => {
    const paths = createPaths();
    const site = createSite({ paths });

    const empty = site.list();
    expect(empty.status).toBe('NOT_FOUND');
    expect(empty.sites).toEqual([]);
    expect(empty.denominators.directories.value).toBe(0);

    makeSite(paths, 'site-directories', undefined);
    makeSite(paths, 'site-valid-spec', { name: 'demo' });
    makeSite(paths, 'site-customer', { customer: { id: 'cust-1' } });
    makeSite(paths, 'site-deployable', { customer: { id: 'cust-1' }, deploy: { target: 'production' } });
    makeSite(paths, 'site-live', {
      customer: { id: 'cust-1' },
      deploy: {
        target: 'acme.example',
        canonical_target: 'acme.example',
        receipt: { target: 'acme.example', environment: 'production', verified_at: new Date().toISOString() },
      },
    });

    const result = site.list();
    expect(result.status).toBe('ok');
    expect(result.sites).toHaveLength(5);
    expect(result.denominators.directories.value).toBe(5);
    expect(result.denominators.valid_spec.value).toBe(4);
    expect(result.denominators.customer.value).toBe(3);
    expect(result.denominators.deployable.value).toBe(2);
    expect(result.denominators.live.value).toBe(1);

    const liveRow = result.sites.find((s) => s.id === 'site-live');
    expect(liveRow.denominator_class).toBe('live');
  });
});

describe('site origin: test vs legit, never optimistically guessed', () => {
  it('honors a declared spec.origin over any inference', () => {
    // A famtastic- prefix would otherwise infer legit; the declaration wins.
    expect(classifyOrigin('famtastic-anything', { origin: 'test' })).toBe('test');
    // A v2- prefix would otherwise infer test; the declaration wins.
    expect(classifyOrigin('v2-real-customer', { origin: 'legit' })).toBe('legit');
  });

  it('infers legit only for the families the operator confirmed', () => {
    expect(classifyOrigin('famtastic-designs', {})).toBe('legit');
    expect(classifyOrigin('mbsh-reunion', {})).toBe('legit');
  });

  it('infers test for this build\'s own fixtures and harness output', () => {
    expect(classifyOrigin('v2-the-beehive-studio', {})).toBe('test');
    expect(classifyOrigin('canon-i-sell-shoes', {})).toBe('test');
    expect(classifyOrigin('shadow-run-1', {})).toBe('test');
  });

  it('returns unknown rather than guessing, and does NOT treat a bare site- prefix as a fixture', () => {
    // site-auntie-gale-garage-sales is a real property. Treating 'site-' as a
    // test marker would misclassify real customer sites as fixtures, which is
    // the same dishonesty as inflating the customer count, pointed the other way.
    expect(classifyOrigin('site-auntie-gale-garage-sales', {})).toBe('unknown');
    expect(classifyOrigin('restaurant', {})).toBe('unknown');
    expect(classifyOrigin('anything-else', { origin: 'unknown' })).toBe('unknown');
    expect(classifyOrigin('anything-else', { origin: 'nonsense' })).toBe('unknown');
  });

  it('list() reports per-origin denominators alongside the totals, and the missing-root branch has the same shape', () => {
    const paths = createPaths();
    const site = createSite({ paths });

    const empty = site.list();
    expect(empty.status).toBe('NOT_FOUND');
    // REGRESSION: the zero-state branch must carry every field the ok branch
    // does, or a console reading denominators_by_origin gets undefined.
    expect(empty.origin_counts).toEqual({ legit: 0, test: 0, unknown: 0 });
    expect(empty.denominators_by_origin.legit.directories.value).toBe(0);

    makeSite(paths, 'famtastic-designs', { customer: { id: 'c1' } });
    makeSite(paths, 'v2-fixture', { customer: { id: 'c2' } });
    makeSite(paths, 'restaurant', { customer: { id: 'c3' } });

    const r = site.list();
    expect(r.origin_counts).toEqual({ legit: 1, test: 1, unknown: 1 });
    // Totals stay the A6 contract: every directory still counts once.
    expect(r.denominators.directories.value).toBe(3);
    expect(r.denominators.customer.value).toBe(3);
    // And the breakdown splits it honestly.
    expect(r.denominators_by_origin.legit.customer.value).toBe(1);
    expect(r.denominators_by_origin.test.customer.value).toBe(1);
    expect(r.denominators_by_origin.unknown.customer.value).toBe(1);
    expect(r.sites.find((x) => x.id === 'famtastic-designs').origin).toBe('legit');
    expect(r.sites.find((x) => x.id === 'restaurant').origin_declared).toBe(false);
  });
});

describe('createSite(paths).get()', () => {
  it('throws 404 site_not_found for an unknown site', () => {
    const paths = createPaths();
    const site = createSite({ paths });
    try {
      site.get('nope');
      throw new Error('should have thrown');
    } catch (error) {
      expect(error.statusCode).toBe(404);
      expect(error.code).toBe('site_not_found');
    }
  });

  it('returns spec, denominator_class and pages_count for a known site', () => {
    const paths = createPaths();
    const dir = makeSite(paths, 'site-get', { customer: { id: 'cust-1' } });
    fs.writeFileSync(path.join(dir, 'index.html'), '<title>Home</title>');
    const site = createSite({ paths });
    const result = site.get('site-get');
    expect(result.site_id).toBe('site-get');
    expect(result.denominator_class).toBe('customer');
    expect(result.pages_count).toBe(1);
  });
});

describe('page.get() traversal rejection', () => {
  it('rejects a pagePath that escapes the site directory', () => {
    const paths = createPaths();
    makeSite(paths, 'site-traversal', { customer: { id: 'cust-1' } });
    const page = createPage({ paths });
    try {
      page.get('site-traversal', '../../../etc/passwd');
      throw new Error('should have thrown');
    } catch (error) {
      expect(error.statusCode).toBe(400);
      expect(error.code).toBe('invalid_page_path');
    }
  });

  it('reads a real page and returns a sha256 revision', () => {
    const paths = createPaths();
    const dir = makeSite(paths, 'site-page', { customer: { id: 'cust-1' } });
    fs.writeFileSync(path.join(dir, 'index.html'), '<title>Home</title><p>hi</p>');
    const page = createPage({ paths });
    const result = page.get('site-page', 'index.html');
    expect(result.revision).toMatch(/^[0-9a-f]{64}$/);
    expect(result.html).toContain('hi');
  });
});

// classify() takes a directory, so write the spec to a temp site and classify it.
let probeCount = 0;
function classifySpecForTest(spec) {
  probeCount += 1;
  return classify(makeSite(createPaths(), `probe-${probeCount}`, spec));
}

describe('live denominator rejects non-production evidence', () => {
  // A fresh probe against staging must never render as live. Found by the phase gate.
  const fresh = () => new Date().toISOString();
  const base = (deploy) => ({ customer: { id: 'c1' }, deploy });

  it('requires an explicitly declared canonical target', () => {
    const spec = base({ target: 'acme.com', receipt: { target: 'acme.com', verified_at: fresh() } });
    expect(classifySpecForTest(spec)).not.toBe('live');
  });

  it('rejects a fresh probe against a preview or staging target', () => {
    for (const target of [
      'staging.acme.com', 'acme-preview.netlify.app', 'test.acme.com',
      // URL-shaped targets: '/' and ':' must count as token boundaries too.
      'https://staging.acme.com', 'https://preview.acme.com', 'https://prod.acme.com/staging',
    ]) {
      const spec = base({ target, canonical_target: target, receipt: { target, verified_at: fresh() } });
      expect(classifySpecForTest(spec), `${target} must not count as live`).not.toBe('live');
    }
  });

  it('rejects a receipt labeled with a non-production environment', () => {
    const spec = base({ target: 'acme.com', canonical_target: 'acme.com', receipt: { target: 'acme.com', environment: 'staging', verified_at: fresh() } });
    expect(classifySpecForTest(spec)).not.toBe('live');
  });

  it('accepts a fresh probe against the declared canonical production target', () => {
    const spec = base({ target: 'acme.com', canonical_target: 'acme.com', receipt: { target: 'acme.com', environment: 'production', verified_at: fresh() } });
    expect(classifySpecForTest(spec)).toBe('live');
  });
});
