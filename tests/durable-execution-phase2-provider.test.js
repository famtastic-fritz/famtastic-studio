import { describe, expect, it, vi } from 'vitest';
import {
  PHASE2_PROVIDER_CALL_RESERVATION_MICROS,
  priceVertexGeminiUsage,
  VERTEX_GEMINI_MODEL,
  VERTEX_GEMINI_PRICEBOOK,
  VERTEX_GEMINI_PRICEBOOK_VERSION,
} from '../server/kernel/durable-execution/phase2/pricebook.js';
import {
  assertVertexGeminiProvider,
  createVertexGeminiProvider,
  VERTEX_GEMINI_API_IDENTITY,
  VERTEX_GEMINI_CALL_BOUND,
  VERTEX_GEMINI_OBSERVATION_SCHEMA,
  VERTEX_GEMINI_PROMPT_VERSION,
  VERTEX_GEMINI_THINKING_LEVEL,
} from '../server/kernel/durable-execution/phase2/vertex-gemini-provider.js';
import { readVertexGeminiUsage } from '../server/kernel/durable-execution/phase2/vertex-gemini-provider-support.js';

function lease(overrides = {}) {
  return {
    job_id: 'job_1',
    task_id: 'task_1',
    attempt_id: 'attempt_1',
    attempt_number: 1,
    packet_id: 'packet_1',
    project_id: 'project_1',
    packet_ref: {
      schema: 'famtastic.site-studio.build-packet.v1',
      selected_direction_ids: ['direction_1'],
      boundary: { deploy_authorized: false },
    },
    ...overrides,
  };
}

function output(overrides = {}) {
  return {
    schema: VERTEX_GEMINI_OBSERVATION_SCHEMA,
    job_id: 'job_1',
    task_id: 'task_1',
    packet_id: 'packet_1',
    project_id: 'project_1',
    review_status: 'ready_for_review',
    summary: 'The packet is ready for human review.',
    observations: [{
      code: 'packet.boundary',
      severity: 'info',
      statement: 'Production deployment remains disabled.',
      evidence_refs: ['packet:packet_1'],
    }],
    ...overrides,
  };
}

function response(overrides = {}) {
  return {
    responseId: 'vertex-response-1',
    usageMetadata: {
      promptTokenCount: 1000,
      candidatesTokenCount: 200,
      thoughtsTokenCount: 0,
      cachedContentTokenCount: 0,
      totalTokenCount: 1200,
    },
    candidates: [{
      finishReason: 'STOP',
      content: { parts: [{ text: JSON.stringify(output()), thoughtSignature: 'opaque-signature' }] },
    }],
    ...overrides,
  };
}

function clientWith(implementation) {
  return { models: { generateContent: vi.fn(implementation) } };
}

function providerFor(client, extra = {}) {
  return createVertexGeminiProvider({
    client,
    projectId: 'famtastic-test-123',
    location: 'us-central1',
    ...extra,
  });
}

describe('Phase 2 Vertex Gemini pricebook', () => {
  it('pins the approved model, date, currency, and standard text rates', () => {
    expect(VERTEX_GEMINI_PRICEBOOK).toEqual({
      version: 'vertex-gemini-2026-09-21',
      effective_date: '2026-09-21',
      currency: 'USD',
      billing_unit: 'micros_per_1m_tokens',
      model: 'gemini-3.1-flash-lite',
      standard_text_input_micros_per_million: 250_000,
      output_including_thinking_micros_per_million: 1_500_000,
    });
  });

  it('uses conservative integer-micro ceilings for input and output including thinking', () => {
    expect(priceVertexGeminiUsage({
      model: VERTEX_GEMINI_MODEL,
      inputTokens: 1,
      outputTokens: 1,
      thinkingTokens: 1,
    })).toMatchObject({
      pricing_version: VERTEX_GEMINI_PRICEBOOK_VERSION,
      input_cost_micros: 1,
      output_cost_micros: 3,
      actual_cost_micros: 4,
      billed_output_tokens: 2,
    });
    expect(priceVertexGeminiUsage({
      model: VERTEX_GEMINI_MODEL,
      inputTokens: 1_000_000,
      outputTokens: 1_000_000,
    }).actual_cost_micros).toBe(1_750_000);
  });

  it('rejects every unapproved model and invalid token count', () => {
    expect(() => priceVertexGeminiUsage({ model: 'gemini-other', inputTokens: 1, outputTokens: 1 }))
      .toThrowError(expect.objectContaining({ code: 'vertex_model_denied' }));
    expect(() => priceVertexGeminiUsage({ model: VERTEX_GEMINI_MODEL, inputTokens: -1, outputTokens: 1 }))
      .toThrowError(expect.objectContaining({ code: 'vertex_pricebook_invalid' }));
    expect(() => priceVertexGeminiUsage({ model: VERTEX_GEMINI_MODEL, inputTokens: 1.2, outputTokens: 1 }))
      .toThrowError(expect.objectContaining({ code: 'vertex_pricebook_invalid' }));
  });
});

