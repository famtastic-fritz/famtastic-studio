// Components module: thin HTTP binding over kernel/component-inventory.js.
// Read-only, portfolio-wide (scope: global -- there is no single site this
// screen is about, it is every real site at once). See that kernel file for
// what "recurring section type" honestly means here: whatever `type` value
// the importer actually wrote into a real site's spec, never an invented
// catalog of layouts.
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { buildComponentInventory } from '../../kernel/component-inventory.js';

function errorResponse(error) {
  const status = error.statusCode || 500;
  return { status, body: { error: error.code || 'handler_failed', message: error.message } };
}

async function loadLibraryCatalog() {
  try {
    const catalogPath = path.resolve(process.cwd(), '..', 'component-studio', 'src', 'catalog.js');
    if (fs.existsSync(catalogPath)) {
      const mod = await import(pathToFileURL(catalogPath).href);
      return mod.COMPONENTS_CATALOG || [];
    }
  } catch {
    // Graceful fallback
  }
  return [];
}

export default {
  name: 'components',
  register({ app, paths }) {
    app.route('GET', '/api/components', async () => {
      try {
        const result = buildComponentInventory({ paths });
        const libraryCatalog = await loadLibraryCatalog();

        return {
          status: 200,
          body: {
            status: result.status,
            reason: result.reason,
            source: 'component inventory kernel: buildComponentInventory() over every real site\'s already-imported spec',
            components: result.components,
            catalog: libraryCatalog,
            skipped_sites: result.skipped_sites,
          },
        };
      } catch (error) {
        return errorResponse(error);
      }
    }, { scope: 'global' });
  },
};
