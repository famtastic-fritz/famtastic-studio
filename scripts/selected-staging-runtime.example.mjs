// CLI adapter for the same reviewed JSON used by server/index.js. When copying
// this adapter outside the checkout, replace the two imports with absolute paths
// to the reviewed installation. The server itself never imports this adapter.
// Opt in with SELECTED_STAGING_ENABLED=1 and SELECTED_STAGING_CONFIG pointing to
// an owner-only (0600), absolute .json file OUTSIDE the checkout. No secret values
// belong in JSON or source; the named credentials must already be in the process.
// Example JSON shape (all identities below are synthetic):
// {
//   "schema_version": 1, "workerMode": "external", "pollIntervalMs": 5000,
//   "shutdownGraceMs": 30000,
//   "callbackEndpoint": "https://designs.example.invalid/web/api/pipeline/site-studio/callback",
//   "callbackSecretEnv": "SITE_STUDIO_CALLBACK_SECRET",
//   "credentialEnv": "FAMTASTIC_CPANEL_API_TOKEN",
//   "artifactOrigins": ["https://designs.example.invalid"],
//   "artifactSecretEnv": "SITE_STUDIO_ARTIFACT_SECRET",
//   "sourceMappings": [],
//   "bindings": [{
//     "binding": {
//       "site_id": "project-synthetic", "customer_id": "synthetic",
//       "url": "https://famtasticinc.com/synthetic/",
//       "target_path": "/home/nineoo/public_html/synthetic",
//       "remote_subdirectory": "synthetic", "access": "protected_review",
//       "host_aliases": ["other.example.invalid"]
//     },
//     "authFile": "/home/nineoo/.famtastic-review/synthetic.htpasswd",
//     "reviewAuthorizationEnv": "SITE_STUDIO_REVIEW_AUTHORIZATION"
//   }]
// }
// artifactSecretEnv supplies assembly.artifactSecret for signed retrieval.
// Alternatively use artifactAuthorizationEnv for an existing Authorization
// header, never both. Use embedded mode only when the server owns polling.
import { configureSelectedStaging } from '../server/kernel/selected-staging-configuration.js';
import { createPaths } from '../server/kernel/paths.js';
export function createRuntime() {
  return configureSelectedStaging({ paths: createPaths(), requiredWorkerMode: 'external' }).runtime;
}
