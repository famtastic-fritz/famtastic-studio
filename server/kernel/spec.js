// spec.json read/write for a site. Writes go through the mutation module so every
// change is journaled before it is visible. mutation is supplied by the factory
// argument (imported lazily by the caller) so this module loads even before
// server/kernel/mutation.js exists; write() throws if no mutation was supplied.
import fs from 'node:fs';
import crypto from 'node:crypto';

function hashContent(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

const SPEC_FILENAME = 'spec.json';

// THE SEAM. createIfMissing: true, matching mutation.js exactly, and for the
// same reason: this function never threw for an unknown site before the seam
// existed (`within('sites', ...)` only checks containment, not existence), so
// a brand new site's FIRST write -- read() called from inside write()'s
// currentRevision check, before spec.json has ever existed anywhere -- must
// keep resolving to where the studio would create it, not throw. Read()'s own
// existing behavior already turns a missing FILE into an honest 200
// `spec_not_found`, never a 404; this preserves that exactly.
function specPathFor(paths, siteId) {
  const { rootName } = paths.resolveSite(siteId, { createIfMissing: true });
  return paths.within(rootName, siteId, 'spec.json');
}

function readRaw(paths, siteId) {
  const specPath = specPathFor(paths, siteId);
  if (!fs.existsSync(specPath)) return { buffer: null, spec: null, parseError: null };
  const buffer = fs.readFileSync(specPath);
  try {
    return { buffer, spec: JSON.parse(buffer.toString('utf8')), parseError: null };
  } catch (error) {
    return { buffer, spec: null, parseError: error.message };
  }
}

function validate(spec) {
  const errors = [];
  if (spec === null || typeof spec !== 'object' || Array.isArray(spec)) {
    errors.push('spec must be a JSON object');
    return errors;
  }
  if (spec.customer !== undefined && (typeof spec.customer !== 'object' || spec.customer === null)) {
    errors.push('spec.customer must be an object when present');
  }
  if (spec.customer?.id !== undefined && typeof spec.customer.id !== 'string') {
    errors.push('spec.customer.id must be a string when present');
  }
  if (spec.deploy !== undefined && (typeof spec.deploy !== 'object' || spec.deploy === null)) {
    errors.push('spec.deploy must be an object when present');
  }
  if (spec.deploy?.target !== undefined && typeof spec.deploy.target !== 'string') {
    errors.push('spec.deploy.target must be a string when present');
  }
  return errors;
}

export function createSpec({ paths, mutation = null }) {
  function read(siteId) {
    const { buffer, spec, parseError } = readRaw(paths, siteId);
    if (!buffer) {
      return { site_id: siteId, spec: null, valid: false, errors: ['spec_not_found'], revision: null };
    }
    if (parseError) {
      return { site_id: siteId, spec: null, valid: false, errors: [`spec.json does not parse: ${parseError}`], revision: hashContent(buffer) };
    }
    const errors = validate(spec);
    return { site_id: siteId, spec, valid: errors.length === 0, errors, revision: hashContent(buffer) };
  }

  function write(siteId, spec, { initiator, expectedRevision } = {}) {
    if (!mutation) {
      throw Object.assign(
        new Error('spec.write requires the mutation module; refusing to write unjournaled'),
        { statusCode: 503, code: 'journal_unavailable' },
      );
    }
    if (!initiator) {
      throw Object.assign(new Error('spec.write requires an initiator'), { statusCode: 400, code: 'initiator_required' });
    }

    const errors = validate(spec);
    if (errors.length) {
      throw Object.assign(new Error(`invalid spec: ${errors.join('; ')}`), { statusCode: 400, code: 'invalid_spec', errors });
    }

    const { buffer: currentBuffer } = readRaw(paths, siteId);
    const currentRevision = currentBuffer ? hashContent(currentBuffer) : null;
    if (expectedRevision !== undefined && expectedRevision !== currentRevision) {
      throw Object.assign(
        new Error('spec revision is stale; reload before writing'),
        { statusCode: 409, code: 'stale_revision' },
      );
    }

    // The mutation contract takes SITE-RELATIVE paths and `contents` (plural).
    // Passing an absolute path or `content` silently writes nothing useful, so it
    // is spelled out here; see docs/plans/PHASE-1-ENDPOINT-CONTRACT.md.
    const nextContents = `${JSON.stringify(spec, null, 2)}\n`;
    const result = mutation.apply({
      site_id: siteId,
      initiator,
      intent: 'spec.write',
      changes: [{ path: SPEC_FILENAME, contents: nextContents }],
      // Deliberately not forwarded: spec revision is a content hash of spec.json,
      // while mutation's expectedRevision is the site-level revision. They are
      // different concepts. The spec's own staleness check ran above; forwarding
      // the hash here would compare a hash against a site revision and always 409.
    });

    // undo_token was silently dropped here even though mutation.apply()
    // already returns it: a spec.write() (including the importer's very
    // first write of a real site) was journaled but had no way for a caller
    // to actually undo it without going digging in the journal by hand.
    return { revision: result.revision, journal_entry_id: result.journal_entry_id, undo_token: result.undo_token };
  }

  return { read, write };
}
