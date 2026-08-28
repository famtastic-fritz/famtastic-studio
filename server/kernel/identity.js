// A1: (site_id, conversation_id) is bound once at ingress, immutably. No ambient
// fallback, and a conflict between sources is a 409, never a silent preference.
const SITE_RE = /^[a-z0-9][a-z0-9._-]{0,190}$/i;
const CONVO_RE = /^[a-z0-9][a-z0-9._:-]{0,190}$/i;

function pick(name, a, b) {
  const av = (a || '').trim();
  const bv = (b || '').trim();
  if (av && bv && av !== bv) {
    throw Object.assign(new Error(`conflicting ${name}: '${av}' vs '${bv}'`), { statusCode: 409, code: 'identity_conflict' });
  }
  return av || bv || '';
}

export function bindIdentity({ query, headers = {} }, { requireSite = true } = {}) {
  const siteId = pick('site_id', query?.get?.('site_id'), headers['x-site-id']);
  const conversationId = pick('conversation_id', query?.get?.('conversation_id'), headers['x-conversation-id']);

  if (requireSite && !siteId) {
    throw Object.assign(new Error('site_id is required; this server has no current-site state'), { statusCode: 400, code: 'identity_required' });
  }
  if (siteId && !SITE_RE.test(siteId)) {
    throw Object.assign(new Error('invalid site_id'), { statusCode: 400, code: 'identity_invalid' });
  }
  if (conversationId && !CONVO_RE.test(conversationId)) {
    throw Object.assign(new Error('invalid conversation_id'), { statusCode: 400, code: 'identity_invalid' });
  }
  return Object.freeze({ site_id: siteId || null, conversation_id: conversationId || null });
}
