/**
 * The Selected Build Packet: the seam artifact between FAMtastic Designs and
 * Site Studio (ADR-0007).
 *
 * Designs owns intake through proofs and emits one of these. Studio owns build
 * through journal and consumes one. It is the ONLY supported way work crosses
 * the boundary -- no shared database reads, no reaching into each other's
 * directories, no implicit conventions.
 *
 * Validation is fail-closed on purpose. A packet that is missing a field is
 * refused rather than defaulted, because every field here is something Studio
 * would otherwise have to guess, and guessing at customer identity, chosen
 * direction, or deploy authorization is exactly the class of failure this
 * boundary exists to prevent.
 */

import { sha256Hex } from './packet.js';
import { validateArtifactBundle } from './artifact-bundle.js';

export const SELECTED_BUILD_PACKET_SCHEMA_VERSION = 1;
export const ORIGINS = ['legit', 'test'];

function isNonEmptyString(v) {
  return typeof v === 'string' && v.trim().length > 0;
}

function isPlainObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

function isIsoDate(v) {
  return isNonEmptyString(v) && !Number.isNaN(Date.parse(v));
}

function validateCustomer(customer, errors) {
  if (!isPlainObject(customer)) {
    errors.push('customer: must be an object with id, name, email');
    return;
  }
  for (const field of ['id', 'name', 'email']) {
    if (!isNonEmptyString(customer[field])) errors.push(`customer.${field}: must be a non-empty string`);
  }
}

function validateChosenDirection(direction, errors) {
  if (!isPlainObject(direction)) {
    errors.push('chosen_direction: must be an object with id and name');
    return;
  }
  for (const field of ['id', 'name']) {
    if (!isNonEmptyString(direction[field])) errors.push(`chosen_direction.${field}: must be a non-empty string`);
  }
}

function validateResearchRef(ref, errors) {
  if (!isPlainObject(ref)) {
    errors.push('research_packet_ref: must be an object with packet_id, brief_hash, source_adapter');
    return;
  }
  for (const field of ['packet_id', 'brief_hash', 'source_adapter']) {
    if (!isNonEmptyString(ref[field])) errors.push(`research_packet_ref.${field}: must be a non-empty string`);
  }
}

function validateAssetRefs(refs, errors) {
  if (!Array.isArray(refs)) {
    errors.push('asset_refs: must be an array (empty is allowed; a site with no assets is honest)');
    return;
  }
  refs.forEach((ref, i) => {
    if (!isPlainObject(ref)) {
      errors.push(`asset_refs[${i}]: must be an object`);
      return;
    }
    if (!isNonEmptyString(ref.ref)) errors.push(`asset_refs[${i}].ref: must be a non-empty string`);
    // Bytes never cross the seam. A packet that inlines media is rejected --
    // it makes the packet unbounded and unreplayable.
    if ('bytes' in ref || 'data' in ref || 'content' in ref) {
      errors.push(`asset_refs[${i}]: must reference an asset, never inline its bytes`);
    }
  });
}

function validateBoundary(boundary, errors) {
  if (!isPlainObject(boundary)) {
    errors.push('boundary: must be an object with external_mutation_allowed and deploy_authorized');
    return;
  }
  for (const field of ['external_mutation_allowed', 'deploy_authorized']) {
    if (typeof boundary[field] !== 'boolean') {
      // Explicitly not defaulting to false. An absent permission is a
      // malformed packet, not a denied one, and the two must not be conflated.
      errors.push(`boundary.${field}: must be an explicit boolean, never absent`);
    }
  }
}

/**
 * validateSelectedBuildPacket(packet) -> {ok, errors[]}
 * Never throws. Collects every error rather than failing on the first, so a
 * producer sees the whole contract gap in one pass.
 */
export function validateSelectedBuildPacket(packet) {
  const errors = [];
  if (!isPlainObject(packet)) {
    return { ok: false, errors: ['packet: must be an object'] };
  }
  if (packet.schema_version !== SELECTED_BUILD_PACKET_SCHEMA_VERSION) {
    errors.push(`schema_version: must equal ${SELECTED_BUILD_PACKET_SCHEMA_VERSION}`);
  }
  if (!isNonEmptyString(packet.packet_id)) errors.push('packet_id: must be a non-empty string');
  if (!isIsoDate(packet.created)) errors.push('created: must be an ISO 8601 date string');

  validateCustomer(packet.customer, errors);
  validateChosenDirection(packet.chosen_direction, errors);

  if (!isPlainObject(packet.spec)) errors.push('spec: must be an object');
  if (!isPlainObject(packet.brand)) errors.push('brand: must be an object');

  if (packet.artifact_bundle !== undefined) {
    errors.push(...validateArtifactBundle(packet.artifact_bundle));
  }

  validateAssetRefs(packet.asset_refs, errors);
  validateResearchRef(packet.research_packet_ref, errors);

  if (!ORIGINS.includes(packet.origin)) {
    errors.push(`origin: must be one of ${ORIGINS.join(', ')} (a build packet is never 'unknown' -- the producer knows)`);
  }
  validateBoundary(packet.boundary, errors);

  return { ok: errors.length === 0, errors };
}

/**
 * createSelectedBuildPacket(fields) -> packet
 * Stamps schema_version and a content-derived packet_id when absent. Does NOT
 * validate; call validateSelectedBuildPacket on the result. Producing and
 * accepting are deliberately separate steps.
 */
export function createSelectedBuildPacket(fields = {}) {
  const body = {
    schema_version: SELECTED_BUILD_PACKET_SCHEMA_VERSION,
    ...fields,
  };
  if (!isNonEmptyString(body.packet_id)) {
    body.packet_id = `sbp_${sha256Hex(body).slice(0, 24)}`;
  }
  return body;
}

/**
 * acceptSelectedBuildPacket(packet) -> {accepted, packet, errors[], may_deploy}
 * The Studio-side ingress. Fail-closed: an invalid packet is refused whole.
 */
export function acceptSelectedBuildPacket(packet) {
  const { ok, errors } = validateSelectedBuildPacket(packet);
  if (!ok) return { accepted: false, packet: null, errors, may_deploy: false };
  return {
    accepted: true,
    packet,
    errors: [],
    // Authorization travels WITH the packet. Studio never infers it from
    // context, environment, or the absence of a denial.
    may_deploy: packet.boundary.deploy_authorized === true,
  };
}
