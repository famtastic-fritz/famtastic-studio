// Shay reasoning seam (PHASE-2-CONTRACTS.md section 2, BINDING: the typed
// card schema). ask() builds the context envelope the plan requires (site
// tag, artifact family, page/selection, revision, surface, conversation id),
// resolves a configured model provider, and returns typed cards.
//
// The provider seam is filled by CLI-backed adapters only (server/kernel/
// shay-adapters/) -- Shay's brain is the operator's own installed CLI
// (claude, codex, gemini, kimi), spawned headless on their existing
// subscription auth. No API keys anywhere in this path, ever. Which adapter
// is active is optionally configured by the Settings/admin lane via
// config/shay.json ({ "provider": "...", "timeout_ms": ... }, read-only from
// here -- server/modules/admin/index.js owns writing it); absent that file
// or an unknown provider id, this falls back to the proven default, claude.
//
// resolveProvider() below picks which adapter to use and confirms it is
// actually installed before handing it back. When none is usable, ask()
// returns an honest provider_unavailable result carrying the envelope it
// would have sent -- it never fabricates a reply, never emits a fake card,
// and never degrades into canned text (same doctrine as kernel/research.js
// and kernel/compose.js for their own no-provider seams). When an adapter IS
// installed but the call itself fails -- times out, exits non-zero, or
// prints something that cannot be parsed as JSON -- ask() returns
// provider_error naming exactly which of those happened, again never a
// fabricated card in its place.
//
// The operator's own message IS real and IS persisted, through the same
// conversation kernel the console composer already uses today (A6: one
// place owns conversation persistence, server/kernel/conversation.js).
import fs from 'node:fs';
import path from 'node:path';
import { createConversation } from './conversation.js';
import { validateCard } from './cards.js';
import { getAdapter, DEFAULT_ADAPTER_ID } from './shay-adapters/index.js';

function fail(statusCode, code, message) {
  return Object.assign(new Error(message), { statusCode, code });
}

// The envelope named in the plan. Identity fields (site_id, conversation_id)
// always come from the bound arguments, never from `context` -- a caller
// cannot spoof identity by stuffing it into the context payload.
function buildEnvelope({ site_id, conversation_id, text, context = {} }) {
  return Object.freeze({
    site_id,
    conversation_id,
    surface: typeof context.surface === 'string' && context.surface.trim() ? context.surface : 'rail',
    artifact_family: context.artifact_family ?? null,
    page: context.page ?? null,
    selection: context.selection ?? null,
    revision: context.revision ?? null,
    text,
    ts: new Date().toISOString(),
  });
}

// Optional, and its absence is fully tolerated: the Settings/admin lane owns
// config/shay.json (sibling to config/paths.json, schema_version 1, shape
// { "provider": "claude", "timeout_ms": 60000 } -- confirmed against
// server/modules/admin/index.js's readShayConfig()/writeShayConfig(), the
// GET/PUT /api/admin/shay handlers that read and rewrite this same file).
// This module only ever reads it, never writes it -- the admin module owns
// writes. Until the file exists, cannot be parsed, or names a field of the
// wrong type, this returns {} and every caller below falls back to the
// proven default -- it never throws for a missing or malformed file, since
// owning that file is out of scope here.
function readShayFileConfig(paths) {
  try {
    const configDir = path.dirname(paths.configFile);
    const file = path.join(configDir, 'shay.json');
    if (!fs.existsSync(file)) return {};
    const data = JSON.parse(fs.readFileSync(file, 'utf8'));
    return data && typeof data === 'object' ? data : {};
  } catch {
    return {};
  }
}

export function readConfiguredProviderId(paths) {
  const data = readShayFileConfig(paths);
  return typeof data.provider === 'string' && data.provider.trim() ? data.provider.trim() : null;
}

// A configured timeout is honored as the default for ask() when the caller
// does not pass its own timeoutMs; an absent or non-positive value defers to
// each adapter's own built-in default (base.js's askTimeoutMsDefault).
export function readConfiguredTimeoutMs(paths) {
  const data = readShayFileConfig(paths);
  return typeof data.timeout_ms === 'number' && Number.isFinite(data.timeout_ms) && data.timeout_ms > 0
    ? data.timeout_ms
    : null;
}

