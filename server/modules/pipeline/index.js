// Pipeline module: thin HTTP binding over kernel/pipeline.js (research -> spec
// -> compose -> build -> verify -> record). No stage logic lives here; it
// binds identity (via the router's frozen `identity`, never calling
// bindIdentity itself), parses the body, calls the kernel, and maps errors.
import crypto from 'node:crypto';
import { stagingPacketErrors as selectedPacketErrors } from '../../kernel/staging-contract.js';
import { PLANNING_SCHEMA, planningPacketErrors } from '../../kernel/selected-planning-contract.js';
import { createDna } from '../../kernel/dna.js';
import { createExecutionStore, projectAcceptance } from '../../kernel/durable-execution/index.js';
import { createMutation } from '../../kernel/mutation.js';
import { createSpec } from '../../kernel/spec.js';
import { createPipeline, STAGES, MODEL_ROUTING } from '../../kernel/pipeline.js';

function errorResponse(error) {
  const status = error.statusCode || 500;
  const body = { error: error.code || 'handler_failed', message: error.message };
  if (error.errors) body.errors = error.errors;
  return { status, body };
}

const MAX_REQUEST_BYTES = 1024 * 1024;
const MAX_ARTIFACTS = 500;
const MAX_DECLARED_ARTIFACT_BYTES = 10 * 1024 * 1024 * 1024;
const PACKET_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;

