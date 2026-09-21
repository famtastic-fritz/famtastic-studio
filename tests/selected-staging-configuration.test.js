import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { configureSelectedStaging, readSelectedStagingConfiguration, selectedStagingDiagnostic,
  validateSelectedStagingConfiguration } from '../server/kernel/selected-staging-configuration.js';
import { configuration, credentials } from './selected-staging-configuration-fixture.mjs';

let root, file, env;
beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'selected-config-'));
  file = path.join(root, 'runtime.json');
  fs.writeFileSync(file, JSON.stringify(configuration()), { mode: 0o600 });
  env = { SELECTED_STAGING_ENABLED: '1', SELECTED_STAGING_CONFIG: file, ...credentials() };
});
afterEach(() => { fs.rmSync(root, { recursive: true, force: true }); });

describe('reviewed selected staging configuration', () => {
  it.each([undefined, '0'])('disabled (%s) never reads a config, credential, or provider', value => {
    const assemblyFactory = vi.fn();
    const guarded = new Proxy({}, { get: (_, key) => {
      if (key === 'SELECTED_STAGING_ENABLED') return value;
      throw new Error('unexpected lookup');
    } });
    expect(configureSelectedStaging({ env: guarded, assemblyFactory }).runtime).toBeNull();
    expect(assemblyFactory).not.toHaveBeenCalled();
  });
  it.each(['true', 'yes', '', '01'])('rejects ambiguous opt-in %s', value => {
    expect(() => configureSelectedStaging({ env: { SELECTED_STAGING_ENABLED: value } })).toThrow('SELECTED_STAGING_ENABLED');
  });
  it('passes exact credential capabilities and signed artifact secret without provider discovery', async () => {
    const runtime = {}, paths = {};
    const factory = vi.fn(() => runtime);
    const result = configureSelectedStaging({ env, paths, assemblyFactory: factory });
    expect(result).toMatchObject({ runtime, workerMode: 'embedded', pollIntervalMs: 1000 });
    const args = factory.mock.calls[0][0];
    expect(args.paths).toBe(paths);
    expect(args.callbackSecret).toBe(env.SITE_STUDIO_CALLBACK_SECRET);
    expect(args.artifactSecret).toBe(env.SITE_STUDIO_ARTIFACT_SECRET);
    expect(args.artifactAuthorizationProvider).toBeNull();
    expect(await args.credentialProvider()).toBe(env.FAMTASTIC_CPANEL_API_TOKEN);
    expect(args.bindings[0].reviewAuthorization).toBe(env.SITE_STUDIO_REVIEW_AUTHORIZATION);
  });
  it('supports explicit Authorization instead of the artifact signing secret', async () => {
    const config = configuration(); delete config.artifactSecretEnv;
    config.artifactAuthorizationEnv = 'SITE_STUDIO_ARTIFACT_AUTHORIZATION';
    fs.writeFileSync(file, JSON.stringify(config)); env.SITE_STUDIO_ARTIFACT_AUTHORIZATION = 'Bearer synthetic-only';
    const factory = vi.fn(() => ({})); configureSelectedStaging({ env, assemblyFactory: factory });
    const args = factory.mock.calls[0][0];
    expect(args.artifactSecret).toBeNull(); expect(await args.artifactAuthorizationProvider()).toBe('Bearer synthetic-only');
  });
  it.each(Object.keys(credentials()))('rejects missing credential %s before constructing a runtime', name => {
    const factory = vi.fn(); delete env[name];
    expect(() => configureSelectedStaging({ env, assemblyFactory: factory })).toThrow('selected_staging_credential_missing');
    expect(factory).not.toHaveBeenCalled();
  });
  it('refuses the CLI adapter in embedded mode before reading credentials or creating a store', () => {
    const factory = vi.fn();
    expect(() => configureSelectedStaging({ env, requiredWorkerMode: 'external', assemblyFactory: factory })).toThrow('workerMode');
    expect(factory).not.toHaveBeenCalled();
  });
  it.each([
    ['schema_version', c => { c.schema_version = 2; }],
    ['workerMode', c => { delete c.workerMode; }],
    ['pollIntervalMs', c => { c.pollIntervalMs = 0; }],
    ['shutdownGraceMs', c => { c.shutdownGraceMs = 60001; }],
    ['configuration', c => { c.runtimeModule = '/arbitrary/code.mjs'; }],
    ['bindings', c => { c.bindings = []; }],
    ['bindings.duplicate', c => { c.bindings.push(structuredClone(c.bindings[0])); }],
    ['bindings.target', c => { c.bindings[0].binding.target_path = '/home/nineoo/public_html'; }],
    ['bindings.target', c => { c.bindings[0].binding.access = 'public'; }],
    ['bindings.url', c => { c.bindings[0].binding.url = 'https://outside.example.invalid/'; }],
    ['bindings.host_aliases', c => { c.bindings[0].binding.host_aliases = ['example.invalid/escape']; }],
    ['bindings.authFile', c => { c.bindings[0].authFile = '/home/nineoo/public_html/auth'; }],
    ['callbackEndpoint', c => { c.callbackEndpoint = 'http://example.invalid/api/pipeline/site-studio/callback'; }],
    ['callbackEndpoint', c => { c.callbackEndpoint += '?token=secret'; }],
    ['callbackSecretEnv', c => { c.callbackSecretEnv = 'HOME'; }],
    ['artifactOrigins', c => { c.artifactOrigins = ['https://assets.example.invalid/path']; }],
    ['artifactOrigins', c => { c.artifactOrigins = ['https://user:secret@assets.example.invalid']; }],
    ['artifactAuthentication', c => { c.artifactAuthorizationEnv = 'SITE_STUDIO_ARTIFACT_AUTHORIZATION'; }],
    ['artifactAuthentication', c => { delete c.artifactSecretEnv; }],
    ['sourceMappings', c => { c.sourceMappings = {}; }],
  ])('validates %s without echoing config values', (field, change) => {
    const config = configuration(); change(config);
    expect(() => validateSelectedStagingConfiguration(config)).toThrow(`selected_staging_config_invalid: ${field}`);
  });
  it('validates a manually bound source mapping without inspecting or writing its repository', () => {
    const config = configuration();
    config.sourceMappings = [{ project_id: '42', customer_id: 'customer-1', site_id: 'project-42', run_id: 'synthetic-run',
      repository_path: '/synthetic/nonexistent/source', source_export_sha256: 'a'.repeat(64), evidence_ref: 'synthetic-evidence' }];
    expect(validateSelectedStagingConfiguration(config).sourceMappings).toEqual(config.sourceMappings);
    config.sourceMappings[0].customer_id = 'another-customer';
    expect(() => validateSelectedStagingConfiguration(config)).toThrow('sourceMappings.binding');
  });
  it('requires absolute, private, owner-only JSON outside the source checkout', () => {
    expect(() => readSelectedStagingConfiguration({ env: { ...env, SELECTED_STAGING_CONFIG: 'runtime.json' } })).toThrow('SELECTED_STAGING_CONFIG');
    expect(() => readSelectedStagingConfiguration({ env, treeRoot: root })).toThrow('must_be_private');
    fs.chmodSync(file, 0o644);
    expect(() => readSelectedStagingConfiguration({ env })).toThrow('must_be_private');
  });
  it('rejects symlinks, non-files, oversized input and malformed JSON without leaking contents', () => {
    const link = path.join(root, 'link.json'); fs.symlinkSync(file, link);
    expect(() => readSelectedStagingConfiguration({ env: { ...env, SELECTED_STAGING_CONFIG: link } })).toThrow('unreadable');
    const directory = path.join(root, 'directory.json'); fs.mkdirSync(directory, { mode: 0o700 });
    expect(() => readSelectedStagingConfiguration({ env: { ...env, SELECTED_STAGING_CONFIG: directory } })).toThrow('must_be_private');
    fs.writeFileSync(file, 'SENSITIVE'.repeat(40000));
    expect(() => readSelectedStagingConfiguration({ env })).toThrow('too_large');
    fs.writeFileSync(file, '{ SENSITIVE');
    try { readSelectedStagingConfiguration({ env }); } catch (error) {
      expect(JSON.stringify(selectedStagingDiagnostic(error, 'boot'))).toContain('json_invalid');
      expect(error.message).not.toContain('SENSITIVE');
    }
  });
  it('reports assembly failure without raw provider errors, secrets or config paths', () => {
    let failure;
    try { configureSelectedStaging({ env, assemblyFactory: () => { throw new Error(`SENSITIVE ${file}`); } }); } catch (error) { failure = error; }
    expect(selectedStagingDiagnostic(failure, 'boot')).toEqual({ component: 'selected_staging', phase: 'boot', code: 'selected_staging_initialization_failed', field: 'assembly' });
    expect(JSON.stringify(selectedStagingDiagnostic({ code: 'SENSITIVE', message: file }, 'wake'))).not.toMatch(/SENSITIVE|runtime.json/);
    expect(selectedStagingDiagnostic({ code: 'EADDRINUSE', message: file }, 'listen')).toEqual({ component: 'selected_staging', phase: 'listen', code: 'EADDRINUSE' });
  });
});
