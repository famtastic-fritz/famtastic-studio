import crypto from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import {
  createCloudTasksDispatcher,
  phase2CloudTaskId,
} from '../server/kernel/durable-execution/phase2/cloud-tasks.js';
import { createGcsArtifactStore } from '../server/kernel/durable-execution/phase2/gcs-artifacts.js';
import { createGoogleOidcVerifier } from '../server/kernel/durable-execution/phase2/google-oidc.js';
import { deterministicDocumentId } from '../server/kernel/durable-execution/phase2/firestore-values.js';

const TARGET = 'https://phase2-worker-abc-uc.a.run.app/internal/execution/tasks/run';
const AUDIENCE = 'https://phase2-worker-abc-uc.a.run.app';
const INVOKER = 'phase2-invoker@pilot-project.iam.gserviceaccount.com';

function reservation(overrides = {}) {
  return {
    schema: 'famtastic.execution.task.v2',
    job_id: 'job_123',
    intent_id: 'intent_456',
    dispatch_generation: 2,
    pilot_run_id: 'pilot_run_789',
    site_id: 'site-123',
    packet_digest: 'a'.repeat(64),
    available_at_ms: 1_700_000_000_123,
    ...overrides,
  };
}

function dispatcher(client, overrides = {}) {
  return createCloudTasksDispatcher({
    client,
    projectId: 'pilot-project',
    location: 'us-central1',
    queueId: 'phase2-pilot',
    targetUrl: TARGET,
    serviceAccountEmail: INVOKER,
    audience: AUDIENCE,
    ...overrides,
  });
}

function createMemoryGcs({ throwAfterFirstSave = false } = {}) {
  const objects = new Map();
  const calls = { save: [], file: [], delete: 0, public: 0, signed: 0 };
  let nextGeneration = 100;
  const bucket = {
    file(name, options) {
      calls.file.push({ name, options });
      const selectedGeneration = options?.generation ? String(options.generation) : null;
      return {
        async save(body, saveOptions) {
          calls.save.push({ name, body: Buffer.from(body), options: saveOptions });
          if (objects.has(name) && saveOptions?.preconditionOpts?.ifGenerationMatch === 0) {
            throw Object.assign(new Error('precondition failed'), { code: 412 });
          }
          const generation = String(nextGeneration++);
          objects.set(name, {
            body: Buffer.from(body),
            metadata: {
              generation,
              size: String(body.length),
              contentType: saveOptions.metadata.contentType,
              cacheControl: saveOptions.metadata.cacheControl,
              metadata: { ...saveOptions.metadata.metadata },
            },
          });
          if (throwAfterFirstSave) {
            throwAfterFirstSave = false;
            throw Object.assign(new Error('connection ended after commit'), { code: 'ECONNRESET' });
          }
        },
        async getMetadata() {
          const record = objects.get(name);
          if (!record || (selectedGeneration && selectedGeneration !== record.metadata.generation)) {
            throw Object.assign(new Error('not found'), { code: 404 });
          }
          return [{ ...record.metadata, metadata: { ...record.metadata.metadata } }];
        },
        async download() {
          const record = objects.get(name);
          if (!record || (selectedGeneration && selectedGeneration !== record.metadata.generation)) {
            throw Object.assign(new Error('not found'), { code: 404 });
          }
          return [Buffer.from(record.body)];
        },
        delete() { calls.delete += 1; throw new Error('delete must not be called'); },
        makePublic() { calls.public += 1; throw new Error('makePublic must not be called'); },
        getSignedUrl() { calls.signed += 1; throw new Error('getSignedUrl must not be called'); },
      };
    },
  };
  return {
    storage: { bucket: vi.fn(() => bucket) },
    objects,
    calls,
  };
}

