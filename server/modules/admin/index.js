// Admin module: resolved paths, health, and the Shay provider switch.
//
// Shay provider config (config/shay.json, schema_version 1) is the field
// server/kernel/shay.js (owned by a parallel lane) reads to pick which CLI
// adapter backs Shay's reasoning. This module owns reading/writing that
// file and reporting a *live, verified* status for every known adapter --
// it never renders a green state it did not just check (CONVENTIONS.md
// item 7, honest states only).
//
// The adapter registry itself (server/kernel/shay-adapters/index.js) is
// owned by a different, parallel lane and may not exist yet on this
// machine. This module never assumes a shape for it beyond what is
// documented below, and degrades honestly -- distinct "not available",
// "unrecognized interface", and "status check failed" outcomes -- rather
// than collapsing all three into an empty list that would silently read as
// "no adapters exist".
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const shayConfigFile = path.resolve(here, '../../../config/shay.json');
const defaultAdaptersRegistryPath = path.resolve(here, '../../kernel/shay-adapters/index.js');

// Test-only escape hatch: lets tests point resolveAdapterStatus() at a stub
// module so the "registry available" rendering path can be verified without
// ever creating a file under server/kernel/shay-adapters/ (that directory is
// owned by a parallel lane; this module must not write into it, even
// temporarily). Unset in all real boots -- server/index.js never sets this,
// so production always resolves the real path above.
function resolveAdaptersRegistryPath() {
  return process.env.ADMIN_SHAY_ADAPTERS_PATH_OVERRIDE
    ? path.resolve(process.env.ADMIN_SHAY_ADAPTERS_PATH_OVERRIDE)
    : defaultAdaptersRegistryPath;
}

// Fallback provider ids named in the plan (claude default, codex/gemini/kimi
// scaffolds). Used only when the adapter registry cannot be consulted, so an
// unknown-provider PUT can still be rejected before the registry lands.
const FALLBACK_PROVIDER_IDS = Object.freeze(['claude', 'codex', 'gemini', 'kimi']);

function readShayConfig() {
  let raw;
  try {
    raw = fs.readFileSync(shayConfigFile, 'utf8');
  } catch (error) {
    throw Object.assign(new Error(`could not read ${shayConfigFile}: ${error.message}`), { statusCode: 500, code: 'shay_config_unreadable' });
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw Object.assign(new Error(`${shayConfigFile} is not valid JSON: ${error.message}`), { statusCode: 500, code: 'shay_config_invalid' });
  }
  if (!parsed || typeof parsed !== 'object' || typeof parsed.provider !== 'string' || !parsed.provider.trim()) {
    throw Object.assign(new Error(`${shayConfigFile} is missing a valid "provider" string`), { statusCode: 500, code: 'shay_config_invalid' });
  }
  return parsed;
}

function writeShayConfig(config) {
  fs.writeFileSync(shayConfigFile, `${JSON.stringify(config, null, 2)}\n`);
}

// A probe() failure classification means the CLI never produced a usable
// response for a reason rooted in identity/entitlement, not connectivity or
// output shape (base.js's own classifier: real observed states on this
// machine are gemini's ineligible_tier and kimi's billing_blocked). Mapped
// to authenticated: false, responds: false -- not an unverified "unknown".
const AUTH_FAILURE_CLASSIFICATIONS = new Set(['not_authenticated', 'ineligible_tier', 'billing_blocked']);

// probe() result -> { installed, authenticated, responds, detail }, keeping
// the three dimensions honestly separate rather than collapsing probe()'s
// single ok/fail verdict into one flag:
//   - not installed: nothing else can be true.
//   - probe ok: installed, authenticated, and responds all verified true.
//   - a recognized auth-failure classification: installed but confirmed
//     unauthenticated (never got a real response either).
//   - exited clean but no parseable JSON: it ran and answered as a process
//     (none of the known auth-failure patterns matched its output), so
//     authenticated stays true, but it did not produce a usable response.
//   - anything else (timeout, nonzero exit, spawn failure): genuinely
//     ambiguous whether auth succeeded -- reported as unknown (null) rather
//     than guessed, per the "never show a green state you did not verify"
//     rule.
function classifyProbe(probeResult) {
  const installed = typeof probeResult?.installed === 'boolean' ? probeResult.installed : null;
  const detail = (probeResult && (probeResult.summary || probeResult.classification)) || 'no probe detail available';
  if (installed === false) return { installed: false, authenticated: false, responds: false, detail };
  if (probeResult?.ok === true) return { installed: true, authenticated: true, responds: true, detail };
  if (AUTH_FAILURE_CLASSIFICATIONS.has(probeResult?.classification)) {
    return { installed: true, authenticated: false, responds: false, detail };
  }
  if (probeResult?.classification === 'unparseable_output') {
    return { installed: true, authenticated: true, responds: false, detail };
  }
  return { installed: installed === null ? true : installed, authenticated: null, responds: false, detail };
}

