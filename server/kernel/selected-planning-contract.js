import { stagingPacketErrors } from './staging-contract.js';
import { digest } from './staging-store.js';
export const PLANNING_SCHEMA = 'famtastic.site-studio.planning-packet.v1';
export function planningPacketErrors(packet) {
  const errors = stagingPacketErrors({ ...packet, schema: 'famtastic.site-studio.build-packet.v1', build_class: 'prepayment_selected_direction_staging' });
  const i = packet?.intent, c = packet?.continuation;
  if (packet?.schema !== PLANNING_SCHEMA || packet.build_class !== 'selected_direction_remaining_work') errors.push('planning.schema');
  if (i?.schema !== 'famtastic.selected-source-intent.v1' || i.operation !== 'plan_remaining_work') errors.push('planning.intent');
  if (i?.project_id !== packet?.project_id || i?.request_id !== packet?.request_id || !i?.customer_id || i.customer_id !== c?.customer?.id
    || i.website_request_id !== c?.website_request_id || !Number.isSafeInteger(c?.website_request_id) || c.website_request_id < 1
    || i.selection?.revision !== c?.selection_revision || !Number.isSafeInteger(c?.selection_revision) || c.selection_revision < 1
    || `direction-${i.selection?.direction_id}` !== packet?.selected_direction_ids?.[0]) errors.push('planning.identity');
  if (!Array.isArray(i?.source?.artifacts) || !Array.isArray(packet?.artifacts) || digest(i.source.artifacts) !== digest(packet.artifacts) || !i.scope || !Array.isArray(i.requested_changes) || !Array.isArray(i.issues)) errors.push('planning.source');
  return [...new Set(errors)];
}
