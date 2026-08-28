// Shay card schema (PHASE-2-CONTRACTS.md section 2, BINDING). Cards are
// structured objects end to end: the console never receives flattened prose
// where a card is meant, and never invents a card the server did not send.
// This module is the one place a card is constructed or checked, so a card
// that exists anywhere in this tree is guaranteed to match the fixed shape.
import crypto from 'node:crypto';

export const CARD_TYPES = Object.freeze([
  'plan',
  'proposal',
  'diff',
  'confirm',
  'progress',
  'success',
  'failure',
  'recovery',
  'deploy_receipt',
]);

const CARD_STATES = Object.freeze(['pending', 'applied', 'rejected', 'failed']);
const EVIDENCE_KINDS = Object.freeze(['file', 'journal', 'event', 'url']);

function fail(statusCode, code, message) {
  return Object.assign(new Error(message), { statusCode, code });
}

function newCardId() {
  return `cd_${Date.now().toString(36)}${crypto.randomBytes(10).toString('hex')}`;
}

function validateEvidence(list) {
  if (!Array.isArray(list)) throw fail(400, 'invalid_card', 'evidence must be an array (empty, never omitted)');
  for (const item of list) {
    if (!item || typeof item !== 'object') throw fail(400, 'invalid_card', 'evidence entries must be objects');
    if (!EVIDENCE_KINDS.includes(item.kind)) {
      throw fail(400, 'invalid_card', `evidence.kind must be one of: ${EVIDENCE_KINDS.join(', ')}`);
    }
    if (typeof item.ref !== 'string' || !item.ref.trim()) {
      throw fail(400, 'invalid_card', 'evidence.ref must be a non-empty string; never fabricate a reference');
    }
    if (item.note !== undefined && typeof item.note !== 'string') {
      throw fail(400, 'invalid_card', 'evidence.note must be a string when present');
    }
  }
  return list;
}

function validateActions(list) {
  if (!Array.isArray(list)) throw fail(400, 'invalid_card', 'actions must be an array');
  for (const action of list) {
    if (!action || typeof action !== 'object') throw fail(400, 'invalid_card', 'action entries must be objects');
    if (typeof action.id !== 'string' || !action.id.trim()) throw fail(400, 'invalid_card', 'action.id is required');
    if (typeof action.label !== 'string' || !action.label.trim()) throw fail(400, 'invalid_card', 'action.label is required');
    if (typeof action.method !== 'string' || !action.method.trim()) throw fail(400, 'invalid_card', 'action.method is required');
    if (typeof action.path !== 'string' || !action.path.trim()) throw fail(400, 'invalid_card', 'action.path is required');
    if (typeof action.confirm_required !== 'boolean') {
      throw fail(400, 'invalid_card', 'action.confirm_required must be a boolean; the console decides whether to ask from this field alone');
    }
  }
  return list;
}

// Constructs a card, validating every field against the fixed schema. Unknown
// types are rejected here, not left to render badly downstream.
export function buildCard({
  type,
  site_id,
  conversation_id,
  title,
  body = '',
  evidence = [],
  actions = [],
  state = 'pending',
}) {
  if (!CARD_TYPES.includes(type)) {
    throw fail(400, 'unknown_card_type', `unknown card type: ${type}. Known types: ${CARD_TYPES.join(', ')}`);
  }
  if (!site_id) throw fail(400, 'identity_required', 'cards require site_id (no ambient site)');
  if (!conversation_id) throw fail(400, 'identity_required', 'cards require conversation_id (no ambient conversation)');
  if (typeof title !== 'string' || !title.trim()) throw fail(400, 'invalid_card', 'title is required');
  if (typeof body !== 'string') throw fail(400, 'invalid_card', 'body must be a string (may be empty)');
  validateEvidence(evidence);
  validateActions(actions);
  if (!CARD_STATES.includes(state)) throw fail(400, 'invalid_card', `state must be one of: ${CARD_STATES.join(', ')}`);

  return Object.freeze({
    card_id: newCardId(),
    schema_version: 1,
    type,
    site_id,
    conversation_id,
    ts: new Date().toISOString(),
    title,
    body,
    evidence: Object.freeze([...evidence]),
    actions: Object.freeze([...actions]),
    state,
  });
}

// Validates an already-built card object (for example one embedded in a
// conversation entry about to be written). Throws on any deviation from the
// fixed schema, including an unknown type -- a card must never enter the
// journal or conversation log in a shape the console cannot trust.
export function validateCard(candidate) {
  if (!candidate || typeof candidate !== 'object') throw fail(400, 'invalid_card', 'card must be an object');
  if (typeof candidate.card_id !== 'string' || !candidate.card_id.trim()) {
    throw fail(400, 'invalid_card', 'card.card_id is required');
  }
  if (candidate.schema_version !== 1) throw fail(400, 'invalid_card', 'unsupported card schema_version');
  if (!CARD_TYPES.includes(candidate.type)) {
    throw fail(400, 'unknown_card_type', `unknown card type: ${candidate.type}. Known types: ${CARD_TYPES.join(', ')}`);
  }
  if (!candidate.site_id) throw fail(400, 'identity_required', 'card missing site_id');
  if (!candidate.conversation_id) throw fail(400, 'identity_required', 'card missing conversation_id');
  if (typeof candidate.ts !== 'string' || Number.isNaN(Date.parse(candidate.ts))) {
    throw fail(400, 'invalid_card', 'card.ts must be an ISO8601 timestamp');
  }
  if (typeof candidate.title !== 'string' || !candidate.title.trim()) throw fail(400, 'invalid_card', 'card.title is required');
  if (typeof candidate.body !== 'string') throw fail(400, 'invalid_card', 'card.body must be a string');
  validateEvidence(candidate.evidence || []);
  validateActions(candidate.actions || []);
  if (!CARD_STATES.includes(candidate.state)) throw fail(400, 'invalid_card', 'invalid card.state');
  return candidate;
}

export function isKnownCardType(type) {
  return CARD_TYPES.includes(type);
}
