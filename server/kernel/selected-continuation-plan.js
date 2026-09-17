import { digest, stagingError } from './staging-store.js';
import { safePublicPath } from './staging-contract.js';
const escape = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
// Deliberately narrow executable recipe: fill authored text slots in a selected,
// hash-bound HTML template. No provider, inferred copy, new visual system or
// application behavior. Existing selected pages are never targets of a step.
export function continuationPlanErrors(packet) {
  const c = packet.continuation, recipe = c.recipe;
  if (c.operation !== 'continue_build') return recipe ? ['recipe_requires_continuation'] : [];
  if (recipe?.id !== 'selected-html-slots-v1' || !Array.isArray(recipe.steps) || !recipe.steps.length) return ['continuation_recipe_required'];
  const errors = [], paths = new Set(c.files.map(f => f.path)), resolved = new Set();
  for (const step of recipe.steps) {
    if (step.stage !== 'fill_selected_template' || !safePublicPath(step.path) || !step.path.endsWith('.html') || paths.has(step.path)) errors.push('continuation_target_invalid');
    paths.add(step.path);
    if (step.design_contract_sha256 !== digest(c.brand?.design_contract || {})) errors.push('continuation_design_stale');
    if (!packet.artifacts.some(a => a.path === step.template_source_path && a.sha256 === step.template_sha256 && a.role === 'source_material')) errors.push('continuation_template_unbound');
    if (!step.slots || !Object.keys(step.slots).length || Object.entries(step.slots).some(([k, v]) => !/^[A-Z_]+$/.test(k) || typeof v !== 'string')) errors.push('continuation_slots_invalid');
    if (step.rights?.status !== 'approved' || !step.rights?.evidence_ref) errors.push('continuation_rights_missing');
    for (const id of step.resolves_change_ids || []) resolved.add(id);
  }
  for (const change of c.requested_changes || []) if (!change.id || !resolved.has(change.id)) errors.push('requested_revision_not_implemented');
  for (const path of c.required_pages) if (!paths.has(path)) errors.push('scope_incomplete');
  return errors;
}
export async function executeContinuationPlan(packet, files, fetchSource) {
  const errors = continuationPlanErrors(packet);
  if (errors.length) throw Object.assign(stagingError('continuation_plan_unsupported'), { permanent: true, details: errors });
  const records = [];
  for (const step of packet.continuation.recipe?.steps || []) {
    const source = packet.artifacts.find(a => a.path === step.template_source_path);
    const bytes = await fetchSource({ ...source, url: step.template_url });
    const template = bytes.toString('utf8');
    const names = [...template.matchAll(/\{\{([A-Z_]+)\}\}/g)].map(m => m[1]);
    if (!names.length || names.some(n => !(n in step.slots)) || Object.keys(step.slots).some(n => !names.includes(n))) throw stagingError('continuation_slots_mismatch');
    for (const match of template.matchAll(/\{\{([A-Z_]+)\}\}/g)) {
      const before = template.slice(0, match.index);
      if (before.lastIndexOf('<') > before.lastIndexOf('>') || /<(script|style|textarea)\b[^>]*>[^]*$/i.test(before.replace(/<(script|style|textarea)\b[^>]*>[^]*?<\/\1>/gi, ''))) throw stagingError('continuation_slot_context_invalid');
    }
    const output = Buffer.from(template.replace(/\{\{([A-Z_]+)\}\}/g, (_, key) => escape(step.slots[key])));
    files.push({ path: step.path, bytes: output });
    records.push({ stage: step.stage, recipe: 'selected-html-slots-v1', path: step.path, input_sha256: digest(bytes), input_content_base64: bytes.toString('base64'), output_sha256: digest(output), design_contract_sha256: step.design_contract_sha256, slots_sha256: digest(step.slots), status: 'passed', generation_provider_calls: 0 });
  }
  return records;
}
