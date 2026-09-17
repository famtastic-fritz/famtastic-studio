import crypto from 'node:crypto';
import { stagingError } from './staging-store.js';
// Endpoint is configuration, never a packet-provided callback URL.
export function createStagingCallback({ endpoint, secret, request }) {
  const url = new URL(endpoint);
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || url.pathname !== '/api/pipeline/site-studio/callback' || !secret || !request) throw stagingError('callback_configuration_invalid');
  return async body => {
    const raw = JSON.stringify(body);
    const response = await request(endpoint, { method: 'POST', redirect: 'error', body: raw,
      headers: { 'Content-Type': 'application/json', 'X-FAMtastic-Signature': `sha256=${crypto.createHmac('sha256', secret).update(raw).digest('hex')}` } });
    if (response.status !== 200 || response.body?.ok !== true) throw stagingError('callback_rejected');
    return response.body;
  };
}
