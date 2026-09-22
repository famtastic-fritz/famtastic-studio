import fs from 'node:fs';
import { digest, stagingError } from './staging-store.js';
const schema = 'famtastic.source-use-restrictions.v1';

export function restrictionsForPacket(packet) {
  const c = packet.continuation;
  const files = c.files.filter(f => f.rights?.scope === 'protected_review_only').map(f => {
    const artifact = packet.artifacts.find(a => a.path === f.source_path);
    return { path: f.path, sha256: artifact.sha256, bytes: artifact.bytes, rights: f.rights };
  });
  return files.length ? { schema, scope: 'protected_review_only', project_id: packet.project_id, customer_id: c.customer.id, request_id: packet.request_id, files } : null;
}
export function readSourceRestrictions(paths, siteId) {
  const registry = paths.within('staging', 'source-use', `${siteId}.json`);
  const file = fs.existsSync(registry) ? registry : paths.within('sites', siteId, '.famtastic', 'source-use.json');
  if (!fs.existsSync(file)) return null;
  const policy = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (policy.schema !== schema || policy.scope !== 'protected_review_only' || !policy.files?.length) throw stagingError('source_use_policy_invalid');
  return policy;
}
export function retainSourceRestrictions(paths, siteId, incoming) {
  const prior = readSourceRestrictions(paths, siteId);
  if (!incoming && !prior) return null;
  incoming ||= prior;
  if (incoming.schema !== schema || incoming.scope !== 'protected_review_only' || !incoming.files?.length) throw stagingError('source_use_policy_invalid');
  if (prior && ['project_id', 'customer_id', 'request_id'].some(key => prior[key] !== incoming[key])) throw stagingError('source_use_identity_changed');
  const files = new Map((prior?.files || []).map(f => [f.path, f]));
  for (const file of incoming.files) files.set(file.path, file);
  const policy = { ...incoming, files: [...files.values()] };
  fs.mkdirSync(paths.within('staging', 'source-use'), { recursive: true });
  fs.writeFileSync(paths.within('staging', 'source-use', `${siteId}.json`), JSON.stringify(policy, null, 2), { mode: 0o600 });
  if (fs.existsSync(paths.within('sites', siteId, '.git'))) {
    fs.mkdirSync(paths.within('sites', siteId, '.famtastic'), { recursive: true });
    fs.writeFileSync(paths.within('sites', siteId, '.famtastic', 'source-use.json'), JSON.stringify(policy, null, 2), { mode: 0o600 });
  }
  return policy;
}
export function assertPublicSourceAllowed(paths, siteId) {
  if (readSourceRestrictions(paths, siteId)) throw stagingError('source_use_protected_review_only');
}
export function assertProtectedSourceAccess(policy, packet, access) {
  if (!policy) return;
  if (policy.project_id !== packet.project_id || policy.customer_id !== packet.continuation.customer.id || policy.request_id !== packet.request_id
    || access?.anonymous_denied !== true || access?.aliases_denied !== true) throw stagingError('source_use_private_access_required');
  const current = restrictionsForPacket(packet);
  if (!current || policy.files.some(file => !current.files.some(f => f.path === file.path && f.sha256 === file.sha256 && f.bytes === file.bytes && f.rights.request_asset_id === file.rights.request_asset_id))) throw stagingError('source_use_grant_missing');
}
export async function revalidateReferenceAccess(packet, fetchArtifact, allowedOrigins) {
  for (const file of packet.continuation.files.filter(f => f.rights?.scope === 'protected_review_only')) {
    let url;
    try { url = new URL(file.url); } catch { throw stagingError('reference_authority_reader_required'); }
    if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || !allowedOrigins.includes(url.origin)) throw stagingError('reference_authority_reader_required');
    const bytes = await fetchArtifact({ url: file.url, maxBytes: file.rights.bytes, redirect: 'error' });
    if (!Buffer.isBuffer(bytes) || bytes.length !== file.rights.bytes || digest(bytes) !== file.rights.sha256) throw stagingError('reference_authority_changed');
  }
}
