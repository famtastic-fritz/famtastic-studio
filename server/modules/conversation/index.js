// Conversation module: thin HTTP binding over server/kernel/conversation.js
// and server/kernel/cards.js. No filesystem or schema logic lives here (A6
// pattern, same as server/modules/sites/index.js) -- it binds identity, calls
// the kernel, and maps errors to status codes.
import { createConversation } from '../../kernel/conversation.js';
import { validateCard } from '../../kernel/cards.js';

function errorResponse(error) {
  const status = error.statusCode || 500;
  const body = { error: error.code || 'handler_failed', message: error.message };
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
      } catch (error) {
        reject(Object.assign(new Error('request body is not valid JSON'), { statusCode: 400, code: 'invalid_body' }));
      }
    });
    req.on('error', reject);
  });
}

export default {
  name: 'conversation',
  register({ app, paths }) {
    const conversation = createConversation({ paths });

    app.route('GET', '/api/sites/conversation', async ({ identity, query }) => {
      try {
        const limitParam = query.get('limit');
        const limit = limitParam ? Number(limitParam) : undefined;
        const entries = conversation.read(identity.site_id, limit ? { limit } : {});
        return { status: 200, body: { site_id: identity.site_id, entries } };
      } catch (error) {
        return errorResponse(error);
      }
    });

    // Appends an operator message. The role is never taken from the request
    // body -- it is always 'operator' here, so the console cannot spoof a
    // 'system' or any other role by posting one.
    app.route('POST', '/api/sites/conversation', async ({ req, identity, query }) => {
      try {
        const body = await readJsonBody(req);
        const conversationId = identity.conversation_id || (typeof body.conversation_id === 'string' ? body.conversation_id : null);
        if (!conversationId) {
          throw Object.assign(
            new Error('conversation_id is required (query, header, or request body) -- start one with POST /api/sites/conversation/new'),
            { statusCode: 400, code: 'identity_required' },
          );
        }
        let card = null;
        if (body.card) card = validateCard(body.card);
        const entry = conversation.append({
          site_id: identity.site_id,
          conversation_id: conversationId,
          role: 'operator',
          text: typeof body.text === 'string' ? body.text : '',
          card,
        });
        return { status: 200, body: { entry } };
      } catch (error) {
        return errorResponse(error);
      }
    });

    app.route('POST', '/api/sites/conversation/new', async ({ identity }) => {
      try {
        // The conversation is minted FOR this site, so ownership is recorded now.
        const result = conversation.newConversation(identity.site_id);
        return { status: 200, body: result };
      } catch (error) {
        return errorResponse(error);
      }
    });
  },
};