// The real, confirmed interface (server/kernel/shay-adapters/index.js, as
// landed): `ADAPTER_IDS: string[]` and `getAdapter(id) -> { id, displayName,
// isInstalled(), isAuthenticated(), probe(), ask() } | null`. probe() is the
// one live, minimal call that answers "does this work right now" (base.js),
// so it alone is used here rather than also calling isAuthenticated() (which
// just re-runs probe() internally) -- calling both would spawn every CLI
// twice for no new information.

// Status probing must never hang the Settings page. The deadline sentinel is a
// unique object so a probe legitimately resolving undefined cannot be mistaken
// for a timeout.
const DEADLINE_EXCEEDED = Symbol('probe_deadline_exceeded');
// Read per call, not at module load: a module-scope constant captured the value
// before anything could configure it, so the deadline was effectively fixed.
function statusDeadlineMs() {
  return Number(process.env.SHAY_STATUS_DEADLINE_MS || 6000);
}

function withDeadline(promise, ms) {
  let timer;
  const deadline = new Promise((resolve) => { timer = setTimeout(() => resolve(DEADLINE_EXCEEDED), ms); });
  return Promise.race([promise, deadline]).finally(() => clearTimeout(timer));
}

async function statusFromConcreteRegistry(registryModule) {
  const ids = Array.isArray(registryModule.ADAPTER_IDS) ? registryModule.ADAPTER_IDS : null;
  const getAdapter = typeof registryModule.getAdapter === 'function' ? registryModule.getAdapter : null;
  if (!ids || !getAdapter) return null; // Not this shape; let the caller try others.

  return Promise.all(ids.map(async (id) => {
    const adapter = getAdapter(id);
    if (!adapter) {
      return { id, displayName: id, installed: null, authenticated: null, responds: null, detail: 'getAdapter() returned null for a listed adapter id -- nothing was verified.' };
    }
    const displayName = adapter.displayName || id;
    try {
      // Each adapter spawns a real CLI, which can take many seconds. Probing all
      // of them is parallel already, but one slow adapter still held the whole
      // Settings page. A bounded deadline keeps the page responsive and reports
      // the timeout as UNKNOWN with a reason: a status nobody waited for is not
      // a status, and guessing green here would be the worst possible answer.
      const deadlineMs = statusDeadlineMs();
      const probeResult = await withDeadline(adapter.probe(), deadlineMs);
      if (probeResult === DEADLINE_EXCEEDED) {
        return {
          id, displayName, installed: null, authenticated: null, responds: null,
          detail: `probe did not answer within ${deadlineMs}ms; status is unknown, not assumed. Re-check from Settings if this adapter matters.`,
        };
      }
      return { id, displayName, ...classifyProbe(probeResult) };
    } catch (error) {
      return { id, displayName, installed: null, authenticated: null, responds: null, detail: `probe() threw: ${error.message}` };
    }
  }));
}

// Speculative fallback shapes, tried only if the concrete interface above
// does not match (e.g. it changes shape later). None of these are
// contractual on the other lane -- if none match, that is reported as an
// honest "unrecognized interface" outcome rather than guessed at further.
async function callRegistryStatus(registryModule) {
  const concrete = await statusFromConcreteRegistry(registryModule);
  if (concrete) return concrete;

  const fn =
    (typeof registryModule.checkAll === 'function' && registryModule.checkAll) ||
    (typeof registryModule.getStatuses === 'function' && registryModule.getStatuses) ||
    (typeof registryModule.default?.checkAll === 'function' && registryModule.default.checkAll);
  if (fn) {
    const result = await fn();
    if (Array.isArray(result)) return result;
  }

  const list =
    (Array.isArray(registryModule.listAdapters?.()) && registryModule.listAdapters()) ||
    (Array.isArray(registryModule.ADAPTERS) && registryModule.ADAPTERS) ||
    (Array.isArray(registryModule.default) && registryModule.default) ||
    null;
  if (list) {
    return Promise.all(
      list.map(async (descriptor) => {
        if (typeof descriptor.checkStatus === 'function') {
          try {
            const s = await descriptor.checkStatus();
            return { id: descriptor.id, displayName: descriptor.displayName || descriptor.id, ...s };
          } catch (error) {
            return {
              id: descriptor.id,
              displayName: descriptor.displayName || descriptor.id,
              installed: null,
              authenticated: null,
              responds: null,
              detail: `status check threw: ${error.message}`,
            };
          }
        }
        return {
          id: descriptor.id,
          displayName: descriptor.displayName || descriptor.id,
          installed: null,
          authenticated: null,
          responds: null,
          detail: 'adapter descriptor exposes no checkStatus() -- nothing was verified.',
        };
      }),
    );
  }

  return null; // Module loaded but exposes none of the recognized shapes.
}

