// Stage executors: the actual work each pipeline stage performs.
//
// Split out of pipeline.js, which crossed the no-monolith limit. This module
// owns WHAT a stage does; pipeline.js owns the sequencing, DNA recording and
// failure handling around it.
import path from 'node:path';
import { importSelectedProvenance } from './selected-provenance.js';
import fs from 'node:fs';
import { REQUIRED_FILES } from '../../vendor/site-foundation/index.js';
import { deriveSpecFromPacket } from './spec-derive.js';
import { composeSite } from './compose.js';
import { verifySite } from './verify.js';
import { runResearch } from './research.js';
import { fillMediaSlots } from './imagery.js';
import { writeCopy } from './copy.js';
import { directLayout } from './layout-archetypes.js';
import { DEFAULT_COPY_CONCURRENCY, MAX_COPY_CONCURRENCY } from './pipeline-constants.js';
import { resolveProvider as resolveShayAdapter } from './shay.js';
import { checkBrandVoice } from './brand-voice.js';

function fail(statusCode, code, message) {
  return Object.assign(new Error(message), { statusCode, code });
}

export function makeExecutors({ paths, journal, events, mutation, spec, researchOptions = {}, imageryOptions = {}, copyOptions = {}, repositories }) {
  return {
    // Async since the shay-native adapter became real: it spawns a CLI that
    // searches and fetches, then independently re-fetches every cited source
    // before trusting it. Calling it without await previously handed the next
    // stage a Promise, which a spec derivation would happily treat as an empty
    // packet and never notice.
    research: async ({ site_id, brief, adapter, raw_import, initiator }) => {
      if (brief.handoff) return importSelectedProvenance({ paths, site_id, brief });
      // runResearch takes a NESTED options object. Spreading these at the top level
      // silently left options undefined, so the real CLI ran even when a caller
      // had injected stubs -- a failure that looked like slowness, not a bug.
      const packet = await runResearch({ paths, journal, events, site_id, adapter, brief, raw_import, initiator, options: researchOptions });
      const outputs = [{ ref: `packets/${site_id}/${packet.packet_id}.json`, content: JSON.stringify(packet) }];
      return { value: packet, inputs: [{ ref: 'brief', content: JSON.stringify(brief) }], outputs };
    },
    spec: async ({ site_id, packet, brief, initiator, repository_session }) => {
      if (!packet) throw fail(400, 'packet_missing', 'cannot run the spec stage without a completed research stage');
      let derivedSpec = deriveSpecFromPacket({ packet, brief, site_id });
      const foundationOutputs = repositories.bootstrap(repository_session, brief, derivedSpec);

      // Imagery runs here, after slots are declared and before the spec is
      // persisted, so the stored spec is the truth about what exists on disk.
      // A generator failure never fails the stage: slots stay declared-unfilled
      // with a reason, which is a legitimate outcome, not an error.
      if (!brief.handoff && Array.isArray(derivedSpec.media_slots) && derivedSpec.media_slots.length) {
        const filled = await fillMediaSlots({
          slots: derivedSpec.media_slots, paths, site_id, ...(imageryOptions || {}),
        });
        derivedSpec.media_slots = filled.slots;
        derivedSpec.media_summary = { ...derivedSpec.media_summary, ...filled.summary };
        derivedSpec.imagery_preflight = filled.preflight;
      }

      // The copy stage. Sections arrive from derivation carrying an
      // `instruction` and a NULL body, because the half of a research section
      // string after the colon is a note to a writer, not the writing. This is
      // where a writer turns it into prose.
      //
      // Like imagery, a failure here never fails the stage. Sections keep a
      // null body and render empty, which is honest. The alternative — letting
      // the instruction through as copy — is what published five sites' own
      // outlines to customers.
      const copyAdapter = brief.handoff ? null : copyOptions.adapter ?? resolveShayAdapter({ paths, spawnImpl: copyOptions.spawnImpl, commandExistsImpl: copyOptions.commandExistsImpl });
      if (copyAdapter && Array.isArray(derivedSpec.pages)) {
        // Pages are INDEPENDENT: each call writes only its own page's sections,
        // so nothing is shared and ordering does not matter. Running them
        // serially cost 266-338s on an eight-page build. Bounded fan-out, the
        // same shape as the batch win, because an unbounded one would put eight
        // live CLI processes on the operator's machine at once.
        const pending = derivedSpec.pages.filter(
          (page) => (page.sections || []).some((sec) => sec && sec.instruction && !sec.body),
        );
        const limit = Math.max(1, Math.min(
          Number(copyOptions.concurrency) || DEFAULT_COPY_CONCURRENCY,
          MAX_COPY_CONCURRENCY,
        ));
        const copySummaries = [];
        let cursor = 0;
        async function worker() {
          for (;;) {
            const page = pending[cursor++];
            if (!page) return;
            try {
              const written = await writeCopy({
                business: derivedSpec.business || brief?.business || {},
                page, sections: page.sections, adapter: copyAdapter,
                spawnImpl: copyOptions.spawnImpl, timeoutMs: copyOptions.timeoutMs,
              });
              // Each worker mutates only the page it owns.
              page.sections = written.sections;
              copySummaries.push({ page: page.id, ...written.summary });
            } catch (error) {
              copySummaries.push({ page: page.id, failed: true, reason: error.code || error.message });
            }
          }
        }
        const startedAt = Date.now();
        await Promise.all(Array.from({ length: Math.min(limit, pending.length) }, worker));
        if (copySummaries.length) {
          // Stable order for the record; completion order is nondeterministic.
          const order = new Map(derivedSpec.pages.map((p, i) => [p.id, i]));
          copySummaries.sort((a, b) => (order.get(a.page) ?? 0) - (order.get(b.page) ?? 0));
          derivedSpec.copy_summary = copySummaries;
          derivedSpec.copy_run = { pages: pending.length, concurrency: limit, duration_ms: Date.now() - startedAt };
        }
      }

      // The creative director selects the layout archetype and writes it INTO
      // the sections, so compose cannot render a default it was never told to
      // reconsider. Runs after copy and imagery so it can see what the page
      // actually has: section count, images declared, lists present.
      if (!brief.handoff) derivedSpec = directLayout({ spec: derivedSpec, packet });

      const writeResult = spec.write(site_id, derivedSpec, { initiator });
      const inputs = [{ ref: `packets/${site_id}/${packet.packet_id}.json`, content: JSON.stringify(packet) }];
      const outputs = [{ ref: 'spec.json', content: JSON.stringify(derivedSpec) }, ...foundationOutputs];
      return { value: derivedSpec, inputs, outputs, evidence_ref: writeResult.journal_entry_id };
    },
    compose: ({ derivedSpec, composer }) => {
      if (!derivedSpec) throw fail(400, 'spec_missing', 'cannot run the compose stage without a persisted spec');
      const composed = composeSite({ spec: derivedSpec, composer });
      const outputs = [
        ...composed.pages.map((p) => ({ ref: p.path, content: p.html })),
        ...composed.assets.map((a) => ({ ref: a.path, content: a.contents })),
      ];
      const inputs = [{ ref: 'spec.json', content: JSON.stringify(derivedSpec) }];

      // The first machine-readable quality signal. Deterministic by design: a
      // model judging another model's brand compliance shares its blind spot.
      // A violation does NOT fail the stage -- it is recorded so an operator
      // (and, later, the suggestion layer) can see it. Failing the build on a
      // word choice would be a worse trade than shipping it visibly flagged.
      const voiceCheck = checkBrandVoice({
        copy: composed.pages.map((pg) => ({ path: pg.path, html: pg.html })),
        brand: derivedSpec.brand,
      });

      return {
        value: composed,
        agent: composed.composer,
        inputs,
        outputs,
        verification: {
          passed: voiceCheck.passed,
          checks: [{
            name: 'brand_voice_compliance',
            passed: voiceCheck.passed,
            vacuous: voiceCheck.vacuous,
            terms_checked: voiceCheck.terms_checked,
            fields_checked: voiceCheck.fields_checked,
          }],
          errors: voiceCheck.violations.map((v) => `brand voice: "${v.term}" appears in ${v.where} -- ${v.context}`),
        },
      };
    },
    build: ({ site_id, composed, initiator, repository_session }) => {
      if (!composed) throw fail(400, 'composed_missing', 'cannot run the build stage without composed page artifacts');
      const protectedPaths = new Set([...REQUIRED_FILES, 'robots.txt', 'sitemap.xml', 'package.json', 'package-lock.json', 'tests/site-contract.test.mjs', '.famtastic/preview.mjs', '.famtastic/public-boundary.mjs', '.famtastic/build.mjs', '.github/workflows/verify.yml', 'docs/STATIC-BUILD.md']);
      const changes = [
        ...composed.pages.map((p) => ({ path: p.path, contents: p.html })),
        ...composed.assets.map((a) => ({ path: a.path, contents: a.contents })),
      ].filter(change => !protectedPaths.has(change.path) || !fs.existsSync(path.join(repository_session.dir, change.path)));
      if (repository_session.initialized) {
        for (let i = changes.length - 1; i >= 0; i--) {
          const file = paths.within('sites', site_id, changes[i].path);
          if (fs.existsSync(file) && fs.readFileSync(file).equals(Buffer.from(changes[i].contents))) changes.splice(i, 1);
        }
      }
      repository_session.generated = changes.map(change => change.path);
      if (!changes.length) return { value: { status: 'already_materialized' }, inputs: composed.pages.map(p => ({ ref: p.path, content: p.html })), outputs: [], verification: { passed: true, reason: 'existing bytes match selected output' } };
      const result = mutation.apply({ site_id, initiator, intent: 'pipeline.build', changes });
      const refs = changes.map((c) => ({ ref: c.path, content: c.contents }));
      return { value: result, inputs: refs, outputs: refs, evidence_ref: result.journal_entry_id };
    },
    verify: async ({ site_id, composed }) => {
      if (!composed) throw fail(400, 'composed_missing', 'cannot run the verify stage without composed page artifacts');
      const resolved = paths.resolveSite(site_id, { createIfMissing: true });
      const siteDir = resolved.dir;
      const result = await verifySite({ siteDir, pages: composed.pages });
      if (!result.passed) {
        const err = new Error(`verification failed: ${result.errors.join('; ')}`);
        err.code = 'verify_failed';
        err.verification = result;
        throw err;
      }
      const inputs = composed.pages.map((p) => ({ ref: p.path, content: p.html }));
      return { value: result, verification: { passed: true, checks: result.checks }, verifier_version: 'playwright-1', inputs };
    },
  };
}
