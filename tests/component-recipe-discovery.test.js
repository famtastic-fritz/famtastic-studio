import { describe, it, expect } from 'vitest';
import componentModule, { discoverRecipes } from '../server/modules/components/index.js';

describe('read-only Component Studio recipe discovery', () => {
  it('does not silently import an adjacent repository when no checkout is configured', async () => {
    const result = await discoverRecipes();
    expect(result.status).toBe('unavailable');
    expect(result.discovery_only).toBe(true);
    expect(result.executable_import_proven).toBe(false);
    expect(result.recipes).toEqual([]);
  });

  it('retains source readiness and module state without promotion', async () => {
    const recipe = { id: 'fixture', status: 'research_candidate', runtime_implemented: false, production_proven: false, modules: { teaching: { status: 'proposed' } } };
    const result = await discoverRecipes(async () => ({ listRecipes: () => [recipe] }));
    expect(result.recipes).toEqual([recipe]);
    expect(result.executable_import_proven).toBe(false);
  });

  it('reports unavailable explicitly instead of a successful empty catalog', async () => {
    for (const load of [async () => { throw new Error('missing'); }, async () => ({}), async () => ({ listRecipes: () => null })]) {
      const result = await discoverRecipes(load);
      expect(result.status).toBe('unavailable');
      expect(result.recipes).toEqual([]);
    }
  });

  it('registers a global read-only endpoint alongside existing inventory', async () => {
    const routes = [];
    componentModule.register({ app: { route: (...args) => routes.push(args) }, paths: {} });
    const route = routes.find(entry => entry[1] === '/api/component-recipes');
    expect(route[0]).toBe('GET');
    expect(route[3]).toEqual({ scope: 'global' });
    expect((await route[2]()).body.discovery_only).toBe(true);
    expect(routes.some(entry => entry[1] === '/api/components')).toBe(true);
    expect(routes.every(entry => entry[0] === 'GET')).toBe(true);
  });
});
