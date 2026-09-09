/**
 * Safe boundary for the FAMtastic Inc delivery target.
 *
 * Site Studio Next may prepare a deterministic handoff for the FAMtastic Inc
 * cPanel/SFTP destination, but it must never silently fall back to Netlify or
 * invent a successful external deployment.  Network transport is injected by
 * the eventual production runner; the default adapter is dry-run only.
 */
import crypto from 'node:crypto';

export const FAMTASTICINC_ADAPTER_SCHEMA_VERSION = 1;
export const FAMTASTICINC_PROVIDER = 'famtasticinc';
export const STAGING_RECEIPT_SCHEMA = 'famtastic.site-studio.staging-receipt.v1';
const FORBIDDEN_PROVIDERS = new Set(['netlify', 'vercel', 'cloudflare']);

function fail(code, message, details = {}) {
  return Object.assign(new Error(message), { code, details });
}

function text(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function safeSiteId(value) {
  return text(value) && /^[a-z0-9][a-z0-9-]{0,62}$/.test(value);
}

function digest(value) {
  return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function assertProvider(provider) {
  if (FORBIDDEN_PROVIDERS.has(provider)) {
    throw fail('provider_forbidden', `${provider} is not an allowed delivery target`);
  }
  if (provider !== FAMTASTICINC_PROVIDER && provider !== 'local') {
    throw fail('provider_not_allowed', `unsupported delivery target: ${provider || '(missing)'}`);
  }
}

function targetRoot(env) {
  // This is a path label for a plan only. It is never written by this module.
  return env.FAMTASTICINC_REMOTE_ROOT || '/home/nineoo/public_html/famtasticinc-landing';
}

function safeSubdirectory(value) {
  return !value || (typeof value === 'string' && value.length <= 120 && !value.startsWith('/') && !value.split('/').includes('..') && /^[A-Za-z0-9._/-]+$/.test(value));
}

function requiredEnv(env, names) {
  return names.filter((name) => !text(env[name]));
}

/**
 * Create an idempotent, dry-run-first delivery boundary.  A caller can inject
 * a transport after owner approval and after the credential/host checks pass;
 * without that injection `dispatch` refuses instead of claiming deployment.
 */
export function createFamtasticIncAdapter({ env = process.env, transport = null, now = () => new Date().toISOString() } = {}) {
  const requiredCredentials = ['FAMTASTICINC_SFTP_HOST', 'FAMTASTICINC_SFTP_USER', 'FAMTASTICINC_SFTP_KEY'];

  function preflight({ provider = FAMTASTICINC_PROVIDER, site_id, target_root } = {}) {
    assertProvider(provider);
    if (!safeSiteId(site_id)) throw fail('identity_invalid', 'site_id must be lowercase kebab-case');
    const missing_credentials = provider === FAMTASTICINC_PROVIDER ? requiredEnv(env, requiredCredentials) : [];
    return {
      schema_version: FAMTASTICINC_ADAPTER_SCHEMA_VERSION,
      provider,
      site_id,
      target_root: target_root || targetRoot(env),
      credentials_present: missing_credentials.length === 0,
      missing_credentials,
      transport_configured: typeof transport === 'function',
      network_dispatch_allowed: typeof transport === 'function' && missing_credentials.length === 0,
      dns_touched: false,
    };
  }

  function plan({ provider = FAMTASTICINC_PROVIDER, site_id, manifest_hash, repo_url = null, repository_mode = 'create_or_existing', branch = 'main', domain = null, environment = 'staging', target_root, remote_subdirectory = null, hosting_class = 'shared' } = {}) {
    assertProvider(provider);
    if (!safeSiteId(site_id)) throw fail('identity_invalid', 'site_id must be lowercase kebab-case');
    if (!text(manifest_hash)) throw fail('manifest_required', 'manifest_hash is required');
    if (!['staging', 'production'].includes(environment)) throw fail('environment_invalid', 'environment must be staging or production');
    if (!['create_or_existing', 'existing', 'bootstrap', 'fixture'].includes(repository_mode)) throw fail('repository_mode_invalid', `unsupported repository mode: ${repository_mode}`);
    if (!text(branch)) throw fail('branch_required', 'branch is required');
    if (!['shared', 'vps', 'managed_external', 'local'].includes(hosting_class)) throw fail('hosting_class_invalid', `unsupported hosting class: ${hosting_class}`);
    if (!safeSubdirectory(remote_subdirectory)) throw fail('remote_subdirectory_invalid', 'remote_subdirectory must be a safe relative path');
    const preflightResult = preflight({ provider, site_id, target_root });
    const handoff_id = `finc_${digest({ provider, site_id, manifest_hash, repo_url, repository_mode, branch, domain, environment, hosting_class }).slice(0, 24)}`;
    return {
      schema_version: FAMTASTICINC_ADAPTER_SCHEMA_VERSION,
      handoff_id,
      idempotency_key: `famtasticinc:${site_id}:${manifest_hash}:${environment}`,
      provider,
      site_id,
      environment,
      hosting_class,
      repository: { mode: repository_mode, url: repo_url, branch },
      target_root: preflightResult.target_root,
      target_path: `${preflightResult.target_root}/${remote_subdirectory || site_id}`,
      remote_subdirectory: remote_subdirectory || site_id,
      manifest_hash,
      repo_url,
      domain,
      preflight: preflightResult,
      status: 'planned',
      dispatched: false,
      created_at: now(),
    };
  }

  async function dispatch(planRecord, { dry_run = true, manifest = [], callback = null } = {}) {
    if (!planRecord || planRecord.schema_version !== FAMTASTICINC_ADAPTER_SCHEMA_VERSION) {
      throw fail('plan_invalid', 'a current FAMtastic Inc handoff plan is required');
    }
    assertProvider(planRecord.provider);
    if (dry_run) {
      return {
        ...planRecord,
        status: 'dry_run',
        dispatched: false,
        receipt_id: `dry_${planRecord.handoff_id}`,
        callback_status: 'not_requested',
      };
    }
    if (typeof transport !== 'function') throw fail('external_transport_not_configured', 'external FAMtastic Inc transport is not configured');
    if (!planRecord.preflight.network_dispatch_allowed) {
      throw fail('external_transport_not_ready', 'FAMtastic Inc credentials or transport preflight failed', planRecord.preflight);
    }
    const result = await transport({ plan: planRecord, manifest, callback });
    if (!result || !text(result.receipt_id) || result.provider !== FAMTASTICINC_PROVIDER) {
      throw fail('external_receipt_invalid', 'transport did not return a FAMtastic Inc receipt');
    }
    return {
      ...planRecord,
      status: 'dispatched',
      dispatched: true,
      receipt_id: result.receipt_id,
      callback_status: result.callback_status || 'pending',
      transport_result: { receipt_id: result.receipt_id, callback_status: result.callback_status || 'pending' },
    };
  }

  return { preflight, plan, dispatch };
}

/**
 * Convert a real FAMtastic Inc dispatch result into Drupal's account-bound
 * pre-payment staging receipt. Dry-run results are intentionally rejected:
 * checkout must never open from a simulated deployment.
 */
export function createStagingReceipt({
  dispatch_result,
  website_request_id,
  project_id = null,
  packet_id,
  idempotency_key,
  artifact_sha256,
  staging_url,
  qa,
  event_id,
  completed_at = new Date().toISOString(),
} = {}) {
  if (!dispatch_result || dispatch_result.status !== 'dispatched' || dispatch_result.dispatched !== true || !text(dispatch_result.receipt_id)) {
    throw fail('staging_dispatch_required', 'a real FAMtastic Inc dispatch receipt is required before creating a staging receipt');
  }
  if (!Number.isInteger(Number(website_request_id)) || Number(website_request_id) < 1) throw fail('website_request_required', 'website_request_id is required');
  if (!text(packet_id) || !text(idempotency_key) || !text(event_id)) throw fail('staging_identity_required', 'packet, idempotency, and event identities are required');
  if (!/^[a-f0-9]{64}$/.test(String(artifact_sha256 || ''))) throw fail('artifact_digest_required', 'artifact_sha256 must be a SHA-256 digest');
  if (!text(staging_url) || !staging_url.startsWith('https://')) throw fail('staging_url_required', 'an HTTPS staging URL is required');
  if (!Array.isArray(qa) || qa.length === 0 || qa.some((check) => !check || check.status !== 'passed' || !text(check.name))) {
    throw fail('staging_qa_required', 'every staging QA check must be named and passed');
  }
  return {
    schema: STAGING_RECEIPT_SCHEMA,
    status: 'deployed',
    event_id,
    packet_id,
    idempotency_key,
    website_request_id: Number(website_request_id),
    project_id: project_id === null ? null : Number(project_id),
    staging_url,
    repository: dispatch_result.repository,
    target_path: dispatch_result.target_path,
    remote_subdirectory: dispatch_result.remote_subdirectory,
    transport_receipt_id: dispatch_result.receipt_id,
    artifact_sha256,
    qa,
    completed_at,
  };
}
