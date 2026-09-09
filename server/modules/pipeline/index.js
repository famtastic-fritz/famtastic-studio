// Pipeline module: thin HTTP binding over kernel/pipeline.js (research -> spec
// -> compose -> build -> verify -> record). No stage logic lives here; it
// binds identity (via the router's frozen `identity`, never calling
// bindIdentity itself), parses the body, calls the kernel, and maps errors.
import crypto from 'node:crypto';
import { createDna } from '../../kernel/dna.js';
import { createMutation } from '../../kernel/mutation.js';
import { createSpec } from '../../kernel/spec.js';
import { createPipeline, STAGES, MODEL_ROUTING } from '../../kernel/pipeline.js';

function errorResponse(error) {
  const status = error.statusCode || 500;
  const body = { error: error.code || 'handler_failed', message: error.message };
  if (error.errors) body.errors = error.errors;
  return { status, body };
}

function readJsonEnvelope(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (chunk) => { data += chunk; });
    req.on('end', () => {
      if (!data) return resolve({ raw: '', body: {} });
      try {
        resolve({ raw: data, body: JSON.parse(data) });
      } catch {
        reject(Object.assign(new Error('request body is not valid JSON'), { statusCode: 400, code: 'invalid_body' }));
      }
    });
    req.on('error', reject);
  });
}

async function readJsonBody(req) {
  return (await readJsonEnvelope(req)).body;
}

function stagingPacketErrors(packet) {
  const errors = [];
  if (!packet || packet.schema !== 'famtastic.site-studio.build-packet.v1') errors.push('packet.schema');
  for (const field of ['packet_id', 'idempotency_key', 'request_id', 'project_id', 'build_class']) {
    if (typeof packet?.[field] !== 'string' || !packet[field].trim()) errors.push(`packet.${field}`);
  }
  if (packet?.build_class !== 'prepayment_selected_direction_staging') errors.push('packet.build_class');
  if (!Array.isArray(packet?.selected_direction_ids) || packet.selected_direction_ids.length !== 1) errors.push('packet.selected_direction_ids');
  const artifacts = Array.isArray(packet?.artifacts) ? packet.artifacts : [];
  if (!artifacts.length) errors.push('packet.artifacts');
  const paths = new Set();
  for (const artifact of artifacts) {
    const valid = artifact
      && ['source_material', 'selected_preview', 'render_evidence'].includes(artifact.role)
      && typeof artifact.path === 'string'
      && artifact.path.length > 0
      && !artifact.path.startsWith('/')
      && !artifact.path.includes('..')
      && /^[a-f0-9]{64}$/.test(artifact.sha256 || '')
      && Number.isInteger(artifact.bytes)
      && artifact.bytes >= 0
      && !paths.has(artifact.path);
    if (!valid) errors.push('packet.artifacts');
    if (artifact?.path) paths.add(artifact.path);
  }
  const canonicalManifest = artifacts
    .map((artifact) => ({ bytes: artifact.bytes, path: artifact.path, role: artifact.role, sha256: artifact.sha256 }))
    .sort((left, right) => left.path.localeCompare(right.path));
  const manifestDigest = crypto.createHash('sha256').update(JSON.stringify(canonicalManifest)).digest('hex');
  if (!/^[a-f0-9]{64}$/.test(packet?.artifact_manifest_sha256 || '') || packet?.artifact_manifest_sha256 !== manifestDigest) {
    errors.push('packet.artifact_manifest_sha256');
  }
  const selected = Array.isArray(packet?.selected_artifacts) ? packet.selected_artifacts : [];
  if (selected.length !== 1) {
    errors.push('packet.selected_artifacts');
  } else {
    const bound = selected[0];
    const match = artifacts.filter((artifact) => artifact.role === 'selected_preview'
      && artifact.path === bound?.source_artifact_path
      && artifact.sha256 === bound?.source_artifact_sha256
      && artifact.bytes === bound?.source_artifact_bytes);
    if (bound?.direction_id !== packet.selected_direction_ids?.[0] || match.length !== 1) errors.push('packet.selected_artifacts');
  }
  if (packet?.boundary?.deploy_authorized === true) errors.push('packet.boundary.deploy_authorized');
  return [...new Set(errors)];
}

