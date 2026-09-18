import crypto from 'node:crypto';
import { Readable } from 'node:stream';
import { expect, it } from 'vitest';
import { createStagingIngressProxy } from '../server/kernel/staging-ingress-proxy.js';

const secret = 'synthetic-dispatch-secret-not-for-production';
async function request({ url = '/api/pipeline/staging/accept', method = 'POST', raw = '{"packet":{"id":"one"}}', signature, contentType = 'application/json', fetchImpl } = {}) {
  const req = Readable.from([Buffer.from(raw)]);
  Object.assign(req, { url, method, headers: { 'content-type': contentType, 'x-famtastic-signature': signature ?? `sha256=${crypto.createHmac('sha256', secret).update(raw).digest('hex')}` } });
  let status, data;
  await createStagingIngressProxy({ secret, fetchImpl })(req, {
    writeHead(value) { status = value; }, end(value) { data = JSON.parse(value); },
  });
  return { status, data };
}
it('forwards exact signed bytes to only the local acceptance route', async () => {
  let calls = 0;
  const result = await request({ raw: '{ "packet" : {} }', fetchImpl: async (url, options) => {
    calls++;
    expect(url.href).toBe('http://127.0.0.1:3400/api/pipeline/staging/accept');
    expect(options.body.toString()).toBe('{ "packet" : {} }');
    expect(options.redirect).toBe('error');
    return new Response(JSON.stringify({ accepted: true }), { status: 202 });
  } });
  expect(result).toEqual({ status: 202, data: { accepted: true } }); expect(calls).toBe(1);
});
it('rejects unsigned, oversized, wrong-type and other routes before upstream work', async () => {
  const fetchImpl = () => { throw new Error('must not contact Studio'); };
  for (const url of ['/', '/api/pipeline/run', '/api/pipeline/source/associate', '/api/pipeline/staging/accept?x=1', '/api/pipeline/staging/accept/']) expect((await request({ url, fetchImpl })).status).toBe(404);
  expect((await request({ signature: 'bad', fetchImpl })).status).toBe(401);
  expect((await request({ raw: 'x'.repeat(2 * 1024 * 1024 + 1), fetchImpl })).status).toBe(413);
  expect((await request({ contentType: 'text/plain', fetchImpl })).status).toBe(415);
});
it('reports bounded unavailable responses without leaking upstream errors', async () => {
  for (const fetchImpl of [async () => { throw new Error('secret=hidden'); }, async () => new Response('not JSON'), async () => new Response('x'.repeat(65537))]) {
    expect(await request({ fetchImpl })).toEqual({ status: 503, data: { error: 'staging_ingress_unavailable' } });
  }
});
it('rejects remote upstreams and weak configuration and labels health honestly', async () => {
  for (const upstream of ['https://example.com', 'http://127.0.0.1/other', 'http://localhost:3400', 'http://user:pass@127.0.0.1:3400']) expect(() => createStagingIngressProxy({ secret, upstream })).toThrow();
  expect(() => createStagingIngressProxy({ secret: 'short' })).toThrow();
  expect((await request({ url: '/handoff-health', method: 'GET' })).data.build_readiness).toBe('not_asserted');
});
