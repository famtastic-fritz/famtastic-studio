import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createPaths, loadPathsConfig } from '../server/kernel/paths.js';
import { extractSeoMeta, scorePage, generateProposals, createSeo } from '../server/kernel/seo.js';

let tmpRoot;
let prevEnvValue;
const config = loadPathsConfig();

beforeEach(() => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-next-seo-'));
  prevEnvValue = process.env[config.data_root_env];
  process.env[config.data_root_env] = tmpRoot;
});

afterEach(() => {
  if (prevEnvValue === undefined) delete process.env[config.data_root_env];
  else process.env[config.data_root_env] = prevEnvValue;
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

function makeSiteWithHtml(paths, siteId, pages) {
  const dir = paths.ensure('sites');
  const siteDir = path.join(dir, siteId);
  fs.mkdirSync(siteDir, { recursive: true });
  for (const [filename, content] of Object.entries(pages)) {
    fs.writeFileSync(path.join(siteDir, filename), content);
  }
  return siteDir;
}

describe('extractSeoMeta', () => {
  it('extracts title, meta description, lang, viewport, canonical, headings, images, and og tags', () => {
    const html = `<!doctype html>
    <html lang="en">
    <head>
      <meta charset="utf-8">
      <meta name="viewport" content="width=device-width, initial-scale=1">
      <title>Reunion 2026 - Miami Beach High</title>
      <meta name="description" content="Official Miami Beach High Class of 1996 30th Reunion celebration and ticket portal.">
      <link rel="canonical" href="https://mbsh96reunion.com">
      <meta property="og:title" content="MBSH 30th Reunion">
      <meta property="og:description" content="Join us in Miami Beach.">
      <meta property="og:image" content="https://mbsh96reunion.com/og.jpg">
      <meta name="twitter:card" content="summary_large_image">
    </head>
    <body>
      <h1>Thirty Years Of Hi-Tides</h1>
      <h2>Event Details</h2>
      <h3>Schedule</h3>
      <img src="/images/hero.webp" alt="Class of 1996 photo">
      <img src="/images/badge.png">
      <a href="/tickets.html">Get Tickets</a>
      <a href="#"></a>
    </body>
    </html>`;

    const meta = extractSeoMeta(html);
    expect(meta.title).toBe('Reunion 2026 - Miami Beach High');
    expect(meta.description).toBe('Official Miami Beach High Class of 1996 30th Reunion celebration and ticket portal.');
    expect(meta.lang).toBe('en');
    expect(meta.viewport).toBe('width=device-width, initial-scale=1');
    expect(meta.canonical).toBe('https://mbsh96reunion.com');
    expect(meta.og.title).toBe('MBSH 30th Reunion');
    expect(meta.og.image).toBe('https://mbsh96reunion.com/og.jpg');
    expect(meta.twitter.card).toBe('summary_large_image');
    expect(meta.h1).toEqual(['Thirty Years Of Hi-Tides']);
    expect(meta.h2).toEqual(['Event Details']);
    expect(meta.h3).toEqual(['Schedule']);
    expect(meta.images.total).toBe(2);
    expect(meta.images.missingAlt).toBe(1);
    expect(meta.links.total).toBe(2);
    expect(meta.links.empty).toBe(1);
  });

  it('handles empty or malformed html gracefully', () => {
    const meta = extractSeoMeta(null);
    expect(meta.title).toBeNull();
    expect(meta.h1).toEqual([]);
    expect(meta.images.total).toBe(0);
  });
});

describe('scorePage and generateProposals', () => {
  it('awards high score for fully compliant page', () => {
    const meta = {
      title: 'Optimal Title For Good Search Results Here',
      description: 'This is an optimal meta description that is between 120 and 160 characters long and describes the business thoroughly for Google and social search results.',
      viewport: 'width=device-width, initial-scale=1',
      lang: 'en',
      canonical: 'https://example.com',
      og: { title: 'Optimal Title', description: 'Good description', image: '/og.png' },
      twitter: { card: 'summary' },
      h1: ['Main Heading'],
      h2: ['Subheading'],
      h3: [],
      images: { total: 2, missingAlt: 0, items: [] },
      links: { total: 3, empty: 0, internal: 3, external: 0 },
    };

    const scoring = scorePage(meta);
    expect(scoring.score).toBeGreaterThanOrEqual(90);
    expect(scoring.grade).toBe('A');
    expect(scoring.issues.length).toBe(0);
  });

  it('penalizes missing critical elements and generates actionable proposals', () => {
    const meta = {
      title: null,
      description: null,
      viewport: null,
      lang: null,
      canonical: null,
      og: {},
      twitter: {},
      h1: [],
      h2: [],
      h3: [],
      images: { total: 3, missingAlt: 3, items: [] },
      links: { total: 2, empty: 1, internal: 1, external: 0 },
    };

    const scoring = scorePage(meta);
    expect(scoring.score).toBeLessThan(50);
    expect(scoring.grade).toBe('F');
    expect(scoring.issues.some((i) => i.id === 'title-missing')).toBe(true);
    expect(scoring.issues.some((i) => i.id === 'desc-missing')).toBe(true);
    expect(scoring.issues.some((i) => i.id === 'h1-missing')).toBe(true);

    const proposals = generateProposals('index.html', meta, scoring);
    expect(proposals.length).toBeGreaterThanOrEqual(3);
    expect(proposals.some((p) => p.type === 'add_title')).toBe(true);
    expect(proposals.some((p) => p.type === 'add_meta_description')).toBe(true);
    expect(proposals.some((p) => p.type === 'add_alt_text')).toBe(true);
  });
});

describe('createSeo({ paths }).analyze', () => {
  it('analyzes all pages of a real site and computes average score', () => {
    const paths = createPaths();
    makeSiteWithHtml(paths, 'site-test-seo', {
      'index.html': `<!doctype html><html lang="en"><head><title>Home Page</title><meta name="description" content="A real description for the home page of this business."><meta name="viewport" content="width=device-width, initial-scale=1"></head><body><h1>Welcome</h1></body></html>`,
      'about.html': `<!doctype html><html lang="en"><head><title>About Us</title><meta name="description" content="Learn about our team and background in this industry."><meta name="viewport" content="width=device-width, initial-scale=1"></head><body><h1>About Us</h1></body></html>`,
    });

    const seo = createSeo({ paths });
    const result = seo.analyze('site-test-seo');

    expect(result.status).toBe('available');
    expect(result.site_id).toBe('site-test-seo');
    expect(result.pages_count).toBe(2);
    expect(result.pages.length).toBe(2);
    expect(result.score).toBeGreaterThan(70);
  });

  it('returns NOT_FOUND status for non-existent site', () => {
    const paths = createPaths();
    const seo = createSeo({ paths });
    const result = seo.analyze('non-existent-site');
    expect(result.status).toBe('NOT_FOUND');
    expect(result.pages_count).toBe(0);
  });
});
