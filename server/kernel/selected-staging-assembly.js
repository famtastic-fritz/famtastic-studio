import { createPaths } from './paths.js';
import { createJournal } from './journal.js';
import { createEvents } from './events.js';
import { createDna } from './dna.js';
import { createMutation } from './mutation.js';
import { createSpec } from './spec.js';
import { createPipeline } from './pipeline.js';
import { createStagingRuntime } from './staging-runtime.js';
import { createStagingCallback } from './staging-callback.js';
import { createSelectedReviewQa } from './selected-review-qa.js';
import { createCpanelReview } from './cpanel-review.js';
import { createCpanelHttpTransport } from './cpanel-http-transport.js';
import { stagingError } from './staging-store.js';
import { createSelectedSourceResolver } from './selected-source-binding.js';

export async function boundedBytes(response, maxBytes) {
  const chunks = []; let count = 0;
  if (Number(response.headers.get('content-length')) > maxBytes) throw stagingError('response_too_large');
  for await (const chunk of response.body || []) {
    count += chunk.length;
    if (count > maxBytes) throw stagingError('response_too_large');
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}
// Actual assembly for an explicitly reviewed local configuration module. Secrets
// enter via caller-supplied providers; construction performs no network call.
export function createSelectedStagingAssembly({ paths = createPaths(), bindings, credentialProvider, callbackEndpoint, callbackSecret,
  artifactOrigins, artifactAuthorizationProvider = async () => null, fetchImpl = fetch, sourceMappings = [] }) {
  if (!Array.isArray(bindings) || !bindings.length || !Array.isArray(artifactOrigins) || !artifactOrigins.length) throw stagingError('runtime_configuration_required');
  const journal = createJournal({ paths }), events = createEvents({ paths }), dna = createDna({ paths });
  const mutation = createMutation({ paths, journal, events }), spec = createSpec({ paths, mutation });
  const pipeline = createPipeline({ paths, journal, events, dna, spec, mutation });
  const hosts = new Map();
  for (const config of bindings) {
    const { binding, reviewAuthorization, authFile } = config;
    if (hosts.has(binding.site_id)) throw stagingError('duplicate_runtime_binding');
    const transport = createCpanelHttpTransport({ paths, journal, binding, credentialProvider, reviewAuthorization, authFile, fetchImpl });
    hosts.set(binding.site_id, createCpanelReview({ paths, journal, binding, transport }));
  }
  const callback = createStagingCallback({ endpoint: callbackEndpoint, secret: callbackSecret, request: async (url, options) => {
    let response; try { response = await fetchImpl(url, { ...options, signal: AbortSignal.timeout(30000) }); } catch { throw stagingError('callback_transport_failed'); }
    const bytes = await boundedBytes(response, 65536);
    let body; try { body = JSON.parse(bytes); } catch { throw stagingError('callback_json_invalid'); }
    return { status: response.status, body };
  } });
  return createStagingRuntime({ paths, journal, pipeline, callback, resolveSource: createSelectedSourceResolver({ paths, mappings: sourceMappings }), allowedArtifactOrigins: artifactOrigins,
    fetchArtifact: async ({ url, maxBytes }) => {
      const origin = new URL(url).origin;
      if (!artifactOrigins.includes(origin)) throw stagingError('artifact_origin_rejected');
      const auth = await artifactAuthorizationProvider(url);
      let response;
      try { response = await fetchImpl(url, { headers: auth ? { Authorization: auth } : {}, redirect: 'error', signal: AbortSignal.timeout(30000) }); }
      catch { throw stagingError('artifact_fetch_failed'); }
      if (response.status !== 200) throw stagingError('artifact_fetch_status');
      return boundedBytes(response, maxBytes);
    }, qa: createSelectedReviewQa({ paths }), host: { deploy: options => {
      const host = hosts.get(options.job.build?.site_id || `project-${options.job.packet.project_id}`);
      if (!host) throw stagingError('site_host_not_configured');
      return host.deploy(options);
    } } });
}
