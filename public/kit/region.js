// Region state machine. Fetches `endpoint` and renders one of
// loading | available | empty | not_implemented | not_found | error | stale
// into `el` (convention 7).
//
// createRegion(el, { endpoint, render })
//   render(data, ctx) is called for the "available" state with the parsed
//   response body. Return a Node (or nothing, if it manages `el` itself via
//   ctx.body, the element reserved for content below the status line).
//
// A late response from a superseded fetch is discarded using a monotonic
// per-region request generation counter.
//
// `not_implemented` is its own terminal state, distinct from `empty`. A
// server module may honestly report `{ status: "not_implemented", reason }`
// when it has not built a real reader yet (e.g. proofs, deployments, builds,
// automations) -- that is not the same claim as "the collection was read and
// it is empty". Rendering both the same way would let a truthful backend
// answer get flattened into a comforting lie by the console. This state
// is checked before the generic empty-array inference below so an
// `not_implemented` body that happens to carry empty arrays (e.g.
// `{ status: "not_implemented", entries: [] }`) is never misread as empty.
//
// `not_configured` is a distinct state again: "a real reader exists, but
// nothing on this machine has ever connected/emitted for it" (e.g. proofs
// before any famtasticdesigns integration has ever written a proof event).
// Before this, a body with `status: "not_configured"` matched none of the
// explicit branches below and fell through to the generic empty-array
// inference, so a genuine "never configured" state rendered identically to
// "we read a real, configured source and it happened to be empty" -- exactly
// the collapse honest states exist to prevent. It shares not_implemented's
// visual family (both mean "nothing to show because the capability/source
// isn't wired up", as opposed to empty's "wired up, read, and genuinely
// nothing there") but carries its own modifier class and copy so it is never
// mistaken for either.
//
// `error` and `partial` are body-level substatuses a 200 response can carry
// (distinct from the network/HTTP-level error path above): `error` means the
// endpoint read but could not produce anything honest to show (e.g. every
// evidence source was unreadable); `partial` means some of the underlying
// sources could not be read but others were, so the readable data renders
// with a named gap rather than being hidden behind a full error.

function setStatus(el, text, modifier) {
  el.innerHTML = "";
  const status = document.createElement("div");
  status.className = `region__status${modifier ? ` region__status--${modifier}` : ""}`;
  status.textContent = text;
  el.appendChild(status);
  return status;
}

// Emptiness must be decided from a NAMED collection. Guessing "the first array in
// the body" made object key order load-bearing: a response carrying both a
// populated metadata array and an empty items array would render either way
// depending on which key came first, and a page's own renderer could be skipped
// entirely. Pages now name their collection; inference is a fallback that only
// fires when the body has exactly one array, so it cannot silently pick wrong.
function resolveCollection(body, collectionKey) {
  if (collectionKey) {
    return Object.prototype.hasOwnProperty.call(body, collectionKey) ? body[collectionKey] : null;
  }
  const arrays = Object.values(body).filter(Array.isArray);
  return arrays.length === 1 ? arrays[0] : null;
}

