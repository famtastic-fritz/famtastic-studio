import crypto from 'node:crypto';

const ACCEPT = '/api/pipeline/staging/accept';
const SELECTED_ACCEPT = '/api/pipeline/selected-staging/accept';

// This is the sole surface exported through the installation's SSH reverse
// forward. The internal Studio UI, source API and other mutation routes are not
// reachable through it. The actual ingress still verifies the same signature.
export function createStagingIngressProxy({ secret, upstream = 'http://127.0.0.1:3400', fetchImpl = fetch }) {
  const target = new URL(upstream);
  if (typeof secret !== 'string' || secret.length < 32 || target.protocol !== 'http:'
    || target.hostname !== '127.0.0.1' || target.pathname !== '/'
    || target.username || target.password || target.search || target.hash) {
    throw new Error('staging_ingress_configuration_invalid');
  }
  return async (req, res) => {
    const reply = (status, body) => {
      if (res.writableEnded || res.destroyed) return;
      res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      res.end(JSON.stringify(body));
    };
    if (req.method === 'GET' && req.url === '/handoff-health') {
      return reply(200, { service: 'selected-staging-ingress', scope: 'signed-staging-accept-only', build_readiness: 'not_asserted' });
    }
    if (req.method !== 'POST' || req.url !== ACCEPT) return reply(404, { error: 'not_found' });
    if (!/^application\/json(?:\s*;.*)?$/i.test(req.headers['content-type'] || '')) return reply(415, { error: 'json_required' });
    try {
      const chunks = []; let size = 0;
      for await (const chunk of req) {
        size += chunk.length;
        if (size > 1024 * 1024) return reply(413, { error: 'request_too_large' });
        chunks.push(chunk);
      }
      const raw = Buffer.concat(chunks);
      const expected = `sha256=${crypto.createHmac('sha256', secret).update(raw).digest('hex')}`;
      const provided = req.headers['x-famtastic-signature'];
      if (typeof provided !== 'string' || Buffer.byteLength(provided) !== Buffer.byteLength(expected)
        || !crypto.timingSafeEqual(Buffer.from(provided), Buffer.from(expected))) return reply(401, { error: 'dispatch_signature_invalid' });
      const result = await fetchImpl(new URL(SELECTED_ACCEPT, target), {
        method: 'POST', body: raw, redirect: 'error', signal: AbortSignal.timeout(35000),
        headers: { 'Content-Type': 'application/json', 'X-FAMtastic-Signature': provided },
      });
      const parts = []; let length = 0;
      for await (const part of result.body || []) {
        length += part.length;
        if (length > 65536) throw new Error('upstream_response_too_large');
        parts.push(part);
      }
      const body = JSON.parse(Buffer.concat(parts).toString('utf8'));
      if (result.status < 200 || result.status > 599) throw new Error('upstream_status_invalid');
      return reply(result.status, body);
    } catch {
      // Never relay raw transport errors, configuration, credentials or bodies.
      return reply(503, { error: 'staging_ingress_unavailable' });
    }
  };
}
