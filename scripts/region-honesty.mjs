// Region honesty cross-check: re-fetch each region's own endpoint and derive the
// state the region SHOULD be showing, then compare. Split out of
// playwright-smoke.mjs to keep that file under the size rule.

export function findFirstArray(body) {
  for (const value of Object.values(body)) if (Array.isArray(value)) return value;
  return null;
}

// Mirrors public/kit/region.js's run() branching; every refetched outcome maps to
// one required UI state, nothing skipped.
export function deriveExpectedRegionState({ httpStatus, body, parseFailed, collectionKey }) {
  if (httpStatus >= 400) {
    if (httpStatus === 400 && body && typeof body === 'object' && body.error === 'identity_required') return 'empty';
    return 'error';
  }
  if (parseFailed || body === null || typeof body !== 'object' || Array.isArray(body)) return 'error';
  if (body.status === 'NOT_FOUND') return 'not_found';
  if (body.status === 'not_implemented') return 'not_implemented';
  // not_configured is a real, distinct state region.js now renders with its
  // own copy -- but it shares not_implemented's DOM class (both mean
  // "nothing to show because it isn't wired up"), so the ACTUAL rendered
  // state the smoke's DOM classifier can observe is 'not_implemented'. See
  // regionStateSatisfies below for the equivalence this expected value maps
  // through, kept distinct here so this function's own vocabulary stays
  // honest about what body.status actually said.
  if (body.status === 'not_configured') return 'not_configured';
  if (body.status === 'error') return 'error';
  if (body.status === 'empty') return 'empty';
  if (body.status === 'partial') {
    // Mirrors region.js: partial renders as available (with a banner) when
    // there is real data to show, otherwise as an error -- there is nothing
    // honest left to render as empty.
    const collection = collectionKey && Object.prototype.hasOwnProperty.call(body, collectionKey)
      ? body[collectionKey]
      : findFirstArray(body);
    return Array.isArray(collection) && collection.length > 0 ? 'available' : 'error';
  }
  // Use the region's own declared collection when it published one. Guessing the
  // first array made this check disagree with region.js on responses carrying
  // more than one array, for example the Work inbox, whose `sources` list is
  // populated while `items` is legitimately empty.
  const collection = collectionKey && Object.prototype.hasOwnProperty.call(body, collectionKey)
    ? body[collectionKey]
    : findFirstArray(body);
  return Array.isArray(collection) && collection.length === 0 ? 'empty' : 'available';
}

// 'stale' (region__status--error, "Stale:" prefix) is the honest shape of an
// 'error' expectation when a prior good render existed -- never a stand-in for
// any other expected state. 'not_configured' is satisfied by an observed
// 'not_implemented' because region.js renders it in that same DOM-class
// family (see the not_configured comment above and public/kit/region.js's
// renderNotConfigured) -- never a stand-in for empty or any other state.
export const regionStateSatisfies = (expected, actual) =>
  actual === expected ||
  (expected === 'error' && actual === 'stale') ||
  (expected === 'not_configured' && actual === 'not_implemented');

export async function crossCheckRegionHonesty({ baseUrl, regionStates, pageDef, exemptionReason }) {
  const mismatches = [];
  const endpoints = new Set(regionStates.map((r) => r.endpoint).filter(Boolean));

  for (const endpoint of endpoints) {
    let httpStatus = null;
    let body = null;
    let parseFailed = false;
    try {
      const res = await fetch(`${baseUrl}${endpoint}`, { headers: { Accept: 'application/json' } });
      httpStatus = res.status;
      try { body = await res.json(); } catch { parseFailed = true; }
    } catch (error) {
      mismatches.push({ endpoint, reason: `cross-check re-fetch failed: ${error.message}` });
      continue;
    }

    for (const region of regionStates.filter((r) => r.endpoint === endpoint)) {
      // Derived per region, not per endpoint: two regions can share an endpoint
      // while naming different collections within the same response body.
      const expected = deriveExpectedRegionState({ httpStatus, body, parseFailed, collectionKey: region.collectionKey });
      if (regionStateSatisfies(expected, region.state)) continue;
      const apiStatus = body && typeof body === 'object' ? body.status : null;
      mismatches.push({
        page: pageDef.id, endpoint, http_status: httpStatus, api_status: apiStatus,
        region_index: region.index, expected_state: expected, observed_state: region.state,
        reason: `region[${region.index}] on page "${pageDef.id}" rendered '${region.state}' but re-fetching ${endpoint} (http ${httpStatus}) implies '${expected}'`,
      });
    }
  }

  // Convention 7: the page's own configured endpoint must be represented by some
  // region on the page, not just any endpoint.
  if (pageDef.endpoint && !exemptionReason && !regionStates.some((r) => r.endpoint === pageDef.endpoint)) {
    mismatches.push({
      page: pageDef.id, endpoint: pageDef.endpoint,
      reason: `page "${pageDef.id}" is configured with endpoint ${pageDef.endpoint} in config/pages.json but no region on the page is backed by that endpoint`,
    });
  }

  return mismatches;
}
