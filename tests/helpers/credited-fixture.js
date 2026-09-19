import fs from 'node:fs';
import path from 'node:path';
import { appendCreatorCredit, creatorLogoAsset } from '../../vendor/site-foundation/index.js';
export function creditedHtml(html, page = 'index.html') {
  const full = html.includes('</body>') ? html + (html.includes('</html>') ? '' : '</html>') : '<html><body>' + html + '</body></html>';
  return appendCreatorCredit(full, { page });
}
export function writeFixtureLogo(dir) {
  const logo = creatorLogoAsset();
  const target = path.join(dir, logo.path);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, logo.contents);
}
