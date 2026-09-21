export const VERTEX_GEMINI_MODEL = 'gemini-3.1-flash-lite';
export const VERTEX_GEMINI_PRICEBOOK_VERSION = 'vertex-gemini-2026-09-21';
export const PHASE2_PROVIDER_CALL_RESERVATION_MICROS = 80_000;

const TOKENS_PER_PRICING_UNIT = 1_000_000n;
const MAX_SAFE_INTEGER_BIGINT = BigInt(Number.MAX_SAFE_INTEGER);

export const VERTEX_GEMINI_PRICEBOOK = Object.freeze({
  version: VERTEX_GEMINI_PRICEBOOK_VERSION,
  effective_date: '2026-09-21',
  currency: 'USD',
  billing_unit: 'micros_per_1m_tokens',
  model: VERTEX_GEMINI_MODEL,
  standard_text_input_micros_per_million: 250_000,
  output_including_thinking_micros_per_million: 1_500_000,
});

function invalid(message) {
  return Object.assign(new Error(message), {
    statusCode: 500,
    code: 'vertex_pricebook_invalid',
  });
}

function tokenCount(value, field) {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw invalid(`${field} must be a nonnegative safe integer`);
  }
  return BigInt(value);
}

function ceilMicros(tokens, rate) {
  if (tokens === 0n) return 0n;
  return ((tokens * BigInt(rate)) + TOKENS_PER_PRICING_UNIT - 1n) / TOKENS_PER_PRICING_UNIT;
}

function safeNumber(value, field) {
  if (value > MAX_SAFE_INTEGER_BIGINT) throw invalid(`${field} exceeds the safe integer range`);
  return Number(value);
}

export function priceVertexGeminiUsage({
  model,
  inputTokens,
  outputTokens,
  thinkingTokens = 0,
} = {}) {
  if (model !== VERTEX_GEMINI_MODEL) {
    throw Object.assign(new Error(`Unsupported Vertex Gemini model: ${String(model || '')}`), {
      statusCode: 503,
      code: 'vertex_model_denied',
    });
  }
  const input = tokenCount(inputTokens, 'inputTokens');
  const output = tokenCount(outputTokens, 'outputTokens');
  const thinking = tokenCount(thinkingTokens, 'thinkingTokens');
  const billedOutput = output + thinking;
  const inputCost = ceilMicros(input, VERTEX_GEMINI_PRICEBOOK.standard_text_input_micros_per_million);
  const outputCost = ceilMicros(billedOutput, VERTEX_GEMINI_PRICEBOOK.output_including_thinking_micros_per_million);
  const total = inputCost + outputCost;

  return Object.freeze({
    pricing_version: VERTEX_GEMINI_PRICEBOOK_VERSION,
    currency: 'USD',
    input_tokens: Number(input),
    output_tokens: Number(output),
    thinking_tokens: Number(thinking),
    billed_output_tokens: safeNumber(billedOutput, 'billed output tokens'),
    input_cost_micros: safeNumber(inputCost, 'input cost'),
    output_cost_micros: safeNumber(outputCost, 'output cost'),
    actual_cost_micros: safeNumber(total, 'actual cost'),
  });
}
