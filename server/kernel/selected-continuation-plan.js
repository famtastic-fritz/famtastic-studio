import { digest, stagingError } from './staging-store.js';
import { safePublicPath } from './staging-contract.js';
import { assembleLegacySharedShell } from './legacy-shared-shell.js';
const escape = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
// Deliberately narrow executable recipe: fill authored text slots in a selected,
// hash-bound HTML template. No provider, inferred copy, new visual system or
// application behavior. Existing selected pages are never targets of a step.
export function continuationPlanErrors(packet) {
  const c = packet.continuation, recipe = c.recipe;
  if (c.operation !== 'continue_build') return recipe ? ['recipe_requires_continuation'] : [];
  if (!['selected-html-slots-v1', 'legacy-shared-shell-v1'].includes(recipe?.id) || !Array.isArray(recipe.steps) || !recipe.steps.length) return ['continuation_recipe_required'];
  const errors = [], paths = new Set(c.files.map(f => f.path)), portablePaths = new Set(c.files.map(f => f.path.toLowerCase())), resolved = new Set();
  for (const step of recipe.steps) {
    const shell = recipe.id === 'legacy-shared-shell-v1';
    if (step.stage !== (shell ? 'assemble_selected_shell' : 'fill_selected_template') || !safePublicPath(step.path) || !step.path.endsWith('.html') || portablePaths.has(step.path.toLowerCase()) || shell && (step.path.includes('/') || !c.required_pages.includes(step.path))) errors.push('continuation_target_invalid');
    paths.add(step.path);
    if (typeof step.path === 'string') portablePaths.add(step.path.toLowerCase());
    if (step.design_contract_sha256 !== digest(c.brand?.design_contract || {})) errors.push('continuation_design_stale');
    if (!packet.artifacts.some(a => a.path === step.template_source_path && a.sha256 === step.template_sha256 && a.role === 'source_material')) errors.push('continuation_template_unbound');
    if (shell) {
      if (step.selected_source_path !== packet.selected_artifacts[0].source_artifact_path || !Array.isArray(step.component_ids) || !step.component_ids.length || new Set(step.component_ids).size !== step.component_ids.length || step.component_ids.some(id => !/^[A-Za-z][A-Za-z0-9_-]*$/.test(id))) errors.push('shell_source_binding_invalid');
      for (const kind of ['content', 'permission']) if (!packet.artifacts.some(a => a.path === step[`${kind}_source_path`] && a.sha256 === step[`${kind}_sha256`] && a.role === 'source_material')) errors.push(`shell_${kind}_record_unbound`);
      if (step.shared_style_source_path && (!packet.artifacts.some(a => a.path === step.shared_style_source_path && a.sha256 === step.shared_style_sha256) || !c.files.some(f => f.source_path === step.shared_style_source_path && f.path === step.shared_style_public_path))) errors.push('shell_shared_style_unbound');
    } else if (!step.slots || !Object.keys(step.slots).length || Object.entries(step.slots).some(([k, v]) => !/^[A-Z_]+$/.test(k) || typeof v !== 'string')) errors.push('continuation_slots_invalid');
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
    if (packet.continuation.recipe.id === 'legacy-shared-shell-v1') {
      const sourceFile = packet.continuation.files.find(f => f.source_path === step.selected_source_path);
      const selected = files.find(f => f.path === sourceFile.path);
      const recordsByKind = {};
      for (const kind of ['content', 'permission']) {
        const artifact = packet.artifacts.find(a => a.path === step[`${kind}_source_path`]);
        recordsByKind[kind] = await fetchSource({ ...artifact, url: step[`${kind}_url`] });
      }
      const styleFile = packet.continuation.files.find(f => f.source_path === step.shared_style_source_path);
      const assembled = assembleLegacySharedShell({ selectedBytes: selected.bytes, templateBytes: bytes,
        contentBytes: recordsByKind.content, permissionBytes: recordsByKind.permission, step,
        sharedStyleBytes: styleFile ? files.find(f => f.path === styleFile.path)?.bytes : null });
      files.push({ path: step.path, bytes: assembled.bytes });
      records.push({ ...assembled.lineage, content_source_path: step.content_source_path, permission_source_path: step.permission_source_path, template_source_path: step.template_source_path });
      continue;
    }
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
