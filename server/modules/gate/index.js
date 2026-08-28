// Quality Gate module: 6-lane evaluation, WebAIM accessibility, token audit, repair queue.
import { createQualityGate } from '../../kernel/quality-gate.js';
import { createSite } from '../../kernel/site.js';

export default {
  name: 'gate',
  register({ app, paths }) {
    const gate = createQualityGate({ paths });
    const siteKernel = createSite({ paths });

    app.route('GET', '/api/gate', async ({ identity, query }) => {
      const siteId = (identity && identity.site_id) || query.site_id;
      if (!siteId) {
        return {
          status: 200,
          body: {
            status: 'no_site_selected',
            reason: 'Quality gate evaluation requires a site_id in the URL query (?site_id=...)',
            lanes: [],
            repair_queue: [],
            gaps: [],
          },
        };
      }

      const evaluation = gate.evaluate(siteId);
      return {
        status: evaluation.status === 'NOT_FOUND' ? 404 : 200,
        body: evaluation,
      };
    });

    app.route('GET', '/api/gate/all', async () => {
      const siteList = siteKernel.list();
      const sites = siteList.sites || [];
      const results = sites.map((s) => ({
        site_id: s.id,
        name: s.name || s.id,
        evaluation: gate.evaluate(s.id),
      }));
      return {
        status: 200,
        body: {
          status: 'available',
          total_sites: results.length,
          results,
        },
      };
    }, { scope: 'global' });
  },
};
