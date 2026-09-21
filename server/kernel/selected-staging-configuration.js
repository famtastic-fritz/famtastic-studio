// Installation-owned JSON only. No executable config, vault discovery or network.
import fs from 'node:fs';
import path from 'node:path';
import { createSelectedStagingAssembly } from './selected-staging-assembly.js';

const MAX_CONFIG_BYTES = 256 * 1024;
const CONFIG_KEYS = ['schema_version', 'workerMode', 'pollIntervalMs', 'shutdownGraceMs', 'bindings',
  'artifactOrigins', 'sourceMappings', 'callbackEndpoint', 'callbackSecretEnv', 'credentialEnv',
  'artifactSecretEnv', 'artifactAuthorizationEnv'];
const ENV_NAME = /^(?:SITE_STUDIO_|SELECTED_STAGING_|FAMTASTIC_STUDIO_|FAMTASTIC_CPANEL_)[A-Z][A-Z0-9_]{0,95}$/;
const ID = /^[a-zA-Z0-9_-]{1,160}$/;

function invalid(field, code = 'selected_staging_config_invalid') {
  // field is always a literal schema field, never config content or a file path.
  return Object.assign(new Error(`${code}: ${field}`), { code, field });
}
function object(value, allowed, field) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || Object.keys(value).some(key => !allowed.includes(key))) throw invalid(field);
}
function text(value, field) {
  if (typeof value !== 'string' || !value || value.length > 4096 || /[\x00-\x1f\x7f]/.test(value)) throw invalid(field);
  return value;
}
function id(value, field) { if (typeof value !== 'string' || !ID.test(value)) throw invalid(field); }
function https(value, field) {
  let url;
  try { url = new URL(text(value, field)); } catch { throw invalid(field); }
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) throw invalid(field);
  return url;
}
function interval(value, fallback, max, field) {
  if (value === undefined) return fallback;
  if (!Number.isInteger(value) || value < 1000 || value > max) throw invalid(field);
  return value;
}
function envName(value, field) {
  if (typeof value !== 'string' || !ENV_NAME.test(value)) throw invalid(field);
}

