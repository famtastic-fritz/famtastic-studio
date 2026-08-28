// Research module: thin HTTP binding over kernel/research.js and kernel/packet.js.
// No adapter logic, no schema logic lives here (A6-style separation) — this file
// only binds identity, parses the body, calls the kernel, and maps errors.
import { runResearch, ADAPTERS } from '../../kernel/research.js';
import { readPacket, listPackets } from '../../kernel/packet.js';

function errorResponse(error) {
  const status = error.statusCode || 500;
  const body = { error: error.code || 'handler_failed', message: error.message };
  if (error.errors) body.errors = error.errors;
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
  name: 'research',
  register({ app, paths, journal, events }) {
    app.route('POST', '/api/research/run', async ({ req, identity }) => {
      try {
        const body = await readJsonBody(req);
        const packet = runResearch({
          paths,
          journal,
          events,
          site_id: identity.site_id,
          adapter: body.adapter,
          brief: body.brief,
          raw_import: body.raw_import,
          initiator: identity.conversation_id || 'console',
        });
        return { status: 201, body: packet };
      } catch (error) {
        return errorResponse(error);
      }
    });

    app.route('GET', '/api/research/packets', async ({ identity }) => {
      try {
        const packets = listPackets({ paths, site_id: identity.site_id });
        return { status: 200, body: { packets, adapters: ADAPTERS } };
      } catch (error) {
        return errorResponse(error);
      }
    });

    app.route('GET', '/api/research/packet', async ({ identity, query }) => {
      try {
        const packet_id = query.get('packet_id');
        if (!packet_id) throw Object.assign(new Error('packet_id is required'), { statusCode: 400, code: 'packet_id_required' });
        const packet = readPacket({ paths, site_id: identity.site_id, packet_id });
        if (!packet) return { status: 404, body: { error: 'NOT_FOUND', packet_id } };
        return { status: 200, body: packet };
      } catch (error) {
        return errorResponse(error);
      }
    });
  },
};
