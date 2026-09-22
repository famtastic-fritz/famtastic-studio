/**
 * FAMtastic -> Site Studio Next selected-build adapter.
 *
 * FAMtastic owns the customer/proof/payment records. Site Studio owns the
 * build. This module is deliberately pure: it does not read either system's
 * database, call HTTP, send mail, charge a card, deploy, or mutate a site.
 * It turns an already-authoritative source snapshot into the versioned packet
 * from ADR-0007 and refuses an ambiguous snapshot before a side effect can be
 * attempted.
 */

import crypto from 'node:crypto';
import {
  acceptSelectedBuildPacket,
  createSelectedBuildPacket,
} from './selected-build-packet.js';
import { validateArtifactBundle } from './artifact-bundle.js';
import { validateDesignContract } from './design-contract.js';

export const SELECTED_BUILD_ADAPTER_SCHEMA_VERSION = 1;

function fail(code, message, details = {}) {
  return Object.assign(new Error(message), { code, details });
}

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function text(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function sha256(value) {
  return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function required(value, label, errors) {
  if (!text(value)) errors.push(`${label}: required`);
}

function checkSource(source, customer, selection, payment, research, lifecycle_stage = 'production') {
  const errors = [];
  if (!isObject(source)) {
    errors.push('source: required authoritative FAMtastic snapshot');
  } else {
    for (const field of ['website_request_public_id', 'proof_campaign_id', 'campaign_id']) {
      required(source[field], `source.${field}`, errors);
    }
    required(source.customer_id, 'source.customer_id', errors);
    if (text(source.customer_id) && source.customer_id !== customer?.id) {
      errors.push('identity_mismatch: source.customer_id does not match customer.id');
    }
  }

  if (!isObject(selection)) {
    errors.push('selection: required approved proof selection');
  } else {
    for (const field of ['direction_id', 'direction_name', 'proof_variant_id', 'proof_version', 'proof_hash', 'approval_id', 'approved_at']) {
      required(selection[field], `selection.${field}`, errors);
    }
    if (selection.approved !== true) errors.push('selection.approved: must be true');
    if (text(source?.current_proof_hash) && text(selection.proof_hash)
      && source.current_proof_hash !== selection.proof_hash) {
      errors.push('stale_proof: selected proof hash is not the current proof for this request');
    }
    if (text(selection.direction_id) && text(selection.approval_direction_id)
      && selection.direction_id !== selection.approval_direction_id) {
      errors.push('selection_mismatch: approval is for a different direction');
    }
  }

  if (!isObject(payment)) {
    errors.push(`${lifecycle_stage === 'staging' ? 'staging_payment' : 'commerce'}: required payment-state snapshot`);
  } else {
    if (lifecycle_stage === 'staging') {
      if (!['pending', 'unpaid'].includes(payment.payment_status)) {
        errors.push('staging_payment: payment_status must be pending or unpaid before lock-in');
      }
    } else {
      for (const field of ['order_id', 'payment_event_id', 'package_sku', 'terms_version', 'terms_acceptance_hash']) {
        required(payment[field], `commerce.${field}`, errors);
      }
      if (payment.payment_status !== 'paid') {
        errors.push('payment_required: commerce.payment_status must equal paid');
      }
    }
  }

  if (!isObject(research)) {
    errors.push('research_packet_ref: required provenance snapshot');
  } else {
    for (const field of ['packet_id', 'brief_hash', 'source_adapter']) {
      required(research[field], `research_packet_ref.${field}`, errors);
    }
  }

  return errors;
}

function checkDesignContract(brand, bundle) {
  const c = brand?.design_contract;
  if (c?.schema_version === 1 && c.kind === 'selected-source-preservation-v1') {
    return /^[a-f0-9]{64}$/.test(c.source_sha256 || '') && bundle?.files?.some(f => f.sha256 === c.source_sha256 && f.path.endsWith('.html'))
      && c.preservation === 'exact-source-and-marked-shell' && c.asset_policy?.preserve === true && c.asset_policy?.rights_safe_only === true
      ? [] : ['brand.design_contract: source-preservation binding invalid'];
  }
  return validateDesignContract(brand?.design_contract);
}

/**
 * Build the packet only from an authoritative, already-selected source.
 * `origin: test` is useful for the synthetic handoff harness; it never means
 * that a test payment or test build is a customer payment.
 */
export function prepareSelectedBuildPacket({
  source,
  customer,
  selection,
  payment,
  spec,
  brand,
  artifact_bundle,
  asset_refs = [],
  research_packet_ref,
  origin = 'test',
  boundary = { external_mutation_allowed: false, deploy_authorized: false },
  callback = null,
  lifecycle_stage = 'production',
  created = new Date().toISOString(),
} = {}) {
  const errors = [];
  if (!isObject(customer)) errors.push('customer: required');
  else for (const field of ['id', 'name', 'email']) required(customer[field], `customer.${field}`, errors);
  if (!isObject(spec)) errors.push('spec: required');
  if (!isObject(brand)) errors.push('brand: required');
  errors.push(...checkDesignContract(brand, artifact_bundle));
  errors.push(...(artifact_bundle ? validateArtifactBundle(artifact_bundle) : ['artifact_bundle: required approved proof artifact bundle']));
  if (!['staging', 'production'].includes(lifecycle_stage)) errors.push('lifecycle_stage: must be staging or production');
  errors.push(...checkSource(source, customer, selection, payment, research_packet_ref, lifecycle_stage));
  if (errors.length) throw fail('handoff_not_ready', errors.join('; '), errors);

  const packet = createSelectedBuildPacket({
    created,
    customer,
    chosen_direction: {
      id: selection.direction_id,
      name: selection.direction_name,
      proof_variant_id: selection.proof_variant_id,
      proof_version: selection.proof_version,
      proof_hash: selection.proof_hash,
      approval_id: selection.approval_id,
      approved_at: selection.approved_at,
    },
    spec,
    brand,
    artifact_bundle,
    asset_refs,
    research_packet_ref,
    origin,
    boundary,
    source: { ...source },
    commerce: { ...payment },
    callback: callback ? { ...callback } : null,
    lifecycle_stage,
    adapter: {
      schema_version: SELECTED_BUILD_ADAPTER_SCHEMA_VERSION,
      idempotency_key: `selected-build:${source.website_request_public_id}:${selection.proof_hash}`,
      source_snapshot_hash: sha256({ source, customer, selection, payment, research_packet_ref }),
    },
  });

  const accepted = acceptSelectedBuildPacket(packet);
  if (!accepted.accepted) throw fail('packet_invalid', accepted.errors.join('; '), accepted.errors);
  return { packet, accepted, idempotency_key: packet.adapter.idempotency_key };
}

/**
 * Lock an accepted proof into a staging build before payment.
 *
 * This is intentionally separate from the paid selected-build path. It may
 * create a local artifact, per-site repository, and staging plan, but it
 * cannot authorize production or claim that payment exists.
 */
export function prepareStagingBuildPacket(fields = {}) {
  return prepareSelectedBuildPacket({
    ...fields,
    payment: fields.payment || { payment_status: 'pending' },
    lifecycle_stage: 'staging',
    boundary: { external_mutation_allowed: false, deploy_authorized: false },
  });
}

/**
 * Translate a packet into the brief shape consumed by Site Studio Next's
 * hermetic pipeline. This is still a pure projection; the caller decides
 * whether to run a local test, stage a build, or stop for owner approval.
 */
export function packetToBuildBrief(packet) {
  const accepted = acceptSelectedBuildPacket(packet);
  if (!accepted.accepted) throw fail('packet_invalid', accepted.errors.join('; '), accepted.errors);
  const needs = packet.spec.site_needs || {};
  return {
    business: packet.spec.business || {
      name: packet.customer.name,
      description: packet.spec.description || `${packet.customer.name} website build`,
    },
    site_needs: {
      pages: needs.pages || packet.spec.pages || ['home'],
      offers: needs.offers || packet.spec.offers || [],
      ctas: needs.ctas || packet.spec.ctas || [],
    },
    // Keep the implementation lane explicit. A CMS, portal, cart, or login
    // cannot be inferred from a visual proof; these declarations tell Studio
    // which recipe/backend it must carry and verify.
    capability_class: packet.spec.capability_class || null,
    recipe: packet.spec.recipe || packet.spec.archetype || null,
    backend: packet.spec.backend || null,
    functional_contract: packet.spec.functional_contract || null,
    brand: packet.brand,
    artifact_bundle: packet.artifact_bundle,
    design_contract: packet.brand?.design_contract || null,
    selected_direction: packet.chosen_direction,
    research_packet_ref: packet.research_packet_ref,
    source: packet.source,
  };
}

/**
 * Tiny in-memory idempotency guard for a single process/test run. Production
 * must replace this with a durable FAMtastic/Studio receipt before dispatch;
 * this function exists to make the duplicate contract executable now.
 */
export function createHandoffReceiptStore() {
  const receipts = new Map();
  return {
    record(idempotencyKey, packet) {
      const prior = receipts.get(idempotencyKey);
      if (prior) {
        if (JSON.stringify(prior.packet) !== JSON.stringify(packet)) {
          throw fail('idempotency_conflict', `idempotency key ${idempotencyKey} was reused with different content`);
        }
        return { duplicate: true, ...prior };
      }
      const receipt = {
        receipt_id: `sbr_${sha256({ idempotencyKey, packet }).slice(0, 24)}`,
        idempotency_key: idempotencyKey,
        packet,
        status: 'accepted_for_test',
      };
      receipts.set(idempotencyKey, receipt);
      return { duplicate: false, ...receipt };
    },
  };
}
