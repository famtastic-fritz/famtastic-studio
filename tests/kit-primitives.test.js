import { describe, it, expect, beforeEach } from 'vitest';

// The kit primitives are DOM-producing, so they need a document. jsdom is not a
// dependency here, so a minimal document shim is built from the same primitives
// the kit actually uses. If the kit starts needing more of the DOM than this
// provides, the shim fails loudly rather than silently passing.
function installDom() {
  const make = (tag) => {
    const node = {
      tagName: tag.toUpperCase(), children: [], className: '', textContent: '',
      dataset: {}, style: {}, attributes: {}, disabled: false, title: '', type: '', src: '', alt: '',
      appendChild(c) { this.children.push(c); return c; },
      setAttribute(k, v) { this.attributes[k] = v; },
      getAttribute(k) { return this.attributes[k]; },
      addEventListener() {},
      classList: {
        add(...c) { node.className = `${node.className} ${c.join(' ')}`.trim(); },
        contains(c) { return node.className.split(/\s+/).includes(c); },
      },
      get text() { return this.textContent; },
    };
    return node;
  };
  globalThis.document = { createElement: make };
}
beforeEach(installDom);

// Walk a produced tree to find text, since the shim has no innerText.
const allText = (n) => [n.textContent, ...(n.children || []).flatMap(allText)].filter(Boolean).join(' ');
const flatten = (n) => [n, ...(n.children || []).flatMap(flatten)];

describe('panel: a panel cannot exist without naming its data source', () => {
  it('throws when no route is given', async () => {
    const { panel } = await import('../public/kit/panel.js');
    expect(() => panel({ title: 'Capability truth' })).toThrow(/requires a route/);
  });

  // B11: every panel displays the API route it reads from. A required argument
  // enforces it; a convention only reminds.
  it('renders the route so it is visible, not just a tooltip', async () => {
    const { panel } = await import('../public/kit/panel.js');
    const el = panel({ title: 'Run ledger', route: '/api/runs' });
    expect(allText(el)).toContain('/api/runs');
  });

  // "This came from an endpoint" and "this was calculated here" are different
  // claims and a reader is entitled to tell them apart.
  it('marks a computed panel differently from a fetched one', async () => {
    const { panel } = await import('../public/kit/panel.js');
    const el = panel({ title: 'Totals', route: 'computed' });
    const badge = flatten(el).find((n) => n.className.includes('kit-route'));
    expect(badge.className).toContain('kit-route-computed');
    expect(badge.textContent).toMatch(/computed on this page/);
  });
});

describe('emptyState: an empty panel must say why it is empty', () => {
  it('rejects a state that is not an honest one', async () => {
    const { emptyState } = await import('../public/kit/empty-state.js');
    expect(() => emptyState({ state: 'fine' })).toThrow(/not an honest state/);
  });

  // "No data" without a reason is indistinguishable from a broken fetch.
  it('requires a reason for every state that is not available or loading', async () => {
    const { emptyState } = await import('../public/kit/empty-state.js');
    for (const state of ['empty', 'not_found', 'error', 'stale', 'not_implemented', 'not_proven']) {
      expect(() => emptyState({ state }), `${state} must require a reason`).toThrow(/requires a reason/);
    }
  });

  it('allows loading and available without one', async () => {
    const { emptyState } = await import('../public/kit/empty-state.js');
    expect(() => emptyState({ state: 'loading' })).not.toThrow();
    expect(() => emptyState({ state: 'available' })).not.toThrow();
  });

  // A truth surface needs to distinguish "could not check" from "checked, fine".
  it('supports not_proven as a first-class state', async () => {
    const { emptyState, HONEST_STATES } = await import('../public/kit/empty-state.js');
    expect(HONEST_STATES).toContain('not_proven');
    const el = emptyState({ state: 'not_proven', reason: 'no probe exists for this capability yet' });
    expect(el.dataset.state).toBe('not_proven');
    expect(allText(el)).toContain('no probe exists');
  });
});

