// Platform registry (plan 2.4). Peer platforms integrate through one declared entry.
import { discoverLibrary } from './library-discovery.js';
const ENTRIES = [
  { id: 'connections', name: 'Connections', status: 'seam', nav: 'proofs', jump_off: null,
    card_types: ['proof_status'], status_projection: { proof_ready: 'ready for review', proof_delivered: 'delivered' },
    authority: 'famtasticdesigns repo owns proof approval and dispatch' },
  { id: 'media-studio', name: 'Media Studio', status: 'seam', nav: 'media', jump_off: null,
    card_types: [], status_projection: {}, authority: 'Media Studio owns the independent media catalog; full platform planned' },
  { id: 'component-studio', name: 'Component Studio', status: 'seam', nav: 'components', jump_off: null,
    card_types: [], status_projection: {}, authority: 'Component Studio owns reusable packages and recipes; full platform planned' },
  { id: 'marketing-studio', name: 'Marketing Studio', status: 'planned', nav: null, jump_off: null,
    card_types: [], status_projection: {}, authority: 'contract documented only' },
  { id: 'research-center', name: 'Research Center', status: 'planned', nav: null, jump_off: null,
    card_types: [], status_projection: {}, authority: 'adapter slot reserved in research source adapters' },
];

export function createRegistry({ paths } = {}) {
  function entry(value) {
    if (!['component-studio', 'media-studio'].includes(value.id)) return { ...value };
    const library = discoverLibrary({ id: value.id, paths });
    return { ...value, library_state: library.status, library_available: library.status === 'available', platform_complete: false, jump_off: library.repository_url || null };
  }
  return {
    all: () => ENTRIES.map(entry),
    byId: (id) => { const e = ENTRIES.find((x) => x.id === id); return e ? entry(e) : null; },
    forPage: (pageId) => ENTRIES.filter((e) => e.nav === pageId).map(entry),
  };
}
