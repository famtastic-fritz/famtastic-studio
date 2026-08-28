import { createShay } from '../../kernel/shay.js';
import { createShayRoutine } from '../../kernel/shay-routine.js';

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
  name: 'shay',
  register({ app, paths }) {
    const shay = createShay({ paths });
    const routine = createShayRoutine({ paths });

    // Handles both site-scoped reasoning and global conversational intake
    app.route('POST', '/api/shay/ask', async ({ req, identity }) => {
      try {
        const body = await readJsonBody(req);
        const promptText = typeof body.prompt === 'string' ? body.prompt : (typeof body.text === 'string' ? body.text : '');
        const conversationId = identity.conversation_id || (typeof body.conversation_id === 'string' ? body.conversation_id : 'shay-global');

        // Global conversational intake mode
        if (!identity.site_id || identity.site_id === 'global' || body.prompt) {
          const result = await routine.handleConversationalTurn({
            prompt: promptText,
            conversationId,
          });
          return { status: 200, body: result };
        }

        // Site-scoped model reasoning mode
        const result = await shay.ask({
          site_id: identity.site_id,
          conversation_id: conversationId,
          text: promptText,
          context: body.context && typeof body.context === 'object' ? body.context : {},
        });
        return { status: 200, body: result };
      } catch (error) {
        return errorResponse(error);
      }
    });

    // Global: reports capability honestly, independent of any one site.
    app.route('GET', '/api/shay/status', async () => {
      try {
        return { status: 200, body: shay.status() };
      } catch (error) {
        return errorResponse(error);
      }
    }, { scope: 'global' });
  },
};
