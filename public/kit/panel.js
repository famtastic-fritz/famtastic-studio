/**
 * panel() — a titled container that MUST name the API route it reads from.
 *
 * WHY `route` IS REQUIRED, NOT OPTIONAL
 *
 * B11 asks that every panel display the route it reads from. Making that a
 * required argument means a panel cannot exist without one: the requirement
 * cannot be forgotten by a screen written later, or by a different agent who
 * never read the contract. A convention is a thing people remember; an argument
 * is a thing the code enforces.
 *
 * It also answers the question this project keeps needing: when a number on
 * screen looks wrong, where did it come from? A panel showing data from nowhere
 * is exactly what a truth surface must not be.
 */
import { routeBadge } from './route-badge.js';

export function panel({ title, route, children = null, actions = null, note = null } = {}) {
  if (!route || typeof route !== 'string') {
    throw new Error(`panel("${title || 'untitled'}") requires a route: every panel must display where its data comes from. Pass the API path, or "computed" for a panel derived from data already on the page.`);
  }

  const el = document.createElement('section');
  el.className = 'kit-panel';

  const head = document.createElement('div');
  head.className = 'kit-panel-head';

  const h = document.createElement('h2');
  h.className = 'kit-panel-title';
  h.textContent = title || '';
  head.appendChild(h);

  head.appendChild(routeBadge(route));

  if (actions) {
    const a = document.createElement('div');
    a.className = 'kit-panel-actions';
    a.appendChild(actions);
    head.appendChild(a);
  }

  el.appendChild(head);

  if (note) {
    const n = document.createElement('p');
    n.className = 'kit-panel-note';
    n.textContent = note;
    el.appendChild(n);
  }

  const body = document.createElement('div');
  body.className = 'kit-panel-body';
  if (children) body.appendChild(children);
  el.appendChild(body);

  // Exposed so a screen can swap the body after a fetch without rebuilding the
  // panel and losing its route.
  el.body = body;
  return el;
}
