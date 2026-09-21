import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createPaths, loadPathsConfig } from '../server/kernel/paths.js';

let tmpRoot;
let prevEnvValue;
const config = loadPathsConfig();

beforeEach(() => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-next-paths-'));
  prevEnvValue = process.env[config.data_root_env];
  process.env[config.data_root_env] = tmpRoot;
});

afterEach(() => {
  if (prevEnvValue === undefined) delete process.env[config.data_root_env];
  else process.env[config.data_root_env] = prevEnvValue;
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

describe('createPaths', () => {
  it('uses the customer collection by default and preserves explicit sandbox isolation', () => {
    const override = process.env.STUDIO_REPOSITORIES_ROOT;
    try {
      delete process.env.STUDIO_REPOSITORIES_ROOT;
      delete process.env[config.data_root_env];
      expect(createPaths().root('sites')).toBe(path.join(os.homedir(), 'Development/FAMtastic/sites'));
      process.env[config.data_root_env] = tmpRoot;
      expect(createPaths().root('sites')).toBe(path.join(tmpRoot, 'sites'));
      process.env.STUDIO_REPOSITORIES_ROOT = path.join(tmpRoot, 'explicit-checkouts');
      expect(createPaths().root('sites')).toBe(path.join(tmpRoot, 'explicit-checkouts'));
    } finally {
      process.env[config.data_root_env] = tmpRoot;
      if (override === undefined) delete process.env.STUDIO_REPOSITORIES_ROOT;
      else process.env.STUDIO_REPOSITORIES_ROOT = override;
    }
  });
  it('resolves every root declared in config/paths.json', () => {
    const paths = createPaths();
    for (const name of Object.keys(config.roots)) {
      expect(() => paths.root(name)).not.toThrow();
      expect(typeof paths.root(name)).toBe('string');
      expect(path.isAbsolute(paths.root(name))).toBe(true);
    }
  });

  it('root() throws for an unknown name', () => {
    const paths = createPaths();
    expect(() => paths.root('not-a-real-root')).toThrow();
  });

  it('within() throws on a traversal attempt', () => {
    const paths = createPaths();
    const rootName = Object.keys(config.roots)[0];
    expect(() => paths.within(rootName, '../escape')).toThrow();
  });

  it('within() resolves a safe relative path inside the root', () => {
    const paths = createPaths();
    const rootName = Object.keys(config.roots)[0];
    const resolved = paths.within(rootName, 'safe-file.json');
    expect(resolved.startsWith(paths.root(rootName))).toBe(true);
  });
});
