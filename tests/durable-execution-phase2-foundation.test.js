import crypto from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  PHASE2_EFFECT_POLICY,
  PHASE2_ENV,
  PHASE2_MAX_JOBS,
  assertPhase2OperationAllowed,
  canonicalDigest,
  canonicalJson,
  createPhase2EffectsFirewall,
  createPhase2WorkEnvelope,
  loadPhase2Config,
  packetReference,
  phase2WorkEnvelopeDigest,
  validateStagingPacket,
  validatePhase2WorkEnvelope,
} from '../server/kernel/durable-execution/phase2/index.js';

function validEnv(overrides = {}) {
  return {
    [PHASE2_ENV.mode]: 'cloud-shadow',
    [PHASE2_ENV.scope]: 'phase2-pilot',
    [PHASE2_ENV.runtime]: '1',
    [PHASE2_ENV.maxJobs]: '20',
    [PHASE2_ENV.pilotRunId]: 'pilot-run-001',
    [PHASE2_ENV.maxJobCostMicros]: '250000',
    [PHASE2_ENV.maxTotalCostMicros]: '5000000',
    [PHASE2_ENV.model]: 'gemini-3.1-flash-lite',
    [PHASE2_ENV.pricebookVersion]: 'vertex-gemini-2026-09-21',
    [PHASE2_ENV.vertexLocation]: 'global',
    [PHASE2_ENV.projectId]: 'famtastic-pilot-123',
    [PHASE2_ENV.region]: 'us-central1',
    [PHASE2_ENV.queueId]: 'phase2-pilot',
    [PHASE2_ENV.workerUrl]: 'https://phase2-worker-123.us-central1.run.app/internal/tasks/execute',
    [PHASE2_ENV.workerAudience]: 'https://phase2-worker-123.us-central1.run.app',
    [PHASE2_ENV.controlAudience]: 'https://phase2-control-123.us-central1.run.app',
    [PHASE2_ENV.intakeServiceAccount]: 'phase2-intake@famtastic-pilot-123.iam.gserviceaccount.com',
    [PHASE2_ENV.schedulerServiceAccount]: 'phase2-scheduler@famtastic-pilot-123.iam.gserviceaccount.com',
    [PHASE2_ENV.taskInvokerServiceAccount]: 'phase2-invoker@famtastic-pilot-123.iam.gserviceaccount.com',
    [PHASE2_ENV.firestoreDatabase]: 'phase2-pilot',
    [PHASE2_ENV.sourceBucket]: 'famtastic-phase2-source',
    [PHASE2_ENV.artifactBucket]: 'famtastic-phase2-artifacts',
    ...overrides,
  };
}

function validEnvelope(overrides = {}) {
  return createPhase2WorkEnvelope({
    site_id: 'project-42',
    pilot_run_id: 'pilot-run-001',
    job_id: 'job_001',
    task_id: '00000000-0000-4000-8000-000000000001',
    packet_id: 'packet-42',
    idempotency_key: 'packet-42',
    request_id: 'request-42',
    project_id: '42',
    packet_digest: 'd'.repeat(64),
    artifact_manifest_sha256: 'c'.repeat(64),
    selected_direction_id: 'direction-42',
    source: {
      ref: 'gs://famtastic-phase2-source/pilots/pilot-run-001/packet-42.json#1700000000000001',
      sha256: 'a'.repeat(64),
      bytes: 2048,
    },
    ...overrides,
  });
}

