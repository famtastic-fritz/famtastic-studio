import { render as renderShell } from '/kit/shell.js';
import { createRegion } from '/kit/region.js';
import { panel } from '/kit/panel.js';
import { pill } from '/kit/pill.js';

const root = renderShell({ pageId: 'gate' });

const params = new URLSearchParams(window.location.search);
const siteId = (params.get('site_id') || '').trim();

const mainSection = document.createElement('section');
mainSection.className = 'gate-screen';
root.appendChild(mainSection);

if (!siteId) {
  const headerEl = document.createElement('div');
  headerEl.className = 'gate-header';
  const heading = document.createElement('h2');
  heading.textContent = 'Quality Gates';
  const subtitle = document.createElement('p');
  subtitle.className = 'card__meta';
  subtitle.textContent = 'Deterministic, accessibility, token adherence, and aesthetic rubric evaluation.';
  headerEl.append(heading, subtitle);

  const empty = document.createElement('div');
  empty.className = 'region__status region__status--empty';
  empty.setAttribute('aria-live', 'polite');
  empty.append('No site_id was given in the URL. ');
  const link = document.createElement('a');
  link.href = '/sites';
  link.textContent = 'Choose a site from your portfolio';
  empty.append(link);
  empty.append(' to inspect its quality gates.');

  mainSection.append(headerEl, empty);
} else {
  const headerEl = document.createElement('div');
  headerEl.className = 'gate-header';
  const heading = document.createElement('h2');
  heading.textContent = `Site: ${siteId}`;
  const subtitle = document.createElement('p');
  subtitle.className = 'card__meta';
  subtitle.textContent = 'Deterministic, accessibility, token adherence, and aesthetic rubric evaluation.';
  headerEl.append(heading, subtitle);

  const regionEl = document.createElement('div');
  mainSection.append(headerEl, regionEl);

  function renderVerdictBanner(data) {
    const verdict = (data.verdict || 'UNKNOWN').toLowerCase();
    const banner = document.createElement('div');
    banner.className = `gate-verdict-banner gate-verdict-banner--${verdict}`;

    const badge = document.createElement('div');
    badge.className = `gate-verdict-badge gate-verdict-badge--${verdict}`;
    badge.textContent = data.verdict || 'UNKNOWN';

    const textWrap = document.createElement('div');
    textWrap.className = 'gate-verdict-text';
    const strong = document.createElement('strong');
    strong.textContent = verdict === 'pass'
      ? 'This build is customer-eligible.'
      : verdict === 'repair'
      ? 'Advisory repairs recommended before customer delivery.'
      : 'This build is not customer-eligible.';
    const p = document.createElement('p');
    p.textContent = data.summary || 'Judgement is on the render, never the markup that produced it.';
    textWrap.append(strong, p);

    banner.append(badge, textWrap);
    return banner;
  }

  function renderLanes(lanes) {
    const wrap = document.createElement('div');
    wrap.className = 'gate-lanes-list';

    for (const l of lanes || []) {
      const row = document.createElement('div');
      row.className = 'gate-lane-row';

      const icon = document.createElement('span');
      icon.className = `gate-lane-status gate-lane-status--${l.status}`;
      // not_computed gets its own glyph, deliberately neither a pass nor a
      // fail mark -- "we did not check" and "we checked and it is fine"
      // must never look the same.
      icon.textContent = l.status === 'pass' ? '✓' : l.status === 'fail' ? '✕' : l.status === 'not_computed' ? '—' : '!';

      const body = document.createElement('div');
      body.className = 'gate-lane-body';
      const name = document.createElement('strong');
      name.textContent = l.name;
      const desc = document.createElement('span');
      desc.textContent = l.summary;
      body.append(name, desc);

      const kindPill = pill({ text: l.kind, variant: l.kind === 'deterministic' ? 'info' : 'dim' });

      row.append(icon, body, kindPill);
      wrap.appendChild(row);
    }
    return wrap;
  }

  function renderTokenAudit(audit) {
    const wrap = document.createElement('div');
    wrap.className = 'gate-token-audit-wrap';

    // audit.computed is false whenever the backend did not walk rendered
    // styles (which is every time, today -- see server/kernel/quality-gate.js).
    // A percentage bar with invented widths would look more precise than a
    // plain sentence and be less true; render the honest sentence instead.
    if (!audit || !audit.computed) {
      const empty = document.createElement('p');
      empty.className = 'region__status region__status--empty';
      empty.textContent = (audit && audit.hint) || 'Not computed.';
      wrap.appendChild(empty);
      return wrap;
    }

    const bar = document.createElement('div');
    bar.className = 'gate-token-bar';
    bar.innerHTML = `
      <div style="width:${audit.on_brand || 0}%;background:var(--color-ok);"></div>
      <div style="width:${audit.near_token || 0}%;background:var(--color-warn);"></div>
      <div style="width:${audit.generic || 0}%;background:#3a3f52;"></div>
    `;

    const legend = document.createElement('div');
    legend.className = 'gate-token-legend';
    legend.innerHTML = `
      <span><i style="background:var(--color-ok)"></i>${audit.on_brand || 0}% on brand tokens</span>
      <span><i style="background:var(--color-warn)"></i>${audit.near_token || 0}% near a token</span>
      <span><i style="background:#3a3f52"></i>${audit.generic || 0}% generic defaults</span>
    `;

    const hint = document.createElement('p');
    hint.className = 'card__meta';
    hint.textContent = audit.hint || '';

    wrap.append(bar, legend, hint);
    return wrap;
  }

  function renderRepairQueue(queue) {
    const wrap = document.createElement('div');
    wrap.className = 'gate-repair-queue-wrap';

    if (!queue || !queue.length) {
      const empty = document.createElement('p');
      empty.className = 'card__meta';
      empty.textContent = 'No active repair items in the queue. All blocking codes are clear.';
      wrap.appendChild(empty);
      return wrap;
    }

    for (const item of queue) {
      const el = document.createElement('div');
      el.className = 'gate-repair-item';

      const head = document.createElement('div');
      head.className = 'gate-repair-header';
      const codePill = pill({ text: item.code, variant: item.severity === 'structural' ? 'bad' : 'warn' });
      const sevNote = document.createElement('span');
      sevNote.className = 'card__meta';
      sevNote.textContent = item.severity === 'structural' ? 'structural · escalates to operator' : 'repairable · bounded attempt';
      head.append(codePill, sevNote);

      const ins = document.createElement('p');
      ins.className = 'gate-repair-instruction';
      ins.textContent = item.instruction;

      el.append(head, ins);
      wrap.appendChild(el);
    }

    const note = document.createElement('p');
    note.className = 'card__meta';
    note.style.marginTop = 'var(--space-2)';
    note.textContent = 'Repair never regenerates the page blindly. Every code maps to a written instruction, structural codes escalate instead of rerolling, and the loop is capped at three.';
    wrap.appendChild(note);

    return wrap;
  }

  function renderCriticPreview(data) {
    const wrap = document.createElement('div');
    wrap.className = 'gate-critic-wrap';

    // No screenshot capture or viewport render happens in this pass (see
    // server/kernel/quality-gate.js -- the aesthetic_critic lane is
    // status: 'not_computed' for the same reason). A bounding-box overlay
    // claiming "1440 & 390 VIEWPORTS CHECKED" used to render here with
    // nothing behind it -- found live before shipping, removed rather than
    // fixed cosmetically, since there is no real evidence to show yet.
    const empty = document.createElement('p');
    empty.className = 'region__status region__status--empty';
    empty.textContent = `No screenshot-based critique was run for ${data.site_id || 'this site'} in this pass -- it would need the capture harness (scripts/capture/render-capture.mjs) plus an isolated model judge, neither of which ran here.`;
    wrap.appendChild(empty);
    return wrap;
  }

  function renderGaps(gaps) {
    const wrap = document.createElement('div');
    wrap.className = 'gate-gaps-wrap';

    if (!gaps || !gaps.length) {
      const empty = document.createElement('p');
      empty.className = 'card__meta';
      empty.textContent = 'No gaps recorded for this site.';
      wrap.appendChild(empty);
      return wrap;
    }

    for (const g of gaps) {
      const row = document.createElement('div');
      row.className = 'gate-gap-row';
      const dot = document.createElement('span');
      dot.className = 'gate-gap-dot';
      const text = document.createElement('div');
      text.className = 'gate-gap-text';
      const strong = document.createElement('strong');
      strong.textContent = g.text;
      const small = document.createElement('small');
      small.textContent = g.detail;
      text.append(strong, small);
      row.append(dot, text);
      wrap.appendChild(row);
    }

    const hint = document.createElement('p');
    hint.className = 'card__meta';
    hint.style.marginTop = 'var(--space-2)';
    hint.textContent = 'What failed and what is missing are different questions. A build may ship with recorded gaps. It may not ship pretending completeness.';
    wrap.appendChild(hint);

    return wrap;
  }

  function renderLimits(limits) {
    const wrap = document.createElement('div');
    wrap.className = 'gate-limits-wrap';

    const p = document.createElement('p');
    p.className = 'card__meta';
    p.style.lineHeight = '1.8';
    p.textContent = (limits || []).join(' · ');

    const note = document.createElement('p');
    note.className = 'card__meta';
    note.style.fontStyle = 'italic';
    note.textContent = 'A proof system that states its own limits is rarer than one that passes.';

    wrap.append(p, note);
    return wrap;
  }

  createRegion(regionEl, {
    collection: 'gate',
    endpoint: `/api/gate?site_id=${encodeURIComponent(siteId)}`,
    render(data) {
      const container = document.createElement('div');
      container.className = 'gate-body-wrap';

      if (data.status === 'NOT_FOUND' || data.status === 'empty') {
        const empty = document.createElement('div');
        empty.className = 'region__status region__status--empty';
        empty.textContent = 'No quality gate data available for this site.';
        container.appendChild(empty);
        return container;
      }

      container.appendChild(renderVerdictBanner(data));

      const grid = document.createElement('div');
      grid.className = 'gate-grid';

      // Left Column
      const leftCol = document.createElement('div');
      leftCol.className = 'gate-column';

      leftCol.appendChild(panel({
        title: 'Quality Lanes',
        route: '/api/gate',
        children: renderLanes(data.lanes || []),
      }));

      leftCol.appendChild(panel({
        title: 'Token Audit',
        route: '/api/gate',
        children: renderTokenAudit(data.token_audit || {}),
      }));

      leftCol.appendChild(panel({
        title: 'Bounded Repair Queue',
        route: '/api/gate',
        children: renderRepairQueue(data.repair_queue || []),
      }));

      // Right Column
      const rightCol = document.createElement('div');
      rightCol.className = 'gate-column';

      rightCol.appendChild(panel({
        title: 'Screenshot-Based Critique',
        route: '/api/gate',
        children: renderCriticPreview(data),
      }));

      rightCol.appendChild(panel({
        title: 'Gaps (Recorded Separately from Failures)',
        route: '/api/gate',
        children: renderGaps(data.gaps || []),
      }));

      rightCol.appendChild(panel({
        title: 'What this Proof Does NOT Establish',
        route: '/api/gate',
        children: renderLimits(data.what_not_proven || []),
      }));

      grid.append(leftCol, rightCol);
      container.appendChild(grid);

      return container;
    },
  });
}
