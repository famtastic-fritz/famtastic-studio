/**
 * routeBadge() — renders the API route a panel reads from.
 *
 * `computed` is a legal value and means "derived from data already on this
 * page". It is deliberately rendered differently from a real route, because
 * "this number came from an endpoint" and "this number was calculated here" are
 * different claims and a reader is entitled to tell them apart.
 */
export function routeBadge(route) {
  const el = document.createElement('code');
  const computed = route === 'computed';
  el.className = `kit-route${computed ? ' kit-route-computed' : ''}`;
  el.textContent = computed ? 'computed on this page' : route;
  el.title = computed
    ? 'Derived from data already loaded on this page, not fetched from an endpoint'
    : `This panel reads from ${route}`;
  return el;
}