describe('toolbar: targets are big enough to hit', () => {
  it('exposes the WCAG minimum so a screen cannot invent its own', async () => {
    const { MIN_TARGET_PX } = await import('../public/kit/toolbar.js');
    expect(MIN_TARGET_PX).toBe(24);
  });

  it('skips an action with no label rather than rendering an empty button', async () => {
    const { toolbar } = await import('../public/kit/toolbar.js');
    const el = toolbar({ actions: [{ label: 'Undo' }, {}, { onClick() {} }] });
    expect(el.children.length).toBe(1);
  });

  // Greyed out with no explanation is the interface version of an empty panel
  // with no reason.
  it('makes a disabled action explain itself', async () => {
    const { toolbar } = await import('../public/kit/toolbar.js');
    const el = toolbar({ actions: [{ label: 'Publish', disabled: true, disabledReason: 'no working copy to publish' }] });
    expect(el.children[0].disabled).toBe(true);
    expect(el.children[0].title).toBe('no working copy to publish');
  });
});

describe('diffView: both sides, always', () => {
  it('renders a labelled placeholder rather than a blank box for a missing side', async () => {
    const { diffView } = await import('../public/kit/diff.js');
    const el = diffView({ before: '', after: 'new text', mode: 'text' });
    expect(allText(el)).toContain('(empty)');
  });

  it('says so when both sides are identical instead of showing a silent no-op', async () => {
    const { diffView } = await import('../public/kit/diff.js');
    expect(allText(diffView({ before: 'same', after: 'same' }))).toMatch(/identical/);
  });

  // A missing capture and an unchanged page look the same when both render as
  // nothing.
  it('labels a missing visual capture', async () => {
    const { diffView } = await import('../public/kit/diff.js');
    expect(allText(diffView({ before: null, after: 'shot.png', mode: 'visual' }))).toContain('No capture for this side');
  });
});

describe('nav grouping follows the vision, and keeps what the vision omitted', () => {
  it('groups every page into Operate, Produce or Know', async () => {
    const { PAGES, NAV_GROUPS } = await import('../public/kit/shell.js');
    for (const p of PAGES) expect(NAV_GROUPS, `${p.id} has no valid group`).toContain(p.group);
  });

  // RULED 2026-08-26: a design sketch omitting a screen is not a delete
  // instruction.
  it('keeps applications, automations and shadow', async () => {
    const { PAGES } = await import('../public/kit/shell.js');
    const ids = PAGES.map((p) => p.id);
    for (const kept of ['applications', 'automations', 'shadow']) expect(ids).toContain(kept);
  });

  // A nav link to a screen that does not exist is a 404 offered as a feature.
  // Unbuilt screens live in docs/lanes/MANIFEST.json, not in the nav.
  it('offers no nav link to a screen that does not exist yet', async () => {
    const fs = await import('node:fs');
    const { PAGES } = await import('../public/kit/shell.js');
    for (const p of PAGES) {
      const file = `public/pages/${p.id}.html`;
      const isRoot = p.path === '/';
      expect(isRoot || fs.existsSync(file), `${p.id} is in the nav but ${file} does not exist`).toBe(true);
    }
  });

  // shell.js duplicates config/pages.json. A divergence between the two is the
  // same producer/consumer duplication that discarded every media slot name.
  it('mirrors config/pages.json exactly', async () => {
    const fs = await import('node:fs');
    const { PAGES } = await import('../public/kit/shell.js');
    const cfg = JSON.parse(fs.readFileSync('config/pages.json', 'utf8')).pages;
    expect(PAGES.map((p) => `${p.id}:${p.title}:${p.group}`))
      .toEqual(cfg.map((p) => `${p.id}:${p.title}:${p.group}`));
  });

  it('places the editor under Operate, per the vision', async () => {
    const { PAGES } = await import('../public/kit/shell.js');
    expect(PAGES.find((p) => p.id === 'site-view').group).toBe('Operate');
  });
});
