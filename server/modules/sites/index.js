// Sites module: thin HTTP binding over the site and spec kernel modules.
// Binds identity, calls the kernel, maps errors to status codes. No classification
// or filesystem logic lives here (that belongs to server/kernel/site.js, A6).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createSite } from '../../kernel/site.js';
import { createSpec } from '../../kernel/spec.js';
import { createImporter } from '../../kernel/importer.js';

const DEFAULT_DEPLOYMENT_TARGET = 'famtasticinc';
const ALLOWED_DEPLOYMENT_TARGETS = new Set([DEFAULT_DEPLOYMENT_TARGET, 'local']);

function deploymentTarget(value, fallback = DEFAULT_DEPLOYMENT_TARGET) {
  const candidate = typeof value === 'string' ? value.trim().toLowerCase() : '';
  return candidate && ALLOWED_DEPLOYMENT_TARGETS.has(candidate) ? candidate : fallback;
}

// server/kernel/mutation.js is being built by another lane against the same
// contract. Load it lazily (top-level await is safe: this module itself is
// loaded via dynamic import from server/kernel/modules.js) so spec writes
// route through it once it lands, without this module failing to load first.
const mutationFile = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../kernel/mutation.js');
let createMutation = null;
if (fs.existsSync(mutationFile)) {
  ({ createMutation } = await import(pathToFileURL(mutationFile).href));
}

function errorResponse(error) {
  const status = error.statusCode || 500;
  const body = { error: error.code || 'handler_failed', message: error.message };
  if (error.errors) body.errors = error.errors;
  return { status, body };
}

