import crypto from 'node:crypto';
import { expect, it, vi } from 'vitest';
import { createStagingCallback } from '../server/kernel/staging-callback.js';
import { selectedArtifactAuthorization } from '../server/kernel/selected-artifact-authorization.js';
import { validateSelectedStagingConfiguration } from '../server/kernel/selected-staging-configuration.js';
import { configuration } from './selected-staging-configuration-fixture.mjs';

it.each(['/api/pipeline/site-studio/callback', '/web/api/pipeline/site-studio/callback'])(
  'configuration and callback support the exact Drupal mount %s', async mount => {
    const endpoint = `https://designs.example.invalid${mount}`, secret = 'synthetic-callback-only';
    const config = configuration(); config.callbackEndpoint = endpoint;
    expect(validateSelectedStagingConfiguration(config).callbackEndpoint).toBe(endpoint);
    const request = vi.fn(async () => ({ status: 200, body: { ok: true } }));
    const callback = createStagingCallback({ endpoint, secret, request });
    expect(request).not.toHaveBeenCalled();
    const body = { schema: 'famtastic.site-studio.association-request.v1', project_id: '42' };
    expect(await callback(body)).toEqual({ ok: true });
    expect(request).toHaveBeenCalledWith(endpoint, expect.objectContaining({ method: 'POST', redirect: 'error', body: JSON.stringify(body),
      headers: { 'Content-Type': 'application/json', 'X-FAMtastic-Signature': 'sha256=' + crypto.createHmac('sha256', secret).update(JSON.stringify(body)).digest('hex') } }));
  });
it.each(['/other/api/pipeline/site-studio/callback', '/web/other/api/pipeline/site-studio/callback',
  '/web/api/pipeline/site-studio/callback/', '/web/api/pipeline/site-studio/callback?token=synthetic',
  '/web/api/pipeline/site-studio/callback#fragment'])(
  'rejects unsupported callback path %s at both boundaries', mount => {
    const endpoint = `https://designs.example.invalid${mount}`;
    const config = configuration(); config.callbackEndpoint = endpoint;
    expect(() => validateSelectedStagingConfiguration(config)).toThrow('callbackEndpoint');
    expect(() => createStagingCallback({ endpoint, secret: 'synthetic', request: vi.fn() })).toThrow('callback_configuration_invalid');
  });
it('existing artifact signer supports /web with exactly the same packet-bound signature', () => {
  const sha = 'a'.repeat(64), secret = 'synthetic-artifact-only', timestamp = 1789600000;
  const route = `/api/site-studio/selected-artifacts/synthetic-request/1/${sha}`;
  const signature = crypto.createHmac('sha256', secret).update(`selected-artifact.v1\nsynthetic-request\n1\n${sha}\n${timestamp}`).digest('hex');
  for (const mount of ['', '/web']) {
    expect(selectedArtifactAuthorization(`https://designs.example.invalid${mount}${route}`, secret, timestamp)).toBe(`FAMtastic-Artifact ${timestamp}:${signature}`);
  }
});