describe('Phase 2 Vertex Gemini provider', () => {
  it('requires an injected ADC client and refuses API key, base URL, and model configuration', () => {
    expect(() => createVertexGeminiProvider({ projectId: 'famtastic-test-123', location: 'us-central1' }))
      .toThrowError(expect.objectContaining({ code: 'vertex_client_required' }));
    for (const rejected of [
      { apiKey: 'secret' },
      { baseUrl: 'https://attacker.example' },
      { model: VERTEX_GEMINI_MODEL },
    ]) {
      expect(() => createVertexGeminiProvider({
        client: clientWith(async () => response()),
        projectId: 'famtastic-test-123',
        location: 'us-central1',
        ...rejected,
      })).toThrowError(expect.objectContaining({ code: 'vertex_provider_config_invalid' }));
    }
  });

  it('brands only factory providers and rejects a structural spoof', () => {
    const provider = providerFor(clientWith(async () => response()));
    expect(assertVertexGeminiProvider(provider)).toBe(provider);
    expect(() => assertVertexGeminiProvider({
      kind: 'vertex-gemini',
      model: VERTEX_GEMINI_MODEL,
      execute: vi.fn(),
    })).toThrowError(expect.objectContaining({ code: 'vertex_provider_denied' }));
  });

  it('sends a fixed observation-only request and returns measured usage, cost, and identity', async () => {
    let now = 1000;
    const client = clientWith(async () => {
      now = 1025;
      return response();
    });
    const provider = providerFor(client, { clock: () => now });
    const result = await provider.execute(lease());

    expect(provider).toMatchObject({
      api_identity: { sdk: '@google/genai', vertexai: true, api_version: 'v1' },
      thinking_level: 'MINIMAL',
    });
    expect(provider.api_identity).toBe(VERTEX_GEMINI_API_IDENTITY);
    expect(VERTEX_GEMINI_THINKING_LEVEL).toBe('MINIMAL');

    expect(result).toMatchObject({
      ok: true,
      output: output(),
      call: {
        provider: 'vertex-gemini',
        model: VERTEX_GEMINI_MODEL,
        provider_request_id: 'vertex-response-1',
        prompt_version: VERTEX_GEMINI_PROMPT_VERSION,
        pricing_version: VERTEX_GEMINI_PRICEBOOK_VERSION,
        input_tokens: 1000,
        output_tokens: 200,
        thinking_tokens: 0,
        billed_output_tokens: 200,
        latency_ms: 25,
        actual_cost_micros: 550,
        outcome: 'success',
      },
    });
    expect(result.call.input_sha256).toMatch(/^[a-f0-9]{64}$/);

    const request = client.models.generateContent.mock.calls[0][0];
    expect(request.model).toBe(VERTEX_GEMINI_MODEL);
    expect(request.config).toMatchObject({
      temperature: 0,
      candidateCount: 1,
      maxOutputTokens: 4096,
      thinkingConfig: { thinkingLevel: 'MINIMAL', includeThoughts: false },
      responseMimeType: 'application/json',
    });
    expect(Object.keys(request.config).sort()).toEqual([
      'candidateCount', 'maxOutputTokens', 'responseJsonSchema', 'responseMimeType',
      'systemInstruction', 'temperature', 'thinkingConfig',
    ]);
    expect(request.config).not.toHaveProperty('tools');
    expect(JSON.stringify(request)).not.toMatch(/apiKey|authorization|baseUrl/i);
    expect(request.config.systemInstruction).toMatch(/observation-only/i);
    const prompt = JSON.parse(request.contents[0].parts[0].text);
    expect(prompt).toMatchObject({
      schema: 'famtastic.execution.vertex-request.v1',
      task: { job_id: 'job_1', attempt_id: 'attempt_1', packet_id: 'packet_1' },
      packet: { boundary: { deploy_authorized: false } },
    });
  });

  it('bounds prompt, system instruction, schema, framing, and output within 80,000 micros', () => {
    expect(VERTEX_GEMINI_CALL_BOUND).toMatchObject({
      reservation_micros: PHASE2_PROVIDER_CALL_RESERVATION_MICROS,
      max_prompt_bytes: 256 * 1024,
      provider_framing_token_allowance: 4096,
      max_output_tokens: 4096,
    });
    expect(VERTEX_GEMINI_CALL_BOUND.system_instruction_bytes).toBeGreaterThan(0);
    expect(VERTEX_GEMINI_CALL_BOUND.response_schema_bytes).toBeGreaterThan(0);
    expect(VERTEX_GEMINI_CALL_BOUND.conservative_max_cost_micros).toBe(73_060);
    expect(VERTEX_GEMINI_CALL_BOUND.reservation_micros * 3).toBe(240_000);
    expect(VERTEX_GEMINI_CALL_BOUND.reservation_micros * 3).toBeLessThanOrEqual(250_000);
    expect(priceVertexGeminiUsage({
      model: VERTEX_GEMINI_MODEL,
      inputTokens: VERTEX_GEMINI_CALL_BOUND.conservative_max_input_tokens,
      outputTokens: VERTEX_GEMINI_CALL_BOUND.max_output_tokens,
      thinkingTokens: 0,
    }).actual_cost_micros).toBe(VERTEX_GEMINI_CALL_BOUND.conservative_max_cost_micros);
  });

  it('accepts, prices, and records bounded thinking tokens at the output rate', async () => {
    const withThinking = response({ usageMetadata: {
      promptTokenCount: 1000,
      candidatesTokenCount: 200,
      thoughtsTokenCount: 25,
      cachedContentTokenCount: 0,
      totalTokenCount: 1225,
    } });
    const result = await providerFor(clientWith(async () => withThinking)).execute(lease());
    expect(result).toMatchObject({
      ok: true,
      call: { output_tokens: 200, thinking_tokens: 25, billed_output_tokens: 225, actual_cost_micros: 588 },
    });
  });

  it.each([
    ['prompt token bound', {
      promptTokenCount: VERTEX_GEMINI_CALL_BOUND.conservative_max_input_tokens + 1,
      candidatesTokenCount: 0,
      thoughtsTokenCount: 0,
      cachedContentTokenCount: 0,
      totalTokenCount: VERTEX_GEMINI_CALL_BOUND.conservative_max_input_tokens + 1,
    }],
    ['output token bound', {
      promptTokenCount: 1,
      candidatesTokenCount: VERTEX_GEMINI_CALL_BOUND.max_output_tokens + 1,
      thoughtsTokenCount: 0,
      cachedContentTokenCount: 0,
      totalTokenCount: VERTEX_GEMINI_CALL_BOUND.max_output_tokens + 2,
    }],
    ['combined candidate and thinking token bound', {
      promptTokenCount: 1,
      candidatesTokenCount: VERTEX_GEMINI_CALL_BOUND.max_output_tokens,
      thoughtsTokenCount: 1,
      cachedContentTokenCount: 0,
      totalTokenCount: VERTEX_GEMINI_CALL_BOUND.max_output_tokens + 2,
    }],
    ['unexpected cached input', {
      promptTokenCount: 1000,
      candidatesTokenCount: 200,
      thoughtsTokenCount: 0,
      cachedContentTokenCount: 1,
      totalTokenCount: 1200,
    }],
  ])('returns uncertain when usage violates the %s', async (_label, usageMetadata) => {
    const result = await providerFor(clientWith(async () => response({ usageMetadata }))).execute(lease());
    expect(result).toMatchObject({
      ok: false,
      retryable: false,
      uncertain: true,
      failureClass: 'vertex_provider_contract_violation',
      call: { outcome: 'uncertain', actual_cost_micros: null },
    });
  });

  it('returns uncertain when total tokens include an unpriced token category', async () => {
    const result = await providerFor(clientWith(async () => response({ usageMetadata: {
      promptTokenCount: 1000,
      candidatesTokenCount: 200,
      thoughtsTokenCount: 0,
      cachedContentTokenCount: 0,
      totalTokenCount: 1201,
    } }))).execute(lease());
    expect(result).toMatchObject({
      ok: false,
      retryable: false,
      uncertain: true,
      failureClass: 'vertex_provider_contract_violation',
      call: { outcome: 'uncertain', actual_cost_micros: null },
    });
  });

  it('rejects priced usage above the supplied reservation before it can enter the ledger', () => {
    expect(() => readVertexGeminiUsage(response(), {
      ...VERTEX_GEMINI_CALL_BOUND,
      reservation_micros: 1,
    })).toThrowError(expect.objectContaining({
      code: 'vertex_provider_contract_violation',
      violation: 'actual_cost_micros',
    }));
  });

  it.each(['provider', 'model', 'baseUrl', 'apiKey', 'apiVersion', 'tools', 'thinkingConfig', 'thinkingLevel'])('rejects a job-supplied %s override before calling Vertex', async (key) => {
    const client = clientWith(async () => response());
    const provider = providerFor(client);
    await expect(provider.execute(lease({ [key]: 'malicious' })))
      .rejects.toMatchObject({ code: 'vertex_override_denied' });
    expect(client.models.generateContent).not.toHaveBeenCalled();
  });

  it('bounds input and rejects a pre-aborted request before calling Vertex', async () => {
    const client = clientWith(async () => response());
    const provider = providerFor(client);
    await expect(provider.execute(lease({ packet_ref: { content: 'x'.repeat(300_000) } })))
      .rejects.toMatchObject({ code: 'vertex_input_too_large' });
    const controller = new AbortController();
    controller.abort();
    await expect(provider.execute(lease(), { signal: controller.signal }))
      .rejects.toMatchObject({ code: 'vertex_request_aborted' });
    expect(client.models.generateContent).not.toHaveBeenCalled();
  });

  it('treats output schema and identity failures as permanent while retaining known spend', async () => {
    for (const invalidOutput of [
      output({ project_id: 'project_wrong' }),
      { ...output(), unexpected: true },
    ]) {
      const client = clientWith(async () => response({
        candidates: [{ finishReason: 'STOP', content: { parts: [{ text: JSON.stringify(invalidOutput) }] } }],
      }));
      const result = await providerFor(client).execute(lease());
      expect(result).toMatchObject({
        ok: false,
        retryable: false,
        uncertain: false,
        call: { outcome: 'permanent_failure', actual_cost_micros: 550 },
      });
      expect(result.reason).not.toContain(JSON.stringify(invalidOutput));
    }
  });

  it.each([
    ['thought summary', { text: 'private thought', thought: true }],
    ['function call', { text: '{}', functionCall: { name: 'publish' } }],
    ['server tool call', { text: '{}', toolCall: { name: 'search' } }],
    ['executable code', { text: '{}', executableCode: { code: 'run()' } }],
  ])('rejects %s content even when a text field is present', async (_label, part) => {
    const invalid = response({
      candidates: [{ finishReason: 'STOP', content: { parts: [part] } }],
    });
    const result = await providerFor(clientWith(async () => invalid)).execute(lease());
    expect(result).toMatchObject({
      ok: false,
      failureClass: 'vertex_response_invalid',
      call: { outcome: 'permanent_failure', actual_cost_micros: 550 },
    });
  });

  it('classifies safety blocks as permanent and preserves reported usage cost', async () => {
    const blocked = response({
      promptFeedback: { blockReason: 'SAFETY' },
      candidates: [],
    });
    const result = await providerFor(clientWith(async () => blocked)).execute(lease());
    expect(result).toMatchObject({
      ok: false,
      retryable: false,
      uncertain: false,
      failureClass: 'vertex_safety_block',
      reason: 'Vertex blocked the response under its safety policy',
      call: { outcome: 'permanent_failure', actual_cost_micros: 550 },
    });
  });

  it.each([429, 500, 503])('classifies an HTTP %s response as transient without leaking error content', async (status) => {
    const error = Object.assign(new Error('Authorization: Bearer secret request-body-private'), { status });
    const result = await providerFor(clientWith(async () => { throw error; })).execute(lease());
    expect(result).toMatchObject({
      ok: false,
      retryable: true,
      uncertain: false,
      failureClass: 'vertex_service_transient',
      call: { outcome: 'transient_failure', actual_cost_micros: null },
    });
    expect(JSON.stringify(result)).not.toMatch(/secret|request-body-private|Authorization/i);
  });

  it.each([400, 401, 403])('classifies an HTTP %s rejection as permanent', async (status) => {
    const result = await providerFor(clientWith(async () => {
      throw Object.assign(new Error('private provider body'), { status });
    })).execute(lease());
    expect(result).toMatchObject({
      ok: false,
      retryable: false,
      uncertain: false,
      failureClass: 'vertex_request_rejected',
      call: { outcome: 'permanent_failure' },
    });
    expect(result.reason).not.toContain('private provider body');
  });

  it.each([
    Object.assign(new Error('aborted with secret'), { name: 'AbortError' }),
    Object.assign(new Error('socket reset with secret'), { code: 'ECONNRESET' }),
    Object.assign(new Error('possibly accepted'), { status: 400, requestMayHaveBeenAccepted: true }),
  ])('stops automatic retry when transport completion is ambiguous', async (error) => {
    const result = await providerFor(clientWith(async () => { throw error; })).execute(lease());
    expect(result).toMatchObject({
      ok: false,
      retryable: false,
      uncertain: true,
      failureClass: 'vertex_request_uncertain',
      call: { outcome: 'uncertain', actual_cost_micros: null },
    });
    expect(JSON.stringify(result)).not.toMatch(/secret|possibly accepted/i);
  });

  it('returns uncertain when accepted response usage is missing and does not invent zero cost', async () => {
    const missingUsage = response();
    delete missingUsage.usageMetadata;
    const result = await providerFor(clientWith(async () => missingUsage)).execute(lease());
    expect(result).toMatchObject({
      ok: false,
      retryable: false,
      uncertain: true,
      failureClass: 'vertex_usage_invalid',
      call: { outcome: 'uncertain', actual_cost_micros: null },
    });
  });

  it('rejects missing response identity and incomplete candidates with known cost', async () => {
    const missingId = response();
    delete missingId.responseId;
    const first = await providerFor(clientWith(async () => missingId)).execute(lease());
    expect(first).toMatchObject({
      ok: false,
      failureClass: 'vertex_response_invalid',
      call: { outcome: 'permanent_failure', actual_cost_micros: 550 },
    });

    const incomplete = response({ candidates: [{
      finishReason: 'MAX_TOKENS',
      content: { parts: [{ text: JSON.stringify(output()) }] },
    }] });
    const second = await providerFor(clientWith(async () => incomplete)).execute(lease());
    expect(second).toMatchObject({
      ok: false,
      failureClass: 'vertex_response_incomplete',
      call: { outcome: 'permanent_failure', actual_cost_micros: 550 },
    });
  });
});