export default {
  name: 'sites',
  register({ app, paths, journal, events }) {
    const site = createSite({ paths });
    const mutation = createMutation ? createMutation({ paths, journal, events }) : null;
    const spec = createSpec({ paths, mutation });
    const importer = createImporter({ paths, spec });

    app.route('GET', '/api/sites', async () => {
      try {
        const result = site.list();
        return { status: 200, body: result };
      } catch (error) {
        return errorResponse(error);
      }
    }, { scope: 'global' });

    app.route('GET', '/api/sites/current', async ({ identity }) => {
      try {
        const result = site.get(identity.site_id);
        return { status: 200, body: result };
      } catch (error) {
        return errorResponse(error);
      }
    });

    app.route('GET', '/api/sites/spec', async ({ identity }) => {
      try {
        const result = spec.read(identity.site_id);
        return { status: 200, body: result };
      } catch (error) {
        return errorResponse(error);
      }
    });

    app.route('PUT', '/api/sites/spec', async ({ req, identity }) => {
      try {
        const body = await readJsonBody(req);
        const result = spec.write(identity.site_id, body.spec, {
          initiator: identity.conversation_id || 'console',
          expectedRevision: body.expectedRevision,
        });
        return { status: 200, body: result };
      } catch (error) {
        return errorResponse(error);
      }
    });

    // Derive a spec from a real site already on disk. Journaled and
    // undoable exactly like any other mutation -- undo_token in the
    // response removes it and restores "no spec.json" cleanly.
    app.route('POST', '/api/sites/import', async ({ identity }) => {
      try {
        const result = importer.importSite(identity.site_id, {
          initiator: identity.conversation_id || 'console',
        });
        return { status: 200, body: result };
      } catch (error) {
        return errorResponse(error);
      }
    });

    // Lists all files in the site directory grouped for the IDE Explorer
    app.route('GET', '/api/sites/files', async ({ identity }) => {
      try {
        const { dir: siteDir } = paths.resolveSite(identity.site_id);
        if (!fs.existsSync(siteDir)) {
          throw Object.assign(new Error(`Site ${identity.site_id} not found on disk`), { statusCode: 404, code: 'site_not_found' });
        }

        const entries = fs.readdirSync(siteDir, { withFileTypes: true });
        const pages = [];
        const styles = [];
        const configs = [];
        const assets = [];

        for (const entry of entries) {
          if (entry.isDirectory()) {
            if (entry.name === '.site-context') {
              const ctxFile = path.join(siteDir, '.site-context', 'site-context.json');
              if (fs.existsSync(ctxFile)) {
                configs.push({ name: '.site-context/site-context.json', path: '.site-context/site-context.json', type: 'json' });
              }
            }
            continue;
          }
          const ext = path.extname(entry.name).toLowerCase();
          if (ext === '.html') {
            pages.push({ name: entry.name, path: entry.name, type: 'html', isIndex: entry.name === 'index.html' });
          } else if (ext === '.css' || entry.name === 'tokens.json') {
            styles.push({ name: entry.name, path: entry.name, type: ext === '.css' ? 'css' : 'json' });
          } else if (ext === '.json' || ext === '.md' || entry.name.startsWith('.')) {
            configs.push({ name: entry.name, path: entry.name, type: ext.slice(1) || 'config' });
          } else {
            assets.push({ name: entry.name, path: entry.name, type: ext.slice(1) || 'asset' });
          }
        }

        // Sort pages with index.html first
        pages.sort((a, b) => (a.isIndex ? -1 : b.isIndex ? 1 : a.name.localeCompare(b.name)));

        return {
          status: 200,
          body: {
            site_id: identity.site_id,
            pages,
            styles,
            configs,
            assets,
            total_files: pages.length + styles.length + configs.length + assets.length,
          },
        };
      } catch (error) {
        return errorResponse(error);
      }
    });

    // Reads specific file content inside the site directory
    app.route('GET', '/api/sites/file', async ({ req, identity }) => {
      try {
        const url = new URL(req.url, 'http://127.0.0.1');
        const filename = url.searchParams.get('file') || 'index.html';
        const { dir: siteDir } = paths.resolveSite(identity.site_id);
        const targetPath = path.resolve(siteDir, filename);

        // Security / containment check: target must be inside site directory
        if (!targetPath.startsWith(path.resolve(siteDir))) {
          throw Object.assign(new Error('Access denied: target path escapes site boundary'), { statusCode: 403, code: 'path_traversal' });
        }

        if (!fs.existsSync(targetPath)) {
          throw Object.assign(new Error(`File ${filename} not found in site ${identity.site_id}`), { statusCode: 404, code: 'file_not_found' });
        }

        const content = fs.readFileSync(targetPath, 'utf8');
        return {
          status: 200,
          body: {
            site_id: identity.site_id,
            file: filename,
            content,
            size: Buffer.byteLength(content, 'utf8'),
            modified_at: fs.statSync(targetPath).mtime.toISOString(),
          },
        };
      } catch (error) {
        return errorResponse(error);
      }
    });

    // Saves specific file content inside the site directory
    app.route('POST', '/api/sites/file', async ({ req, identity }) => {
      try {
        const body = await readJsonBody(req);
        const filename = body.file || 'index.html';
        const content = typeof body.content === 'string' ? body.content : '';
        const { dir: siteDir } = paths.resolveSite(identity.site_id, { createIfMissing: true });
        const targetPath = path.resolve(siteDir, filename);

        if (!targetPath.startsWith(path.resolve(siteDir))) {
          throw Object.assign(new Error('Access denied: target path escapes site boundary'), { statusCode: 403, code: 'path_traversal' });
        }

        const dir = path.dirname(targetPath);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

        fs.writeFileSync(targetPath, content, 'utf8');

        // Record mutation event
        if (events && typeof events.emit === 'function') {
          events.emit({
            type: 'file_saved',
            site_id: identity.site_id,
            payload: {
              file: filename,
              bytes: Buffer.byteLength(content, 'utf8'),
            },
          });
        }

        return {
          status: 200,
          body: {
            site_id: identity.site_id,
            file: filename,
            saved: true,
            bytes: Buffer.byteLength(content, 'utf8'),
          },
        };
      } catch (error) {
        return errorResponse(error);
      }
    });

    // Site-Level Settings (stored in .site-context/site-context.json and spec.json)
    app.route('GET', '/api/sites/settings', async ({ identity }) => {
      try {
        const { dir: siteDir } = paths.resolveSite(identity.site_id, { createIfMissing: true });
        if (!fs.existsSync(siteDir)) {
          throw Object.assign(new Error(`Site ${identity.site_id} not found`), { statusCode: 404, code: 'site_not_found' });
        }

        const ctxDir = path.join(siteDir, '.site-context');
        const ctxFile = path.join(ctxDir, 'site-context.json');
        let context = {};
        if (fs.existsSync(ctxFile)) {
          try { context = JSON.parse(fs.readFileSync(ctxFile, 'utf8')); } catch { context = {}; }
        }

        let siteSpec = {};
        try {
          const specResult = spec.read(identity.site_id);
          siteSpec = specResult.spec || {};
        } catch {
          siteSpec = {};
        }

        const settings = {
          site_id: identity.site_id,
          site_name: context.business_name || siteSpec.business?.name || identity.site_id.replace(/^site-/, '').replace(/-/g, ' '),
          domain: context.domain || siteSpec.business?.domain || `${identity.site_id.replace(/^site-/, '')}.famtastic.dev`,
          git_repo_url: context.git_repo_url || `https://github.com/famtastic-fritz/${identity.site_id}.git`,
          // FAMtastic Inc is the only production provider. A stale legacy
          // value must never make the console imply Netlify/Vercel is active.
          deployment_target: deploymentTarget(context.deployment_target),
          market: context.market || siteSpec.business?.market || siteSpec.business?.location || 'Local Market',
          brand_style: context.brand_style || siteSpec.business?.style || 'modern-clean',
          coupon_hook: context.coupon_hook || siteSpec.business?.coupon_hook || '',
          meta_title: context.meta_title || siteSpec.business?.name || '',
          meta_description: context.meta_description || `${context.business_name || identity.site_id} - Official Website`,
          created_at: context.created_at || new Date().toISOString(),
          updated_at: context.updated_at || new Date().toISOString(),
        };

        return { status: 200, body: settings };
      } catch (error) {
        return errorResponse(error);
      }
    });

    app.route('POST', '/api/sites/settings', async ({ req, identity }) => {
      try {
        const body = await readJsonBody(req);
        const { dir: siteDir } = paths.resolveSite(identity.site_id, { createIfMissing: true });
        if (!fs.existsSync(siteDir)) {
          throw Object.assign(new Error(`Site ${identity.site_id} not found`), { statusCode: 404, code: 'site_not_found' });
        }

        const ctxDir = path.join(siteDir, '.site-context');
        if (!fs.existsSync(ctxDir)) fs.mkdirSync(ctxDir, { recursive: true });
        const ctxFile = path.join(ctxDir, 'site-context.json');

        let currentCtx = {};
        if (fs.existsSync(ctxFile)) {
          try { currentCtx = JSON.parse(fs.readFileSync(ctxFile, 'utf8')); } catch { currentCtx = {}; }
        }

        const requestedDeploymentTarget = typeof body.deployment_target === 'string'
          ? body.deployment_target.trim().toLowerCase()
          : '';
        if (requestedDeploymentTarget && !ALLOWED_DEPLOYMENT_TARGETS.has(requestedDeploymentTarget)) {
          throw Object.assign(
            new Error(`Unsupported deployment target: ${requestedDeploymentTarget}. Use famtasticinc or local.`),
            { statusCode: 422, code: 'deployment_target_not_supported' },
          );
        }

        const updated = {
          ...currentCtx,
          site_id: identity.site_id,
          business_name: body.site_name || currentCtx.business_name || identity.site_id,
          domain: body.domain || currentCtx.domain || '',
          git_repo_url: body.git_repo_url || currentCtx.git_repo_url || '',
          deployment_target: requestedDeploymentTarget
            || deploymentTarget(currentCtx.deployment_target),
          market: body.market || currentCtx.market || '',
          brand_style: body.brand_style || currentCtx.brand_style || 'modern-clean',
          coupon_hook: body.coupon_hook || currentCtx.coupon_hook || '',
          meta_title: body.meta_title || currentCtx.meta_title || '',
          meta_description: body.meta_description || currentCtx.meta_description || '',
          updated_at: new Date().toISOString(),
        };

        fs.writeFileSync(ctxFile, JSON.stringify(updated, null, 2), 'utf8');

        // Also update spec.json if present
        try {
          const specResult = spec.read(identity.site_id);
          if (specResult.spec) {
            const nextSpec = {
              ...specResult.spec,
              business: {
                ...specResult.spec.business,
                name: updated.business_name,
                domain: updated.domain,
                location: updated.market,
                style: updated.brand_style,
                coupon_hook: updated.coupon_hook || undefined,
              },
            };
            spec.write(identity.site_id, nextSpec, { initiator: 'settings-console' });
          }
        } catch {
          // Best effort spec sync
        }

        return { status: 200, body: { success: true, settings: updated } };
      } catch (error) {
        return errorResponse(error);
      }
    });
  },
};

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (chunk) => { data += chunk; });
    req.on('end', () => {
      if (!data) return resolve({});
      try {
        resolve(JSON.parse(data));
      } catch (error) {
        reject(Object.assign(new Error('request body is not valid JSON'), { statusCode: 400, code: 'invalid_body' }));
      }
    });
    req.on('error', reject);
  });
}