describe('Phase 2 Cloud Tasks adapter', () => {
  it('creates one deterministic IDs-only OIDC task', async () => {
    let submitted;
    const client = {
      createTask: vi.fn(async (request) => {
        submitted = request;
        return [{ name: request.task.name }];
      }),
      getTask: vi.fn(),
    };
    const result = await dispatcher(client).create(reservation());
    const expectedId = phase2CloudTaskId('intent_456', 2);
    expect(expectedId).toBe(deterministicDocumentId('cloudtask', 'intent_456', 2));
    expect(result).toEqual({
      task_id: expectedId,
      task_name: `projects/pilot-project/locations/us-central1/queues/phase2-pilot/tasks/${expectedId}`,
      job_id: 'job_123',
      intent_id: 'intent_456',
      dispatch_generation: 2,
      deduplicated: false,
    });
    expect(submitted.parent).toBe('projects/pilot-project/locations/us-central1/queues/phase2-pilot');
    expect(submitted.task).toMatchObject({
      name: result.task_name,
      httpRequest: {
        httpMethod: 'POST',
        url: TARGET,
        headers: { 'Content-Type': 'application/json; charset=utf-8' },
        oidcToken: { serviceAccountEmail: INVOKER, audience: AUDIENCE },
      },
    });
    expect(submitted.task).not.toHaveProperty('scheduleTime');
    expect(JSON.parse(submitted.task.httpRequest.body.toString('utf8'))).toEqual({
      schema: 'famtastic.execution.task.v2',
      job_id: 'job_123',
      intent_id: 'intent_456',
      dispatch_generation: 2,
      pilot_run_id: 'pilot_run_789',
      site_id: 'site-123',
      packet_digest: 'a'.repeat(64),
    });
    expect(client.getTask).not.toHaveBeenCalled();
  });

  it('converges on ALREADY_EXISTS only after exact full identity verification', async () => {
    let expectedTask;
    const client = {
      createTask: vi.fn(async ({ task }) => {
        expectedTask = task;
        throw Object.assign(new Error('exists'), { code: 6 });
      }),
      getTask: vi.fn(async () => [expectedTask]),
    };
    const result = await dispatcher(client).create(reservation());
    expect(result.deduplicated).toBe(true);
    expect(client.getTask).toHaveBeenCalledWith({ name: result.task_name, responseView: 'FULL' });
  });

  it('reports an existing task as unverified when its full identity lookup fails', async () => {
    const client = {
      createTask: vi.fn(async () => { throw Object.assign(new Error('exists'), { code: 6 }); }),
      getTask: vi.fn(async () => { throw Object.assign(new Error('unavailable'), { code: 14 }); }),
    };
    await expect(dispatcher(client).create(reservation()))
      .rejects.toMatchObject({ code: 'cloud_task_identity_unverified', statusCode: 503 });
  });

  it('ignores server-assigned scheduling metadata during duplicate convergence', async () => {
    let existing;
    const client = {
      createTask: vi.fn(async ({ task }) => {
        existing = { ...task, scheduleTime: { seconds: 1_700_000_999, nanos: 123 } };
        throw Object.assign(new Error('exists after an ambiguous create'), { code: 6 });
      }),
      getTask: vi.fn(async () => [existing]),
    };
    await expect(dispatcher(client).create(reservation()))
      .resolves.toMatchObject({ deduplicated: true });
  });

  it('rejects an existing task with different body, target, or OIDC identity', async () => {
    const cases = [
      (task) => { task.httpRequest.body = Buffer.from('{}'); },
      (task) => { task.httpRequest.url = `${AUDIENCE}/wrong`; },
      (task) => { task.httpRequest.oidcToken.serviceAccountEmail = 'other-agent@pilot-project.iam.gserviceaccount.com'; },
    ];
    for (const mutate of cases) {
      let existing;
      const client = {
        createTask: vi.fn(async ({ task }) => {
          existing = structuredClone(task);
          mutate(existing);
          throw Object.assign(new Error('exists'), { code: 'ALREADY_EXISTS' });
        }),
        getTask: vi.fn(async () => [existing]),
      };
      await expect(dispatcher(client).create(reservation()))
        .rejects.toMatchObject({ code: 'cloud_task_existing_identity_conflict', statusCode: 409 });
    }
  });

  it('rejects content fields, mismatched reservations, and unsafe targets before submission', async () => {
    const client = { createTask: vi.fn(), getTask: vi.fn() };
    await expect(dispatcher(client).create(reservation({ prompt: 'secret customer content' })))
      .rejects.toMatchObject({ code: 'cloud_task_reservation_invalid' });
    await expect(dispatcher(client).create(reservation({ packet_digest: 'not-a-digest' })))
      .rejects.toMatchObject({ code: 'cloud_task_reservation_invalid' });
    await expect(dispatcher(client).create(reservation({ schema: 'famtastic.execution.task.v1' })))
      .rejects.toMatchObject({ code: 'cloud_task_reservation_invalid' });
    await expect(dispatcher(client).create(reservation({ task_id: 'wrong' })))
      .rejects.toMatchObject({ code: 'cloud_task_identity_conflict' });
    expect(() => dispatcher(client, { targetUrl: 'http://127.0.0.1/task' }))
      .toThrowError(expect.objectContaining({ code: 'cloud_task_target_invalid' }));
    expect(() => dispatcher(client, { audience: 'https://different.run.app' }))
      .toThrowError(expect.objectContaining({ code: 'cloud_task_audience_mismatch' }));
    expect(() => dispatcher(client, {
      serviceAccountEmail: 'phase2-invoker@foreign-project.iam.gserviceaccount.com',
    })).toThrowError(expect.objectContaining({ code: 'cloud_task_config_invalid' }));
    expect(client.createTask).not.toHaveBeenCalled();
  });

  it('accepts store reservation metadata without putting it in the task body', async () => {
    let submitted;
    const client = {
      createTask: vi.fn(async (request) => {
        submitted = request;
        return [{ name: request.task.name }];
      }),
      getTask: vi.fn(),
    };
    await dispatcher(client).create(reservation({
      task_id: phase2CloudTaskId('intent_456', 2),
      reservation_token: 'dispatchlease_123',
      duplicate: false,
    }));
    const body = JSON.parse(submitted.task.httpRequest.body.toString('utf8'));
    expect(body).not.toHaveProperty('reservation_token');
    expect(body).not.toHaveProperty('duplicate');
    expect(body).not.toHaveProperty('task_id');
  });
});

