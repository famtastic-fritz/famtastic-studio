/**
 * diffView() — before and after, with what changed made explicit.
 *
 * Two modes, because they answer different questions:
 *   'text'   what words changed
 *   'visual' what the page looks like either side of the change
 *
 * A review surface that only shows the AFTER is asking the operator to trust a
 * change they cannot inspect. Both sides are always rendered, and an empty side
 * is labelled rather than blank.
 */
export function diffView({ before = '', after = '', mode = 'text', beforeLabel = 'Before', afterLabel = 'After' } = {}) {
  const el = document.createElement('div');
  el.className = `kit-diff kit-diff-${mode}`;

  const side = (label, content, cls) => {
    const s = document.createElement('div');
    s.className = `kit-diff-side ${cls}`;
    const h = document.createElement('div');
    h.className = 'kit-diff-label';
    h.textContent = label;
    s.appendChild(h);
    if (mode === 'visual') {
      if (content) {
        const img = document.createElement('img');
        img.src = content;
        img.alt = `${label} rendering`;
        img.className = 'kit-diff-img';
        s.appendChild(img);
      } else {
        const p = document.createElement('p');
        p.className = 'kit-diff-missing';
        // Never a blank box: a missing capture and an unchanged page look
        // identical when both render as nothing.
        p.textContent = 'No capture for this side';
        s.appendChild(p);
      }
    } else {
      const pre = document.createElement('pre');
      pre.className = 'kit-diff-text';
      pre.textContent = content || '';
      if (!content) {
        pre.classList.add('kit-diff-missing');
        pre.textContent = '(empty)';
      }
      s.appendChild(pre);
    }
    return s;
  };

  el.appendChild(side(beforeLabel, before, 'kit-diff-before'));
  el.appendChild(side(afterLabel, after, 'kit-diff-after'));

  if (mode === 'text' && before === after) {
    const same = document.createElement('p');
    same.className = 'kit-diff-identical';
    same.textContent = 'Both sides are identical — this change is a no-op.';
    el.appendChild(same);
  }
  return el;
}
