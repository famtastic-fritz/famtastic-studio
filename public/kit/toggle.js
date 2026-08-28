// A real switch control: <button role="switch" aria-checked>, keyboard-
// operable natively (Enter/Space, being a real <button>), not the cockpit
// mockup's `<div class="toggle" onclick="this.classList.toggle('on')">` --
// that has no ARIA role, no keyboard path, and flips a CSS class with
// nothing behind it. Matches public/kit/toolbar.js's established contract:
// a disabled control must say why (`disabledReason`), and every control
// clears the 24x24px minimum target size (WCAG 2.2 SC 2.5.8).
export function toggle({ checked = false, disabled = false, disabledReason = null, onChange = null, label = null } = {}) {
  if (disabled && !disabledReason) {
    throw new Error('toggle({disabled: true}) requires a disabledReason: a disabled switch must say why.');
  }

  const btn = document.createElement('button');
  btn.type = 'button';
  btn.setAttribute('role', 'switch');
  btn.setAttribute('aria-checked', String(Boolean(checked)));
  btn.className = 'kit-toggle';
  if (checked) btn.classList.add('kit-toggle--on');
  if (label) btn.setAttribute('aria-label', label);

  if (disabled) {
    btn.disabled = true;
    btn.title = disabledReason;
  }

  const track = document.createElement('span');
  track.className = 'kit-toggle__track';
  track.setAttribute('aria-hidden', 'true');
  const thumb = document.createElement('span');
  thumb.className = 'kit-toggle__thumb';
  track.appendChild(thumb);
  btn.appendChild(track);

  btn.addEventListener('click', () => {
    if (btn.disabled) return;
    const next = btn.getAttribute('aria-checked') !== 'true';
    btn.setAttribute('aria-checked', String(next));
    btn.classList.toggle('kit-toggle--on', next);
    if (onChange) onChange(next);
  });

  return btn;
}