describe('Phase 2 GCS artifact adapter', () => {
  it('creates canonical private bytes with generation-zero precondition', async () => {
    const memory = createMemoryGcs();
    const store = createGcsArtifactStore({
      storage: memory.storage,
      bucketName: 'phase2-artifacts',
      prefix: 'phase2-pilot',
    });
    const result = await store.write({
      jobId: 'job_123',
      logicalKey: 'provider-result',
      version: 1,
      output: { z: 2, a: 1 },
    });
    expect(result).toMatchObject({
      logical_key: 'provider-result',
      version: 1,
      artifact_ref: 'gs://phase2-artifacts/phase2-pilot/jobs/job_123/artifacts/provider-result-v1.json#100',
      bytes: 13,
      generation: '100',
      deduplicated: false,
      recovered_after_write_error: false,
    });
    expect(memory.calls.save[0].body.toString()).toBe('{"a":1,"z":2}');
    expect(memory.calls.save[0].options).toMatchObject({
      resumable: false,
      timeout: 60_000,
      validation: 'crc32c',
      preconditionOpts: { ifGenerationMatch: 0 },
      metadata: { contentType: 'application/json', cacheControl: 'private, no-store, max-age=0' },
    });
    expect(result.sha256).toBe(crypto.createHash('sha256').update(memory.calls.save[0].body).digest('hex'));
    expect(memory.calls).toMatchObject({ delete: 0, public: 0, signed: 0 });
  });

  it('converges on precondition failure only when exact bytes and generation verify', async () => {
    const memory = createMemoryGcs();
    const store = createGcsArtifactStore({ storage: memory.storage, bucketName: 'phase2-artifacts' });
    const input = { jobId: 'job_123', logicalKey: 'result', version: 1, output: { ok: true } };
    const first = await store.write(input);
    const duplicate = await store.write(input);
    expect(duplicate).toEqual({ ...first, deduplicated: true });
    await expect(store.write({ ...input, output: { ok: false } }))
      .rejects.toMatchObject({ code: 'artifact_identity_conflict', statusCode: 409 });
  });

  it('recovers an ambiguous save that committed exact immutable bytes', async () => {
    const memory = createMemoryGcs({ throwAfterFirstSave: true });
    const store = createGcsArtifactStore({ storage: memory.storage, bucketName: 'phase2-artifacts' });
    const result = await store.write({ jobId: 'job_123', logicalKey: 'result', output: { ok: true } });
    expect(result).toMatchObject({
      deduplicated: true,
      recovered_after_write_error: true,
      artifact_ref: 'gs://phase2-artifacts/phase2/jobs/job_123/artifacts/result-v1.json#100',
    });
    expect(memory.calls.save).toHaveLength(1);
  });

  it('reads only generation-pinned configured objects and verifies size and SHA-256', async () => {
    const memory = createMemoryGcs();
    const store = createGcsArtifactStore({ storage: memory.storage, bucketName: 'phase2-artifacts' });
    const written = await store.write({ jobId: 'job_123', logicalKey: 'packet', output: { packet_id: 'p1' } });
    const read = await store.readExact({
      artifactRef: written.artifact_ref,
      sha256: written.sha256,
      bytes: written.bytes,
    });
    expect(read).toMatchObject({
      artifact_ref: written.artifact_ref,
      sha256: written.sha256,
      bytes: written.bytes,
      generation: written.generation,
    });
    expect(JSON.parse(read.body.toString('utf8'))).toEqual({ packet_id: 'p1' });
    const deterministic = await store.readDeterministic({
      jobId: 'job_123', logicalKey: 'packet', version: 1,
    });
    expect(deterministic).toMatchObject({
      artifact_ref: written.artifact_ref,
      sha256: written.sha256,
      bytes: written.bytes,
    });
    await expect(store.readDeterministic({
      jobId: 'job_missing', logicalKey: 'packet', version: 1,
    })).resolves.toBeNull();
    await expect(store.readExact({
      artifactRef: written.artifact_ref.replace('phase2-artifacts', 'other-bucket'),
      sha256: written.sha256,
      bytes: written.bytes,
    })).rejects.toMatchObject({ code: 'gcs_artifact_ref_invalid' });
    await expect(store.readExact({
      artifactRef: written.artifact_ref,
      sha256: '0'.repeat(64),
      bytes: written.bytes,
    })).rejects.toMatchObject({ code: 'artifact_identity_conflict' });
    await expect(store.readExact({
      artifactRef: written.artifact_ref,
      sha256: written.sha256,
      bytes: 1024 * 1024 + 1,
    })).rejects.toMatchObject({ code: 'gcs_input_too_large' });
  });

  it('rejects non-JSON output and unsafe bucket identities before any write', async () => {
    const memory = createMemoryGcs();
    const store = createGcsArtifactStore({ storage: memory.storage, bucketName: 'phase2-artifacts' });
    await expect(store.write({ jobId: 'job_123', output: { hidden: undefined } }))
      .rejects.toMatchObject({ code: 'artifact_output_invalid' });
    const sparse = [];
    sparse.length = 1;
    await expect(store.write({ jobId: 'job_123', output: sparse }))
      .rejects.toMatchObject({ code: 'artifact_output_invalid' });
    expect(() => createGcsArtifactStore({ storage: memory.storage, bucketName: 'unsafe..bucket' }))
      .toThrowError(expect.objectContaining({ code: 'gcs_artifact_config_invalid' }));
    expect(memory.calls.save).toHaveLength(0);
  });
});

