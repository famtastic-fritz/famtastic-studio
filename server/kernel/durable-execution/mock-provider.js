function denied(code, message) {
  return Object.assign(new Error(message), { statusCode: 503, code });
}

const MOCK_PROVIDER_BRAND = Symbol('famtastic.phase1.mock-provider');

function outcomeKey(projectId, attemptNumber) {
  return `${projectId}:${attemptNumber}`;
}

function validatedOutcomePlan(plan) {
  if (!plan || typeof plan !== 'object' || Array.isArray(plan)) {
    throw denied('mock_plan_invalid', 'Mock outcome plan must be a plain data object');
  }
  const copy = {};
  for (const [key, value] of Object.entries(plan)) {
    const suppliedClass = value?.failureClass;
    const validClass = suppliedClass === undefined
      || (typeof suppliedClass === 'string'
        && suppliedClass === suppliedClass.trim()
        && /^[A-Za-z0-9._:-]{1,100}$/.test(suppliedClass));
    if (!/^(?:\*|[A-Za-z0-9._:-]{1,128}):(?:\*|[1-9][0-9]?)$/.test(key)
      || !value || typeof value !== 'object' || Array.isArray(value)
      || !['success', 'transient_failure', 'permanent_failure'].includes(value.type)
      || !validClass) {
      throw denied('mock_plan_invalid', `Invalid deterministic mock outcome: ${key}`);
    }
    copy[key] = Object.freeze({
      type: value.type,
      failureClass: suppliedClass,
      reason: typeof value.reason === 'string' ? value.reason : undefined,
    });
  }
  return Object.freeze(copy);
}

export function assertMockProvider(provider) {
  if (!provider || provider[MOCK_PROVIDER_BRAND] !== true || provider.kind !== 'mock' || typeof provider.execute !== 'function') {
    throw denied('real_provider_denied', 'Phase 1 durable execution accepts only an injected deterministic mock provider');
  }
  return provider;
}

export function createMockProvider({ outcomes = {} } = {}) {
  const plan = validatedOutcomePlan(outcomes);
  let mockCalls = 0;
  const provider = {
    kind: 'mock',
    model: 'deterministic-mock-v1',
    execute(lease) {
      mockCalls += 1;
      const outcome = plan[outcomeKey(lease.project_id, lease.attempt_number)]
        || plan[outcomeKey(lease.project_id, '*')]
        || plan[outcomeKey('*', lease.attempt_number)]
        || plan[outcomeKey('*', '*')]
        || { type: 'success' };
      const type = outcome.type || 'success';
      if (!['success', 'transient_failure', 'permanent_failure'].includes(type)) {
        throw denied('mock_outcome_invalid', `Unsupported deterministic mock outcome: ${type}`);
      }
      const failureClass = type === 'success'
        ? null
        : (outcome.failureClass || (type === 'transient_failure' ? 'mock_transient' : 'mock_permanent'));
      const call = {
        provider: 'mock',
        model: 'deterministic-mock-v1',
        provider_request_id: `mock:${lease.attempt_id}`,
        input_tokens: 16,
        output_tokens: type === 'success' ? 32 : 0,
        latency_ms: 5,
        reserved_cost_micros: 0,
        actual_cost_micros: 0,
        outcome: type,
        failure_class: failureClass,
      };
      if (type !== 'success') {
        return {
          ok: false,
          retryable: type === 'transient_failure',
          failureClass,
          reason: outcome.reason || `Deterministic ${type.replace('_', ' ')}`,
          call,
        };
      }
      return {
        ok: true,
        call,
        output: {
          schema: 'famtastic.execution.mock-result.v1',
          job_id: lease.job_id,
          task_id: lease.task_id,
          packet_id: lease.packet_id,
          project_id: lease.project_id,
          result: 'ready_for_phase1_pilot_gate',
        },
      };
    },
    telemetry: () => Object.freeze({ mock_calls: mockCalls, external_calls: 0 }),
  };
  Object.defineProperty(provider, MOCK_PROVIDER_BRAND, { value: true });
  return Object.freeze(provider);
}

function blockEffect(kind) {
  throw Object.assign(new Error(`${kind} is denied in Phase 1 durable execution`), {
    statusCode: 403,
    code: 'external_effect_denied',
  });
}

export function createEffectsFirewall() {
  const attempted = { callback: 0, outbound: 0, publish: 0, deploy: 0 };
  const completed = { callback: 0, outbound: 0, publish: 0, deploy: 0 };
  const deny = (action, label) => {
    attempted[action] += 1;
    return blockEffect(label);
  };
  return Object.freeze({
    callback: () => deny('callback', 'callback'),
    outbound: () => deny('outbound', 'outbound message'),
    publish: () => deny('publish', 'publish'),
    deploy: () => deny('deploy', 'deploy'),
    snapshot: () => Object.freeze({ attempted: { ...attempted }, completed: { ...completed } }),
  });
}