export function validateSelectedStagingConfiguration(config) {
  object(config, CONFIG_KEYS, 'configuration');
  if (config.schema_version !== 1) throw invalid('schema_version');
  if (!['external', 'embedded'].includes(config.workerMode)) throw invalid('workerMode');
  const pollIntervalMs = interval(config.pollIntervalMs, 5000, 300000, 'pollIntervalMs');
  const shutdownGraceMs = interval(config.shutdownGraceMs, 30000, 60000, 'shutdownGraceMs');
  const callback = https(config.callbackEndpoint, 'callbackEndpoint');
  if (!['/api/pipeline/site-studio/callback', '/web/api/pipeline/site-studio/callback'].includes(callback.pathname)) throw invalid('callbackEndpoint');
  envName(config.callbackSecretEnv, 'callbackSecretEnv');
  envName(config.credentialEnv, 'credentialEnv');
  // Choose signed artifact retrieval or a pre-bound Authorization header.
  if (Number(config.artifactSecretEnv !== undefined) + Number(config.artifactAuthorizationEnv !== undefined) !== 1) throw invalid('artifactAuthentication');
  for (const field of ['artifactSecretEnv', 'artifactAuthorizationEnv']) if (config[field] !== undefined) envName(config[field], field);
  if (!Array.isArray(config.artifactOrigins) || !config.artifactOrigins.length || config.artifactOrigins.length > 32) throw invalid('artifactOrigins');
  for (const origin of config.artifactOrigins) if (https(origin, 'artifactOrigins').origin !== origin) throw invalid('artifactOrigins');
  if (new Set(config.artifactOrigins).size !== config.artifactOrigins.length) throw invalid('artifactOrigins');
  if (!Array.isArray(config.bindings) || !config.bindings.length || config.bindings.length > 256) throw invalid('bindings');
  const sites = new Set(), targets = new Set(), urls = new Set();
  for (const row of config.bindings) {
    object(row, ['binding', 'authFile', 'reviewAuthorizationEnv'], 'bindings');
    envName(row.reviewAuthorizationEnv, 'bindings.reviewAuthorizationEnv');
    if (typeof row.authFile !== 'string' || !/^\/home\/nineoo\/\.famtastic-review\/[a-z0-9-]+\.htpasswd$/.test(row.authFile)) throw invalid('bindings.authFile');
    const b = row.binding;
    object(b, ['url', 'target_path', 'remote_subdirectory', 'site_id', 'customer_id', 'access', 'host_aliases'], 'bindings.binding');
    id(b.site_id, 'bindings.site_id'); id(b.customer_id, 'bindings.customer_id');
    const url = https(b.url, 'bindings.url');
    if (url.port || !/^(?:[a-z0-9-]+\.)?famtasticinc\.com$/.test(url.hostname)
      || !/^\/(?:[a-z0-9-]+\/)?$/.test(url.pathname) || url.href !== b.url) throw invalid('bindings.url');
    if (typeof b.remote_subdirectory !== 'string' || !/^[a-z0-9-]+$/.test(b.remote_subdirectory)
      || b.target_path !== `/home/nineoo/public_html/${b.remote_subdirectory}`
      || (url.pathname !== '/' && url.pathname !== `/${b.remote_subdirectory}/`)
      || b.access !== 'protected_review') throw invalid('bindings.target');
    if (!Array.isArray(b.host_aliases) || !b.host_aliases.length || b.host_aliases.length > 32
      || b.host_aliases.some(host => typeof host !== 'string' || host === url.hostname
        || !/^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,63}$/.test(host))) throw invalid('bindings.host_aliases');
    if (sites.has(b.site_id) || targets.has(b.target_path) || urls.has(b.url)) throw invalid('bindings.duplicate');
    sites.add(b.site_id); targets.add(b.target_path); urls.add(b.url);
  }
  const sourceMappings = config.sourceMappings ?? [];
  if (!Array.isArray(sourceMappings) || sourceMappings.length > 256) throw invalid('sourceMappings');
  const projects = new Set(), mappedSites = new Set(), repositories = new Set();
  for (const row of sourceMappings) {
    object(row, ['project_id', 'customer_id', 'request_id', 'site_id', 'run_id', 'repository_path',
      'source_export_sha256', 'evidence_ref', 'remote_url'], 'sourceMappings');
    for (const key of ['project_id', 'customer_id', 'site_id', 'run_id']) id(row[key], `sourceMappings.${key}`);
    if (row.request_id !== undefined) id(row.request_id, 'sourceMappings.request_id');
    text(row.repository_path, 'sourceMappings.repository_path'); text(row.evidence_ref, 'sourceMappings.evidence_ref');
    if (!path.isAbsolute(row.repository_path) || path.normalize(row.repository_path) !== row.repository_path
      || !/^[a-f0-9]{64}$/.test(row.source_export_sha256 || '')) throw invalid('sourceMappings.source');
    if (row.remote_url !== undefined && row.remote_url !== null) text(row.remote_url, 'sourceMappings.remote_url');
    if (!config.bindings.some(b => b.binding.site_id === row.site_id && b.binding.customer_id === row.customer_id)
      || projects.has(row.project_id) || mappedSites.has(row.site_id) || repositories.has(row.repository_path)) throw invalid('sourceMappings.binding');
    projects.add(row.project_id); mappedSites.add(row.site_id); repositories.add(row.repository_path);
  }
  return { ...structuredClone(config), sourceMappings: structuredClone(sourceMappings), pollIntervalMs, shutdownGraceMs };
}

export function readSelectedStagingConfiguration({ env = process.env, treeRoot } = {}) {
  // Config paths, credentials and factories are untouched unless opt-in is exact.
  if (env.SELECTED_STAGING_ENABLED === undefined || env.SELECTED_STAGING_ENABLED === '0') return null;
  if (env.SELECTED_STAGING_ENABLED !== '1') throw invalid('SELECTED_STAGING_ENABLED');
  const file = env.SELECTED_STAGING_CONFIG;
  if (typeof file !== 'string' || !path.isAbsolute(file) || !file.endsWith('.json')) throw invalid('SELECTED_STAGING_CONFIG');
  let fd, raw;
  try {
    const real = fs.realpathSync(file);
    if (treeRoot) {
      const root = fs.realpathSync(treeRoot);
      if (real === root || real.startsWith(root + path.sep)) throw invalid('SELECTED_STAGING_CONFIG', 'selected_staging_config_must_be_private');
    }
    fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK);
    const stat = fs.fstatSync(fd);
    if (!stat.isFile() || (stat.mode & 0o077) !== 0 || (process.getuid && stat.uid !== process.getuid())) throw invalid('SELECTED_STAGING_CONFIG', 'selected_staging_config_must_be_private');
    if (stat.size > MAX_CONFIG_BYTES) throw invalid('SELECTED_STAGING_CONFIG', 'selected_staging_config_too_large');
    // Bounded even if another writer grows the file after fstat.
    const buffer = Buffer.alloc(MAX_CONFIG_BYTES + 1);
    let size = 0, count;
    while (size < buffer.length && (count = fs.readSync(fd, buffer, size, buffer.length - size, null))) size += count;
    if (size > MAX_CONFIG_BYTES) throw invalid('SELECTED_STAGING_CONFIG', 'selected_staging_config_too_large');
    raw = buffer.subarray(0, size).toString('utf8');
  } catch (error) {
    if (error.code?.startsWith('selected_staging_config_')) throw error;
    throw invalid('SELECTED_STAGING_CONFIG', 'selected_staging_config_unreadable');
  } finally { if (fd !== undefined) fs.closeSync(fd); }
  let config;
  try { config = JSON.parse(raw); } catch { throw invalid('configuration', 'selected_staging_config_json_invalid'); }
  return validateSelectedStagingConfiguration(config);
}

