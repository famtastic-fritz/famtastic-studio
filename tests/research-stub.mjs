// Deterministic research plumbing for tests.
//
// The real shay-native adapter spawns the claude CLI with WebSearch and WebFetch
// and then independently re-fetches every source it cites. That takes roughly
// 100 seconds and depends on the network, so a test must never do it.
//
// spawnImpl must return a CHILD PROCESS shape, not a result object: runCli wires
// listeners onto child.stdout/stderr and waits for 'close'. Returning a plain
// object made runCli wait for events that never came, so the stub "worked" only
// by timing out after the real CLI had already run.
import { EventEmitter } from 'node:events';

function fakeChild({ code = 0, stdout = '', stderr = '' }) {
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.kill = () => {};
  setImmediate(() => {
    if (stdout) child.stdout.emit('data', Buffer.from(stdout));
    if (stderr) child.stderr.emit('data', Buffer.from(stderr));
    child.emit('close', code);
  });
  return child;
}

const STUB_RESPONSE = JSON.stringify({
  facts: [],
  brand: { voice: 'stubbed', palette_direction: 'stubbed', type_direction: 'stubbed', imagery_direction: 'stubbed' },
  // Deliberately empty: real research ENRICHES a brief, it does not erase it.
  // Returning fixed site_needs here overwrote the brief's own offers and pages,
  // which made a passing pipeline look like it had dropped the customer's input.
  site_needs: {},
  component_needs: [],
  media_prompts: [],
  seo_targets: { keywords: [], meta_direction: 'stubbed' },
  open_questions: ['stubbed research: no live lookup was performed in this test'],
  confidence_notes: 'stubbed adapter used in tests; nothing here was researched',
});

// Builds stub options. By default the CLI returns no facts and the fetch
// confirms nothing, so any claim carrying a source is honestly demoted. Tests
// that need the verified path pass verifySources: true; tests that need brief
// content to reach the page let the stub echo the prompt's own brief back.
/**
 * @param opts.mediaPrompts  declare media prompts so the IMAGERY stage actually
 *   runs. It defaults to none, and that default meant imagery was skipped in
 *   every pipeline test for as long as it has existed: the executor guards on
 *   `media_slots.length`, an empty stub yields zero slots, and the stage was
 *   never entered. Verified empirically 2026-08-25 -- fetch was never called and
 *   no preflight was ever recorded. Same shape as the copy-stage bypass.
 */
export function makeResearchStub({ facts = [], verifySources = false, echoPrompt = true, mediaPrompts = [] } = {}) {
  return {
    commandExistsImpl: () => true,
    timeoutMs: 2000,
    spawnImpl: (_command, args = []) => {
      const prompt = Array.isArray(args) ? args.join(' ') : String(args);
      const body = JSON.parse(STUB_RESPONSE);
      // Research emits {slot, prompt}; accept plain strings here for brevity.
      if (mediaPrompts.length) {
        body.media_prompts = mediaPrompts.map((m, i) => (typeof m === 'string' ? { slot: `slot-${i + 1}`, prompt: m } : m));
      }
      body.facts = facts;
      if (echoPrompt) {
        // Carry the brief's own words through, so a test can assert that real
        // brief content reaches the composed page rather than a fixed fixture.
        body.confidence_notes = `stubbed adapter; brief text seen by the prompt: ${prompt.slice(0, 400)}`;
      }
      return fakeChild({ code: 0, stdout: JSON.stringify(body) });
    },
    fetchImpl: async () => (verifySources
      ? { ok: true, status: 200, headers: new Map([['content-type', 'text/html']]), text: async () => '<html>stub source</html>' }
      : { ok: false, status: 599, headers: new Map(), text: async () => '' }),
  };
}

export const stubResearchOptions = makeResearchStub();
