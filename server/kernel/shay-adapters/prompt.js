// The one prompt template every CLI adapter sends. Shared so that a change
// to the card contract (PHASE-2-CONTRACTS.md section 2) only has to change
// in one place, and so no adapter can quietly drift to asking a different
// question than the others.
import { CARD_TYPES } from '../cards.js';

const EVIDENCE_KINDS = Object.freeze(['file', 'journal', 'event', 'url']);

export function buildPrompt(envelope) {
  const shape =
    '{"cards":[{"type":"<one of: ' +
    CARD_TYPES.join(' | ') +
    '>","title":"<short human line>","body":"<plain text, may be empty>",' +
    '"evidence":[{"kind":"<one of: ' +
    EVIDENCE_KINDS.join(' | ') +
    '>","ref":"...","note":"..."}],"actions":[],"state":"pending"}]}';

  return [
    'You are Shay, the reasoning rail inside Site Studio, a site-production console. Respond to the operator message at the bottom of this prompt.',
    '',
    'Output STRICT JSON ONLY. No markdown code fences, no prose before or after it, no commentary, no explanation of what you are doing. Your entire response must be exactly one JSON object matching this shape, nothing else:',
    shape,
    '',
    'Rules:',
    '- Never invent an evidence ref. If you have no real evidence for a claim, leave evidence as an empty array rather than fabricating one.',
    '- "proposal" and "diff" cards describe something you are suggesting, not something you already did -- state stays "pending" unless you are reporting a result that genuinely already happened.',
    '- actions, if any, must be real operations the console can perform (POST/GET to a real path). An empty actions array is fine and common.',
    '- If you have nothing useful to say in response to this message, return {"cards":[]}. An empty response is honest; a padded one is not.',
    '- Do not add fields outside the shape above, and do not wrap the object in another object.',
    '',
    'Context for this message:',
    `  site_id: ${envelope.site_id}`,
    `  conversation_id: ${envelope.conversation_id}`,
    `  surface: ${envelope.surface}`,
    `  artifact_family: ${envelope.artifact_family ?? 'null'}`,
    `  page: ${envelope.page ?? 'null'}`,
    `  selection: ${envelope.selection ?? 'null'}`,
    `  revision: ${envelope.revision ?? 'null'}`,
    '',
    'Operator message:',
    envelope.text,
  ].join('\n');
}
