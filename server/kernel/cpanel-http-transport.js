import { digest, stagingError } from './staging-store.js';
import { createReviewBackup } from './review-backup.js';
import { safePublicPath } from './staging-contract.js';

// Real HTTP serialization, with fetch and credentials injected at assembly.
// Never contacts a host merely by importing or constructing this module.
export function createCpanelHttpTransport({ paths, journal, binding, credentialProvider, reviewAuthorization, authFile, fetchImpl = fetch }) {
  const target = structuredClone(binding), url = new URL(target.url);
  if (!/^\/home\/nineoo\/\.famtastic-review\/[a-z0-9-]+\.htpasswd$/.test(authFile || '') || typeof reviewAuthorization !== 'string' || !reviewAuthorization.startsWith('Basic ') || typeof credentialProvider !== 'function') throw stagingError('cpanel_credentials_unbound');
  const privateRoot = '/home/nineoo/.famtastic-review';
  const lockName = `${target.site_id}.lock.json`;
  let operation;
  const scoped = name => {
    if (name !== '.htaccess' && !safePublicPath(name)) throw stagingError('cpanel_path_rejected');
    return `${target.target_path}/${name}`;
  };
  async function api(route, params = {}, form = null) {
    const endpoint = new URL(`https://famtasticinc.com:2083/${route}`);
    for (const [key, value] of Object.entries(params)) endpoint.searchParams.set(key, String(value));
    const token = await credentialProvider();
    if (typeof token !== 'string' || !token) throw stagingError('cpanel_credential_missing');
    let response;
    try { response = await fetchImpl(endpoint.href, { method: form ? 'POST' : 'GET', body: form,
      headers: { Authorization: `cpanel nineoo:${token}` }, redirect: 'error', signal: AbortSignal.timeout(60000) }); }
    catch { throw stagingError('cpanel_request_failed'); }
    if (response.status !== 200) throw stagingError('cpanel_http_failed');
    let json; try { json = await response.json(); } catch { throw stagingError('cpanel_response_invalid'); }
    return json.cpanelresult || json;
  }
  async function uploadAbsolute(dir, name, bytes, overwrite = true) {
    const form = new FormData(); form.set('dir', dir); form.set('overwrite', overwrite ? '1' : '0');
    form.set('file-1', new Blob([bytes]), name);
    const result = await api('execute/Fileman/upload_files', {}, form);
    if (result.status !== 1 || result.data?.failed) throw stagingError('cpanel_upload_failed');
  }
  async function readText(dir, file) {
    const result = await api('execute/Fileman/get_file_content', { dir, file, update_html_document_encoding: 0 });
    if (result.status !== 1 || typeof result.data?.content !== 'string') throw stagingError('cpanel_read_failed');
    return result.data.content;
  }
  async function listing(dir) {
    const result = await api('execute/Fileman/list_files', { dir, show_hidden: 1 });
    if (result.status !== 1 || !Array.isArray(result.data)) throw stagingError('cpanel_listing_failed');
    return result.data;
  }
  async function assertClaim() {
    if (!operation || await readText(privateRoot, lockName) !== operation) throw stagingError('remote_claim_lost');
  }
  async function publicGet(name, authorization = reviewAuthorization, host = url.hostname) {
    const endpoint = new URL(name, target.url); endpoint.hostname = host;
    let response;
    try { response = await fetchImpl(endpoint.href, { headers: authorization ? { Authorization: authorization } : {}, redirect: 'error', signal: AbortSignal.timeout(30000) }); }
    catch { throw stagingError('review_https_failed'); }
    const chunks = []; let size = 0;
    for await (const chunk of response.body || []) {
      size += chunk.length; if (size > 25 * 1024 * 1024) throw stagingError('review_response_too_large'); chunks.push(Buffer.from(chunk));
    }
    const bytes = Buffer.concat(chunks);
    return { status: response.status, bytes, noindex: /noindex/i.test(response.headers.get('x-robots-tag') || ''), https_verified: true };
  }
  async function inventory(relative = '') {
    const dir = relative ? `${target.target_path}/${relative}` : target.target_path;
    const result = [];
    for (const row of await listing(dir)) {
      if (['.', '..'].includes(row.file)) continue;
      const name = relative ? `${relative}/${row.file}` : row.file;
      if (row.type === 'dir') {
        if (!/^[a-zA-Z0-9_-]+(?:\/[a-zA-Z0-9_-]+)*$/.test(name)) throw stagingError('remote_directory_invalid');
        result.push(...await inventory(name));
      } else {
        if (row.type !== 'file') throw stagingError('remote_file_type_invalid');
        scoped(name); result.push(name);
      }
    }
    return result;
  }
  async function readFile(name) {
    scoped(name);
    if (!(await inventory()).includes(name)) return null;
    const result = await publicGet(name);
    if (result.status !== 200) throw stagingError('remote_bytes_unreadable');
    return result.bytes;
  }
  async function writeFile(name, bytes) {
    await assertClaim(); const full = scoped(name), at = full.lastIndexOf('/');
    await uploadAbsolute(full.slice(0, at), full.slice(at + 1), bytes);
  }
  async function trash(full) {
    const result = await api('json-api/cpanel', { cpanel_jsonapi_user: 'nineoo', cpanel_jsonapi_apiversion: 2, cpanel_jsonapi_module: 'Fileman', cpanel_jsonapi_func: 'fileop', op: 'trash', sourcefiles: full.replace('/home/nineoo/', ''), doubledecode: 0 });
    if (result.event?.result !== 1) throw stagingError('cpanel_trash_failed');
  }
  const backups = createReviewBackup({ paths, journal, binding: target, readFile, writeFile, removeFile: async name => { await assertClaim(); await trash(scoped(name)); }, listFiles: () => inventory() });
  return {
    async claim(id) {
      if (!/^[a-zA-Z0-9_-]+$/.test(id)) throw stagingError('operation_invalid');
      const rows = await listing(privateRoot);
      if (!rows.some(r => r.file === lockName)) await uploadAbsolute(privateRoot, lockName, id, false);
      operation = id; await assertClaim();
    },
    async release() { await assertClaim(); await trash(`${privateRoot}/${lockName}`); operation = null; },
    async preflight() {
      await assertClaim();
      const result = await api('execute/DomainInfo/domains_data');
      const domains = [result.data?.main_domain, ...(result.data?.sub_domains || []), ...(result.data?.addon_domains || [])];
      const domain = domains.find(d => d?.domain === url.hostname);
      const expectedRoot = url.pathname === '/' ? target.target_path : `/home/nineoo/public_html`;
      if (result.status !== 1 || domain?.documentroot !== expectedRoot || (url.pathname !== '/' && target.target_path !== `${expectedRoot}${url.pathname.replace(/\/$/, '')}`)) throw stagingError('cpanel_vhost_mismatch');
      await listing(target.target_path);
      if (!(await listing(privateRoot)).some(r => `${privateRoot}/${r.file}` === authFile && r.type === 'file')) throw stagingError('review_auth_file_missing');
      return { verified: true, hostname: url.hostname, target_path: target.target_path, site_id: target.site_id };
    },
    backup: backups.backup, restore: backups.restore,
    async protect() {
      const gate = `RewriteEngine On\nRewriteCond %{HTTP_HOST} !^${url.hostname.replaceAll('.', '\\.')}(:443)?$ [NC]\nRewriteRule ^ - [F,L]\nAuthType Basic\nAuthName "Client review"\nAuthUserFile ${authFile}\nRequire valid-user\nHeader always set X-Robots-Tag "noindex, nofollow"\nHeader always set Cache-Control "no-store"\nOptions -Indexes\n`;
      await writeFile('.htaccess', Buffer.from(gate));
      if (await readText(target.target_path, '.htaccess') !== gate) throw stagingError('access_file_verification_failed');
    },
    async verifyAccess() {
      const anonymous = await publicGet('', null);
      const aliases = await Promise.all(target.host_aliases.map(host => publicGet('', null, host)));
      return { anonymous_denied: anonymous.status === 401, aliases_denied: aliases.every(r => [401, 403, 404].includes(r.status)), noindex: anonymous.noindex };
    },
    fileHash: async ({ path }) => { const b = await readFile(path); return b === null ? null : digest(b); },
    async mkdir({ path }) {
      await assertClaim();
      if (!/^[a-zA-Z0-9_-]+(?:\/[a-zA-Z0-9_-]+)*$/.test(path)) throw stagingError('cpanel_directory_invalid');
      const full = `${target.target_path}/${path}`, at = full.lastIndexOf('/'), parent = full.slice(0, at), name = full.slice(at + 1);
      if ((await listing(parent)).some(r => r.file === name && r.type === 'dir')) return;
      const result = await api('json-api/cpanel', { cpanel_jsonapi_user: 'nineoo', cpanel_jsonapi_apiversion: 2, cpanel_jsonapi_module: 'Fileman', cpanel_jsonapi_func: 'mkdir', path: parent, name, permissions: '0755' });
      if (result.event?.result !== 1) throw stagingError('cpanel_mkdir_failed');
    },
    async upload({ path, bytes, expected_sha256 }) {
      const current = await readFile(path);
      if ((current === null ? null : digest(current)) !== expected_sha256) throw stagingError('remote_revision_changed');
      await writeFile(path, bytes);
    },
    probe: ({ path }) => publicGet(path),
  };
}
