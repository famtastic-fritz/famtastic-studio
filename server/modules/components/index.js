// Components module: thin HTTP binding over kernel/component-inventory.js.
// Read-only, portfolio-wide (scope: global -- there is no single site this
// screen is about, it is every real site at once). See that kernel file for
// what "recurring section type" honestly means here: whatever `type` value
// the importer actually wrote into a real site's spec, never an invented
// catalog of layouts.
import { buildComponentInventory } from '../../kernel/component-inventory.js';
import { discoverLibrary } from '../../kernel/library-discovery.js';

function errorResponse(error) {
  const status = error.statusCode || 500;
  return { status, body: { error: error.code || 'handler_failed', message: error.message } };
}

// Read-only specification discovery. This endpoint never binds a customer,
// executes a recipe, or upgrades the source's implementation/readiness flags.
export async function discoverRecipes(load = null, paths = null) {
  try {
    if (!load) {
      const library = discoverLibrary({ id: 'component-studio', paths });
      return { ...library, status: library.status === 'available' ? 'ok' : 'unavailable', recipes: library.entries };
    }
    const library = await load();
    if (typeof library.listRecipes !== 'function') throw new Error('Recipe discovery export missing');
    const recipes = library.listRecipes();
    if (!Array.isArray(recipes)) throw new Error('Invalid recipe catalog');
    return { status: 'ok', discovery_only: true, executable_import_proven: false, recipes };
  } catch {
    return { status: 'unavailable', reason: 'component_studio_recipe_library_unavailable', discovery_only: true, executable_import_proven: false, recipes: [] };
  }
}

export default {
  name: 'components',
  register({ app, paths }) {
    app.route('GET', '/api/libraries', async () => ({ status: 200, body: { schema_version: '1.0.0', libraries: ['component-studio', 'media-studio'].map(id => discoverLibrary({ id, paths })) } }), { scope: 'global' });
    app.route('GET', '/api/component-recipes', async () => ({
      status: 200,
      body: await discoverRecipes(null, paths),
    }), { scope: 'global' });
    app.route('GET', '/api/components', async () => {
      try {
        const result = buildComponentInventory({ paths });
        const libraryCatalog = discoverLibrary({ id: 'component-studio', paths });

        return {
          status: 200,
          body: {
            status: result.status,
            reason: result.reason,
            source: 'component inventory kernel: buildComponentInventory() over every real site\'s already-imported spec',
            components: result.components,
            catalog: libraryCatalog.entries,
            library: libraryCatalog,
            skipped_sites: result.skipped_sites,
          },
        };
      } catch (error) {
        return errorResponse(error);
      }
    }, { scope: 'global' });
  },
};
