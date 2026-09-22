import { decodeSourceExport } from './source-export-wire.js';
import { digest, stagingError } from './staging-store.js';
import { validateShellAuthority } from './legacy-shared-shell.js';

// A delayed agency callback does not erase locally verified completed work.
// This execution projection never replaces the signed packet or receipt identity.
export async function reconcileCompletedSelection(packet, files, fetchSource, resolveCompleted, readMappedArtifact) {
  const completed = await resolveCompleted?.(packet);
  if (!completed) return packet;
  const execution = structuredClone(packet), c = execution.continuation;
  const source = decodeSourceExport(completed.source_export), reused = [];
  for (const file of source.files) {
    if (c.files.some(f => f.path === file.path)) continue;
    // Already verified against the exact owner-mandated derivative by the
    // source resolver. The immutable selected bundle remains unchanged.
    if (completed.credit_projection?.added.some(f => f.path === file.path)) continue;
    const step = c.recipe?.steps.find(s => s.path === file.path), prior = completed.mapping.completed_steps?.[file.path];
    if (c.recipe?.id !== 'legacy-shared-shell-v1' || !step || !prior) throw stagingError('completed_page_reconciliation_unsupported');
    const records = {};
    for (const kind of ['template', 'content', 'permission']) {
      const artifact = packet.artifacts.find(a => a.path === step[`${kind}_source_path`]);
      records[kind] = await fetchSource({ ...artifact, url: step[`${kind}_url`] });
    }
    const selected = files.find(f => f.path === c.files.find(f => f.source_path === step.selected_source_path)?.path);
    const validated = validateShellAuthority({ selectedBytes: selected.bytes, templateBytes: records.template, contentBytes: records.content, permissionBytes: records.permission, step });
    const identity = { content_record_id: validated.content.record_id, fields_sha256: digest(validated.content.fields), selected_sha256: validated.selectedHash,
      template_sha256: validated.templateHash, component_ids: step.component_ids, design_contract_sha256: step.design_contract_sha256 };
    if (JSON.stringify(identity) !== JSON.stringify(prior)) throw stagingError('completed_page_copy_requires_edit_recipe');
    const source_path = `next-source/${source.run_id}/${file.path}`;
    execution.artifacts.push({ role: 'source_material', path: source_path, bytes: file.bytes, sha256: file.sha256 });
    c.files.push({ path: file.path, source_path, source_origin: 'mapped_repository', rights: step.rights });
    reused.push(file.path);
    const resolved = new Set(step.resolves_change_ids || []);
    c.requested_changes = (c.requested_changes || []).filter(change => !resolved.has(change.id));
    c.recipe.steps = c.recipe.steps.filter(s => s !== step);
  }
  c.source_export_sha256 = completed.source_export.sha256;
  // Exact mapped-reader validation now sees the complete original manifest.
  for (const name of reused) files.push({ path: name, bytes: await readMappedArtifact(execution, c.files.find(f => f.path === name)) });
  if (!c.recipe?.steps.length) { delete c.recipe; c.operation = 'package_existing'; }
  execution.local_source_reconciliation = { source_export_sha256: c.source_export_sha256, reused_pages: reused };
  return execution;
}