describe('Phase 2 Google OIDC verifier', () => {
  const nowMs = 1_700_000_000_000;
  const validPayload = {
    aud: AUDIENCE,
    iss: 'https://accounts.google.com',
    email: INVOKER,
    email_verified: true,
    sub: '1234567890',
    iat: 1_699_999_900,
    exp: 1_700_003_500,
  };
  const token = 'header.payload.signature';

  function oidc(payload = validPayload, overrides = {}) {
    const verifyIdToken = vi.fn(async () => ({ getPayload: () => payload }));
    return {
      verifyIdToken,
      instance: createGoogleOidcVerifier({
        verifier: { verifyIdToken },
        audience: AUDIENCE,
        allowedServiceAccountEmails: [INVOKER, 'phase2-scheduler@pilot-project.iam.gserviceaccount.com'],
        clock: () => nowMs,
        ...overrides,
      }),
    };
  }

  it('accepts only exact verified claims and ignores forged task headers', async () => {
    const { instance, verifyIdToken } = oidc();
    const identity = await instance.verify({
      headers: {
        authorization: `Bearer ${token}`,
        'x-cloudtasks-taskname': 'forged-task',
        'x-cloudtasks-queuename': 'forged-queue',
      },
      audience: AUDIENCE,
    });
    expect(identity).toEqual({
      email: INVOKER,
      subject: '1234567890',
      audience: AUDIENCE,
      issuer: 'https://accounts.google.com',
      issued_at: 1_699_999_900,
      expires_at: 1_700_003_500,
    });
    expect(verifyIdToken).toHaveBeenCalledWith({ idToken: token, audience: AUDIENCE });
  });

  it('fails closed when the HTTP service supplies a different audience', async () => {
    const { instance, verifyIdToken } = oidc();
    await expect(instance.verify({
      headers: { authorization: `Bearer ${token}` },
      audience: 'https://other.run.app',
    })).rejects.toMatchObject({ code: 'oidc_audience_invalid', statusCode: 401 });
    expect(verifyIdToken).not.toHaveBeenCalled();
  });

  it.each([
    ['audience', { aud: 'https://other.run.app' }],
    ['issuer', { iss: 'https://attacker.example' }],
    ['email', { email: 'other-agent@pilot-project.iam.gserviceaccount.com' }],
    ['email verification', { email_verified: false }],
    ['expiry', { exp: 1_699_999_000 }],
  ])('rejects a wrong %s claim', async (_label, changed) => {
    const { instance } = oidc({ ...validPayload, ...changed });
    await expect(instance.verifyToken(token))
      .rejects.toMatchObject({ code: 'oidc_claims_invalid', statusCode: 403 });
  });

  it('accepts both exact Google issuer forms', async () => {
    const { instance } = oidc({ ...validPayload, iss: 'accounts.google.com' });
    await expect(instance.verifyToken(token)).resolves.toMatchObject({
      issuer: 'accounts.google.com',
      email: INVOKER,
    });
  });

  it('rejects missing or malformed authorization without calling the verifier', async () => {
    const { instance, verifyIdToken } = oidc();
    await expect(instance.verifyRequest({ headers: { 'x-cloudtasks-taskname': 'pretend' } }))
      .rejects.toMatchObject({ code: 'oidc_authorization_invalid', statusCode: 401 });
    await expect(instance.verifyRequest({ headers: { authorization: 'Bearer not-a-jwt' } }))
      .rejects.toMatchObject({ code: 'oidc_authorization_invalid', statusCode: 401 });
    expect(verifyIdToken).not.toHaveBeenCalled();
  });

  it('sanitizes verifier failures and requires a nonempty exact email allowlist', async () => {
    const instance = createGoogleOidcVerifier({
      verifier: { verifyIdToken: vi.fn(async () => { throw new Error(`provider rejected ${token}`); }) },
      audience: AUDIENCE,
      allowedServiceAccountEmails: [INVOKER],
      clock: () => nowMs,
    });
    await expect(instance.verifyToken(token))
      .rejects.toMatchObject({ code: 'oidc_token_invalid', message: 'Google OIDC verification failed' });
    await expect(instance.verifyToken(token)).rejects.not.toHaveProperty('cause');
    expect(() => createGoogleOidcVerifier({
      verifier: { verifyIdToken: vi.fn() },
      audience: AUDIENCE,
      allowedServiceAccountEmails: [],
    })).toThrowError(expect.objectContaining({ code: 'oidc_config_invalid' }));
  });
});
