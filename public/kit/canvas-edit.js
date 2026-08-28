// Canvas click-to-edit client (Phase 2 contract section 1). This script runs
// INSIDE the instrumented site page (served via srcdoc into the canvas
// iframe by public/pages/site-view/canvas.js), not inside the console shell.
// It talks to /api/sites/edit on the console's own origin -- a srcdoc iframe
// without a sandbox attribute is same-origin with its parent, so a relative
// fetch() here reaches the console server directly.
//
// Flow (BINDING): click selects. A second click, or Enter while selected,
// opens inline editing. Escape cancels and restores the original text.
// Blur or Enter commits: POST /api/sites/edit, then the element is
// re-rendered from that response (finalized, contenteditable turned off)
// rather than assumed to have succeeded before the server confirms it.
//
// Text content edits only (M2 scope). Elements the server did not stamp
// with data-fam-sel (images, structural containers, anything not a single
// text leaf) are not selectable here -- that is the honest "not in this
// milestone" state: no affordance is offered rather than a broken one.
//
// A11y blocker fix (2026-08-22): selection used to be click-only -- the
// server-stamped [data-fam-sel] leaves are plain text nodes with no native
// tab stop, so a keyboard-only operator had no way to reach or activate the
// edit affordance at all (an unreachable interactive control). Every
// selectable element is now given tabIndex=0 and role="button" below, and
// focusing one selects it the same way a click does, so Tab -> Enter drives
// the exact same select -> edit -> commit flow a mouse click does.
(function canvasEdit() {
  const root = document.documentElement;
  const siteId = (document.querySelector('meta[name="fam-site-id"]') || {}).content || '';
  const pagePath = (document.querySelector('meta[name="fam-page-path"]') || {}).content || '';

  const STYLE_ID = 'fam-canvas-edit-style';
  if (!document.getElementById(STYLE_ID)) {
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
      [data-fam-sel] { cursor: pointer; }
      [data-fam-sel]:hover { outline: 1px dashed #5b9dd9; outline-offset: 2px; }
      .fam-selected { outline: 2px solid #5b9dd9 !important; outline-offset: 2px; }
      .fam-editing { outline: 2px solid #4caf72 !important; outline-offset: 2px; cursor: text; }
      #fam-canvas-readout {
        position: fixed; right: 8px; bottom: 8px; z-index: 2147483647;
        font: 11px ui-monospace, monospace; padding: 4px 8px; border-radius: 4px;
        background: rgba(13, 15, 18, 0.9); color: #d9dce1; border: 1px solid #383f49;
        pointer-events: none;
      }
      #fam-canvas-readout[data-state="error"] { color: #d9645b; border-color: #d9645b; }
      #fam-canvas-readout[data-state="ok"] { color: #4caf72; border-color: #4caf72; }
    `;
    document.head.appendChild(style);
  }

  let readout = document.getElementById('fam-canvas-readout');
  if (!readout) {
    readout = document.createElement('div');
    readout.id = 'fam-canvas-readout';
    readout.textContent = siteId && pagePath ? 'Canvas ready. Click, or Tab to, text to select it.' : 'Canvas not fully instrumented (missing site_id/page_path).';
    document.body.appendChild(readout);
  }

  // Make every selectable leaf a real tab stop with an accessible role so a
  // keyboard-only operator can reach it -- it was click-only before. The
  // element's own text is still its accessible name (it's a text leaf), so
  // no aria-label is needed on top of role="button".
  for (const el of document.querySelectorAll('[data-fam-sel]')) {
    if (!el.hasAttribute('tabindex')) el.tabIndex = 0;
    if (!el.hasAttribute('role')) el.setAttribute('role', 'button');
  }

  let selected = null; // currently selected element
  let editing = null; // currently editing element
  let originalText = null;
  let commitStartedAt = null;
  // True from the moment a commit's fetch starts until endEdit() clears it.
  // A click landing on a different element while that fetch is still in
  // flight sees `editing` still set (it is only cleared once the outcome is
  // known) and would otherwise call commitEdit() a second time for the SAME
  // element with the same, now-stale beforeText -- racing the server into a
  // 409 that reverted the canvas to the pre-edit text even though the first
  // commit had already saved successfully. Found live, editing a real page:
  // Enter to save, then immediately clicking the next headline, cost the
  // operator a save that looked lost even though the file was correct.
  let committing = false;

  function clearSelection() {
    if (selected) selected.classList.remove('fam-selected');
    selected = null;
  }

  function select(el) {
    clearSelection();
    if (!el) return; // the node can vanish between click and handler
    selected = el;
    selected.classList.add('fam-selected');
    readout.dataset.state = '';
    readout.textContent = `Selected: ${el.getAttribute('data-fam-sel')}`;
  }

  function beginEdit(el) {
    if (!el || !el.isConnected) return; // node detached since selection
    editing = el;
    originalText = el.textContent;
    el.classList.add('fam-editing');
    el.setAttribute('contenteditable', 'plaintext-only');
    el.focus();
    const range = document.createRange();
    range.selectNodeContents(el);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
    readout.dataset.state = '';
    readout.textContent = 'Editing. Enter or blur to save, Escape to cancel.';
  }

  function cancelEdit() {
    if (!editing) return;
    editing.textContent = originalText;
    endEdit();
    readout.dataset.state = '';
    readout.textContent = 'Edit cancelled.';
  }

  function endEdit() {
    // Removing contenteditable fires blur synchronously, and the blur handler
    // re-enters commitEdit -> endEdit. Clear the shared state FIRST and work from
    // a local, so the re-entrant call is a no-op instead of reading a nulled
    // `editing` halfway through this function.
    const node = editing;
    editing = null;
    originalText = null;
    committing = false;
    if (!node) return;
    node.removeAttribute('contenteditable');
    node.classList.remove('fam-editing');
  }

  async function commitEdit() {
    if (!editing || committing) return;
    committing = true;
    const el = editing;
    const selector = el.getAttribute('data-fam-sel');
    const beforeText = originalText;
    const afterText = el.textContent;
    commitStartedAt = performance.now();

    if (afterText === beforeText) {
      endEdit();
      readout.dataset.state = '';
      readout.textContent = 'No change.';
      return;
    }
    if (!siteId || !pagePath || !selector) {
      el.textContent = beforeText;
      endEdit();
      readout.dataset.state = 'error';
      readout.textContent = 'Cannot save: missing site_id, page_path, or selector.';
      return;
    }

    readout.dataset.state = '';
    readout.textContent = 'Saving...';

    let response;
    try {
      response = await fetch(`/api/sites/edit?site_id=${encodeURIComponent(siteId)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ page_path: pagePath, selector, before_text: beforeText, after_text: afterText }),
      });
    } catch (err) {
      el.textContent = beforeText;
      endEdit();
      readout.dataset.state = 'error';
      readout.textContent = `Network error, not saved: ${err.message}`;
      return;
    }

    let body = null;
    try { body = await response.json(); } catch { /* no body */ }

    if (!response.ok) {
      // 409 stale_selection: the file changed since this page was served.
      // Restore whatever the server reports as the live text when it knows
      // it, otherwise fall back to the pre-edit text -- never keep an
      // unsaved edit displayed as if it were committed.
      el.textContent = (body && body.live_text) || beforeText;
      endEdit();
      const detail = (body && (body.message || body.error)) || response.statusText;
      readout.dataset.state = 'error';
      readout.textContent = `Save failed (${response.status}): ${detail}`;
      return;
    }

    // Re-render from the server response: the edit is only final now that
    // the server has confirmed it journaled and applied it.
    endEdit();
    const editMs = performance.now() - commitStartedAt;
    root.setAttribute('data-fam-edit-ms', String(Math.round(editMs)));
    readout.dataset.state = 'ok';
    const appliedMs = body && typeof body.applied_ms === 'number' ? body.applied_ms.toFixed(1) : 'unknown';
    readout.textContent = `Saved. client=${Math.round(editMs)}ms server=${appliedMs}ms rev=${body ? body.revision : '?'}`;
  }

  document.addEventListener('click', (event) => {
    // The canvas is an editing surface, not a browsable site. Most text on a real
    // page sits inside anchors and buttons, so without this an operator clicking a
    // nav link to retitle it just navigates away and loses the canvas.
    const navigable = event.target.closest('a[href], button, [type="submit"]');
    if (navigable) event.preventDefault();

    const target = event.target.closest('[data-fam-sel]');
    if (editing && target === editing) return; // click while editing: leave text caret alone
    if (editing) {
      // Await the in-flight commit before touching selection. Firing it and
      // selecting in the same tick let a second edit begin mid-commit.
      commitEdit().then(() => { if (target && target.isConnected) select(target); });
      return;
    }
    if (!target) {
      clearSelection();
      if (!editing) {
        readout.dataset.state = '';
        readout.textContent = 'Only text content is editable in this milestone.';
      }
      return;
    }
    if (selected === target) {
      beginEdit(target);
    } else {
      select(target);
    }
  });

  // Keyboard path onto the same select/edit flow the click handler drives:
  // Tab lands on a [data-fam-sel] leaf (now a real tab stop) and this
  // selects it, exactly like a first click does; Enter (handled below)
  // then opens editing, exactly like a second click does.
  document.addEventListener('focusin', (event) => {
    // beginEdit() below calls el.focus() on the element it just set as
    // `editing`, which fires this handler synchronously -- the `editing`
    // check makes that re-entry a no-op instead of overwriting the
    // "Editing..." readout with "Selected: ...".
    const target = event.target.closest && event.target.closest('[data-fam-sel]');
    if (!target || editing) return;
    if (selected === target) return;
    select(target);
  });

  document.addEventListener('submit', (event) => { event.preventDefault(); });
  document.addEventListener('auxclick', (event) => {
    if (event.target.closest('a[href]')) event.preventDefault();
  });

  document.addEventListener('keydown', (event) => {
    if (editing) {
      if (event.key === 'Escape') {
        event.preventDefault();
        cancelEdit();
      } else if (event.key === 'Enter') {
        event.preventDefault();
        commitEdit();
      }
      return;
    }
    if (selected && event.key === 'Enter') {
      event.preventDefault();
      beginEdit(selected);
    }
  });

  document.addEventListener(
    'blur',
    (event) => {
      if (editing && event.target === editing) commitEdit();
    },
    true,
  );
})();
