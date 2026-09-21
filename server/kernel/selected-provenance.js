import { createPacket, writePacket, sha256Hex } from './packet.js';
import { validateArtifactBundle } from './artifact-bundle.js';
// Records inherited work without pretending it was freshly researched.
export function importSelectedProvenance({ paths, site_id, brief }) {
  if (!['package_existing', 'continue_build'].includes(brief.handoff?.operation)
    || validateArtifactBundle(brief.artifact_bundle).length) throw Object.assign(new Error('selected import contract invalid'), { code: 'selected_import_invalid' });
  const packet = createPacket({ site_id, source_adapter: 'selected-artifact-import', execution_status: 'partial',
    brief_ref: brief.handoff.correlation_id, brief_hash: sha256Hex(brief), facts: [], customer_claims: [],
    not_found: [{ question: 'Independent research', reason: 'Not requested: importing selected source without factual rewriting' }],
    brand: brief.brand, site_needs: brief.site_needs, component_needs: [], media_prompts: [],
    seo_targets: { keywords: [], meta_direction: '' }, open_questions: [], confidence_notes: 'Selected source import; no research or generation performed',
    inherited_provenance: brief.research_packet_ref, handoff: brief.handoff }, { site_id });
  packet.site_id = site_id;
  packet.inherited_provenance = brief.research_packet_ref;
  packet.handoff = brief.handoff;
  writePacket({ paths, site_id, packet });
  return { value: packet, inputs: [{ ref: 'selected-handoff', content: JSON.stringify(brief) }],
    outputs: [{ ref: `packets/${site_id}/${packet.packet_id}.json`, content: JSON.stringify(packet) }],
    agent: 'selected-artifact-import', usage: { input_tokens: 0, output_tokens: 0 }, cost_estimate: { amount_usd: 0, currency: 'usd' } };
}