export default {
  name: 'pipeline',
  register({ app, paths, journal, events }) {
    const dna = createDna({ paths });
    const mutation = createMutation({ paths, journal, events });
    const spec = createSpec({ paths, mutation });
    const pipeline = createPipeline({ paths, journal, events, dna, spec, mutation });

    app.route('POST', '/api/pipeline/staging/accept', async ({ req }) => {
      try {
        const envelope = await readJsonEnvelope(req);
        const secret = process.env.FAMTASTIC_STUDIO_DISPATCH_SECRET || '';
        const provided = req.headers?.['x-famtastic-signature'] || '';
        const expected = secret ? `sha256=${crypto.createHmac('sha256', secret).update(envelope.raw).digest('hex')}` : '';
        if (!secret || typeof provided !== 'string' || Buffer.byteLength(expected) !== Buffer.byteLength(provided) || !crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(provided))) {
          return { status: 401, body: { error: 'dispatch_signature_invalid' } };
        }
        const packet = envelope.body?.packet;
        const errors = stagingPacketErrors(packet);
        if (errors.length) return { status: 422, body: { accepted: false, error: 'staging_packet_rejected', errors } };
        const siteId = `project-${packet.project_id}`;
        const event = events.emit({
          type: 'site_studio.staging_accepted',
          site_id: siteId,
          idempotency_key: packet.idempotency_key,
          payload: { packet_id: packet.packet_id, request_id: packet.request_id, project_id: packet.project_id, status: 'accepted_waiting_callback' },
        });
        journal.append({
          site_id: siteId,
          initiator: 'famtastic-drupal',
          intent: 'accept_selected_staging_packet',
          changes: [{ packet_id: packet.packet_id, status: 'accepted_waiting_callback' }],
          result: { event_id: event.event_id, status: 'accepted_waiting_callback' },
          evidence: { idempotency_key: packet.idempotency_key },
        });
        return { status: 202, body: { accepted: true, status: 'accepted_waiting_callback', receipt: { receipt_id: event.event_id, packet_id: packet.packet_id, idempotency_key: packet.idempotency_key } } };
      } catch (error) {
        return { status: error.statusCode || 500, body: { accepted: false, error: error.code || 'staging_accept_failed', message: error.message } };
      }
    }, { scope: 'global' });

    app.route('POST', '/api/pipeline/run', async ({ req, identity }) => {
      try {
        const body = await readJsonBody(req);
        const targetSiteId = identity?.site_id || body.site_id || (body.brief?.business_name ? `site-${body.brief.business_name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}` : null);
        if (!targetSiteId) {
          throw Object.assign(new Error('pipeline.run requires a site_id or a brief with business_name'), { statusCode: 400, code: 'identity_required' });
        }
        const result = await pipeline.run({
          site_id: targetSiteId,
          brief: body.brief,
          adapter: body.adapter,
          raw_import: body.raw_import,
          composer: body.composer,
          recipe_ref: body.recipe_ref || null,
          initiator: identity?.conversation_id || 'console',
        });
        return { status: result.outcome === 'success' ? 201 : 422, body: result };
      } catch (error) {
        return errorResponse(error);
      }
    }, { scope: 'global' });

    app.route('POST', '/api/pipeline/retry', async ({ req, identity }) => {
      try {
        const body = await readJsonBody(req);
        if (!body.run_id) throw Object.assign(new Error('run_id is required'), { statusCode: 400, code: 'run_id_required' });
        if (!body.stage) throw Object.assign(new Error('stage is required'), { statusCode: 400, code: 'stage_required' });
        const result = await pipeline.retryStage({
          site_id: identity.site_id,
          run_id: body.run_id,
          stage: body.stage,
          brief: body.brief,
          adapter: body.adapter,
          raw_import: body.raw_import,
          composer: body.composer,
          initiator: identity.conversation_id || 'console:retry',
        });
        return { status: result.outcome === 'stage_retried' ? 200 : 422, body: result };
      } catch (error) {
        return errorResponse(error);
      }
    });

    app.route('GET', '/api/pipeline/runs', async ({ identity }) => {
      try {
        const all = dna.list();
        const runs = identity.site_id ? all.filter((r) => r.site_id === identity.site_id) : all;
        return { status: 200, body: { runs, stages: STAGES, model_routing: MODEL_ROUTING } };
      } catch (error) {
        return errorResponse(error);
      }
    });

    app.route('GET', '/api/pipeline/run', async ({ identity, query }) => {
      try {
        const run_id = query.get('run_id');
        if (!run_id) throw Object.assign(new Error('run_id is required'), { statusCode: 400, code: 'run_id_required' });
        const record = dna.read(run_id);
        if (!record || (identity.site_id && record.site_id !== identity.site_id)) {
          return { status: 404, body: { error: 'NOT_FOUND', run_id } };
        }
        return { status: 200, body: record };
      } catch (error) {
        return errorResponse(error);
      }
    });
  },
};
