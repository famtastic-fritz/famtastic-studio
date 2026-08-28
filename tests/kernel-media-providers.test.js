import { describe, it, expect } from 'vitest';
import { listProviders, getProvider, resolveProvider, registrySummary, AUTH_MODES } from '../server/kernel/media-providers.js';

describe('media provider registry', () => {
  // The rule that matters most: Studio must never be the thing holding a
  // provider key. That is the accident that made preview generation look like
  // it belonged to Designs.
  it('offers no legal auth mode that would put an API key inside Studio', () => {
    expect(AUTH_MODES).toEqual(['none', 'mcp', 'seam']);
    expect(AUTH_MODES).not.toContain('api_key');
    for (const p of listProviders()) expect(AUTH_MODES).toContain(p.auth);
  });

  it('resolves the one wired image provider', () => {
    expect(resolveProvider({ kind: 'image' }).id).toBe('pollinations');
  });

  // A caller that asked for video and quietly got a still is the same
  // substitution failure the imagery stage already refuses.
  it('resolves video to hyperframes, wired over MCP', () => {
    const p = resolveProvider({ kind: 'video' });
    expect(p.id).toBe('hyperframes');
    expect(p.auth).toBe('mcp');
  });

  it('still refuses to silently downgrade a kind with no wired provider', () => {
    expect(() => resolveProvider({ kind: 'avatar' })).toThrow(/no wired provider/);
    try { resolveProvider({ kind: 'avatar' }); } catch (e) { expect(e.code).toBe('NO_WIRED_PROVIDER'); }
  });

  it('errors on a declared-but-unwired provider asked for by name, and says why', () => {
    try {
      resolveProvider({ kind: 'image', prefer: 'adobe' });
      throw new Error('should have thrown');
    } catch (e) {
      expect(e.code).toBe('PROVIDER_NOT_WIRED');
      expect(e.message).toMatch(/operator_auth_required/);
    }
  });

  it('refuses a provider asked to produce a kind it does not make', () => {
    expect(() => resolveProvider({ kind: 'image', prefer: 'hyperframes' })).toThrow(/does not produce/);
  });

  it('reports an honest summary including what each blocked provider is blocked by', () => {
    const s = registrySummary();
    const byId = Object.fromEntries(s.map((p) => [p.id, p]));
    expect(byId.pollinations.status).toBe('wired');
    expect(byId.heygen.blocked_by).toMatch(/no_worker/);
    // Declared is not the same as available, and the registry says so.
    expect(s.filter((p) => p.status === 'wired').map((p) => p.id).sort()).toEqual(['hyperframes', 'pollinations']);
  });

  it('rejects an unknown provider or kind rather than guessing', () => {
    expect(() => getProvider('nope')).toThrow(/unknown media provider/);
    expect(() => resolveProvider({ kind: 'hologram' })).toThrow(/unknown media kind/);
  });
});
