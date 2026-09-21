// Child-process fixture: no provider or other outbound fetch can escape tests.
import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import http from 'node:http';
import https from 'node:https';
const calls = process.env.STAGING_BOOT_CALLS;
const forbidden = () => { fs.appendFileSync(calls, 'unexpected-network\n'); throw new Error('fixture_network_forbidden'); };
http.request = forbidden; http.get = forbidden; https.request = forbidden; https.get = forbidden;
syncBuiltinESMExports();
globalThis.fetch = async (url, options) => {
  if (process.env.STAGING_BOOT_CALLBACK !== '1' || !['https://designs.example.invalid/api/pipeline/site-studio/callback',
    'https://designs.example.invalid/web/api/pipeline/site-studio/callback'].includes(url)) return forbidden();
  fs.appendFileSync(calls, 'synthetic-callback\n');
  if (process.env.STAGING_BOOT_HOLD === '1') await new Promise(resolve => {
    process.once('message', resolve); process.send({ fixture: 'callback-held' });
  });
  const body = JSON.parse(options.body);
  if (body.schema === 'famtastic.site-studio.association-request.v1') {
    return new Response(JSON.stringify({ ok: true, association: { fixture: 'synthetic-grant' } }), { status: 200 });
  }
  return new Response(JSON.stringify({ ok: true }), { status: 200 });
};
// A negative boot test detects credential lookup, not only network access.
if (process.env.STAGING_BOOT_DENY_CREDENTIALS === '1') {
  const original = process.env;
  process.env = new Proxy(original, { get(target, key) {
    if (['SITE_STUDIO_CALLBACK_SECRET', 'SITE_STUDIO_ARTIFACT_SECRET', 'FAMTASTIC_CPANEL_API_TOKEN', 'SITE_STUDIO_REVIEW_AUTHORIZATION'].includes(key)) {
      fs.appendFileSync(calls, 'unexpected-credential-lookup\n'); throw new Error('fixture_credential_lookup_forbidden');
    }
    return target[key];
  } });
}
