import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { describe, expect, it, vi } from 'vitest';
import { prepareRunCreate, submitRunCreateOnce } from '../infra/gcp/phase2/scripts/run-create-only.mjs';
import { PHASE2_ENV } from '../server/kernel/durable-execution/phase2/config.js';

const parent = 'projects/example-project/locations/us-central1';
function fixture() {
  const runtime = {
    mode: 'cloud-shadow', scope: 'phase2-pilot', runtime: '1', maxJobs: '20',
    pilotRunId: 'disposable-test', maxJobCostMicros: '250000', maxTotalCostMicros: '5000000',
    model: 'gemini-3.1-flash-lite', pricebookVersion: 'vertex-gemini-2026-09-21', vertexLocation: 'global',
    projectId: 'example-project', region: 'us-central1', queueId: 'phase2-test',
    workerUrl: 'https://phase2-worker-123456789012.us-central1.run.app/internal/tasks/execute',
    workerAudience: 'https://phase2-worker-123456789012.us-central1.run.app',
    controlAudience: 'https://phase2-control-123456789012.us-central1.run.app',
    intakeServiceAccount: 'phase2-intake@example-project.iam.gserviceaccount.com',
    schedulerServiceAccount: 'phase2-scheduler@example-project.iam.gserviceaccount.com',
    taskInvokerServiceAccount: 'phase2-invoker@example-project.iam.gserviceaccount.com',
    firestoreDatabase: 'phase2-test', sourceBucket: 'example-source', artifactBucket: 'example-artifacts',
  };
  return {
    runtimeEnv: Object.fromEntries(Object.entries(runtime).map(([key, value]) => [PHASE2_ENV[key], value])),
    projectNumber: '123456789012', repository: 'phase2-images', sourceSha: 'a'.repeat(40), operationId: 'b'.repeat(32),
    services: Object.fromEntries(['control', 'worker'].map(role => [role, {
      name: `phase2-${role}`, serviceAccount: `phase2-${role}@example-project.iam.gserviceaccount.com`,
      image: `us-central1-docker.pkg.dev/example-project/phase2-images/${role}@sha256:${'c'.repeat(64)}`,
    }])),
  };
}
function io(response = { status: 200, body: { name: `${parent}/operations/op-1` } }) {
  const events = [];
  return { events, record: vi.fn(async (event) => { events.push(event); }), request: vi.fn(async () => response) };
}