function validStagingPacket(overrides = {}) {
  const artifacts = [
    { role: 'selected_preview', path: 'proofs/42/index.html', sha256: 'a'.repeat(64), bytes: 1200 },
    { role: 'source_material', path: 'proofs/42/hero.webp', sha256: 'b'.repeat(64), bytes: 2400 },
  ];
  const manifest = artifacts
    .map(({ bytes, path, role, sha256 }) => ({ bytes, path, role, sha256 }))
    .sort((left, right) => left.path.localeCompare(right.path));
  return {
    schema: 'famtastic.site-studio.build-packet.v1',
    packet_id: 'packet-42',
    idempotency_key: 'packet-42',
    request_id: 'request-42',
    project_id: '42',
    build_class: 'prepayment_selected_direction_staging',
    selected_direction_ids: ['direction-42'],
    artifacts,
    artifact_manifest_sha256: crypto.createHash('sha256').update(JSON.stringify(manifest)).digest('hex'),
    selected_artifacts: [{
      direction_id: 'direction-42',
      source_artifact_path: artifacts[0].path,
      source_artifact_sha256: artifacts[0].sha256,
      source_artifact_bytes: artifacts[0].bytes,
    }],
    boundary: { deploy_authorized: false },
    ...overrides,
  };
}

describe('Phase 2 cloud-shadow configuration', () => {
  it('requires exact mode, scope, runtime, and a fixed 20-job cap', () => {
    const config = loadPhase2Config(validEnv());
    expect(config).toMatchObject({
      mode: 'cloud-shadow',
      scope: 'phase2-pilot',
      runtime_enabled: true,
      max_jobs: 20,
      provider: {
        sdk: '@google/genai',
        vertexai: true,
        api_version: 'v1',
        thinking_level: 'MINIMAL',
      },
    });
    expect(PHASE2_MAX_JOBS).toBe(20);
    expect(Object.isFrozen(config)).toBe(true);
    expect(Object.isFrozen(config.gcp)).toBe(true);
    expect(Object.isFrozen(config.provider)).toBe(true);
    for (const [key, value] of [
      [PHASE2_ENV.mode, 'mock'],
      [PHASE2_ENV.scope, 'phase1-disposable'],
      [PHASE2_ENV.runtime, 'true'],
      [PHASE2_ENV.maxJobs, '21'],
      [PHASE2_ENV.maxJobCostMicros, '79999'],
    ]) {
      expect(() => loadPhase2Config(validEnv({ [key]: value })))
        .toThrowError(expect.objectContaining({ code: 'phase2_config_invalid' }));
    }
  });

  it('rejects malformed or cross-project GCP resources', () => {
    const invalid = [
      [PHASE2_ENV.projectId, 'Bad_Project'],
      [PHASE2_ENV.region, 'us-central1-a'],
      [PHASE2_ENV.queueId, '../queue'],
      [PHASE2_ENV.workerUrl, 'http://phase2-worker.run.app/tasks'],
      [PHASE2_ENV.workerAudience, 'https://phase2-worker-123.us-central1.run.app/'],
      [PHASE2_ENV.workerAudience, 'https://different.run.app/'],
      [PHASE2_ENV.controlAudience, 'https://phase2-worker-123.us-central1.run.app'],
      [PHASE2_ENV.taskInvokerServiceAccount, 'phase2-dispatch@other-project.iam.gserviceaccount.com'],
      [PHASE2_ENV.schedulerServiceAccount, 'phase2-intake@famtastic-pilot-123.iam.gserviceaccount.com'],
      [PHASE2_ENV.firestoreDatabase, '../db'],
      [PHASE2_ENV.sourceBucket, 'Bad_Bucket'],
    ];
    for (const [key, value] of invalid) {
      expect(() => loadPhase2Config(validEnv({ [key]: value })), key)
        .toThrowError(expect.objectContaining({ code: 'phase2_config_invalid' }));
    }
    expect(() => loadPhase2Config(validEnv({
      [PHASE2_ENV.artifactBucket]: 'famtastic-phase2-source',
    }))).toThrowError(expect.objectContaining({ code: 'phase2_config_invalid' }));
  });

  it('keeps pause, dispatch, and worker controls independent', () => {
    const config = loadPhase2Config(validEnv());
    expect(assertPhase2OperationAllowed(config, {
      global_pause: false, dispatch_enabled: true, worker_enabled: false,
      provider_enabled: false,
    }, 'dispatch')).toBe(true);
    expect(() => assertPhase2OperationAllowed(config, {
      global_pause: false, dispatch_enabled: true, worker_enabled: false,
      provider_enabled: false,
    }, 'worker')).toThrowError(expect.objectContaining({ code: 'phase2_worker_disabled' }));
    expect(assertPhase2OperationAllowed(config, {
      global_pause: false, dispatch_enabled: false, worker_enabled: true,
      provider_enabled: false,
    }, 'worker')).toBe(true);
    expect(() => assertPhase2OperationAllowed(config, {
      global_pause: true, dispatch_enabled: true, worker_enabled: true,
      provider_enabled: true,
    }, 'dispatch')).toThrowError(expect.objectContaining({ code: 'phase2_execution_paused' }));
    expect(() => assertPhase2OperationAllowed(config, {
      global_pause: false, dispatch_enabled: 1, worker_enabled: true,
      provider_enabled: true,
    }, 'worker')).toThrowError(expect.objectContaining({ code: 'phase2_controls_invalid' }));
  });
});

