// Unit tests for server/kernel/shay-adapters/*. Every CLI invocation is
// stubbed via spawnImpl injection (base.js -> cli-runner.js's runCli) so
// these are fast and deterministic and never touch a real CLI or network --
// the one real end-to-end proof lives outside this suite (manual run against
// the actual `claude` CLI, reported separately). Coverage: adapter
// selection/registry, envelope-to-prompt passing, JSON parsing off noisy
// stdout, card validation and drop-with-reason, timeout, non-zero exit,
// unparseable output, and honest install/auth classification.
import { describe, it, expect, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { getAdapter, ADAPTER_IDS, DEFAULT_ADAPTER_ID } from '../server/kernel/shay-adapters/index.js';
import { createClaudeAdapter } from '../server/kernel/shay-adapters/claude.js';
import { createCodexAdapter } from '../server/kernel/shay-adapters/codex.js';
import { createKimiAdapter } from '../server/kernel/shay-adapters/kimi.js';
import { extractJson } from '../server/kernel/shay-adapters/cli-runner.js';
import { CARD_TYPES } from '../server/kernel/cards.js';

// A fake child_process.ChildProcess: an EventEmitter with .stdout/.stderr
// EventEmitters and a .kill() that simulates the OS eventually delivering a
// 'close' after a signal -- a real killed process does not hang forever, and
// a stub that never resolves would just hang the test instead of proving
// anything about the timeout path.
function makeFakeChild() {
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.kill = vi.fn((signal) => {
    setImmediate(() => child.emit('close', null, signal));
  });
  return child;
}

function closeWith(child, { stdout = '', stderr = '', code = 0, delayMs = 0 } = {}) {
  setTimeout(() => {
    if (stdout) child.stdout.emit('data', Buffer.from(stdout));
    if (stderr) child.stderr.emit('data', Buffer.from(stderr));
    child.emit('close', code, null);
  }, delayMs);
}

const ENVELOPE = Object.freeze({
  site_id: 'site-a',
  conversation_id: 'conv-a',
  surface: 'rail',
  artifact_family: null,
  page: null,
  selection: null,
  revision: null,
  text: 'what should I do next',
  ts: '2026-08-23T00:00:00.000Z',
});

describe('shay-adapters registry', () => {
  it('exposes claude as the default adapter id', () => {
    expect(DEFAULT_ADAPTER_ID).toBe('claude');
  });

  it('lists exactly the four scaffolded adapters', () => {
    // gemini is permanently retired (2026-08-23); its absence here is the assertion.
    expect([...ADAPTER_IDS].sort()).toEqual(['claude', 'codex', 'kimi']);
  });

  it('getAdapter returns null for an unknown id rather than throwing', () => {
    expect(getAdapter('not-a-real-adapter')).toBeNull();
  });

  it('every adapter implements the identical interface shape', () => {
    for (const id of ADAPTER_IDS) {
      const adapter = getAdapter(id);
      expect(adapter.id).toBe(id);
      expect(typeof adapter.displayName).toBe('string');
      expect(typeof adapter.command).toBe('string');
      expect(typeof adapter.isInstalled).toBe('function');
      expect(typeof adapter.isAuthenticated).toBe('function');
      expect(typeof adapter.probe).toBe('function');
      expect(typeof adapter.ask).toBe('function');
    }
  });
});

describe('per-adapter CLI invocation shape (envelope -> real argv)', () => {
  const cases = [
    { factory: createClaudeAdapter, command: 'claude', argv0: '-p' },
    { factory: createCodexAdapter, command: 'codex', argv0: 'exec' },
    { factory: createKimiAdapter, command: 'kimi', argv0: '-p' },
  ];

  for (const { factory, command, argv0 } of cases) {
    it(`${command} adapter spawns "${command}" with the documented argv, stdin closed, and the envelope carried in the prompt`, async () => {
      const spawnImpl = vi.fn((cmd, args) => {
        const child = makeFakeChild();
        closeWith(child, { stdout: JSON.stringify({ cards: [] }) });
        return child;
      });
      const adapter = factory({ spawnImpl, commandExistsImpl: () => true });
      const result = await adapter.ask({ envelope: ENVELOPE, timeoutMs: 2000 });

      expect(spawnImpl).toHaveBeenCalledTimes(1);
      const [calledCommand, calledArgs, opts] = spawnImpl.mock.calls[0];
      expect(calledCommand).toBe(command);
      expect(calledArgs).toHaveLength(2);
      expect(calledArgs[0]).toBe(argv0);
      expect(typeof calledArgs[1]).toBe('string');
      expect(calledArgs[1]).toContain(ENVELOPE.site_id);
      expect(calledArgs[1]).toContain(ENVELOPE.conversation_id);
      expect(calledArgs[1]).toContain(ENVELOPE.text);
      // Several of these CLIs (codex exec in particular) wait on stdin that
      // never arrives unless it is explicitly closed -- verified against
      // this exact regression on the real CLI before writing base.js.
      expect(opts.stdio[0]).toBe('ignore');
      expect(result.ok).toBe(true);
    });
  }
});

describe('adapter.ask: JSON parsing off real-shaped CLI stdout', () => {
  it('parses clean single-line JSON (the verified claude probe shape)', async () => {
    const spawnImpl = () => {
      const child = makeFakeChild();
      closeWith(child, { stdout: '{"cards":[{"type":"plan","title":"probe"}]}\n' });
      return child;
    };
    const adapter = createClaudeAdapter({ spawnImpl, commandExistsImpl: () => true });
    const result = await adapter.ask({ envelope: ENVELOPE });
    expect(result.ok).toBe(true);
    expect(result.cards).toHaveLength(1);
    expect(result.cards[0].type).toBe('plan');
    expect(result.cards[0].title).toBe('probe');
  });

  it('parses JSON wrapped in a markdown fence', async () => {
    const spawnImpl = () => {
      const child = makeFakeChild();
      closeWith(child, { stdout: '```json\n{"cards":[{"type":"success","title":"done"}]}\n```\n' });
      return child;
    };
    const adapter = createClaudeAdapter({ spawnImpl, commandExistsImpl: () => true });
    const result = await adapter.ask({ envelope: ENVELOPE });
    expect(result.ok).toBe(true);
    expect(result.cards[0].title).toBe('done');
  });

  it('pulls the JSON out of noisy output with a leading bullet and reasoning text (the real observed kimi shape)', async () => {
    // This exact shape -- a reasoning line, a blank line, then a
    // bullet-prefixed JSON answer -- is what `kimi -p` actually printed in
    // manual testing; it is not invented for this test.
    const child = makeFakeChild();
    closeWith(child, {
      stdout:
        '• The user wants strict JSON only\n\n' +
        '• {"cards":[{"type":"proposal","title":"stronger headline"}]}\n',
    });
    const adapter = createKimiAdapter({ spawnImpl: () => child, commandExistsImpl: () => true });
    const result = await adapter.ask({ envelope: ENVELOPE });
    expect(result.ok).toBe(true);
    expect(result.cards).toHaveLength(1);
    expect(result.cards[0].title).toBe('stronger headline');
  });

  it('reports unparseable_output honestly when exit is 0 but stdout has no JSON in it', async () => {
    const spawnImpl = () => {
      const child = makeFakeChild();
      closeWith(child, { stdout: 'Sure, here is my answer in plain prose with no JSON at all.' });
      return child;
    };
    const adapter = createClaudeAdapter({ spawnImpl, commandExistsImpl: () => true });
    const result = await adapter.ask({ envelope: ENVELOPE });
    expect(result.ok).toBe(false);
    expect(result.classification).toBe('unparseable_output');
    expect(result.cards).toEqual([]);
    expect(result.raw).toContain('plain prose');
  });
});

describe('adapter.ask: card validation and drop-with-reason', () => {
  it('keeps a valid card and drops an unknown-type candidate, recording why', async () => {
    const spawnImpl = () => {
      const child = makeFakeChild();
      closeWith(child, {
        stdout: JSON.stringify({
          cards: [
            { type: 'plan', title: 'a real plan', body: '', evidence: [], actions: [], state: 'pending' },
            { type: 'not_a_real_type', title: 'bogus' },
          ],
        }),
      });
      return child;
    };
    const adapter = createClaudeAdapter({ spawnImpl, commandExistsImpl: () => true });
    const result = await adapter.ask({ envelope: ENVELOPE });
    expect(result.ok).toBe(true);
    expect(result.cards).toHaveLength(1);
    expect(result.cards[0].title).toBe('a real plan');
    expect(result.dropped).toHaveLength(1);
    expect(result.dropped[0].reason).toMatch(/unknown card type/i);
    expect(result.dropped[0].candidate.title).toBe('bogus');
  });

  it('drops a candidate with a missing title rather than passing it through', async () => {
    const spawnImpl = () => {
      const child = makeFakeChild();
      closeWith(child, { stdout: JSON.stringify({ cards: [{ type: 'plan', title: '' }] }) });
      return child;
    };
    const adapter = createClaudeAdapter({ spawnImpl, commandExistsImpl: () => true });
    const result = await adapter.ask({ envelope: ENVELOPE });
    expect(result.ok).toBe(true);
    expect(result.cards).toEqual([]);
    expect(result.dropped).toHaveLength(1);
    expect(result.dropped[0].reason).toMatch(/title is required/i);
  });

  it('every built card carries the envelope site_id and conversation_id, never a model-supplied one', async () => {
    const spawnImpl = () => {
      const child = makeFakeChild();
      closeWith(child, {
        stdout: JSON.stringify({
          cards: [{ type: 'plan', title: 'x', site_id: 'attacker-site', conversation_id: 'attacker-conv' }],
        }),
      });
      return child;
    };
    const adapter = createClaudeAdapter({ spawnImpl, commandExistsImpl: () => true });
    const result = await adapter.ask({ envelope: ENVELOPE });
    expect(result.cards[0].site_id).toBe(ENVELOPE.site_id);
    expect(result.cards[0].conversation_id).toBe(ENVELOPE.conversation_id);
  });

  it('an empty cards array from the model is honest, not an error', async () => {
    const spawnImpl = () => {
      const child = makeFakeChild();
      closeWith(child, { stdout: '{"cards":[]}' });
      return child;
    };
    const adapter = createClaudeAdapter({ spawnImpl, commandExistsImpl: () => true });
    const result = await adapter.ask({ envelope: ENVELOPE });
    expect(result.ok).toBe(true);
    expect(result.cards).toEqual([]);
    expect(result.dropped).toEqual([]);
  });
});

describe('adapter.ask: failure is first-class, never a fabricated card', () => {
  it('reports timed_out and kills the child when the CLI never responds', async () => {
    const child = makeFakeChild(); // never closes on its own
    const spawnImpl = vi.fn(() => child);
    const adapter = createClaudeAdapter({ spawnImpl, commandExistsImpl: () => true });
    const result = await adapter.ask({ envelope: ENVELOPE, timeoutMs: 30 });
    expect(result.ok).toBe(false);
    expect(result.classification).toBe('timed_out');
    expect(result.cards).toEqual([]);
    expect(child.kill).toHaveBeenCalled();
  });

  it('reports nonzero_exit with stderr context when the CLI exits non-zero', async () => {
    const spawnImpl = () => {
      const child = makeFakeChild();
      closeWith(child, { stderr: 'boom: something broke\n', code: 7 });
      return child;
    };
    const adapter = createClaudeAdapter({ spawnImpl, commandExistsImpl: () => true });
    const result = await adapter.ask({ envelope: ENVELOPE });
    expect(result.ok).toBe(false);
    expect(result.classification).toBe('nonzero_exit');
    expect(result.summary).toMatch(/7/);
    expect(result.cards).toEqual([]);
  });

  it('reports spawn_failed when the CLI cannot even be started', async () => {
    const spawnImpl = () => {
      const child = makeFakeChild();
      setImmediate(() => child.emit('error', new Error('spawn claude ENOENT')));
      return child;
    };
    const adapter = createClaudeAdapter({ spawnImpl, commandExistsImpl: () => true });
    const result = await adapter.ask({ envelope: ENVELOPE });
    expect(result.ok).toBe(false);
    expect(result.classification).toBe('spawn_failed');
    expect(result.summary).toMatch(/ENOENT/);
  });

  it('reports not_installed and never spawns anything when the command is not on PATH', async () => {
    const spawnImpl = vi.fn();
    const adapter = createClaudeAdapter({ spawnImpl, commandExistsImpl: () => false });
    const result = await adapter.ask({ envelope: ENVELOPE });
    expect(result.ok).toBe(false);
    expect(result.classification).toBe('not_installed');
    expect(spawnImpl).not.toHaveBeenCalled();
  });

  it('classifies an IneligibleTierError stderr honestly rather than as a generic error (the classification lives in the shared runner, not in the retired gemini adapter)', async () => {
    const spawnImpl = () => {
      const child = makeFakeChild();
      closeWith(child, {
        stderr: 'IneligibleTierError: This client is no longer supported for Gemini Code Assist for individuals.',
        code: 1,
      });
      return child;
    };
    const adapter = createKimiAdapter({ spawnImpl, commandExistsImpl: () => true });
    const result = await adapter.ask({ envelope: ENVELOPE });
    expect(result.ok).toBe(false);
    expect(result.classification).toBe('ineligible_tier');
  });

  it('classifies a known billing failure (403) honestly', async () => {
    const spawnImpl = () => {
      const child = makeFakeChild();
      closeWith(child, { stderr: 'Request failed with status 403: billing cycle exhausted', code: 1 });
      return child;
    };
    const adapter = createKimiAdapter({ spawnImpl, commandExistsImpl: () => true });
    const result = await adapter.ask({ envelope: ENVELOPE });
    expect(result.ok).toBe(false);
    expect(result.classification).toBe('billing_blocked');
  });
});

describe('adapter.probe() / isAuthenticated(): honest capability reporting', () => {
  it('probe() succeeds when the CLI is installed and returns parseable JSON', async () => {
    const spawnImpl = () => {
      const child = makeFakeChild();
      closeWith(child, { stdout: '{"ok":true,"cards":[{"type":"plan","title":"probe"}]}' });
      return child;
    };
    const adapter = createClaudeAdapter({ spawnImpl, commandExistsImpl: () => true });
    const probeResult = await adapter.probe();
    expect(probeResult.ok).toBe(true);
    expect(await adapter.isAuthenticated()).toBe(true);
  });

  it('probe() reports not_installed without spawning when the command is missing', async () => {
    const spawnImpl = vi.fn();
    const adapter = createKimiAdapter({ spawnImpl, commandExistsImpl: () => false });
    const probeResult = await adapter.probe();
    expect(probeResult.ok).toBe(false);
    expect(probeResult.installed).toBe(false);
    expect(probeResult.classification).toBe('not_installed');
    expect(spawnImpl).not.toHaveBeenCalled();
    expect(await adapter.isAuthenticated()).toBe(false);
  });

  it('probe() reports ineligible_tier from stderr and isAuthenticated() is false', async () => {
    const spawnImpl = () => {
      const child = makeFakeChild();
      closeWith(child, { stderr: 'IneligibleTierError: retired', code: 1 });
      return child;
    };
    const adapter = createKimiAdapter({ spawnImpl, commandExistsImpl: () => true });
    const probeResult = await adapter.probe();
    expect(probeResult.ok).toBe(false);
    expect(probeResult.installed).toBe(true);
    expect(probeResult.classification).toBe('ineligible_tier');
    expect(await adapter.isAuthenticated()).toBe(false);
  });
});

describe('extractJson (cli-runner.js)', () => {
  it('parses a plain JSON object', () => {
    expect(extractJson('{"a":1}')).toEqual({ ok: true, value: { a: 1 }, matched: '{"a":1}' });
  });

  it('parses JSON inside a fenced block', () => {
    const result = extractJson('here you go:\n```json\n{"a":2}\n```\nthanks');
    expect(result.ok).toBe(true);
    expect(result.value).toEqual({ a: 2 });
  });

  it('picks the last balanced JSON block in noisy multi-paragraph output', () => {
    const result = extractJson('{"stale":"first"}\nsome reasoning text\n{"a":3}');
    expect(result.ok).toBe(true);
    expect(result.value).toEqual({ a: 3 });
  });

  it('returns ok:false with a reason for text with no JSON at all', () => {
    const result = extractJson('just plain prose, no braces here');
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('unparseable');
  });

  it('returns ok:false for empty output', () => {
    expect(extractJson('   ')).toEqual({ ok: false, reason: 'empty_output' });
  });
});

describe('shared prompt sanity', () => {
  it('the prompt sent to the CLI names every known card type so the model cannot claim ignorance of the schema', async () => {
    const spawnImpl = vi.fn(() => {
      const child = makeFakeChild();
      closeWith(child, { stdout: '{"cards":[]}' });
      return child;
    });
    const adapter = createClaudeAdapter({ spawnImpl, commandExistsImpl: () => true });
    await adapter.ask({ envelope: ENVELOPE });
    const prompt = spawnImpl.mock.calls[0][1][1];
    for (const type of CARD_TYPES) {
      expect(prompt).toContain(type);
    }
    expect(prompt).toMatch(/strict json/i);
  });
});
