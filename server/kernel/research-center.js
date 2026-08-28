/**
 * The proto-Research-Center: the ONE callable interface to research grounding,
 * shared by FAMtastic Designs and Site Studio (ADR-0008).
 *
 * There is one implementation. It currently lives in this repo across three
 * modules -- research.js (run and verify), spec-derive.js (packet to spec), and
 * packet.js (schema, validation, persistence) -- and this file is the seam in
 * front of them.
 *
 * Why a facade rather than letting each platform import the modules directly:
 * the moment two platforms import internals, the internals become the contract
 * and the capability can never move. Everything crossing into research goes
 * through the functions below, so relocating the implementation later -- into
 * its own service, its own repo, behind a network call -- is a RELOCATION, not
 * a rewrite. Callers keep calling the same four functions.
 *
 * Rule: no forks. If a platform needs research behavior this interface does not
 * expose, the answer is to extend this interface, never to copy research.js.
 */

import { runResearch } from './research.js';
import { deriveSpecFromPacket } from './spec-derive.js';
import {
  validatePacket,
  createPacket,
  readPacket,
  writePacket,
  SCHEMA_VERSION as PACKET_SCHEMA_VERSION,
} from './packet.js';

export const RESEARCH_CENTER_INTERFACE_VERSION = 1;

/**
 * The four capabilities that cross the seam. Anything not listed here is an
 * internal detail and may change without notice.
 */
export const CAPABILITIES = Object.freeze([
  'research.run',
  'research.packet.validate',
  'research.packet.read',
  'spec.derive',
]);

/**
 * research.run: produce a Research Packet for a brief.
 * Live search plus independent re-fetch of every cited source. Honest about
 * what it could not verify; never fabricates a fact to fill the shape.
 */
export async function run(args) {
  return runResearch(args);
}

/**
 * spec.derive: turn a Research Packet into a creative spec.
 * A spec is only 'research-derived' when research contributed a verified fact.
 */
export function deriveSpec(args) {
  return deriveSpecFromPacket(args);
}

/**
 * research.packet.validate / .read: the packet schema is part of the seam,
 * because both platforms must agree on what a packet IS.
 */
export function validate(packet, opts) {
  return validatePacket(packet, opts);
}

export function read(args) {
  return readPacket(args);
}

export { createPacket, writePacket, PACKET_SCHEMA_VERSION };

/**
 * describe() -> a machine-readable statement of what this capability offers.
 * Exists so a consuming platform can assert compatibility instead of assuming
 * it, and so the seam is discoverable rather than tribal knowledge.
 */
export function describe() {
  return {
    interface_version: RESEARCH_CENTER_INTERFACE_VERSION,
    packet_schema_version: PACKET_SCHEMA_VERSION,
    capabilities: [...CAPABILITIES],
    implementation: {
      location: 'site-studio-next/server/kernel',
      modules: ['research.js', 'spec-derive.js', 'packet.js'],
      status: 'co-located; designated for relocation without interface change',
    },
  };
}
