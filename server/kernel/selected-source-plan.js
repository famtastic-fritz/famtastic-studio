import { decodeSourceExport } from './source-export-wire.js';

// Planning accepts incomplete inherited evidence; execution and ready receipts do not.
export function planSelectedSource(intent, sourceExport = null) {
  if (intent?.schema !== 'famtastic.selected-source-intent.v1') throw new Error('selected_source_intent_invalid');
  const issues = [...(intent.issues || [])];
  const changes = (intent.requested_changes || []).filter(change => change.status !== 'resolved');
  const snapshot = intent.scope?.snapshot || {};
  const interactive = ['required_features', 'integrations', 'booking_details', 'ecommerce_details', 'custom_needs'].filter(key => String(snapshot[key] || '').trim());
  if (interactive.length) issues.push({ stage: 'build', code: 'scope_features_require_recipe', fields: interactive, owner: 'next' });
  if (changes.length) issues.push({ stage: 'build', code: 'requested_revisions_pending', owner: 'next' });
  if (!sourceExport) issues.push({ stage: 'build', code: 'selected_preserving_executor_required', owner: 'next' });
  else {
    try {
      if (!decodeSourceExport(sourceExport).scope_complete) issues.push({ stage: 'build', code: 'source_scope_incomplete', owner: 'next' });
    } catch { issues.push({ stage: 'materialize', code: 'source_export_digest_mismatch', owner: 'next' }); }
  }
  return { schema: 'famtastic.selected-source-plan.v1', intent_id: intent.intent_id,
    operation: 'continue_build', source_artifacts: intent.source.artifacts,
    provenance: { status: 'inherited', design_dna_sha256: intent.source.design_dna_sha256 },
    requested_scope: intent.scope, pending_changes: changes, issues,
    executable: false, ready: false };
}
