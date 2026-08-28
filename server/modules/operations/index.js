// Operations module: deployments, builds, applications.
// Automations (Shay's Skills Leash) moved to server/modules/automations/,
// backed by server/kernel/skills.js -- do not re-register /api/automations
// here.
import fs from 'node:fs';
import path from 'node:path';
import { createDeploy } from '../../kernel/deploy.js';

function listAllReceipts(paths, journal, events) {
  const deploy = createDeploy({ paths, journal, events });
  const root = paths.root('deploys');
  if (!fs.existsSync(root)) return { status: 'empty', receipts: [] };
  const receipts = fs
    .readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .flatMap((entry) => deploy.list(entry.name).receipts)
    .sort((a, b) => (a.timestamp < b.timestamp ? 1 : -1));
  return { status: receipts.length ? 'available' : 'empty', receipts };
}

function loadProviders(paths) {
  const configDir = path.dirname(paths.configFile);
  const file = path.join(configDir, 'providers.json');
  if (!fs.existsSync(file)) return [];
  return JSON.parse(fs.readFileSync(file, 'utf8')).providers || [];
}

function listRoot(paths, rootName) {
  const root = paths.root(rootName);
  if (!fs.existsSync(root)) return { status: 'NOT_FOUND', root, items: [] };
  const items = fs.readdirSync(root, { withFileTypes: true }).map((entry) => ({
    id: entry.name,
    type: entry.isDirectory() ? 'directory' : 'file',
  }));
  return { status: items.length ? 'available' : 'empty', root, items };
}

export default {
  name: 'operations',
  register({ app, paths, journal, events }) {
    // Deployments/builds/applications/automations read global roots (apps, previews,
    // dna, recipes) and global config, not any one site's state -- convention 5 only
    // requires site_id on requests that read or write site state, so these are
    // declared `scope: 'global'` rather than inheriting the site-scoped default.
    //
    // Deployments: real receipts written by server/kernel/deploy.js (ADR-0003,
    // A7), read across every site's receipt directory. Global scope because this
    // is an operator-wide view, not one site's state.
    app.route('GET', '/api/deployments', async () => {
      const { status, receipts } = listAllReceipts(paths, journal, events);
      return {
        status: 200,
        body: {
          status,
          receipts,
          providers: loadProviders(paths),
        },
      };
    }, { scope: 'global' });

    // Builds + Recipes moved to server/modules/builds/index.js, which owns
    // /api/builds, /api/builds/run, /api/recipes, and /api/builds/save-as-recipe
    // with a real reader backed by the dna and recipe kernels. Do not
    // re-register /api/builds here -- module load order is alphabetical
    // (builds loads before operations) so a duplicate would silently lose
    // anyway, but leaving one in place would still be two sources of truth
    // for one URL.

    app.route('GET', '/api/applications', async () => {
      const listing = listRoot(paths, 'apps');
      return { status: 200, body: listing };
    }, { scope: 'global' });
  },
};
