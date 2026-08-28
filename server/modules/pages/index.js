// Pages module: page listing/reading, mutation history, and undo. Identity is
// bound at ingress for every route here (A1) -- there is no ambient site.
// Thin by design: real work lives in kernel/page.js, kernel/journal.js and
// kernel/mutation.js; this module only wires HTTP to them.
import { createPage } from '../../kernel/page.js';
import { createMutation } from '../../kernel/mutation.js';

function errorBody(error, fallbackCode) {
  return { status: error.statusCode || 500, body: { error: error.code || fallbackCode, message: error.message } };
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', (chunk) => { raw += chunk; });
    req.on('end', () => {
      if (!raw.trim()) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch {
        reject(Object.assign(new Error('request body is not valid JSON'), { statusCode: 400, code: 'invalid_json' }));
      }
    });
    req.on('error', reject);
  });
}

export default {
  name: 'pages',
  register({ app, paths, events, journal }) {
    const page = createPage({ paths });
    const mutation = createMutation({ paths, journal, events });

    app.route('GET', '/api/sites/pages', async ({ identity }) => {
      try {
        const result = page.list(identity.site_id);
        return { status: 200, body: result };
      } catch (error) {
        return errorBody(error, 'page_list_failed');
      }
    });

    app.route('GET', '/api/sites/page', async ({ query, identity }) => {
      try {
        const { site_id } = identity;
        const pagePath = (query.get('path') || '').trim();
        if (!pagePath) {
          throw Object.assign(new Error('path query parameter is required'), { statusCode: 400, code: 'path_required' });
        }
        const result = page.get(site_id, pagePath);
        return { status: 200, body: result };
      } catch (error) {
        return errorBody(error, 'page_get_failed');
      }
    });

    app.route('GET', '/api/sites/history', async ({ query, identity }) => {
      try {
        const { site_id } = identity;
        const limitParam = query.get('limit');
        const limit = limitParam ? Number(limitParam) : 100;
        const entries = journal.read(site_id, { limit: Number.isFinite(limit) && limit > 0 ? limit : 100 });
        return {
          status: 200,
          body: { site_id, entries, status: entries.length ? 'available' : 'empty' },
        };
      } catch (error) {
        return errorBody(error, 'history_read_failed');
      }
    });

    app.route('POST', '/api/sites/undo', async ({ req, identity }) => {
      try {
        const { site_id } = identity;
        const body = await readJsonBody(req);
        const undoToken = (body.undo_token || '').trim();
        if (!undoToken) {
          throw Object.assign(new Error('undo_token is required in the request body'), { statusCode: 400, code: 'undo_token_required' });
        }
        const result = mutation.undo(site_id, undoToken);
        return { status: 200, body: { site_id, ...result } };
      } catch (error) {
        return errorBody(error, 'undo_failed');
      }
    });
  },
};
