import { describe, expect, it } from 'vitest';
import { createFamtasticIncAdapter } from '../server/kernel/famtasticinc-adapter.js';

const base = {
  site_id: 'shay-tighten-up-your-locs',
  manifest_hash: 'sha256:fixture',
  repo_url: 'git@github.com:famtastic-fritz/shay-tighten-up-your-locs.git',
  domain: 'tightenupyourlocs.com',
};

describe('FAMtastic Inc delivery boundary', () => {
  it('refuses Netlify and other retired provider targets', () => {
    const adapter = createFamtasticIncAdapter();
    expect(() => adapter.plan({ ...base, provider: 'netlify' })).toThrow(/not an allowed delivery target/i);
    expect(() => adapter.plan({ ...base, provider: 'vercel' })).toThrow(/not an allowed delivery target/i);
  });

  it('creates a dry-run plan without exposing credentials or touching DNS', () => {
    const adapter = createFamtasticIncAdapter({ env: {} });
    const plan = adapter.plan({ ...base, environment: 'staging' });
    expect(plan.provider).toBe('famtasticinc');
    expect(plan.preflight.credentials_present).toBe(false);
    expect(plan.preflight.missing_credentials).toEqual([
      'FAMTASTICINC_SFTP_HOST',
      'FAMTASTICINC_SFTP_USER',
      'FAMTASTICINC_SFTP_KEY',
    ]);
    expect(plan.preflight.dns_touched).toBe(false);
    expect(JSON.stringify(plan)).not.toContain('secret');
  });

  it('returns a receipt for a dry run and does not dispatch', async () => {
    let called = false;
    const adapter = createFamtasticIncAdapter({
      env: { FAMTASTICINC_SFTP_HOST: 'host', FAMTASTICINC_SFTP_USER: 'user', FAMTASTICINC_SFTP_KEY: 'key' },
      transport: async () => { called = true; return { provider: 'famtasticinc', receipt_id: 'never' }; },
    });
    const plan = adapter.plan(base);
    const receipt = await adapter.dispatch(plan, { dry_run: true });
    expect(receipt.status).toBe('dry_run');
    expect(receipt.dispatched).toBe(false);
    expect(called).toBe(false);
  });

  it('fails closed when a real dispatch is requested without injected transport', async () => {
    const adapter = createFamtasticIncAdapter({ env: { FAMTASTICINC_SFTP_HOST: 'host', FAMTASTICINC_SFTP_USER: 'user', FAMTASTICINC_SFTP_KEY: 'key' } });
    const plan = adapter.plan(base);
    await expect(adapter.dispatch(plan, { dry_run: false })).rejects.toMatchObject({ code: 'external_transport_not_configured' });
  });

  it('supports an explicit existing-repository and VPS configuration without changing the default', () => {
    const adapter = createFamtasticIncAdapter({ env: {} });
    const plan = adapter.plan({ ...base, repository_mode: 'existing', branch: 'staging', hosting_class: 'vps', environment: 'staging' });
    expect(plan.hosting_class).toBe('vps');
    expect(plan.repository).toEqual({ mode: 'existing', url: base.repo_url, branch: 'staging' });
    expect(adapter.plan({ ...base }).hosting_class).toBe('shared');
  });

  it('does not claim deployment when an injected transport returns a bad receipt', async () => {
    const adapter = createFamtasticIncAdapter({
      env: { FAMTASTICINC_SFTP_HOST: 'host', FAMTASTICINC_SFTP_USER: 'user', FAMTASTICINC_SFTP_KEY: 'key' },
      transport: async () => ({ provider: 'netlify', receipt_id: 'wrong-provider' }),
    });
    const plan = adapter.plan(base);
    await expect(adapter.dispatch(plan, { dry_run: false })).rejects.toMatchObject({ code: 'external_receipt_invalid' });
  });
});