export function configureSelectedStaging({ paths, env = process.env, treeRoot, requiredWorkerMode,
  assemblyFactory = createSelectedStagingAssembly } = {}) {
  const config = readSelectedStagingConfiguration({ env, treeRoot });
  if (requiredWorkerMode && config?.workerMode !== requiredWorkerMode) throw invalid('workerMode');
  if (!config) return { runtime: null, workerMode: 'disabled', shutdownGraceMs: 30000 };
  const secret = (name, field) => {
    const value = env[name];
    if (typeof value !== 'string' || !value.trim() || value.length > 16384 || /[\x00-\x1f\x7f]/.test(value)) throw invalid(field, 'selected_staging_credential_missing');
    return value;
  };
  const callbackSecret = secret(config.callbackSecretEnv, 'callbackSecretEnv');
  const token = secret(config.credentialEnv, 'credentialEnv');
  const artifactSecret = config.artifactSecretEnv ? secret(config.artifactSecretEnv, 'artifactSecretEnv') : null;
  const authorization = config.artifactAuthorizationEnv ? secret(config.artifactAuthorizationEnv, 'artifactAuthorizationEnv') : null;
  const bindings = config.bindings.map(row => {
    const reviewAuthorization = secret(row.reviewAuthorizationEnv, 'bindings.reviewAuthorizationEnv');
    if (!/^Basic [A-Za-z0-9+/]+={0,2}$/.test(reviewAuthorization)) throw invalid('bindings.reviewAuthorizationEnv', 'selected_staging_credential_invalid');
    return { binding: row.binding, authFile: row.authFile, reviewAuthorization };
  });
  let runtime;
  try {
    runtime = assemblyFactory({ paths, bindings, sourceMappings: config.sourceMappings,
      callbackEndpoint: config.callbackEndpoint, callbackSecret, artifactOrigins: config.artifactOrigins,
      artifactSecret, artifactAuthorizationProvider: authorization ? async () => authorization : null,
      credentialProvider: async () => token });
  } catch { throw invalid('assembly', 'selected_staging_initialization_failed'); }
  return { runtime, workerMode: config.workerMode, pollIntervalMs: config.pollIntervalMs, shutdownGraceMs: config.shutdownGraceMs };
}

// Never print raw errors, config values, paths, request bodies or credentials.
export function selectedStagingDiagnostic(error, phase) {
  const codes = ['selected_staging_config_invalid', 'selected_staging_config_must_be_private',
    'selected_staging_config_too_large', 'selected_staging_config_unreadable', 'selected_staging_config_json_invalid',
    'selected_staging_credential_missing', 'selected_staging_credential_invalid', 'selected_staging_initialization_failed'];
  const known = codes.includes(error?.code);
  const operational = ['EADDRINUSE', 'EADDRNOTAVAIL', 'EACCES', 'ERR_SQLITE_ERROR', 'SQLITE_BUSY',
    'journal_unavailable', 'events_locked', 'claim_lost', 'callback_transport_failed', 'callback_rejected'];
  return { component: 'selected_staging', phase, code: known || operational.includes(error?.code) ? error.code : 'selected_staging_operation_failed',
    ...(known && /^(?:[a-zA-Z_]+)(?:\.[a-zA-Z_]+)?$/.test(error.field || '') ? { field: error.field } : {}) };
}
