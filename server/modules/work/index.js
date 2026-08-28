// Work module: the unified work queue (plan 3.1). Thin HTTP binding over the
// work kernel; no source logic lives here (that belongs to
// server/kernel/work.js). This endpoint spans sites by design (it is the
// cross-site inbox), so the route stays scope: 'global' -- every item it
// returns names its own site_id explicitly instead (convention 5).
import { createWork } from '../../kernel/work.js';

export default {
  name: 'work',
  register({ app, paths, journal, events }) {
    const work = createWork({ paths, journal, events });

    app.route('GET', '/api/work/items', async () => {
      try {
        const result = work.list();
        return { status: 200, body: result };
      } catch (error) {
        return { status: error.statusCode || 500, body: { error: error.code || 'work_list_failed', message: error.message } };
      }
    }, { scope: 'global' });
  },
};
