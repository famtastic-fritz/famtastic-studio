// Shadow runs module: thin HTTP binding over kernel/shadow.js. No pipeline or
// boundary logic lives here (ENDGAME items 24-25, amendment A12); this module
// parses requests, calls the kernel, maps errors, and serves the comparison
// page at its own URL. Deliberately NOT registered in config/pages.json or the
// shared nav (see CONVENTIONS.md: the smoke gate asserts an exact 11-page
// inventory by full tuple) -- reachable instead by a direct link, same as any
// other static page under public/pages/.
import { runShadow, list, read } from '../../kernel/shadow.js';

function errorResponse(error) {
  const status = error.statusCode || 500;
  const body = { error: error.code || 'handler_failed', message: error.message };
  if (error.checks) body.checks = error.checks;
  return { status, body };
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
  name: 'shadow',
  register({ app }) {
    // The comparison view itself. Not in config/pages.json by design; linked
    // to directly (see public/pages/shadow.js's own back-link to /builds, and
    // this module's report note on the reverse link).
    app.page('/shadow', 'pages/shadow.html');

    // Cross-site inventory read, same shape as GET /api/builds (server/modules/
    // builds/index.js) -- a shadow run is evidence for a cutover decision, not
    // one site's state.
    app.route('GET', '/api/shadow/runs', async () => {
      try {
        const runs = list();
        return {
          status: 200,
          body: {
            status: runs.length ? 'available' : 'empty',
            source: 'shadow kernel (list())',
            note: runs.length ? undefined : 'No shadow runs recorded yet.',
            denominators: { total: { value: runs.length } },
            runs,
          },
        };
      } catch (error) {
        return errorResponse(error);
      }
    }, { scope: 'global' });

    app.route('GET', '/api/shadow/run', async ({ query }) => {
      try {
        const shadowId = (query.get('shadow_id') || '').trim();
        if (!shadowId) {
          return { status: 200, body: { status: 'NOT_FOUND', note: 'shadow_id is required', source: 'shadow kernel (read())' } };
        }
        const record = read(shadowId);
        if (!record) {
          return { status: 200, body: { status: 'NOT_FOUND', note: `no shadow record for shadow_id ${shadowId}`, source: 'shadow kernel (read())' } };
        }
        return { status: 200, body: { status: 'available', source: 'shadow kernel (read())', record } };
      } catch (error) {
        return errorResponse(error);
      }
    }, { scope: 'global' });

    // The one mutating route: actually runs the shadow pipeline. Site-scoped
    // (default) -- a shadow run is always run FOR a site, and identity is
    // bound and frozen by the router before this handler runs (A1).
    app.route('POST', '/api/shadow/run', async ({ req, identity }) => {
      try {
        const body = await readJsonBody(req);
        if (!body.brief || typeof body.brief !== 'object') {
          throw Object.assign(new Error('brief is required'), { statusCode: 400, code: 'brief_required' });
        }
        const record = await runShadow({
          site_id: identity.site_id,
          brief: body.brief,
          adapter: body.adapter,
          raw_import: body.raw_import,
          composer: body.composer,
          recipe_ref: body.recipe_ref || null,
          legacy_evidence: body.legacy_evidence || null,
          initiator: identity.conversation_id || 'shadow:console',
        });
        return { status: 201, body: record };
      } catch (error) {
        return errorResponse(error);
      }
    });
  },
};
