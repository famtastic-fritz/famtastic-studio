import { render as renderShell } from '/kit/shell.js';
import { createRegion } from '/kit/region.js';
import { panel } from '/kit/panel.js';
import { table } from '/kit/table.js';
import { pill } from '/kit/pill.js';

const root = renderShell({ pageId: 'seo' });

const params = new URLSearchParams(window.location.search);
const siteId = (params.get('site_id') || '').trim();

const mainSection = document.createElement('section');
mainSection.className = 'seo-screen';
root.appendChild(mainSection);

if (!siteId) {
  const headerEl = document.createElement('div');
  headerEl.className = 'seo-header';
  const heading = document.createElement('h2');
  heading.textContent = 'SEO & Metadata';
  const subtitle = document.createElement('p');
  subtitle.className = 'card__meta';
  subtitle.textContent = 'Real-time search engine optimization, meta tags, and social share previews.';
  headerEl.append(heading, subtitle);

  const empty = document.createElement('div');
  empty.className = 'region__status region__status--empty';
  empty.setAttribute('aria-live', 'polite');
  empty.append('No site_id was given in the URL. ');
  const link = document.createElement('a');
  link.href = '/sites';
  link.textContent = 'Choose a site from your portfolio';
  empty.append(link);
  empty.append(' to inspect its SEO health.');

  mainSection.append(headerEl, empty);
} else {
  const headerEl = document.createElement('div');
  headerEl.className = 'seo-header';
  const heading = document.createElement('h2');
  heading.textContent = `Site: ${siteId}`;
  const subtitle = document.createElement('p');
  subtitle.className = 'card__meta';
  subtitle.textContent = 'Real-time search engine optimization, meta tags, and social share previews.';
  headerEl.append(heading, subtitle);

  const regionEl = document.createElement('div');
  mainSection.append(headerEl, regionEl);

  function renderScorePill(score) {
    const variant = score >= 85 ? 'ok' : score >= 70 ? 'warn' : 'bad';
    return pill({ text: `${score} / 100`, variant });
  }

  function renderOverview(data) {
    const wrap = document.createElement('div');
    wrap.className = 'seo-overview-grid';

    const scoreCard = document.createElement('div');
    scoreCard.className = 'card seo-score-card';
    const scoreNum = document.createElement('div');
    scoreNum.className = 'seo-score-number';
    scoreNum.textContent = `${data.score || 0}`;
    const scoreGrade = document.createElement('div');
    scoreGrade.className = 'seo-score-grade';
    scoreGrade.textContent = `Grade: ${data.grade || 'N/A'}`;
    const scoreLabel = document.createElement('div');
    scoreLabel.className = 'card__meta';
    scoreLabel.textContent = `Scanned ${data.pages_count || 0} pages across ${data.site_id || 'site'}`;
    scoreCard.append(scoreNum, scoreGrade, scoreLabel);

    const statsCard = document.createElement('div');
    statsCard.className = 'card seo-stats-card';
    let criticalCount = 0;
    let warnCount = 0;
    let passCount = 0;
    for (const p of data.pages || []) {
      criticalCount += (p.issues || []).filter((i) => i.severity === 'critical').length;
      warnCount += (p.issues || []).filter((i) => i.severity === 'warning').length;
      passCount += (p.passed || []).length;
    }

    const statList = document.createElement('ul');
    statList.className = 'seo-stat-list';
    statList.innerHTML = `
      <li><span class="pill pill--bad">${criticalCount} Critical</span> Needs immediate fix</li>
      <li><span class="pill pill--warn">${warnCount} Warnings</span> Recommended improvements</li>
      <li><span class="pill pill--ok">${passCount} Passed</span> Compliant best practices</li>
      <li><span class="pill pill--info">${(data.proposals || []).length} Proposals</span> Auto-fix blueprints ready</li>
    `;
    statsCard.appendChild(statList);

    wrap.append(scoreCard, statsCard);
    return wrap;
  }

  function renderPreviews(data) {
    const firstPage = (data.pages && data.pages[0]) || null;
    const wrap = document.createElement('div');
    wrap.className = 'seo-previews-container';

    if (!firstPage || !firstPage.preview) return wrap;

    const google = firstPage.preview.google || {};
    const googleCard = document.createElement('div');
    googleCard.className = 'card seo-preview-card';
    googleCard.innerHTML = `
      <h3>Google Search Snippet Preview</h3>
      <div class="google-serp-preview">
        <div class="serp-url">${google.url || 'https://example.com'}</div>
        <div class="serp-title">${google.title || 'Page Title'}</div>
        <div class="serp-desc">${google.description || 'Page meta description...'}</div>
      </div>
    `;

    const social = firstPage.preview.social || {};
    const socialCard = document.createElement('div');
    socialCard.className = 'card seo-preview-card';
    socialCard.innerHTML = `
      <h3>Social Share Preview (OpenGraph)</h3>
      <div class="social-share-preview">
        <div class="social-img-placeholder">${social.image ? `<img src="${social.image}" alt="og"/>` : '<span>No OG Image</span>'}</div>
        <div class="social-meta">
          <div class="social-domain">${social.domain || 'example.com'}</div>
          <div class="social-title">${social.title || 'Social Title'}</div>
          <div class="social-desc">${social.description || 'Social description summary...'}</div>
        </div>
      </div>
    `;

    wrap.append(googleCard, socialCard);
    return wrap;
  }

  function renderProposals(proposals) {
    const list = document.createElement('div');
    list.className = 'seo-proposals-list';
    if (!proposals || !proposals.length) {
      const empty = document.createElement('p');
      empty.className = 'card__meta';
      empty.textContent = 'No pending fix proposals. All basic meta properties are populated.';
      list.appendChild(empty);
      return list;
    }

    for (const prop of proposals) {
      const item = document.createElement('div');
      item.className = 'card seo-proposal-item';
      item.innerHTML = `
        <div class="seo-prop-head">
          <span class="pill pill--info">${prop.type}</span>
          <strong>${prop.title}</strong>
          <span class="card__meta">${prop.target_file}</span>
        </div>
        <p class="seo-prop-ins">${prop.instruction}</p>
        <pre class="seo-prop-diff"><code>${prop.code_diff}</code></pre>
      `;
      list.appendChild(item);
    }
    return list;
  }

  function renderPagesTable(pages) {
    const columns = [
      { key: 'path', label: 'Page Path' },
      { key: 'title', label: 'Title Tag' },
      { key: 'description', label: 'Meta Description' },
      { key: 'h1', label: 'H1 Heading' },
      { key: 'score', label: 'Score' },
    ];

    return table({
      columns,
      rows: pages,
      cellRender(row, col) {
        if (col.key === 'score') return renderScorePill(row.score);
        if (col.key === 'h1') {
          const count = (row.h1 || []).length;
          return count === 1 ? pill({ text: row.h1[0], variant: 'ok' }) : pill({ text: `${count} H1s`, variant: count === 0 ? 'bad' : 'warn' });
        }
        if (col.key === 'title') {
          return row.title ? row.title : pill({ text: 'Missing', variant: 'bad' });
        }
        if (col.key === 'description') {
          return row.description ? `${row.description.slice(0, 60)}...` : pill({ text: 'Missing', variant: 'bad' });
        }
        return row[col.key];
      },
    });
  }

  createRegion(regionEl, {
    collection: 'pages',
    endpoint: `/api/seo?site_id=${encodeURIComponent(siteId)}`,
    render(data) {
      const container = document.createElement('div');
      container.className = 'seo-body-wrap';

      if (data.status === 'NOT_FOUND' || !data.pages || !data.pages.length) {
        const empty = document.createElement('div');
        empty.className = 'region__status region__status--empty';
        empty.textContent = 'No pages available for SEO analysis for this site.';
        container.appendChild(empty);
        return container;
      }

      container.appendChild(renderOverview(data));

      const previewPanel = panel({
        title: 'Search & Social Snippet Previews',
        route: '/api/seo',
        children: renderPreviews(data),
      });
      container.appendChild(previewPanel);

      const pagesPanel = panel({
        title: 'Page Health Audit',
        route: '/api/seo',
        children: renderPagesTable(data.pages || []),
      });
      container.appendChild(pagesPanel);

      const proposalsPanel = panel({
        title: 'Automated Fix Proposals',
        route: '/api/seo',
        children: renderProposals(data.proposals || []),
      });
      container.appendChild(proposalsPanel);

      return container;
    },
  });
}
