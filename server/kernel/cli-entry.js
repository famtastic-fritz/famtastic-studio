import { realpathSync } from 'node:fs';

/** Compare file identity across /tmp aliases and --preserve-symlinks-main. */
export function isDirectExecution(moduleUrl, entryPath = process.argv[1]) {
  if (!entryPath) return false;
  try {
    return realpathSync(new URL(moduleUrl)) === realpathSync(entryPath);
  } catch {
    return false;
  }
}