// SEAM: the one function that decides which adapter, if any, Shay actually
// uses. Sync and cheap on purpose -- it checks configuration and whether the
// chosen CLI is on PATH, but does not spend a live model turn confirming
// authentication (that is adapter.probe()/isAuthenticated(), used by ask()
// itself when it actually calls out). An unknown configured id falls back to
// the default rather than failing outright; a default that is not installed
// resolves to null -- honest unavailability, never a guess.
export function resolveProvider({ paths, spawnImpl, commandExistsImpl }) {
  const configuredId = readConfiguredProviderId(paths);
  const adapter =
    getAdapter(configuredId, { spawnImpl, commandExistsImpl }) ||
    getAdapter(DEFAULT_ADAPTER_ID, { spawnImpl, commandExistsImpl });
  if (!adapter || !adapter.isInstalled()) return null;
  return adapter;
}

// spawnImpl/commandExistsImpl are test-only injection points threaded down
// into shay-adapters/*; production callers never pass them and get the real
// node:child_process spawn and the real PATH check.
export function createShay({ paths, spawnImpl, commandExistsImpl }) {
  const conversation = createConversation({ paths });

  // Honest capability report for GET /api/shay/status. No guessing: this
  // calls the exact same resolution the ask() path uses, so status can never
  // drift from what ask() actually does. Deliberately does not call
  // isAuthenticated() (that spawns a live probe) -- status is meant to be
  // cheap enough to poll.
  function status() {
    const provider = resolveProvider({ paths, spawnImpl, commandExistsImpl });
    return Object.freeze({
      provider_configured: Boolean(provider),
      provider_name: provider ? provider.displayName : null,
    });
  }

  async function ask({ site_id, conversation_id, text, context = {}, timeoutMs }) {
    if (!site_id) throw fail(400, 'identity_required', 'shay.ask requires site_id (no ambient site)');
    if (!conversation_id) throw fail(400, 'identity_required', 'shay.ask requires conversation_id (no ambient conversation)');
    if (typeof text !== 'string' || !text.trim()) throw fail(400, 'invalid_text', 'shay.ask requires non-empty text');
    if (context !== null && typeof context !== 'object') throw fail(400, 'invalid_context', 'context must be an object when present');

    const envelope = buildEnvelope({ site_id, conversation_id, text, context: context || {} });

    // Persist the operator's message through the existing conversation
    // kernel -- the exact path the console composer already uses today.
    // This happens regardless of provider availability: the operator's own
    // words are always real and always worth keeping.
    const operatorEntry = conversation.append({ site_id, conversation_id, role: 'operator', text });

    const provider = resolveProvider({ paths, spawnImpl, commandExistsImpl });
    if (!provider) {
      return Object.freeze({
        status: 'provider_unavailable',
        envelope,
        operator_entry: operatorEntry,
        provider_name: null,
        cards: [],
        message:
          'No Shay CLI adapter is usable right now (none configured is installed on PATH, including the default). The envelope that would have been sent is included for inspection. Nothing was fabricated in its place -- no card, no canned reply.',
      });
    }

    // The adapter spawns the operator's own CLI, parses its stdout, and
    // builds candidate cards via cards.js's buildCard -- but its result is
    // never trusted blindly here. Every card is re-validated with
    // validateCard() before it is allowed anywhere near persistence; one
    // that fails is dropped with its reason recorded, not passed through.
    // An explicit caller timeoutMs always wins; otherwise config/shay.json's
    // timeout_ms (Settings-owned) is honored when present; otherwise the
    // adapter's own built-in default applies.
    const effectiveTimeoutMs = timeoutMs ?? readConfiguredTimeoutMs(paths) ?? undefined;
    const result = await provider.ask({ envelope, timeoutMs: effectiveTimeoutMs });

    if (!result.ok) {
      return Object.freeze({
        status: 'provider_error',
        envelope,
        operator_entry: operatorEntry,
        provider_name: provider.displayName,
        cards: [],
        classification: result.classification || 'unknown_error',
        message: result.summary || 'The provider call failed and produced no further detail.',
      });
    }

    const dropped = [...(result.dropped || [])];
    const validCards = [];
    for (const candidate of result.cards || []) {
      try {
        validCards.push(validateCard(candidate));
      } catch (error) {
        dropped.push({ reason: error.message, candidate });
      }
    }

    const persistedEntries = validCards.map((card) =>
      conversation.append({ site_id, conversation_id, role: 'system', text: '', card }),
    );

    return Object.freeze({
      status: 'ok',
      envelope,
      operator_entry: operatorEntry,
      provider_name: provider.displayName,
      cards: Object.freeze(persistedEntries.map((entry) => entry.card)),
      dropped: Object.freeze(dropped),
    });
  }

  return { ask, status };
}