// Central point that resolves "what do we honestly know about Shay's
// providers right now". Never caches a stale verdict across calls -- each
// GET re-imports (Node module cache still applies, which is fine: the
// registry module itself is expected to do the live process/PATH checks on
// each call to its status functions, not at import time) and re-checks.
async function resolveAdapterStatus() {
  const adaptersRegistryPath = resolveAdaptersRegistryPath();
  if (!fs.existsSync(adaptersRegistryPath)) {
    return {
      registry_available: false,
      adapters: [],
      reason: `Adapter registry not found at server/kernel/shay-adapters/index.js. It is owned by a parallel lane and has not landed on this machine yet, so no adapter installed/authenticated/responds status can be verified.`,
    };
  }

  let registryModule;
  try {
    // Cache-busting query string so a status check re-imports rather than
    // reusing a stale module instance -- the registry's own checks (process
    // spawn, PATH lookup) are expected to be live per call, not per import.
    registryModule = await import(`${pathToFileURL(adaptersRegistryPath).href}?t=${Date.now()}`);
  } catch (error) {
    return {
      registry_available: false,
      adapters: [],
      reason: `Adapter registry exists at server/kernel/shay-adapters/index.js but failed to load: ${error.message}`,
    };
  }

  let adapters;
  try {
    adapters = await callRegistryStatus(registryModule);
  } catch (error) {
    return {
      registry_available: true,
      status_check_failed: true,
      adapters: [],
      reason: `Adapter registry loaded but the status check threw: ${error.message}`,
    };
  }

  if (adapters === null) {
    return {
      registry_available: true,
      status_check_failed: true,
      adapters: [],
      reason: 'Adapter registry loaded but exposes none of the recognized status-check exports (checkAll, getStatuses, listAdapters, ADAPTERS). Nothing was verified.',
    };
  }

  return {
    registry_available: true,
    adapters: adapters.map((a) => ({
      id: a.id,
      displayName: a.displayName || a.id,
      installed: typeof a.installed === 'boolean' ? a.installed : null,
      authenticated: typeof a.authenticated === 'boolean' ? a.authenticated : null,
      responds: typeof a.responds === 'boolean' ? a.responds : null,
      detail: typeof a.detail === 'string' ? a.detail : null,
    })),
  };
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (chunk) => { data += chunk; });
    req.on('end', () => {
      if (!data) return resolve({});
      try {
        resolve(JSON.parse(data));
      } catch {
        reject(Object.assign(new Error('request body is not valid JSON'), { statusCode: 400, code: 'invalid_body' }));
      }
    });
    req.on('error', reject);
  });
}

