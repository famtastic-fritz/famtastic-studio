// SEO module: site and page SEO scoring, checklist evaluation, and fix proposals.
import { createSeo } from '../../kernel/seo.js';

function errorResponse(error) {
  const status = error.statusCode || 500;
  return { status, body: { error: error.code || 'seo_analysis_failed', message: error.message } };
}

export default {
  name: 'seo',
  register({ app, paths }) {
    const seo = createSeo({ paths });

    app.route('GET', '/api/seo', async ({ identity }) => {
      try {
        const { site_id } = identity;
        const result = seo.analyze(site_id);
        return { status: 200, body: result };
      } catch (error) {
        return errorResponse(error);
      }
    });

    app.route('GET', '/api/seo/page', async ({ query, identity }) => {
      try {
        const { site_id } = identity;
        const pagePath = (query.get('path') || 'index.html').trim();
        const siteResult = seo.analyze(site_id);
        const pageData = siteResult.pages.find((p) => p.path === pagePath);
        if (!pageData) {
          return { status: 404, body: { error: 'page_not_found', message: `Page not found in SEO scan: ${pagePath}` } };
        }
        return { status: 200, body: { site_id, page: pageData } };
      } catch (error) {
        return errorResponse(error);
      }
    });
  },
};
