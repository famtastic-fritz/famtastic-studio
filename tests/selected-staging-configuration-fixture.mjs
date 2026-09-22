export function configuration(workerMode = 'embedded') {
  return { schema_version: 1, workerMode, pollIntervalMs: 1000, shutdownGraceMs: 1000,
    callbackEndpoint: 'https://designs.example.invalid/api/pipeline/site-studio/callback',
    callbackSecretEnv: 'SITE_STUDIO_CALLBACK_SECRET', credentialEnv: 'FAMTASTIC_CPANEL_API_TOKEN',
    artifactOrigins: ['https://assets.example.invalid'], artifactSecretEnv: 'SITE_STUDIO_ARTIFACT_SECRET', sourceMappings: [],
    bindings: [{ binding: { site_id: 'project-42', customer_id: 'customer-1',
      url: 'https://synthetic.famtasticinc.com/', target_path: '/home/nineoo/public_html/synthetic',
      remote_subdirectory: 'synthetic', access: 'protected_review', host_aliases: ['other.example.invalid'] },
    authFile: '/home/nineoo/.famtastic-review/synthetic.htpasswd', reviewAuthorizationEnv: 'SITE_STUDIO_REVIEW_AUTHORIZATION' }] };
}
export function credentials() {
  return { SITE_STUDIO_CALLBACK_SECRET: 'synthetic-callback-never-live', FAMTASTIC_CPANEL_API_TOKEN: 'synthetic-cpanel-never-live',
    SITE_STUDIO_ARTIFACT_SECRET: 'synthetic-artifact-never-live', SITE_STUDIO_REVIEW_AUTHORIZATION: 'Basic c3ludGhldGljOm5ldmVyLWxpdmU=' };
}
