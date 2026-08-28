// Platform module: registry passthrough and proofs projection.
// Used to also serve /api/media and /api/components as a raw listing of the
// (empty, unused) studio-owned media/components roots -- replaced by the
// dedicated media/components kernel modules, which project real portfolio
// data (images actually found in imported sites, section types actually
// used) instead. See server/modules/media/ and server/modules/components/.
import fs from 'node:fs';
import { projectProofs } from '../../kernel/proofs.js';

export default {
  name: 'platform',
  register({ app, paths, events, registry }) {
    // The registry and proofs endpoints read global state (the static
    // platform registry, or whatever a future proofs adapter reads from
    // connections) -- not site state, so convention 5 does not require
    // site_id on these. Declared `scope: 'global'` rather than inheriting
    // the site-scoped default.
    app.route('GET', '/api/platform/registry', async () => ({
      status: 200,
      body: { entries: registry.all() },
    }), { scope: 'global' });

    // Proofs (plan 3.5, Decision 3): READ-ONLY pipeline visibility over real
    // integration events on the event spine. GET only -- see
    // tests/kernel-proofs.test.js for the assertion that no mutating route
    // exists under /api/proofs. dispatch, approval, and edit-before-send stay
    // in the famtasticdesigns repo; this route never writes anything and never
    // calls out to that repo, it only projects <events root>/<site_id>.jsonl.
    app.route('GET', '/api/proofs', async () => ({
      status: 200,
      body: projectProofs({ fs, paths, events, registry }),
    }), { scope: 'global' });
  },
};
