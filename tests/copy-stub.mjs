// Deterministic copy plumbing for tests.
//
// The copy stage spawns a CLI once PER PAGE. A real build of eight pages makes
// eight calls, so a test must never do it.
//
// This stub existed nowhere until 2026-08-25, and the pipeline tests passed
// without it for a reason worth recording: derivation used to write `body`
// directly on the fallback path, and writeCopy only fills a section whose body
// is falsy. Every section arrived pre-filled, so the copy stage was skipped
// entirely and the tests never exercised it. Removing that bypass -- the same
// bypass that published "Opening statement" as a hero -- made fourteen tests
// reach for the real CLI and time out. The bypass had been hiding the stage.
//
// spawnImpl must return a CHILD PROCESS shape (see research-stub.mjs).
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

/**
 * makeCopyStub: returns copyOptions for createPipeline.
 *
 * By default it answers every requested section with prose that is deliberately
 * NOT a reflow of the instruction, so the echo guard passes and the test is
 * exercising the happy path rather than the rejection path.
 *
 * @param {object} opts
 * @param {boolean} opts.echo   answer by echoing the instruction back, to prove
 *                              the guard rejects it
 * @param {boolean} opts.empty  answer with no sections, to prove an unwritten
 *                              body renders empty rather than inventing text
 * @param {boolean} opts.unparseable  answer with non-JSON
 */
export function makeCopyStub({ echo = false, empty = false, unparseable = false } = {}) {
  const spawnImpl = (_command, args = []) => {
    if (unparseable) return fakeChild({ stdout: 'I am afraid I cannot do that.' });
    if (empty) return fakeChild({ stdout: JSON.stringify({ sections: [] }) });

    // Recover the ids the prompt asked about. The prompt embeds each section's
    // id and instruction; answering only what was asked keeps the stub honest
    // about which sections the stage actually requested.
    // The prompt lists sections as:
    //   1. id="hero"
    //      WHAT THIS SECTION MUST COVER: <instruction>
    const prompt = String(args[args.length - 1] || '');
    const asked = [...prompt.matchAll(/id="([^"]+)"\s*\n\s*WHAT THIS SECTION MUST COVER:\s*(.+)/g)]
      .map((m) => ({ id: m[1], instruction: m[2].trim() }));

    const sections = asked.map(({ id, instruction }) => ({
      id,
      // An echo hands the instruction back, which is exactly what the guard
      // exists to reject.
      body: echo
        ? instruction
        : `Stubbed prose for ${id}. It reads as a finished sentence written for a visitor, not as a note describing what should go here.`,
    }));
    return fakeChild({ stdout: JSON.stringify({ sections }) });
  };

  return { adapter: { command: 'stub-copy-cli', id: 'stub' }, spawnImpl, timeoutMs: 5000 };
}
