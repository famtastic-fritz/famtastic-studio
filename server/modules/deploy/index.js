// Deploy module: thin HTTP binding over server/kernel/deploy.js (ADR-0003, A7).
// Identity is bound at ingress by the router (A1); this module never calls
// bindIdentity itself and only consumes the frozen identity it is handed.
import { createDeploy } from '../../kernel/deploy.js';

function errorResponse(error, fallbackCode) {
  const status = error.statusCode || 500;
  const body = { error: error.code || fallbackCode, message: error.message };
  if (error.verification) body.verification = error.verification;
  return { status, body };
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
  name: 'deploy',
  register({ app, paths, events, journal }) {
    const deploy = createDeploy({ paths, journal, events });

    // Confirmation without dispatch (PROVE item 8): shows exactly what a deploy
    // would write, and writes nothing.
    app.route('POST', '/api/sites/plan-deploy', async ({ identity }) => {
      try {
        return { status: 200, body: deploy.plan({ site_id: identity.site_id }) };
      } catch (error) {
        return { status: error.statusCode || 500, body: { error: error.code || 'plan_failed', message: error.message } };
      }
    });

    app.route('POST', '/api/sites/deploy', async ({ identity }) => {
      try {
        const initiator = identity.conversation_id || 'console';
        const receipt = deploy.deploy({ site_id: identity.site_id, initiator });
        return { status: 200, body: receipt };
      } catch (error) {
        return errorResponse(error, 'deploy_failed');
      }
    });

    app.route('POST', '/api/sites/go-live', async ({ req, identity }) => {
      try {
        const body = await readJsonBody(req);
        const receipt_id = (body.receipt_id || '').trim();
        if (!receipt_id) {
          throw Object.assign(new Error('receipt_id is required'), { statusCode: 400, code: 'receipt_id_required' });
        }
        // dns_evidence is optional: this machine must not contact production DNS
        // (ADR-0003), so go-live only records evidence a caller supplies -- it
        // never manufactures it.
        const dns_evidence = body.dns_evidence === undefined || body.dns_evidence === '' ? undefined : body.dns_evidence;
        const initiator = identity.conversation_id || 'console';
        const result = deploy.goLive({ site_id: identity.site_id, receipt_id, dns_evidence, initiator });
        return { status: 200, body: result };
      } catch (error) {
        return errorResponse(error, 'go_live_failed');
      }
    });

    app.route('POST', '/api/sites/rollback', async ({ req, identity }) => {
      try {
        const body = await readJsonBody(req);
        const receipt_id = (body.receipt_id || '').trim();
        if (!receipt_id) {
          throw Object.assign(new Error('receipt_id is required'), { statusCode: 400, code: 'receipt_id_required' });
        }
        const initiator = identity.conversation_id || 'console';
        const result = deploy.rollback({ site_id: identity.site_id, receipt_id, initiator });
        return { status: 200, body: result };
      } catch (error) {
        return errorResponse(error, 'rollback_failed');
      }
    });

    app.route('GET', '/api/sites/deployments', async ({ identity }) => {
      try {
        const result = deploy.list(identity.site_id);
        return { status: 200, body: result };
      } catch (error) {
        return errorResponse(error, 'deployments_list_failed');
      }
    });
  },
};