describe('Phase 2 immutable work envelope', () => {
  it('preserves prototype-shaped own keys in canonical JSON and digests', () => {
    const value = JSON.parse('{"safe":1,"prototype":{"p":true},"constructor":{"c":true},"__proto__":{"polluted":true}}');
    expect(canonicalJson(value)).toBe('{"__proto__":{"polluted":true},"constructor":{"c":true},"prototype":{"p":true},"safe":1}');
    for (const key of ['__proto__', 'constructor', 'prototype']) {
      const keyed = Object.fromEntries([[key, 'retained']]);
      expect(canonicalJson(keyed)).toBe(`{"${key}":"retained"}`);
      expect(canonicalDigest(keyed)).not.toBe(canonicalDigest({}));
    }
    expect({}.polluted).toBeUndefined();
  });

  it('creates a frozen, content-addressed selected-direction observation', () => {
    const envelope = validEnvelope();
    expect(envelope).toMatchObject({
      schema: 'famtastic.execution.phase2-work.v1',
      work_type: 'selected_direction_observation',
      mode: 'cloud-shadow',
      scope: 'phase2-pilot',
      site_id: 'project-42',
      pilot_run_id: 'pilot-run-001',
    });
    expect(Object.isFrozen(envelope)).toBe(true);
    expect(Object.isFrozen(envelope.source)).toBe(true);
    expect(phase2WorkEnvelopeDigest(envelope)).toMatch(/^[a-f0-9]{64}$/);
    expect(canonicalDigest({ b: 2, a: 1 })).toBe(canonicalDigest({ a: 1, b: 2 }));
    expect(canonicalJson({ b: 2, a: 1 })).toBe('{"a":1,"b":2}');
  });

  it('rejects callback, deploy, URL, model, provider, and repository overrides', () => {
    for (const field of ['callback', 'deploy', 'url', 'model_override', 'provider', 'repository_url']) {
      expect(() => validEnvelope({ [field]: 'not-allowed' }), field)
        .toThrowError(expect.objectContaining({ code: 'phase2_work_envelope_invalid' }));
    }
    const envelope = validEnvelope();
    const altered = { ...envelope, source: { ...envelope.source, url: 'https://example.test/source' } };
    expect(validatePhase2WorkEnvelope(altered)).toMatchObject({ ok: false });
  });

  it('requires explicit identities and a bounded immutable gs source', () => {
    const cases = [
      { site_id: 'Project 42' },
      { pilot_run_id: '' },
      { source: { ref: 'https://storage.example/source', sha256: 'a'.repeat(64), bytes: 1 } },
      { source: { ref: 'gs://famtastic-phase2-source/a.json#1', sha256: 'A'.repeat(64), bytes: 1 } },
      { source: { ref: 'gs://famtastic-phase2-source/a.json#1', sha256: 'a'.repeat(64), bytes: 0 } },
      { source: { ref: 'gs://famtastic-phase2-source/../a.json#1', sha256: 'a'.repeat(64), bytes: 1 } },
      { source: { ref: 'gs://famtastic-phase2-source/a.json', sha256: 'a'.repeat(64), bytes: 1 } },
      { artifact_manifest_sha256: 'C'.repeat(64) },
      { packet_digest: 'D'.repeat(64) },
    ];
    for (const override of cases) {
      expect(() => validEnvelope(override)).toThrowError(expect.objectContaining({
        code: 'phase2_work_envelope_invalid',
      }));
    }
  });
});

