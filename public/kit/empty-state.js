/**
 * emptyState() — an honest state, with the reason it is that state.
 *
 * WHY `reason` IS REQUIRED FOR ANYTHING BUT `available`
 *
 * "No data" without a reason is indistinguishable from a broken fetch. This
 * project has repeatedly found surfaces that rendered empty and looked calm
 * while something upstream had failed: a page with all its parts and none of its
 * substance, a stage skipped rather than run, a slot unfilled rather than
 * declined. An empty panel that cannot say WHY it is empty is the same failure
 * wearing a different hat.
 *
 * States are A14's: loading | available | empty | not_implemented | not_found |
 * error | stale. Plus `not_proven`, which a truth surface needs: "we could not
 * check" is not "we checked and it is fine", and collapsing the two is how a
 * truth surface becomes a document viewer with extra steps.
 */
export const HONEST_STATES = [
  'loading', 'available', 'empty', 'not_implemented',
  'not_found', 'error', 'stale', 'not_proven',
];

const NEEDS_REASON = new Set(['empty', 'not_implemented', 'not_found', 'error', 'stale', 'not_proven']);

const LABEL = {
  loading: 'Loading',
  empty: 'Nothing here yet',
  not_implemented: 'Not built yet',
  not_found: 'Not found',
  error: 'Could not load',
  stale: 'Possibly out of date',
  not_proven: 'Not proven',
};

export function emptyState({ state, reason = null, detail = null } = {}) {
  if (!HONEST_STATES.includes(state)) {
    throw new Error(`emptyState: "${state}" is not an honest state. Use one of: ${HONEST_STATES.join(', ')}`);
  }
  if (NEEDS_REASON.has(state) && (!reason || !String(reason).trim())) {
    throw new Error(`emptyState("${state}") requires a reason. An empty panel that cannot say why it is empty is indistinguishable from a broken fetch.`);
  }

  const el = document.createElement('div');
  el.className = `kit-empty kit-empty-${state}`;
  el.dataset.state = state;

  const label = document.createElement('strong');
  label.className = 'kit-empty-label';
  label.textContent = LABEL[state] || state;
  el.appendChild(label);

  if (reason) {
    const r = document.createElement('p');
    r.className = 'kit-empty-reason';
    r.textContent = reason;
    el.appendChild(r);
  }
  if (detail) {
    const d = document.createElement('code');
    d.className = 'kit-empty-detail';
    d.textContent = detail;
    el.appendChild(d);
  }
  return el;
}
