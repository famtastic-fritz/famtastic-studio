import { describe, it, expect } from 'vitest';
import { bindIdentity } from '../server/kernel/identity.js';

function req({ site_id, conversation_id, headers = {} } = {}) {
  const params = new URLSearchParams();
  if (site_id !== undefined) params.set('site_id', site_id);
  if (conversation_id !== undefined) params.set('conversation_id', conversation_id);
  return { query: params, headers };
}

describe('bindIdentity', () => {
  it('throws 400 identity_required with no site_id', () => {
    expect(() => bindIdentity(req())).toThrow();
    try {
      bindIdentity(req());
      throw new Error('should have thrown');
    } catch (error) {
      expect(error.statusCode).toBe(400);
      expect(error.code).toBe('identity_required');
    }
  });

  it('accepts site_id from the query string', () => {
    const identity = bindIdentity(req({ site_id: 'my-site' }));
    expect(identity.site_id).toBe('my-site');
  });

  it('accepts site_id from the x-site-id header', () => {
    const identity = bindIdentity(req({ headers: { 'x-site-id': 'header-site' } }));
    expect(identity.site_id).toBe('header-site');
  });

  it('rejects an invalid site_id containing a path traversal', () => {
    expect(() => bindIdentity(req({ site_id: '../evil' }))).toThrow();
  });

  it('rejects an invalid site_id containing a space', () => {
    expect(() => bindIdentity(req({ site_id: 'a b' }))).toThrow();
  });

  it('returns conversation_id when present', () => {
    const identity = bindIdentity(req({ site_id: 'my-site', conversation_id: 'conv-1' }));
    expect(identity.conversation_id).toBe('conv-1');
  });

  it('returns null conversation_id when not present', () => {
    const identity = bindIdentity(req({ site_id: 'my-site' }));
    expect(identity.conversation_id).toBeNull();
  });

  it('does not require site_id when requireSite is false', () => {
    const identity = bindIdentity(req(), { requireSite: false });
    expect(identity.site_id).toBeNull();
  });
});
