import { canonicalDigest, canonicalJson } from './canonical.js';
import { boundedInteger, requiredString, storeFailure } from './firestore-values.js';
import { callMetrics } from './firestore-worker-support.js';
import { VERTEX_GEMINI_OBSERVATION_SCHEMA } from './vertex-gemini-provider.js';

const MAX_CHECKPOINT_BYTES = 256 * 1024;
const OUTPUT_FIELDS = [
  'schema', 'job_id', 'task_id', 'packet_id', 'project_id',
  'review_status', 'summary', 'observations',
];

function plainObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function exactKeys(value, fields) {
  const actual = Object.keys(value).sort();
  const expected = [...fields].sort();
  return actual.length === expected.length
    && actual.every((key, index) => key === expected[index]);
}

function boundedText(value, label, max) {
  if (typeof value !== 'string' || value !== value.trim() || !value || value.length > max) {
    throw storeFailure(400, 'provider_checkpoint_output_invalid', `${label} is invalid`);
  }
}

function validateOutput(job, output) {
  if (!plainObject(output) || !exactKeys(output, OUTPUT_FIELDS)
    || output.schema !== VERTEX_GEMINI_OBSERVATION_SCHEMA
    || output.job_id !== job.job_id || output.task_id !== job.task_id
    || output.packet_id !== job.packet_id || output.project_id !== job.project_id
    || !['ready_for_review', 'needs_human_review'].includes(output.review_status)) {
    throw storeFailure(400, 'provider_checkpoint_output_invalid', 'Provider output identity or schema is invalid');
  }
  boundedText(output.summary, 'Provider output summary', 4000);
  if (!Array.isArray(output.observations) || output.observations.length > 50) {
    throw storeFailure(400, 'provider_checkpoint_output_invalid', 'Provider output observations are invalid');
  }
  for (const observation of output.observations) {
    if (!plainObject(observation)
      || !exactKeys(observation, ['code', 'severity', 'statement', 'evidence_refs'])
      || !/^[A-Za-z0-9._:-]{1,100}$/.test(observation.code || '')
      || !['info', 'warning', 'error'].includes(observation.severity)) {
      throw storeFailure(400, 'provider_checkpoint_output_invalid', 'Provider observation schema is invalid');
    }
    boundedText(observation.statement, 'Provider observation statement', 2000);
    if (!Array.isArray(observation.evidence_refs) || observation.evidence_refs.length > 20
      || observation.evidence_refs.some((ref) => typeof ref !== 'string'
        || ref !== ref.trim() || !ref || ref.length > 500)) {
      throw storeFailure(400, 'provider_checkpoint_output_invalid', 'Provider observation evidence is invalid');
    }
  }
  return output;
}

function canonicalOutput(job, output) {
  let json;
  let parsed;
  try {
    json = canonicalJson(output);
    parsed = JSON.parse(json);
  } catch {
    throw storeFailure(400, 'provider_checkpoint_output_invalid', 'Provider output must be canonical JSON data');
  }
  validateOutput(job, parsed);
  const bytes = Buffer.byteLength(json, 'utf8');
  if (bytes > MAX_CHECKPOINT_BYTES) {
    throw storeFailure(413, 'provider_checkpoint_output_too_large', 'Provider checkpoint exceeds 256 KiB');
  }
  return { json, parsed, bytes, sha256: canonicalDigest(parsed) };
}

function publicMetrics(metrics) {
  return {
    providerRequestId: metrics.provider_request_id,
    inputTokens: metrics.input_tokens,
    outputTokens: metrics.output_tokens,
    thinkingTokens: metrics.thinking_tokens,
    cachedInputTokens: metrics.cached_input_tokens,
    totalTokens: metrics.total_tokens,
    latencyMs: metrics.latency_ms,
    promptVersion: metrics.prompt_version,
    inputSha256: metrics.input_sha256,
    actualCostMicros: metrics.actual_cost_micros,
  };
}

function metricsFromCall(call) {
  return callMetrics({
    providerRequestId: call.provider_request_id,
    inputTokens: call.input_tokens,
    outputTokens: call.output_tokens,
    thinkingTokens: call.thinking_tokens,
    cachedInputTokens: call.cached_input_tokens,
    totalTokens: call.total_tokens,
    latencyMs: call.latency_ms,
    promptVersion: call.prompt_version,
    inputSha256: call.input_sha256,
    actualCostMicros: call.actual_cost_micros,
  }, { requireKnown: true });
}

export function prepareProviderCheckpoint(job, output, metricsInput, reservedCostMicros) {
  const canonical = canonicalOutput(job, output);
  const metrics = callMetrics(metricsInput, { requireKnown: true });
  boundedInteger(reservedCostMicros, 'reservedCostMicros', { min: 1 });
  if (metrics.actual_cost_micros > reservedCostMicros) {
    throw storeFailure(409, 'cost_reservation_exceeded', 'Provider cost exceeded its reservation');
  }
  return { ...canonical, metrics };
}

export function providerCheckpointFromCall(job, call) {
  if (call.state !== 'provider_succeeded') {
    throw storeFailure(409, 'provider_checkpoint_missing', 'The model call has no durable provider-success checkpoint');
  }
  let storedOutput;
  try {
    storedOutput = JSON.parse(call.checkpoint_output_json);
  } catch {
    throw storeFailure(503, 'provider_checkpoint_corrupt', 'Stored provider checkpoint output is invalid');
  }
  const canonical = canonicalOutput(job, storedOutput);
  boundedInteger(call.checkpoint_output_bytes, 'checkpoint_output_bytes', { min: 1, max: MAX_CHECKPOINT_BYTES });
  requiredString(call.checkpoint_output_sha256, 'checkpoint_output_sha256', {
    max: 64, pattern: /^[a-f0-9]{64}$/,
  });
  if (canonical.bytes !== call.checkpoint_output_bytes
    || canonical.sha256 !== call.checkpoint_output_sha256) {
    throw storeFailure(503, 'provider_checkpoint_corrupt', 'Stored provider checkpoint identity is invalid');
  }
  const metrics = metricsFromCall(call);
  if (metrics.actual_cost_micros > call.reserved_cost_micros) {
    throw storeFailure(503, 'provider_checkpoint_corrupt', 'Stored provider checkpoint exceeds its cost reservation');
  }
  return {
    model_call_id: call.model_call_id,
    output: canonical.parsed,
    metrics: publicMetrics(metrics),
  };
}

export function sameProviderCheckpoint(call, prepared) {
  if (call.checkpoint_output_json !== prepared.json) return false;
  return Object.entries(prepared.metrics).every(([key, value]) => call[key] === value);
}

export { MAX_CHECKPOINT_BYTES as PROVIDER_CHECKPOINT_MAX_BYTES };
