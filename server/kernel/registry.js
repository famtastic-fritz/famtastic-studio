// Platform registry (plan 2.4). Peer platforms integrate through one declared entry.
const ENTRIES = [
  { id: 'connections', name: 'Connections', status: 'seam', nav: 'proofs', jump_off: null,
    card_types: ['proof_status'], status_projection: { proof_ready: 'ready for review', proof_delivered: 'delivered' },
    authority: 'famtasticdesigns repo owns proof approval and dispatch' },
  { id: 'media-studio', name: 'Media Studio', status: 'planned', nav: 'media', jump_off: null,
    card_types: [], status_projection: {}, authority: 'media library ownership pending platform' },
  { id: 'component-studio', name: 'Component Studio', status: 'planned', nav: 'components', jump_off: null,
    card_types: [], status_projection: {}, authority: 'component library ownership pending platform' },
  { id: 'marketing-studio', name: 'Marketing Studio', status: 'planned', nav: null, jump_off: null,
    card_types: [], status_projection: {}, authority: 'contract documented only' },
  { id: 'research-center', name: 'Research Center', status: 'planned', nav: null, jump_off: null,
    card_types: [], status_projection: {}, authority: 'adapter slot reserved in research source adapters' },
];

export function createRegistry() {
  return {
    all: () => ENTRIES.map((e) => ({ ...e })),
    byId: (id) => { const e = ENTRIES.find((x) => x.id === id); return e ? { ...e } : null; },
    forPage: (pageId) => ENTRIES.filter((e) => e.nav === pageId).map((e) => ({ ...e })),
  };
}