describe('Phase 2 create-only Cloud Run request boundary (offline transport)', () => {
  it.each(['control', 'worker'])('builds an explicit immutable %s create request with no public URI', role => {
    const input = fixture(); input.runtimeEnv.UNRELATED_SECRET = 'never-include-me';
    const plan = prepareRunCreate(input, role);
    expect(plan.method).toBe('POST');
    expect(plan.url).toBe(`https://run.googleapis.com/v2/${parent}/services?serviceId=phase2-${role}`);
    expect(plan.resource).toBe(`${parent}/services/phase2-${role}`);
    expect(plan.body).toMatchObject({ ingress: 'INGRESS_TRAFFIC_INTERNAL_ONLY', invokerIamDisabled: false,
      defaultUriDisabled: true, scaling: { minInstanceCount: 0, maxInstanceCount: 1 },
      traffic: [{ type: 'TRAFFIC_TARGET_ALLOCATION_TYPE_LATEST', percent: 100 }],
      template: { timeout: role === 'control' ? '60s' : '300s', maxInstanceRequestConcurrency: 1,
        serviceAccount: input.services[role].serviceAccount } });
    const container = plan.body.template.containers[0];
    expect(container.env.map(x => x.name).sort()).toEqual(Object.values(PHASE2_ENV).sort());
    expect(container.resources).toEqual({ limits: { cpu: '1', memory: '512Mi' }, cpuIdle: true, startupCpuBoost: false });
    expect(JSON.stringify(plan)).not.toContain('never-include-me');
    expect(plan.body_sha256).toBe(createHash('sha256').update(JSON.stringify(plan.body)).digest('hex'));
    expect(() => { container.env[0].value = 'live'; }).toThrow(TypeError);
    input.services[role].image = 'changed'; input.runtimeEnv[PHASE2_ENV.mode] = 'live';
    expect(container.image).not.toBe('changed'); expect(container.env[0].value).toBe('cloud-shadow');
  });

  it('accepts one-character and 49-character names but not 50 characters', () => {
    for (const length of [1, 49, 50]) {
      const input = fixture(); input.services.control.name = 'a'.repeat(length);
      input.runtimeEnv[PHASE2_ENV.controlAudience] = `https://${input.services.control.name}-${input.projectNumber}.us-central1.run.app`;
      if (length < 50) expect(prepareRunCreate(input, 'control')).toBeTruthy();
      else expect(() => prepareRunCreate(input, 'control')).toThrow('phase2_run_create_input_invalid');
    }
  });

  it.each([1, 49, 50])('the existing shell preflight agrees with the v2 name limit (%i)', length => {
    const name = 'a'.repeat(length);
    const result = spawnSync('bash', ['-c', `
      set -a
      source infra/gcp/phase2/env.example
      set +a
      source infra/gcp/phase2/scripts/common.sh
      PHASE2_CONTROL_SERVICE="$1"
      PHASE2_CONTROL_AUDIENCE="https://$1-123456789012.us-central1.run.app"
      require_phase2_env
    `, 'phase2-name-test', name], { encoding: 'utf8' });
    expect(result.error).toBeUndefined();
    expect(result.status === 0, result.stderr).toBe(length < 50);
  });

  it.each([
    ['project', x => { x.runtimeEnv[PHASE2_ENV.projectId] = 'foreign-project'; }],
    ['number', x => { x.projectNumber = '123456789013'; }],
    ['service escape', x => { x.services.control.name = 'foo?serviceId=bar'; }],
    ['uppercase', x => { x.services.worker.name = 'WORKER'; }],
    ['mutable image', x => { x.services.control.image = 'control:latest'; }],
    ['foreign registry', x => { x.services.control.image = x.services.control.image.replace('example-project', 'foreign-project'); }],
    ['foreign repository', x => { x.repository = 'different'; }],
    ['image query', x => { x.services.control.image += '?secret=bad'; }],
    ['same runtime', x => { x.services.worker.serviceAccount = x.services.control.serviceAccount; }],
    ['caller runtime', x => { x.services.worker.serviceAccount = x.runtimeEnv[PHASE2_ENV.taskInvokerServiceAccount]; }],
    ['foreign SA', x => { x.services.worker.serviceAccount = 'worker@example-foreign.iam.gserviceaccount.com'; }],
    ['same service', x => { x.services.worker.name = x.services.control.name; }],
    ['missing other role', x => { delete x.services.worker; }],
    ['source', x => { x.sourceSha = 'main'; }],
    ['operation', x => { x.operationId = 'pending'; }],
    ['provider', x => { x.runtimeEnv[PHASE2_ENV.model] = 'other-model'; }],
    ['cost', x => { x.runtimeEnv[PHASE2_ENV.maxTotalCostMicros] = '5000001'; }],
    ['real customer mode', x => { x.runtimeEnv[PHASE2_ENV.mode] = 'live'; }],
    ['audience suffix', x => { x.runtimeEnv[PHASE2_ENV.controlAudience] += '/'; }],
  ])('rejects %s before any transport', (_name, mutate) => {
    const input = fixture(); mutate(input); expect(() => prepareRunCreate(input, 'control')).toThrow();
  });

  it('requires an explicit role and current valid runtime configuration', () => {
    expect(() => prepareRunCreate(fixture(), 'admin')).toThrow('role_invalid');
    expect(() => prepareRunCreate(undefined, 'control')).toThrow('configuration');
  });

  it('records intent before one POST and returns only acceptance, never readiness', async () => {
    const plan = prepareRunCreate(fixture(), 'worker'); const transport = io();
    transport.request.mockImplementation(async request => {
      expect(transport.events).toHaveLength(1);
      expect(transport.events[0].event).toBe('phase2_run_create_intent');
      expect(transport.events[0].outcome).toBe('submission_unresolved');
      expect(request).toEqual({ method: 'POST', url: plan.url, body: JSON.stringify(plan.body),
        redirect: 'error', retries: 0, timeoutMs: 30000 });
      return { status: 200, body: { name: `${parent}/operations/op-1` } };
    });
    const receipt = await submitRunCreateOnce(plan, transport);
    expect(receipt).toMatchObject({ outcome: 'accepted_not_verified', ready: false, contained: false, customer_effects_authorized: false });
    expect(transport.request).toHaveBeenCalledTimes(1); expect(transport.events).toHaveLength(2);
    expect(transport.events[1]).toEqual(receipt);
    await expect(submitRunCreateOnce(plan, transport)).rejects.toThrow('plan_rejected');
    expect(transport.request).toHaveBeenCalledTimes(1);
  });

  it('refuses forged/serialized plans and missing dependencies', async () => {
    const plan = prepareRunCreate(fixture(), 'control'); const transport = io();
    for (const fake of [{ ...plan }, JSON.parse(JSON.stringify(plan)), {}]) {
      await expect(submitRunCreateOnce(fake, transport)).rejects.toThrow('plan_rejected');
    }
    await expect(submitRunCreateOnce(plan)).rejects.toThrow('dependencies_missing');
    expect(transport.request).not.toHaveBeenCalled();
  });

  it('does not submit if intent persistence fails, including reentry', async () => {
    const plan = prepareRunCreate(fixture(), 'control'); const transport = io();
    transport.record.mockImplementation(async () => {
      await expect(submitRunCreateOnce(plan, transport)).rejects.toThrow('plan_rejected');
      throw new Error('synthetic disk full');
    });
    await expect(submitRunCreateOnce(plan, transport)).rejects.toThrow('disk full');
    expect(transport.request).not.toHaveBeenCalled();
  });

  it('never adopts or updates a same-name collision', async () => {
    const plan = prepareRunCreate(fixture(), 'control');
    const transport = io({ status: 409, body: { message: 'private provider detail' } });
    await expect(submitRunCreateOnce(plan, transport)).rejects.toThrow('phase2_run_create_conflict');
    expect(transport.request).toHaveBeenCalledTimes(1);
    expect(transport.events.at(-1).outcome).toBe('no_adoption_or_mutation_retry');
    expect(JSON.stringify(transport.events)).not.toContain('private provider detail');
  });

  it.each([
    undefined, { status: 403 }, { status: 500 }, { status: 302 },
    { status: 200, body: {} }, { status: 200, body: { name: 'https://elsewhere.invalid/operation' } },
    { status: 200, body: { name: 'projects/foreign/locations/us-central1/operations/op-1' } },
    { status: 200, body: { name: `${parent}/operations/../services/worker` } },
    { status: 200, body: { name: `${parent}/operations/op-1`, error: { message: 'private detail' } } },
  ])('classifies rejected, malformed or foreign responses as uncertain without retry (%j)', async response => {
    const plan = prepareRunCreate(fixture(), 'worker'); const transport = io();
    transport.request.mockResolvedValue(response);
    await expect(submitRunCreateOnce(plan, transport)).rejects.toThrow('phase2_run_create_uncertain');
    expect(transport.events.at(-1).outcome).toBe('reconcile_read_only');
    expect(transport.request).toHaveBeenCalledTimes(1);
    await expect(submitRunCreateOnce(plan, transport)).rejects.toThrow('plan_rejected');
  });

  it('holds an uncertain submitted outcome after lost response or receipt-write failure', async () => {
    for (const failure of ['network', 'record']) {
      const plan = prepareRunCreate(fixture(), 'control'); const transport = io();
      if (failure === 'network') transport.request.mockRejectedValue(new Error('Bearer secret-value'));
      else transport.record.mockImplementation(async e => {
        if (e.event !== 'phase2_run_create_intent') throw new Error('disk full');
        transport.events.push(e);
      });
      await expect(submitRunCreateOnce(plan, transport)).rejects.toThrow(failure === 'network' ? 'uncertain' : 'disk full');
      expect(transport.request).toHaveBeenCalledTimes(1);
      await expect(submitRunCreateOnce(plan, transport)).rejects.toThrow('plan_rejected');
      expect(JSON.stringify(transport.events)).not.toContain('secret-value');
      expect(transport.events[0].outcome).toBe('submission_unresolved');
      if (failure === 'record') expect(transport.events).toHaveLength(1);
    }
  });
});
