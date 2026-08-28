// Source verification for research: the one place a cited URL is actually
// fetched and judged. Split out of research.js, which crossed the no-monolith
// limit.
//
// The rule this module exists to enforce: a model's claim that a URL supports a
// fact is never trusted on its own. Every distinct source_uri is fetched here,
// once, and only a confirmed response promotes a claim into facts[]. Anything
// unconfirmable lands in rejected[] with a specific reason rather than being
// quietly dropped.
import { sha256Hex } from './packet.js';

// Cap on distinct source URLs fetched per packet. A model that cites fifty
// sources should not turn one research call into fifty network round trips.
const MAX_FACT_URIS_TO_VERIFY = 20;

// Per-fetch ceiling. A source that will not answer in ten seconds is treated as
// unconfirmable rather than allowed to stall the whole packet.
const VERIFY_FETCH_TIMEOUT_MS = 10000;

export function looksLikeHttpUrl(value) {
  if (typeof value !== 'string' || !value.trim()) return false;
  try {
    const parsed = new URL(value.trim());
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

// Real, independent verification of one source_uri: a live fetch (or the
// injected stub, in tests), never a syntactic guess. Returns enough to both
// gate trust (ok/reason) and record honest provenance (status, content type,
// a sha256 of what was actually read) without ever needing the caller to
// trust the model's own account of what is at that URL.
export async function verifySourceUri(uri, { fetchImpl } = {}) {
  const impl = typeof fetchImpl === 'function' ? fetchImpl : globalThis.fetch;
  if (typeof impl !== 'function') return { ok: false, reason: 'no_fetch_available' };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), VERIFY_FETCH_TIMEOUT_MS);
  try {
    const response = await impl(uri, {
      method: 'GET',
      redirect: 'follow',
      signal: controller.signal,
      headers: { 'user-agent': 'site-studio-next-research/1' },
    });
    const status = typeof response?.status === 'number' ? response.status : 0;
    if (status < 200 || status >= 400) return { ok: false, reason: `http_${status || 'unknown'}`, status };
    let bodyHash = null;
    try {
      const text = typeof response.text === 'function' ? await response.text() : '';
      bodyHash = text ? sha256Hex(text) : null;
    } catch {
      // Hashing is bonus provenance, never load-bearing for the ok/fail verdict.
      // NOTE: this catch is broad enough to swallow a programming error too --
      // during the split out of research.js it quietly absorbed a missing
      // sha256Hex import and degraded every hash to null instead of failing.
      bodyHash = null;
    }
    const contentType = response.headers && typeof response.headers.get === 'function' ? response.headers.get('content-type') : null;
    return { ok: true, status, contentType: contentType || null, bodyHash };
  } catch (error) {
    return { ok: false, reason: error?.name === 'AbortError' ? 'timed_out' : (error?.message || 'fetch_error') };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Verifies every distinct source_uri among `candidates` (brief-sourced and/or
 * model-sourced, mixed freely) with a real fetch, one per unique URI no
 * matter how many candidates share it. Never trusts a candidate's own
 * verification_state claim, model or brief -- the returned facts[] entries
 * always carry 'verified' because they are, in this process, right now: a
 * live fetch confirmed the source_uri resolves. A candidate whose source_uri
 * is missing, malformed, or does not resolve is never silently dropped; it
 * lands in `rejected` with an honest, specific reason.
 */
export async function verifyFactCandidates(candidates, { fetchImpl } = {}) {
  const uris = [...new Set(candidates.map((c) => c.source_uri).filter(looksLikeHttpUrl))].slice(0, MAX_FACT_URIS_TO_VERIFY);
  const verdicts = new Map();
  await Promise.all(uris.map(async (uri) => { verdicts.set(uri, await verifySourceUri(uri, { fetchImpl })); }));

  const now = new Date().toISOString();
  const facts = [];
  const rejected = [];
  for (const candidate of candidates) {
    const claim = typeof candidate.claim === 'string' ? candidate.claim.trim() : '';
    if (!claim) continue;
    if (!looksLikeHttpUrl(candidate.source_uri)) {
      rejected.push({ claim, reason: 'no retrievable source_uri was given for this claim; never promoted to facts[] to avoid inventing a source' });
      continue;
    }
    const uri = candidate.source_uri.trim();
    const verdict = verdicts.get(uri);
    if (!verdict || !verdict.ok) {
      rejected.push({
        claim,
        reason: `source_uri ${uri} could not be independently confirmed (${verdict ? verdict.reason : 'not checked'}); not promoted to facts[] on an unconfirmed source`,
      });
      continue;
    }
    // v2: a verified source is necessary but not sufficient. A finding must also
    // say what it is for; without design_use it is rejected here for the same
    // reason an unsourced claim is — it cannot be acted on downstream.
    const designUse = typeof candidate.design_use === 'string' && candidate.design_use.trim() ? candidate.design_use.trim() : null;
    if (!designUse) {
      rejected.push({ claim, reason: 'source confirmed, but no design_use was supplied; a finding that cannot say what it changes is not promoted to facts[]' });
      continue;
    }
    const fact = {
      claim,
      source_uri: uri,
      retrieved_at: now,
      checked_at: now,
      verification_state: 'verified',
      http_status: verdict.status,
      design_use: designUse,
      mutable: typeof candidate.mutable === 'boolean' ? candidate.mutable : true,
    };
    if (verdict.bodyHash) fact.content_sha256 = verdict.bodyHash;
    if (verdict.contentType) fact.content_type = verdict.contentType;
    facts.push(fact);
  }
  return { facts, rejected };
}
