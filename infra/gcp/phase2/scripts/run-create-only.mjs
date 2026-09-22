// Operator-only primitive. No CLI, credentials, transport or cloud work on import.
// apply-inert.sh remains hard-disabled; this is not a complete provisioner.
import { createHash } from 'node:crypto';
import { loadPhase2Config, PHASE2_ENV } from '../../../../server/kernel/durable-execution/phase2/config.js';

const plans = new WeakMap();
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
const fail = (code) => Object.assign(new Error(code), { code });
const requireMatch = (value, expression) => {
  if (typeof value !== 'string' || !expression.test(value)) throw fail('phase2_run_create_input_invalid');
  return value;
};
const freeze = (value) => {
  if (value && typeof value === 'object') {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
};

/**
 * Prepare one exact, create-only Cloud Run v2 request. All inputs are explicit.
 * Reuse runtime validation and the exact allowlist; never copy ambient secrets.
 * Both roles are validated together to reject shared runtime/caller identities.
 */
export function prepareRunCreate({ runtimeEnv, projectNumber, services, repository, sourceSha, operationId } = {}, role) {
  if (!['control', 'worker'].includes(role)) throw fail('phase2_run_create_role_invalid');
  const config = loadPhase2Config(runtimeEnv ?? {});
  requireMatch(projectNumber, /^[1-9][0-9]{5,19}$/);
  requireMatch(repository, /^[a-z][a-z0-9._-]{2,254}$/);
  requireMatch(sourceSha, /^[0-9a-f]{40}$/);
  requireMatch(operationId, /^[0-9a-f]{32}$/);
  const { project_id: project, region } = config.gcp;
  const parent = `projects/${project}/locations/${region}`;
  const identities = [config.gcp.intake_service_account, config.gcp.scheduler_service_account, config.gcp.task_invoker_service_account];
  const names = [];
  for (const kind of ['control', 'worker']) {
    const service = services?.[kind];
    // The v2 create method requires fewer than 50 characters, including one-char names.
    const name = requireMatch(service?.name, /^[a-z](?:[a-z0-9-]{0,47}[a-z0-9])?$/);
    if (`${name}-${projectNumber}`.length > 63) throw fail('phase2_run_create_input_invalid');
    const account = requireMatch(service?.serviceAccount, /^[a-z][a-z0-9-]{4,28}[a-z0-9]@[a-z][a-z0-9-]{4,28}[a-z0-9]\.iam\.gserviceaccount\.com$/);
    if (!account.endsWith(`@${project}.iam.gserviceaccount.com`)) throw fail('phase2_run_create_input_invalid');
    const prefix = `${region}-docker.pkg.dev/${project}/${repository}/`;
    if (typeof service?.image !== 'string' || !service.image.startsWith(prefix)
      || !/^[a-z][a-z0-9._-]*@sha256:[0-9a-f]{64}$/.test(service.image.slice(prefix.length))) throw fail('phase2_run_create_input_invalid');
    if (config.gcp[`${kind}_audience`] !== `https://${name}-${projectNumber}.${region}.run.app`) throw fail('phase2_run_create_input_invalid');
    names.push(name); identities.push(account);
  }
  if (new Set(names).size !== 2 || new Set(identities).size !== 5) throw fail('phase2_run_create_identity_collision');
  const service = services[role];
  const environment = Object.values(PHASE2_ENV).map((name) => {
    const value = name === PHASE2_ENV.maxJobs ? String(config.max_jobs) : runtimeEnv[name];
    if (typeof value !== 'string') throw fail('phase2_run_create_input_invalid');
    return { name, value };
  });
  const body = freeze({
    labels: { 'famtastic-create': operationId, 'famtastic-source': sourceSha, 'famtastic-role': role },
    client: 'famtastic-phase2-create-only', ingress: 'INGRESS_TRAFFIC_INTERNAL_ONLY',
    invokerIamDisabled: false, defaultUriDisabled: true,
    // Empty traffic means 100% latest, NOT zero. Containment is independent of routing.
    traffic: [{ type: 'TRAFFIC_TARGET_ALLOCATION_TYPE_LATEST', percent: 100 }],
    scaling: { minInstanceCount: 0, maxInstanceCount: 1 },
    template: {
      serviceAccount: service.serviceAccount, timeout: role === 'control' ? '60s' : '300s',
      scaling: { minInstanceCount: 0, maxInstanceCount: 1 }, maxInstanceRequestConcurrency: 1,
      containers: [{ name: role, image: service.image, ports: [{ containerPort: 8080 }], env: environment,
        resources: { limits: { cpu: '1', memory: '512Mi' }, cpuIdle: true, startupCpuBoost: false } }],
    },
  });
  const wire = JSON.stringify(body);
  const descriptor = freeze({
    schema: 'famtastic.phase2.run-create.v1', role, source_sha: sourceSha,
    operation_id: operationId, resource: `${parent}/services/${service.name}`,
    method: 'POST', url: `https://run.googleapis.com/v2/${parent}/services?serviceId=${service.name}`,
    body_sha256: sha(wire), body,
  });
  plans.set(descriptor, { parent, wire, submitted: false });
  return descriptor;
}

/**
 * Exactly one invocation of a caller-supplied transport after durable intent.
 * The transport must enforce redirect:error, retries:0 and timeoutMs itself.
 * No default transport/auth, recovery adoption, IAM grant, update or delete exists.
 * A successful response is only an accepted operation, never ready/contained/live.
 */
export async function submitRunCreateOnce(plan, { request, record } = {}) {
  const bound = plans.get(plan);
  if (!bound || bound.submitted) throw fail('phase2_run_create_plan_rejected');
  if (typeof request !== 'function' || typeof record !== 'function') throw fail('phase2_run_create_dependencies_missing');
  // Consume even when recording fails: a fresh operator-reviewed plan is required.
  // Across processes, POST create itself still rejects a same-name collision.
  bound.submitted = true;
  const identity = { resource: plan.resource, operation_id: plan.operation_id, source_sha: plan.source_sha, body_sha256: plan.body_sha256 };
  // This may be the only surviving event after a crash following POST. Never
  // infer "not submitted" from a missing outcome or retry the mutation blindly.
  await record(freeze({ ...identity, event: 'phase2_run_create_intent', outcome: 'submission_unresolved' }));
  let response;
  try {
    response = await request(freeze({ method: plan.method, url: plan.url, body: bound.wire,
      redirect: 'error', retries: 0, timeoutMs: 30_000 }));
  } catch {
    // Never echo a provider error which could contain authorization or raw input.
    await record(freeze({ ...identity, event: 'phase2_run_create_uncertain', outcome: 'reconcile_read_only' }));
    throw fail('phase2_run_create_uncertain');
  }
  if (response?.status === 409) {
    await record(freeze({ ...identity, event: 'phase2_run_create_conflict', outcome: 'no_adoption_or_mutation_retry' }));
    throw fail('phase2_run_create_conflict');
  }
  const operation = response?.body?.name;
  const operationPrefix = `${bound.parent}/operations/`;
  if (response?.status !== 200 || typeof operation !== 'string' || !operation.startsWith(operationPrefix)
    || !/^[a-zA-Z0-9_-]{1,128}$/.test(operation.slice(operationPrefix.length)) || response.body.error) {
    await record(freeze({ ...identity, event: 'phase2_run_create_uncertain', outcome: 'reconcile_read_only' }));
    throw fail('phase2_run_create_uncertain');
  }
  const receipt = freeze({ ...identity, event: 'phase2_run_create_accepted', operation,
    outcome: 'accepted_not_verified', ready: false, contained: false, customer_effects_authorized: false });
  // If this fails, cloud acceptance is uncertain to the caller. Never resubmit.
  await record(receipt);
  return receipt;
}