function readJsonEnvelope(req, { maxBytes = MAX_REQUEST_BYTES } = {}) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let bytes = 0;
    let rejected = false;
    req.on('data', (chunk) => {
      if (rejected) return;
      bytes += Buffer.byteLength(chunk);
      if (bytes > maxBytes) {
        rejected = true;
        reject(Object.assign(new Error('request body exceeds 1 MiB'), { statusCode: 413, code: 'request_too_large' }));
        return;
      }
      chunks.push(Buffer.from(chunk));
    });
    req.on('end', () => {
      if (rejected) return;
      if (!bytes) return resolve({ raw: Buffer.alloc(0), body: {} });
      try {
        const raw = Buffer.concat(chunks, bytes);
        resolve({ raw, body: JSON.parse(raw.toString('utf8')) });
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
    if (typeof packet?.[field] !== 'string' || !PACKET_ID_RE.test(packet[field])) errors.push(`packet.${field}`);
  }
  if (packet?.build_class !== 'prepayment_selected_direction_staging') errors.push('packet.build_class');
  if (!Array.isArray(packet?.selected_direction_ids)
    || packet.selected_direction_ids.length !== 1
    || !PACKET_ID_RE.test(packet.selected_direction_ids[0] || '')) errors.push('packet.selected_direction_ids');
  const artifacts = Array.isArray(packet?.artifacts) ? packet.artifacts : [];
  if (!artifacts.length || artifacts.length > MAX_ARTIFACTS) errors.push('packet.artifacts');
  const paths = new Set();
  let declaredBytes = 0;
  for (const artifact of artifacts) {
    const artifactPath = artifact?.path;
    const safePath = typeof artifactPath === 'string'
      && artifactPath.length > 0
      && artifactPath.length <= 500
      && !artifactPath.startsWith('/')
      && !/^[A-Za-z]:/.test(artifactPath)
      && !artifactPath.includes('\\')
      && !artifactPath.includes('\0')
      && artifactPath.split('/').every((part) => part && part !== '.' && part !== '..');
    const valid = artifact
      && ['source_material', 'selected_preview', 'render_evidence'].includes(artifact.role)
      && safePath
      && /^[a-f0-9]{64}$/.test(artifact.sha256 || '')
      && Number.isInteger(artifact.bytes)
      && artifact.bytes >= 0
      && artifact.bytes <= MAX_DECLARED_ARTIFACT_BYTES
      && !paths.has(artifactPath);
    if (!valid) errors.push('packet.artifacts');
    if (artifactPath) paths.add(artifactPath);
    if (Number.isInteger(artifact?.bytes) && artifact.bytes >= 0) declaredBytes += artifact.bytes;
  }
  if (declaredBytes > MAX_DECLARED_ARTIFACT_BYTES) errors.push('packet.artifacts');
  const canonicalManifest = artifacts
    .map((artifact) => ({ bytes: artifact?.bytes, path: artifact?.path, role: artifact?.role, sha256: artifact?.sha256 }))
    .sort((left, right) => String(left.path || '').localeCompare(String(right.path || '')));
  const manifestDigest = crypto.createHash('sha256').update(JSON.stringify(canonicalManifest)).digest('hex');
  if (!/^[a-f0-9]{64}$/.test(packet?.artifact_manifest_sha256 || '') || packet?.artifact_manifest_sha256 !== manifestDigest) {
    errors.push('packet.artifact_manifest_sha256');
  }
  const selected = Array.isArray(packet?.selected_artifacts) ? packet.selected_artifacts : [];
  if (selected.length !== 1) {
    errors.push('packet.selected_artifacts');
  } else {
    const bound = selected[0];
    const match = artifacts.filter((artifact) => artifact?.role === 'selected_preview'
      && artifact?.path === bound?.source_artifact_path
      && artifact?.sha256 === bound?.source_artifact_sha256
      && artifact?.bytes === bound?.source_artifact_bytes);
    if (bound?.direction_id !== packet.selected_direction_ids?.[0] || match.length !== 1) errors.push('packet.selected_artifacts');
  }
  if (packet?.boundary?.deploy_authorized === true) errors.push('packet.boundary.deploy_authorized');
  return [...new Set(errors)];
}

export default {
  name: 'pipeline',
  register({ app, paths, journal, events, stagingRuntime = null }) {
    const dna = createDna({ paths });
    const mutation = createMutation({ paths, journal, events });
    const spec = createSpec({ paths, mutation });
    const pipeline = createPipeline({ paths, journal, events, dna, spec, mutation });
    for (const [route, action] of [['/api/pipeline/source/association', 'request'], ['/api/pipeline/source/associate', 'finalize']]) {
      app.route('POST', route, async ({ req }) => {
        try {
          if (!stagingRuntime?.sourceAssociation) return { status: 503, body: { error: 'source_association_unconfigured' } };
          return { status: 200, body: await stagingRuntime.sourceAssociation[action](await readJsonBody(req)) };
        } catch (error) { return errorResponse(error); }
      }, { scope: 'global' });
    }

    app.route('POST', '/api/pipeline/staging/accept', async ({ req }) => {
      let executionStore;
      try {
        const envelope = await readJsonEnvelope(req, { maxBytes: MAX_REQUEST_BYTES });
        const secret = process.env.FAMTASTIC_STUDIO_DISPATCH_SECRET || '';
        const provided = req.headers?.['x-famtastic-signature'] || '';
        const expected = secret ? `sha256=${crypto.createHmac('sha256', secret).update(envelope.raw).digest('hex')}` : '';
        if (!secret || typeof provided !== 'string' || Buffer.byteLength(expected) !== Buffer.byteLength(provided) || !crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(provided))) {
          return { status: 401, body: { error: 'dispatch_signature_invalid' } };
        }
        const packet = envelope.body?.packet;
        const errors = stagingPacketErrors(packet);
        if (errors.length) return { status: 422, body: { accepted: false, error: 'staging_packet_rejected', errors } };
        const executionMode = process.env.FAMTASTIC_EXECUTION_MODE || 'disabled';
        const executionScope = process.env.FAMTASTIC_EXECUTION_SCOPE || 'disabled';
        if (executionMode !== 'mock' || executionScope !== 'phase1-disposable') {
          const code = executionMode !== 'disabled' && executionMode !== 'mock'
            ? 'real_provider_denied'
            : 'durable_execution_disabled';
          throw Object.assign(new Error('Durable staging admission requires explicit mock, disposable Phase 1 configuration'), {
            statusCode: 503,
            code,
          });
        }
        const siteId = `project-${packet.project_id}`;
        const executionRoot = paths.ensure('execution');
        executionStore = createExecutionStore({ dbPath: paths.executionDatabase(), safeRoot: executionRoot });
        const accepted = executionStore.acceptStagingPacket({ packet, siteId });
        const projections = projectAcceptance({ store: executionStore, journal, events, record: accepted });
        return {
          status: 202,
          body: {
            accepted: true,
            status: 'accepted_waiting_callback',
            receipt: {
              receipt_id: accepted.receipt_id,
              packet_id: packet.packet_id,
              idempotency_key: packet.idempotency_key,
            },
            execution: {
              task_id: accepted.task_id,
              state: accepted.state,
              dispatch_state: accepted.dispatch_state,
              journal_projection: projections.journal,
              event_projection: projections.event,
              duplicate: accepted.duplicate,
            },
          },
        };
      } catch (error) {
        return { status: error.statusCode || 500, body: { accepted: false, error: error.code || 'staging_accept_failed', message: error.message } };
      } finally {
        executionStore?.close();
      }
    }, { scope: 'global' });

    // Real selected continuation is a separate, opt-in capability. It never
    // falls through to the disposable mock queue or creates an orphan queue.
    app.route('POST', '/api/pipeline/selected-staging/accept', async ({ req }) => {
      try {
        const envelope = await readJsonEnvelope(req);
        const secret = process.env.FAMTASTIC_STUDIO_DISPATCH_SECRET || '';
        const provided = req.headers?.['x-famtastic-signature'] || '';
        const expected = secret ? `sha256=${crypto.createHmac('sha256', secret).update(envelope.raw).digest('hex')}` : '';
        if (!secret || typeof provided !== 'string' || Buffer.byteLength(expected) !== Buffer.byteLength(provided)
          || !crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(provided))) {
          return { status: 401, body: { error: 'dispatch_signature_invalid' } };
        }
        if (!stagingRuntime?.store) return { status: 503, body: { accepted: false, error: 'selected_staging_unconfigured' } };
        if ((process.env.FAMTASTIC_EXECUTION_MODE || 'disabled') !== 'disabled'
          || (process.env.FAMTASTIC_EXECUTION_SCOPE || 'disabled') !== 'disabled') {
          return { status: 503, body: { accepted: false, error: 'selected_staging_execution_mode_conflict' } };
        }
        const packet = envelope.body?.packet;
        const errors = packet?.schema === PLANNING_SCHEMA ? planningPacketErrors(packet) : selectedPacketErrors(packet);
        if (errors.length) return { status: 422, body: { accepted: false, error: 'staging_packet_rejected', errors } };
        const job = stagingRuntime.store.accept(packet);
        events.emit({ type: 'site_studio.staging_accepted', site_id: `project-${packet.project_id}`, idempotency_key: packet.idempotency_key,
          payload: { packet_id: packet.packet_id, job_id: job.id, status: job.state } });
        setImmediate(() => { stagingRuntime.wake().catch(() => {}); });
        return { status: 202, body: { accepted: true, status: 'accepted_waiting_callback',
          receipt: { receipt_id: job.id, packet_id: packet.packet_id, idempotency_key: packet.idempotency_key } } };
      } catch (error) {
        return { status: error.statusCode || 500, body: { accepted: false, error: error.code || 'staging_accept_failed' } };
      }
    }, { scope: 'global' });

    app.route('POST', '/api/pipeline/run', async ({ req, identity }) => {
      try {
        const body = await readJsonBody(req);
        if (body.association) {
          throw Object.assign(new Error('Create the source once, then associate its existing site_id and run_id through /api/pipeline/source/associate.'), { statusCode: 409, code: 'source_association_separate_handoff_required' });
        }
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
