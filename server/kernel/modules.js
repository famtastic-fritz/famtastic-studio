// Discovers server/modules/*/index.js. Each default export: { name, register({ app, paths, events, journal, registry }) }.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const modulesDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../modules');

export async function loadModules() {
  if (!fs.existsSync(modulesDir)) return [];
  const names = fs.readdirSync(modulesDir).filter((n) => fs.existsSync(path.join(modulesDir, n, 'index.js'))).sort();
  const mods = [];
  for (const name of names) {
    const mod = (await import(pathToFileURL(path.join(modulesDir, name, 'index.js')).href)).default;
    if (!mod || typeof mod.register !== 'function') throw new Error(`module ${name} must default-export { name, register }`);
    mods.push({ name, ...mod });
  }
  return mods;
}