export default {
  name: 'admin',
  register({ app, paths, journal }) {
    app.route('GET', '/api/admin/paths', async () => {
      const roots = Object.fromEntries(
        Object.entries(paths.roots).map(([name, dir]) => [name, { path: dir, exists: fs.existsSync(dir) }]),
      );
      return { status: 200, body: { dataRoot: paths.dataRoot, roots, config: paths.config } };
    }, { scope: 'global' });

    app.route('POST', '/api/admin/paths', async ({ req }) => {
      try {
        const body = await readJsonBody(req);
        const configFile = paths.configFile;
        const currentConfig = JSON.parse(fs.readFileSync(configFile, 'utf8'));

        if (body.data_root_default) {
          currentConfig.data_root_default = body.data_root_default;
        }
        if (body.portfolio_roots && typeof body.portfolio_roots === 'object') {
          currentConfig.portfolio_roots = {
            ...currentConfig.portfolio_roots,
            ...body.portfolio_roots,
          };
        }
        if (body.roots && typeof body.roots === 'object') {
          currentConfig.roots = {
            ...currentConfig.roots,
            ...body.roots,
          };
        }

        fs.writeFileSync(configFile, JSON.stringify(currentConfig, null, 2) + '\n', 'utf8');

        return {
          status: 200,
          body: {
            saved: true,
            config: currentConfig,
            message: 'Paths configuration saved successfully',
          },
        };
      } catch (error) {
        return {
          status: error.statusCode || 500,
          body: { error: error.code || 'handler_failed', message: error.message },
        };
      }
    }, { scope: 'global' });

    app.route('GET', '/api/admin/health', async () => ({
      status: 200,
      body: {
        ok: true,
        port: Number(process.env.PORT || paths.config.preview.port || 3400),
        node: process.version,
        invariants: { p0_i1: 'asserted' },
      },
    }), { scope: 'global' });

    // Honest, live status for every known Shay adapter (installed,
    // authenticated, responds -- verified separately, never inferred from
    // one another) plus which provider is currently active.
    app.route('GET', '/api/admin/shay', async () => {
      let config;
      try {
        config = readShayConfig();
      } catch (error) {
        return { status: 200, body: { status: 'error', reason: error.message } };
      }

      const adapterStatus = await resolveAdapterStatus();

      if (!adapterStatus.registry_available) {
        return {
          status: 200,
          body: {
            status: adapterStatus.status_check_failed ? 'error' : 'not_implemented',
            reason: adapterStatus.reason,
            active_provider: config.provider,
            timeout_ms: config.timeout_ms,
            adapters: [],
          },
        };
      }

      if (adapterStatus.status_check_failed) {
        return {
          status: 200,
          body: {
            status: 'error',
            reason: adapterStatus.reason,
            active_provider: config.provider,
            timeout_ms: config.timeout_ms,
            adapters: [],
          },
        };
      }

      return {
        status: 200,
        body: {
          active_provider: config.provider,
          timeout_ms: config.timeout_ms,
          adapters: adapterStatus.adapters,
        },
      };
    }, { scope: 'global' });

    app.route('PUT', '/api/admin/shay', async ({ req }) => {
      let body;
      try {
        body = await readJsonBody(req);
      } catch (error) {
        return { status: error.statusCode || 400, body: { error: error.code || 'invalid_body', message: error.message } };
      }

      if (typeof body.provider !== 'string' || !body.provider.trim()) {
        return { status: 400, body: { error: 'invalid_provider', message: 'provider is required and must be a non-empty string' } };
      }
      const requestedProvider = body.provider.trim();

      const adapterStatus = await resolveAdapterStatus();
      const knownIds = adapterStatus.registry_available && adapterStatus.adapters.length
        ? adapterStatus.adapters.map((a) => a.id)
        : FALLBACK_PROVIDER_IDS;

      if (!knownIds.includes(requestedProvider)) {
        return {
          status: 400,
          body: {
            error: 'unknown_provider',
            message: `"${requestedProvider}" is not a known Shay provider.`,
            known_providers: knownIds,
          },
        };
      }

      let config;
      try {
        config = readShayConfig();
      } catch (error) {
        return { status: 500, body: { error: error.code || 'shay_config_unreadable', message: error.message } };
      }

      const previousProvider = config.provider;
      config.provider = requestedProvider;
      try {
        writeShayConfig(config);
      } catch (error) {
        return { status: 500, body: { error: 'shay_config_write_failed', message: error.message } };
      }

      // This is a global, cross-site setting change -- it does not carry a
      // site_id, and journal.append() (A1, per-site journal) requires one.
      // It is journaled under the literal 'global' site id as an explicit,
      // documented exception, never silently skipped and never faked as
      // "recorded" when it was not.
      let journaled = false;
      let journalError = null;
      if (journal && typeof journal.append === 'function') {
        try {
          journal.append({
            site_id: 'global',
            initiator: 'operator',
            intent: 'admin.shay.set_provider',
            changes: [{ field: 'shay.provider', from: previousProvider, to: requestedProvider }],
            result: 'ok',
          });
          journaled = true;
        } catch (error) {
          journalError = error.message;
        }
      } else {
        journalError = 'no journal available in this module\'s register args';
      }

      return {
        status: 200,
        body: {
          active_provider: config.provider,
          previous_provider: previousProvider,
          journaled,
          journal_error: journaled ? null : journalError,
        },
      };
    }, { scope: 'global' });
  },
};
