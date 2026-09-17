// Copy outside the source checkout and configure only after activation review.
// This is an actual createRuntime assembly, not a provider pseudocode stub.
import fs from 'node:fs';
import { createSelectedStagingAssembly } from '../server/kernel/selected-staging-assembly.js';
export function createRuntime() {
  const configFile = process.env.SELECTED_STAGING_CONFIG;
  if (!configFile) throw new Error('SELECTED_STAGING_CONFIG must name a reviewed private JSON configuration');
  const config = JSON.parse(fs.readFileSync(configFile, 'utf8'));
  const secret = name => {
    const value = process.env[name];
    if (!value) throw new Error(`Required credential binding is missing: ${name}`);
    return value;
  };
  return createSelectedStagingAssembly({
    bindings: config.bindings.map(row => ({ binding: row.binding, authFile: row.authFile, reviewAuthorization: secret(row.reviewAuthorizationEnv) })),
    artifactOrigins: config.artifactOrigins,
    sourceMappings: config.sourceMappings || [],
    artifactAuthorizationProvider: async () => config.artifactAuthorizationEnv ? secret(config.artifactAuthorizationEnv) : null,
    callbackEndpoint: config.callbackEndpoint,
    callbackSecret: secret('SITE_STUDIO_CALLBACK_SECRET'),
    credentialProvider: async () => secret('FAMTASTIC_CPANEL_API_TOKEN'),
  });
}
