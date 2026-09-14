import fs from 'node:fs';
import { git } from '../../vendor/site-foundation/index.js';

export function repositoryStatus(root) {
  try {
    if (fs.realpathSync(git(root, ['rev-parse', '--show-toplevel'])) !== fs.realpathSync(root)) return { url: null, state: 'unavailable' };
    let url = null;
    try { url = git(root, ['remote', 'get-url', 'origin']); } catch { /* Local-only is a real state. */ }
    return { url, state: 'local_only', remote_configured: Boolean(url) };
  } catch { return { url: null, state: 'unavailable', remote_configured: false }; }
}
