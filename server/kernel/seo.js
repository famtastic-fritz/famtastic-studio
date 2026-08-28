// SEO analysis engine for pages and sites.
// Analyzes real HTML, extracts metadata, evaluates hierarchy, checks social tags,
// and computes deterministic health scores and fix proposals without external dependencies.
import fs from 'node:fs';
import { createPage } from './page.js';

export function extractSeoMeta(html) {
  if (!html || typeof html !== 'string') {
    return {
      title: null,
      description: null,
      viewport: null,
      canonical: null,
      lang: null,
      og: {},
      twitter: {},
      h1: [],
      h2: [],
      h3: [],
      images: { total: 0, missingAlt: 0, items: [] },
      links: { total: 0, empty: 0, internal: 0, external: 0 },
    };
  }

  // Title
  const titleMatch = html.match(/<title[^>]*>([^<]*)<\/title>/i);
  const title = titleMatch ? titleMatch[1].trim() : null;

  // Lang
  const langMatch = html.match(/<html[^>]*\slang=["']([^"']+)["']/i);
  const lang = langMatch ? langMatch[1].trim() : null;

  // Viewport
  const viewportMatch = html.match(/<meta[^>]*\bname=["']viewport["'][^>]*\bcontent=["']([^"']+)["']/i) ||
                        html.match(/<meta[^>]*\bcontent=["']([^"']+)["'][^>]*\bname=["']viewport["']/i);
  const viewport = viewportMatch ? viewportMatch[1].trim() : null;

  // Description
  const descMatch = html.match(/<meta[^>]*\bname=["']description["'][^>]*\bcontent=["']([^"']+)["']/i) ||
                    html.match(/<meta[^>]*\bcontent=["']([^"']+)["'][^>]*\bname=["']description["']/i);
  const description = descMatch ? descMatch[1].trim() : null;

  // Canonical
  const canonicalMatch = html.match(/<link[^>]*\brel=["']canonical["'][^>]*\bhref=["']([^"']+)["']/i) ||
                         html.match(/<link[^>]*\bhref=["']([^"']+)["'][^>]*\brel=["']canonical["']/i);
  const canonical = canonicalMatch ? canonicalMatch[1].trim() : null;

  // OpenGraph
  const og = {};
  const ogRegex = /<meta[^>]*\bproperty=["']og:([^"']+)["'][^>]*\bcontent=["']([^"']+)["']/gi;
  let ogMatch;
  while ((ogMatch = ogRegex.exec(html)) !== null) {
    og[ogMatch[1].toLowerCase()] = ogMatch[2].trim();
  }

  // Twitter Cards
  const twitter = {};
  const twRegex = /<meta[^>]*\bname=["']twitter:([^"']+)["'][^>]*\bcontent=["']([^"']+)["']/gi;
  let twMatch;
  while ((twMatch = twRegex.exec(html)) !== null) {
    twitter[twMatch[1].toLowerCase()] = twMatch[2].trim();
  }

  // Headings
  const getHeadings = (tag) => {
    const list = [];
    const re = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'gi');
    let m;
    while ((m = re.exec(html)) !== null) {
      const text = m[1].replace(/<[^>]+>/g, '').trim();
      if (text) list.push(text);
    }
    return list;
  };

  const h1 = getHeadings('h1');
  const h2 = getHeadings('h2');
  const h3 = getHeadings('h3');

  // Images
  const imgRegex = /<img\b([^>]*)>/gi;
  let imgMatch;
  let totalImg = 0;
  let missingAlt = 0;
  const imgItems = [];
  while ((imgMatch = imgRegex.exec(html)) !== null) {
    totalImg += 1;
    const attrs = imgMatch[1];
    const srcMatch = attrs.match(/\bsrc=["']([^"']+)["']/i);
    const altMatch = attrs.match(/\balt=["']([^"']*)["']/i);
    const src = srcMatch ? srcMatch[1] : '';
    const alt = altMatch ? altMatch[1].trim() : null;
    const hasAlt = alt !== null && alt.length > 0;
    if (!hasAlt) missingAlt += 1;
    imgItems.push({ src, alt, hasAlt });
  }

  // Links
  const linkRegex = /<a\b([^>]*)>([\s\S]*?)<\/a>/gi;
  let linkMatch;
  let totalLinks = 0;
  let emptyLinks = 0;
  let internalLinks = 0;
  let externalLinks = 0;
  while ((linkMatch = linkRegex.exec(html)) !== null) {
    totalLinks += 1;
    const attrs = linkMatch[1];
    const body = linkMatch[2].replace(/<[^>]+>/g, '').trim();
    const hrefMatch = attrs.match(/\bhref=["']([^"']*)["']/i);
    const href = hrefMatch ? hrefMatch[1].trim() : '';
    if (!href || href === '#' || (!body && !attrs.includes('<img'))) {
      emptyLinks += 1;
    }
    if (href.startsWith('http://') || href.startsWith('https://') || href.startsWith('//')) {
      externalLinks += 1;
    } else if (href && !href.startsWith('mailto:') && !href.startsWith('tel:')) {
      internalLinks += 1;
    }
  }

  return {
    title,
    description,
    viewport,
    canonical,
    lang,
    og,
    twitter,
    h1,
    h2,
    h3,
    images: { total: totalImg, missingAlt, items: imgItems },
    links: { total: totalLinks, empty: emptyLinks, internal: internalLinks, external: externalLinks },
  };
}

export function scorePage(meta) {
  let score = 100;
  const issues = [];
  const passed = [];

  // Title check
  if (!meta.title) {
    score -= 20;
    issues.push({ id: 'title-missing', severity: 'critical', message: 'Missing <title> tag' });
  } else if (meta.title.length < 20) {
    score -= 5;
    issues.push({ id: 'title-short', severity: 'warning', message: `Title is very short (${meta.title.length} chars, optimal: 30-60)` });
  } else if (meta.title.length > 65) {
    score -= 5;
    issues.push({ id: 'title-long', severity: 'warning', message: `Title is long (${meta.title.length} chars, may truncate in SERP)` });
  } else {
    passed.push({ id: 'title-ok', message: `Title tag optimal length (${meta.title.length} chars)` });
  }

  // Meta description check
  if (!meta.description) {
    score -= 15;
    issues.push({ id: 'desc-missing', severity: 'critical', message: 'Missing meta description' });
  } else if (meta.description.length < 50) {
    score -= 5;
    issues.push({ id: 'desc-short', severity: 'warning', message: `Meta description is short (${meta.description.length} chars, optimal: 120-160)` });
  } else if (meta.description.length > 170) {
    score -= 5;
    issues.push({ id: 'desc-long', severity: 'warning', message: `Meta description is long (${meta.description.length} chars, may truncate in SERP)` });
  } else {
    passed.push({ id: 'desc-ok', message: `Meta description optimal length (${meta.description.length} chars)` });
  }

  // H1 check
  if (meta.h1.length === 0) {
    score -= 15;
    issues.push({ id: 'h1-missing', severity: 'critical', message: 'No <h1> heading found on page' });
  } else if (meta.h1.length > 1) {
    score -= 8;
    issues.push({ id: 'h1-multiple', severity: 'warning', message: `Multiple <h1> headings found (${meta.h1.length}). Best practice is exactly 1.` });
  } else {
    passed.push({ id: 'h1-ok', message: 'Single clear <h1> heading found' });
  }

  // Viewport check
  if (!meta.viewport) {
    score -= 15;
    issues.push({ id: 'viewport-missing', severity: 'critical', message: 'Missing mobile viewport meta tag' });
  } else {
    passed.push({ id: 'viewport-ok', message: 'Mobile viewport configured' });
  }

  // Lang check
  if (!meta.lang) {
    score -= 10;
    issues.push({ id: 'lang-missing', severity: 'warning', message: 'Missing lang attribute on <html> element' });
  } else {
    passed.push({ id: 'lang-ok', message: `Language specified (${meta.lang})` });
  }

  // Alt text check
  if (meta.images.missingAlt > 0) {
    const penalty = Math.min(15, meta.images.missingAlt * 3);
    score -= penalty;
    issues.push({
      id: 'alt-missing',
      severity: meta.images.missingAlt > 2 ? 'warning' : 'minor',
      message: `${meta.images.missingAlt} of ${meta.images.total} images missing alt text`,
    });
  } else if (meta.images.total > 0) {
    passed.push({ id: 'alt-ok', message: `All ${meta.images.total} images have alt text` });
  }

  // OpenGraph check
  const hasOg = meta.og.title && (meta.og.description || meta.og.image);
  if (!hasOg) {
    score -= 10;
    issues.push({ id: 'og-incomplete', severity: 'warning', message: 'Incomplete OpenGraph tags for social sharing' });
  } else {
    passed.push({ id: 'og-ok', message: 'OpenGraph metadata configured' });
  }

  // Empty links check
  if (meta.links.empty > 0) {
    score -= Math.min(10, meta.links.empty * 2);
    issues.push({ id: 'links-empty', severity: 'warning', message: `${meta.links.empty} empty or uninformative links found` });
  }

  return {
    score: Math.max(0, Math.min(100, score)),
    grade: score >= 90 ? 'A' : score >= 80 ? 'B' : score >= 70 ? 'C' : score >= 60 ? 'D' : 'F',
    issues,
    passed,
  };
}

export function generateProposals(pagePath, meta, scoring) {
  const proposals = [];

  if (!meta.title) {
    const fallbackTitle = meta.h1[0] || 'Welcome';
    proposals.push({
      id: `prop-title-${pagePath}`,
      target_file: pagePath,
      type: 'add_title',
      title: 'Add page title',
      instruction: `Add <title>${fallbackTitle}</title> inside <head>`,
      code_diff: `+ <title>${fallbackTitle}</title>`,
    });
  }

  if (!meta.description) {
    const fallbackDesc = meta.h1[0] ? `${meta.h1[0]} - Official website and information.` : 'Official website information.';
    proposals.push({
      id: `prop-desc-${pagePath}`,
      target_file: pagePath,
      type: 'add_meta_description',
      title: 'Add meta description',
      instruction: `Add <meta name="description" content="${fallbackDesc}">`,
      code_diff: `+ <meta name="description" content="${fallbackDesc}">`,
    });
  }

  if (meta.images.missingAlt > 0) {
    proposals.push({
      id: `prop-alt-${pagePath}`,
      target_file: pagePath,
      type: 'add_alt_text',
      title: 'Add descriptive alt text to images',
      instruction: `Add descriptive alt attributes to ${meta.images.missingAlt} image tags`,
      code_diff: `- <img src="..." />\n+ <img src="..." alt="Descriptive visual caption" />`,
    });
  }

  if (!meta.og.title) {
    const ogTitle = meta.title || meta.h1[0] || 'Home';
    proposals.push({
      id: `prop-og-${pagePath}`,
      target_file: pagePath,
      type: 'add_opengraph',
      title: 'Add social share metadata (OpenGraph)',
      instruction: `Add og:title and og:description tags`,
      code_diff: `+ <meta property="og:title" content="${ogTitle}">\n+ <meta property="og:type" content="website">`,
    });
  }

  return proposals;
}

export function createSeo({ paths }) {
  const pageKernel = createPage({ paths });

  function analyze(siteId) {
    const pageList = pageKernel.list(siteId);
    if (pageList.status === 'NOT_FOUND' || !pageList.pages.length) {
      return {
        site_id: siteId,
        status: pageList.status === 'NOT_FOUND' ? 'NOT_FOUND' : 'empty',
        score: 0,
        grade: 'N/A',
        pages_count: 0,
        pages: [],
        checklist: [],
        proposals: [],
      };
    }

    const analyzedPages = [];
    let totalScore = 0;
    const allProposals = [];
    const siteIssues = [];

    for (const pageEntry of pageList.pages) {
      try {
        const pageData = pageKernel.get(siteId, pageEntry.path);
        const meta = extractSeoMeta(pageData.html);
        const scoring = scorePage(meta);
        const proposals = generateProposals(pageEntry.path, meta, scoring);

        totalScore += scoring.score;
        allProposals.push(...proposals);

        analyzedPages.push({
          path: pageEntry.path,
          title: meta.title,
          description: meta.description,
          h1: meta.h1,
          score: scoring.score,
          grade: scoring.grade,
          issues: scoring.issues,
          passed: scoring.passed,
          meta,
          proposals,
          preview: {
            google: {
              title: meta.title || meta.h1[0] || pageEntry.path,
              url: `https://${siteId}.com/${pageEntry.path === 'index.html' ? '' : pageEntry.path}`,
              description: meta.description || 'No meta description provided for this page.',
            },
            social: {
              title: meta.og.title || meta.title || meta.h1[0] || siteId,
              description: meta.og.description || meta.description || 'Website overview and details.',
              image: meta.og.image || null,
              domain: `${siteId}.com`,
            },
          },
        });
      } catch (err) {
        siteIssues.push({ path: pageEntry.path, error: err.message });
      }
    }

    const avgScore = analyzedPages.length ? Math.round(totalScore / analyzedPages.length) : 0;

    return {
      site_id: siteId,
      status: 'available',
      score: avgScore,
      grade: avgScore >= 90 ? 'A' : avgScore >= 80 ? 'B' : avgScore >= 70 ? 'C' : avgScore >= 60 ? 'D' : 'F',
      pages_count: analyzedPages.length,
      pages: analyzedPages,
      proposals: allProposals,
      errors: siteIssues,
    };
  }

  return { analyze, extractSeoMeta, scorePage, generateProposals };
}