export function createRegion(el, { endpoint, render, collection: collectionKey = null }) {
  if (!el) throw new Error("createRegion requires an element");
  if (!endpoint) throw new Error("createRegion requires an endpoint");

  el.classList.add("region");
  el.setAttribute("aria-live", "polite");
  el.setAttribute("aria-atomic", "true");
  // Records the endpoint this region is backed by directly on the DOM node so
  // external verification (the Playwright smoke script) can re-fetch the same
  // endpoint and cross-check the rendered state against the real response body,
  // instead of guessing which endpoint produced which region.
  el.dataset.regionEndpoint = endpoint;
  // Publish the collection key so external checks (the smoke's honesty
  // cross-check) can derive the SAME expected state this region will render.
  // Without it the two sides use different rules and disagree on honest data.
  if (collectionKey) el.dataset.regionCollection = collectionKey;

  let generation = 0;
  let lastGoodData = null;
  let lastGoodBody = null;

  async function run() {
    const myGeneration = ++generation;
    const isRefresh = lastGoodData !== null;

    if (!isRefresh) {
      setStatus(el, "Loading...", "loading");
    }

    let response;
    try {
      response = await fetch(endpoint, { headers: { Accept: "application/json" } });
    } catch (err) {
      if (myGeneration !== generation) return;
      return renderError(`Network error contacting ${endpoint}: ${err.message}`, isRefresh);
    }

    if (myGeneration !== generation) return; // superseded by a later request

    let body = null;
    let parseFailed = false;
    try {
      body = await response.json();
    } catch {
      parseFailed = true;
    }

    if (myGeneration !== generation) return; // superseded during body read

    if (!response.ok) {
      if (
        response.status === 400 &&
        body &&
        typeof body === "object" &&
        body.error === "identity_required"
      ) {
        return renderEmpty({
          note: "No site selected. Choose a site to see this page's data.",
          source: "identity_required",
        });
      }
      const message = (body && typeof body === "object" && body.message) || response.statusText || "request failed";
      return renderError(`${endpoint} returned ${response.status}: ${message}`, isRefresh);
    }

    if (parseFailed || body === null || typeof body !== "object" || Array.isArray(body)) {
      return renderError(`${endpoint} returned a non-object response body`, isRefresh);
    }

    if (body.status === "NOT_FOUND") {
      return renderNotFound({
        note: body.note || body.message || "Not found.",
        source: body.source || body.root || null,
      });
    }

    if (body.status === "not_implemented") {
      return renderNotImplemented({
        reason: body.reason || body.note || body.message || null,
        source: body.source || null,
      });
    }

    if (body.status === "not_configured") {
      return renderNotConfigured({
        reason: body.reason || body.note || body.message || null,
        source: body.source || null,
      });
    }

    if (body.status === "error") {
      return renderError(`${endpoint} reported status "error": ${body.reason || body.note || body.message || "unknown error"}`, isRefresh);
    }

    if (body.status === "empty") {
      return renderEmpty({
        note: body.note || "This collection is empty.",
        source: body.source || null,
      });
    }

    if (body.status === "partial") {
      const partialCollection = resolveCollection(body, collectionKey);
      if (!Array.isArray(partialCollection) || partialCollection.length === 0) {
        return renderError(`${endpoint} reported status "partial" with no readable data: ${body.reason || body.note || "some sources could not be read"}`, isRefresh);
      }
      lastGoodData = body;
      lastGoodBody = body;
      el.innerHTML = "";
      const banner = document.createElement("div");
      banner.className = "region__banner region__banner--partial";
      banner.textContent = `Partial: ${body.reason || body.note || "some sources could not be read; showing what is available."}`;
      el.appendChild(banner);
      const renderedPartial = render ? render(body, { endpoint }) : null;
      if (renderedPartial instanceof Node) el.appendChild(renderedPartial);
      return;
    }

    const collection = resolveCollection(body, collectionKey);
    if (Array.isArray(collection) && collection.length === 0) {
      return renderEmpty({
        note: body.note || "This collection is empty.",
        source: body.source || null,
      });
    }

    lastGoodData = body;
    lastGoodBody = body;
    el.innerHTML = "";
    const rendered = render ? render(body, { endpoint }) : null;
    if (rendered instanceof Node) el.appendChild(rendered);
  }

  function renderEmpty({ note, source }) {
    el.innerHTML = "";
    const status = document.createElement("div");
    status.className = "region__status region__status--empty";
    status.textContent = source ? `${note} (source: ${source})` : note;
    el.appendChild(status);
  }

  // NOT_FOUND: a real read that found nothing at the configured root/path.
  // Visually related to empty (same neutral dashed treatment app.css already
  // defines for region__status--empty) but carries its own modifier class so
  // it is never confused with "the collection was read and is empty" by
  // anything inspecting the DOM (including the smoke script).
  function renderNotFound({ note, source }) {
    el.innerHTML = "";
    const status = document.createElement("div");
    status.className = "region__status region__status--empty region__status--not-found";
    status.textContent = `Not found: ${source ? `${note} (source: ${source})` : note}`;
    el.appendChild(status);
  }

  // not_implemented: the server module has not built a real reader yet and
  // says so honestly (see server/modules/{operations,platform}/index.js).
  // This must never look like a normal empty state or a success -- it is a
  // gap in the backend, not an absence of data. region.js owns no CSS file
  // in this tree (public/app.css belongs to a different lane's ownership),
  // so the distinct look is applied inline using the same --color-warn
  // tokens app.css already defines for warnings, rather than depending on a
  // stylesheet rule that does not exist yet.
  function renderNotImplemented({ reason, source }) {
    el.innerHTML = "";
    const status = document.createElement("div");
    status.className = "region__status region__status--not-implemented";
    const text = reason || "This capability is not implemented on the server yet.";
    status.textContent = source ? `Not implemented: ${text} (source: ${source})` : `Not implemented: ${text}`;
    status.style.color = "var(--color-warn)";
    status.style.background = "var(--color-warn-bg)";
    status.style.border = "1px solid var(--color-warn)";
    status.style.borderRadius = "var(--radius-md)";
    el.appendChild(status);
  }

  // not_configured: a real reader exists but nothing on this machine has
  // ever configured/emitted for it (see kernel/proofs.js's not_configured
  // state). Shares not_implemented's DOM class (so external tooling that
  // classifies by that class treats it as the same family of "nothing to
  // show because it isn't wired up") but carries its own modifier and copy
  // so it is never confused with a built reader that legitimately found
  // nothing (renderEmpty) or with a reader the server has not built at all
  // (renderNotImplemented). Distinct from empty is the honest-states
  // requirement this exists to satisfy.
  function renderNotConfigured({ reason, source }) {
    el.innerHTML = "";
    const status = document.createElement("div");
    status.className = "region__status region__status--not-implemented region__status--not-configured";
    const text = reason || "This capability has not been configured on this machine yet.";
    status.textContent = source ? `Not configured: ${text} (source: ${source})` : `Not configured: ${text}`;
    status.style.color = "var(--color-warn)";
    status.style.background = "var(--color-warn-bg)";
    status.style.border = "1px solid var(--color-warn)";
    status.style.borderRadius = "var(--radius-md)";
    el.appendChild(status);
  }

  function renderError(message, isRefresh) {
    if (isRefresh && lastGoodBody) {
      // Keep the last good render visible, but surface a stale banner.
      el.innerHTML = "";
      const status = document.createElement("div");
      // Stale gets its own class. Reusing the error class left the theme with no
      // hook to distinguish "this data is old" from "this failed", which are
      // different things for an operator: one still shows usable data.
      status.className = "region__status region__status--stale";
      status.textContent = `Stale: ${message}`;
      el.appendChild(status);
      const rendered = render ? render(lastGoodBody, { endpoint, stale: true }) : null;
      if (rendered instanceof Node) el.appendChild(rendered);
      return;
    }
    setStatus(el, message, "error");
  }

  run();

  return {
    refresh: run,
  };
}
