// Console module: registers the static page routes for the frontend. Reads
// the page list from config/pages.json so the URL map has one source of
// truth (convention: paths registry / declarative route registration).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const pagesConfigPath = path.resolve(here, '../../../config/pages.json');

export default {
  name: 'console',
  register({ app }) {
    const { pages } = JSON.parse(fs.readFileSync(pagesConfigPath, 'utf8'));
    for (const page of pages) {
      app.page(page.path, `pages/${page.id}.html`);
    }
  },
};
