import {
  PHASE2_PROVIDER_CALL_RESERVATION_MICROS,
  priceVertexGeminiUsage,
  VERTEX_GEMINI_MODEL,
} from './pricebook.js';

const PROVIDER_FRAMING_TOKEN_ALLOWANCE = 4096;

function failure(code, message, violation = null) {
  return Object.assign(new Error(message), { statusCode: 502, code, violation });
}

function safeInteger(value, field) {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw failure('vertex_usage_invalid', `${field} is invalid`);
  }
  return value;
}

function contractViolation(violation) {
  throw failure(
    'vertex_provider_contract_violation',
    'Vertex usage exceeded the fixed provider billing contract',
    violation,
  );
}

export function createVertexGeminiCallBound({
  maxPromptBytes,
  maxOutputTokens,
  systemInstruction,
  responseJsonSchema,
} = {}) {
  const systemBytes = Buffer.byteLength(systemInstruction, 'utf8');
  const schemaBytes = Buffer.byteLength(JSON.stringify(responseJsonSchema), 'utf8');
  const maxInputTokens = maxPromptBytes + systemBytes + schemaBytes + PROVIDER_FRAMING_TOKEN_ALLOWANCE;
  const maxCost = priceVertexGeminiUsage({
    model: VERTEX_GEMINI_MODEL,
    inputTokens: maxInputTokens,
    outputTokens: maxOutputTokens,
    thinkingTokens: 0,
  }).actual_cost_micros;
  if (maxCost > PHASE2_PROVIDER_CALL_RESERVATION_MICROS) {
    throw new Error('Vertex Gemini provider cost bound exceeds its call reservation');
  }
  return Object.freeze({
    reservation_micros: PHASE2_PROVIDER_CALL_RESERVATION_MICROS,
    max_prompt_bytes: maxPromptBytes,
    system_instruction_bytes: systemBytes,
    response_schema_bytes: schemaBytes,
    provider_framing_token_allowance: PROVIDER_FRAMING_TOKEN_ALLOWANCE,
    conservative_max_input_tokens: maxInputTokens,
    max_output_tokens: maxOutputTokens,
    conservative_max_cost_micros: maxCost,
  });
}

export function readVertexGeminiUsage(response, callBound) {
  const usage = response?.usageMetadata;
  if (!usage || typeof usage !== 'object') {
    throw failure('vertex_usage_invalid', 'Vertex usage metadata is required');
  }
  const inputTokens = safeInteger(usage.promptTokenCount, 'promptTokenCount');
  const outputTokens = safeInteger(usage.candidatesTokenCount, 'candidatesTokenCount');
  const thinkingTokens = safeInteger(usage.thoughtsTokenCount ?? 0, 'thoughtsTokenCount');
  const cachedInputTokens = safeInteger(usage.cachedContentTokenCount ?? 0, 'cachedContentTokenCount');
  const totalTokens = safeInteger(usage.totalTokenCount, 'totalTokenCount');
  if (cachedInputTokens !== 0) contractViolation('cached_input_tokens');
  if (inputTokens > callBound.conservative_max_input_tokens) contractViolation('input_tokens');
  if (outputTokens + thinkingTokens > callBound.max_output_tokens) contractViolation('output_tokens');
  if (totalTokens !== inputTokens + outputTokens + thinkingTokens) contractViolation('total_tokens');
  const priced = priceVertexGeminiUsage({
    model: VERTEX_GEMINI_MODEL,
    inputTokens,
    outputTokens,
    thinkingTokens,
  });
  if (priced.actual_cost_micros > callBound.reservation_micros) contractViolation('actual_cost_micros');
  return {
    ...priced,
    cached_input_tokens: cachedInputTokens,
    total_tokens: totalTokens,
  };
}