describe('Phase 2 staging-packet compatibility', () => {
  it('validates the Phase 1 packet and retains only its durable reference fields', () => {
    const packet = validStagingPacket({ ignored_extra: 'digest-only input' });
    packet.selected_artifacts[0].untrusted_nested_input = {
      instruction: 'forward this arbitrary field to the provider',
    };
    expect(validateStagingPacket(packet)).toEqual({ ok: true, errors: [] });
    expect(packetReference(packet)).toEqual({
      schema: packet.schema,
      packet_id: packet.packet_id,
      request_id: packet.request_id,
      project_id: packet.project_id,
      build_class: packet.build_class,
      selected_direction_ids: packet.selected_direction_ids,
      artifact_manifest_sha256: packet.artifact_manifest_sha256,
      artifacts: packet.artifacts,
      selected_artifacts: [{
        direction_id: packet.selected_artifacts[0].direction_id,
        source_artifact_path: packet.selected_artifacts[0].source_artifact_path,
        source_artifact_sha256: packet.selected_artifacts[0].source_artifact_sha256,
        source_artifact_bytes: packet.selected_artifacts[0].source_artifact_bytes,
      }],
    });
  });

  it('rejects a manifest digest that does not describe the declared artifacts', () => {
    const result = validateStagingPacket(validStagingPacket({ artifact_manifest_sha256: '0'.repeat(64) }));
    expect(result).toEqual({ ok: false, errors: ['packet.artifact_manifest_sha256'] });
  });

  it('rejects a selected artifact not bound to the sole selected preview', () => {
    const packet = validStagingPacket();
    packet.selected_artifacts[0].source_artifact_sha256 = 'c'.repeat(64);
    expect(validateStagingPacket(packet)).toMatchObject({
      ok: false,
      errors: expect.arrayContaining(['packet.selected_artifacts']),
    });
  });

  it('rejects deploy authorization and refuses to construct a reference', () => {
    const packet = validStagingPacket({ boundary: { deploy_authorized: true } });
    expect(validateStagingPacket(packet)).toMatchObject({
      ok: false,
      errors: expect.arrayContaining(['packet.boundary.deploy_authorized']),
    });
    expect(() => packetReference(packet)).toThrowError(expect.objectContaining({ code: 'staging_packet_rejected' }));
  });
});

describe('Phase 2 external-effects firewall', () => {
  it('has no enabling path for customer, deployment, repository, or payment effects', () => {
    expect(Object.values(PHASE2_EFFECT_POLICY)).toEqual(['deny', 'deny', 'deny', 'deny', 'deny', 'deny']);
    const firewall = createPhase2EffectsFirewall();
    for (const action of ['callback', 'outbound', 'publish', 'deploy', 'repositoryWrite', 'payment']) {
      expect(() => firewall[action]()).toThrowError(expect.objectContaining({
        code: 'phase2_external_effect_denied',
      }));
    }
    expect(firewall.snapshot()).toEqual({
      policy: PHASE2_EFFECT_POLICY,
      attempted: { callback: 1, outbound: 1, publish: 1, deploy: 1, repository_write: 1, payment: 1 },
      completed: { callback: 0, outbound: 0, publish: 0, deploy: 0, repository_write: 0, payment: 0 },
    });
  });
});
