/**
 * toolbar() — actions whose targets are big enough to hit.
 *
 * WCAG 2.2 SC 2.5.8: an interactive target must be at least 24x24 CSS px.
 * That is `mutable: false` in the research record, so it is enforced here in the
 * primitive rather than left to each screen.
 *
 * The editor mockup's floating toolbar FAILS this, and is knowingly not copied.
 * A mockup is directional: its structure and function are the spec, its
 * measurements are not.
 */
export const MIN_TARGET_PX = 24;

export function toolbar({ actions = [], label = 'Actions', floating = false } = {}) {
  const el = document.createElement('div');
  el.className = `kit-toolbar${floating ? ' kit-toolbar-floating' : ''}`;
  el.setAttribute('role', 'toolbar');
  el.setAttribute('aria-label', label);

  for (const action of actions) {
    if (!action || !action.label) continue;
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'kit-toolbar-btn';
    b.textContent = action.label;
    if (action.title) b.title = action.title;
    if (action.danger) b.classList.add('kit-toolbar-danger');
    if (action.disabled) {
      b.disabled = true;
      // A disabled control must say why. "Greyed out with no explanation" is the
      // interface version of an empty panel with no reason.
      b.title = action.disabledReason || action.title || 'Unavailable';
    }
    if (typeof action.onClick === 'function') b.addEventListener('click', action.onClick);
    el.appendChild(b);
  }
  return el;
}
