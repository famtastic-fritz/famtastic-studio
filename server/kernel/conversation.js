// Per-site conversation persistence (PHASE-2-CONTRACTS.md section 3, BINDING).
// Append-only JSONL at <conversations root>/<site_id>.jsonl, one JSON object
// per line: { entry_id, ts, site_id, conversation_id, role, text, card? }.
// No ambient site or conversation: every call names them explicitly, and a
// missing one is refused rather than guessed.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

// Deliberately narrow. Shay is not wired to a model in this milestone (M2):
// an 'assistant' or similar role would imply something is listening and
// replying, which is the single worst outcome named in the brief. Only the
// operator (a human, via the console) and the system (the server itself,
// recording what actually happened) may author an entry.
const ROLES = Object.freeze(['operator', 'system']);

function fail(statusCode, code, message) {
  return Object.assign(new Error(message), { statusCode, code });
}

function newEntryId() {
  return `ce_${Date.now().toString(36)}${crypto.randomBytes(8).toString('hex')}`;
}

function newConversationId() {
  return `conv_${Date.now().toString(36)}${crypto.randomBytes(8).toString('hex')}`;
}

export function createConversation({ paths }) {
  function fileFor(siteId) {
    return paths.within('conversations', `${siteId}.jsonl`);
  }

  // A conversation_id carried no site binding, so an id minted while working on
  // site A was silently accepted against site B. Per-site files meant no data
  // bled, but conversation identity itself guaranteed nothing. Ownership is now
  // claimed on first use and enforced afterwards.
  function ownersFile() { return paths.within('conversations', '_owners.json'); }

  function readOwners() {
    const file = ownersFile();
    if (!fs.existsSync(file)) return {};
    try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return {}; }
  }

  function claimConversation(conversationId, siteId) {
    const owners = readOwners();
    const owner = owners[conversationId];
    if (owner && owner !== siteId) {
      throw fail(409, 'conversation_site_mismatch', `conversation ${conversationId} belongs to site ${owner}, not ${siteId}`);
    }
    if (!owner) {
      owners[conversationId] = siteId;
      paths.ensure('conversations');
      fs.writeFileSync(ownersFile(), JSON.stringify(owners, null, 2));
    }
  }

  function ownerOf(conversationId) {
    return readOwners()[conversationId] || null;
  }

  function append({ site_id, conversation_id, role, text, card = null }) {
    if (!site_id) throw fail(400, 'identity_required', 'conversation entries require site_id (no ambient site)');
    if (!conversation_id) {
      throw fail(400, 'identity_required', 'conversation entries require conversation_id (no ambient conversation)');
    }
    claimConversation(conversation_id, site_id);
    if (!ROLES.includes(role)) throw fail(400, 'invalid_role', `role must be one of: ${ROLES.join(', ')}`);
    if (typeof text !== 'string') {
      throw fail(400, 'invalid_text', 'text must be a string (may be empty when a card carries the content)');
    }
    if (card !== null) {
      if (typeof card !== 'object') throw fail(400, 'invalid_card', 'card must be an object when present');
      // The full schema is server/kernel/cards.js's job (validateCard). This
      // module only refuses a card that would silently mislabel who it
      // belongs to -- a card must never bleed across sites or conversations.
      if (card.site_id && card.site_id !== site_id) {
        throw fail(400, 'identity_conflict', 'card.site_id does not match the conversation entry site_id');
      }
      if (card.conversation_id && card.conversation_id !== conversation_id) {
        throw fail(400, 'identity_conflict', 'card.conversation_id does not match the conversation entry conversation_id');
      }
    }

    const entry = {
      entry_id: newEntryId(),
      ts: new Date().toISOString(),
      site_id,
      conversation_id,
      role,
      text,
      ...(card !== null ? { card } : {}),
    };

    paths.ensure('conversations');
    const file = fileFor(site_id);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.appendFileSync(file, `${JSON.stringify(entry)}\n`);
    return entry;
  }

  // Newest-last, matching PHASE-2-CONTRACTS.md section 3 ("Read returns
  // newest-last for display"). Entries are already written in append order,
  // so no reversal is needed -- only a tail slice for the limit.
  function read(siteId, { limit = 200 } = {}) {
    if (!siteId) throw fail(400, 'identity_required', 'conversation read requires site_id (no ambient site)');
    const file = fileFor(siteId);
    if (!fs.existsSync(file)) return [];
    const lines = fs.readFileSync(file, 'utf8').trim().split('\n').filter(Boolean);
    const entries = [];
    for (const line of lines) {
      try {
        entries.push(JSON.parse(line));
      } catch {
        // A torn trailing line is skipped for reading rather than failing the
        // whole history; the write path never produces one mid-file.
      }
    }
    return entries.slice(-limit);
  }

  // Starts a fresh conversation_id without touching or destroying any prior
  // history. This does not write anything by itself -- restart continuity
  // (a second kernel instance over the same directory seeing the same
  // history) depends on there being no server-side "current conversation"
  // state to lose. The caller (console) persists the id it gets back and
  // sends it explicitly on every subsequent append.
  function newConversation(siteId) {
    if (!siteId) throw fail(400, 'identity_required', 'newConversation requires a site_id to own the conversation');
    const conversation_id = newConversationId();
    claimConversation(conversation_id, siteId);
    return { conversation_id, site_id: siteId };
  }

  return { append, read, newConversation, ownerOf };
}
