import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { createPaths, loadPathsConfig } from '../server/kernel/paths.js';
import { createShay, resolveProvider, readConfiguredProviderId, readConfiguredTimeoutMs } from '../server/kernel/shay.js';
import { createConversation } from '../server/kernel/conversation.js';

let tmpRoot;
let prevEnvValue;
const config = loadPathsConfig();

// Deterministically "nothing is installed" -- used by every test below that
// is not specifically exercising a working adapter, so those tests never
// depend on (or accidentally invoke) whatever CLIs happen to be on the
// machine actually running the suite.
const NOTHING_INSTALLED = { commandExistsImpl: () => false };

beforeEach(() => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-next-shay-'));
  prevEnvValue = process.env[config.data_root_env];
  process.env[config.data_root_env] = tmpRoot;
});

afterEach(() => {
  if (prevEnvValue === undefined) delete process.env[config.data_root_env];
  else process.env[config.data_root_env] = prevEnvValue;
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

// A fake child_process.ChildProcess, matching the one in
// tests/shay-adapters.test.js -- see that file for why kill() simulates an
// eventual 'close'.
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

describe('createShay.status', () => {
  it('reports honestly that no provider is usable when nothing is installed', () => {
    const paths = createPaths();
    const shay = createShay({ paths, ...NOTHING_INSTALLED });
    expect(shay.status()).toEqual({ provider_configured: false, provider_name: null });
  });

  it('reports the default claude adapter as configured when it is installed (stubbed PATH check)', () => {
    const paths = createPaths();
    const shay = createShay({ paths, commandExistsImpl: (cmd) => cmd === 'claude' });
    expect(shay.status()).toEqual({ provider_configured: true, provider_name: 'Claude Code CLI' });
  });
});

describe('createShay.ask: identity and input validation (provider-independent)', () => {
  it('refuses without site_id (no ambient site)', async () => {
    const paths = createPaths();
    const shay = createShay({ paths, ...NOTHING_INSTALLED });
    await expect(
      shay.ask({ conversation_id: 'conv_a', text: 'hello' }),
    ).rejects.toThrow(/site_id/);
  });

  it('refuses without conversation_id (no ambient conversation)', async () => {
    const paths = createPaths();
    const shay = createShay({ paths, ...NOTHING_INSTALLED });
    await expect(
      shay.ask({ site_id: 'site-a', text: 'hello' }),
    ).rejects.toThrow(/conversation_id/);
  });

  it('refuses empty text', async () => {
    const paths = createPaths();
    const shay = createShay({ paths, ...NOTHING_INSTALLED });
    await expect(
      shay.ask({ site_id: 'site-a', conversation_id: 'conv_a', text: '   ' }),
    ).rejects.toThrow(/text/);
  });

  it('builds the required context envelope', async () => {
    const paths = createPaths();
    const shay = createShay({ paths, ...NOTHING_INSTALLED });
    const result = await shay.ask({
      site_id: 'site-a',
      conversation_id: 'conv_a',
      text: 'what should I do next',
      context: { surface: 'canvas', artifact_family: 'page', page: 'home', selection: 'hero', revision: 'r3' },
    });
    expect(result.envelope).toMatchObject({
      site_id: 'site-a',
      conversation_id: 'conv_a',
      surface: 'canvas',
      artifact_family: 'page',
      page: 'home',
      selection: 'hero',
      revision: 'r3',
      text: 'what should I do next',
    });
    expect(typeof result.envelope.ts).toBe('string');
    expect(Number.isNaN(Date.parse(result.envelope.ts))).toBe(false);
  });

  it('defaults envelope fields (surface, artifact_family, page, selection, revision) when context is omitted', async () => {
    const paths = createPaths();
    const shay = createShay({ paths, ...NOTHING_INSTALLED });
    const result = await shay.ask({ site_id: 'site-a', conversation_id: 'conv_a', text: 'hi' });
    expect(result.envelope.surface).toBe('rail');
    expect(result.envelope.artifact_family).toBeNull();
    expect(result.envelope.page).toBeNull();
    expect(result.envelope.selection).toBeNull();
    expect(result.envelope.revision).toBeNull();
  });

  it('persists the operator message through the conversation kernel regardless of provider availability', async () => {
    const paths = createPaths();
    const shay = createShay({ paths, ...NOTHING_INSTALLED });
    await shay.ask({ site_id: 'site-a', conversation_id: 'conv_a', text: 'note this' });

    const conversation = createConversation({ paths });
    const entries = conversation.read('site-a');
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ site_id: 'site-a', conversation_id: 'conv_a', role: 'operator', text: 'note this' });
    expect(entries[0].card).toBeUndefined();
  });

  it('cross-site isolation: two sites asking never see each others operator entries', async () => {
    const paths = createPaths();
    const shay = createShay({ paths, ...NOTHING_INSTALLED });
    await shay.ask({ site_id: 'site-a', conversation_id: 'conv_a', text: 'a-note' });
    await shay.ask({ site_id: 'site-b', conversation_id: 'conv_b', text: 'b-note' });

    const conversation = createConversation({ paths });
    const aEntries = conversation.read('site-a');
    const bEntries = conversation.read('site-b');
    expect(aEntries.map((e) => e.text)).toEqual(['a-note']);
    expect(bEntries.map((e) => e.text)).toEqual(['b-note']);
  });

  it('rejects a conversation_id already owned by a different site (identity conflict surfaces, not silently swallowed)', async () => {
    const paths = createPaths();
    const shay = createShay({ paths, ...NOTHING_INSTALLED });
    await shay.ask({ site_id: 'site-a', conversation_id: 'shared-conv', text: 'first' });
    await expect(
      shay.ask({ site_id: 'site-b', conversation_id: 'shared-conv', text: 'second' }),
    ).rejects.toThrow(/site-a|conversation_site_mismatch|shared-conv/);
  });
});

describe('createShay.ask: provider_unavailable (no adapter installed)', () => {
  it('returns an honest provider_unavailable result carrying the envelope it would have sent', async () => {
    const paths = createPaths();
    const shay = createShay({ paths, ...NOTHING_INSTALLED });
    const result = await shay.ask({ site_id: 'site-a', conversation_id: 'conv_a', text: 'do the thing' });
    expect(result.status).toBe('provider_unavailable');
    expect(result.provider_name).toBeNull();
    expect(result.envelope).toBeTruthy();
    expect(result.envelope.text).toBe('do the thing');
    expect(typeof result.message).toBe('string');
    expect(result.message.length).toBeGreaterThan(0);
  });

  it('never produces a card when no provider is installed', async () => {
    const paths = createPaths();
    const shay = createShay({ paths, ...NOTHING_INSTALLED });
    const result = await shay.ask({ site_id: 'site-a', conversation_id: 'conv_a', text: 'do the thing' });
    expect(result.cards).toEqual([]);
  });

  it('records no system/card entry alongside the operator message when no provider is installed', async () => {
    const paths = createPaths();
    const shay = createShay({ paths, ...NOTHING_INSTALLED });
    await shay.ask({ site_id: 'site-a', conversation_id: 'conv_a', text: 'note this' });

    const conversation = createConversation({ paths });
    const entries = conversation.read('site-a');
    expect(entries.filter((e) => e.role === 'system')).toHaveLength(0);
  });
});

describe('createShay.ask: a stubbed CLI adapter actually wired through resolveProvider', () => {
  it('status ok: parses a real typed card, validates it, and persists it as a system conversation entry', async () => {
    const paths = createPaths();
    const spawnImpl = () => {
      const child = makeFakeChild();
      closeWith(child, {
        stdout: JSON.stringify({
          cards: [{ type: 'success', title: 'Shay rail is online', body: 'hello', evidence: [], actions: [], state: 'pending' }],
        }),
      });
      return child;
    };
    const shay = createShay({ paths, spawnImpl, commandExistsImpl: (cmd) => cmd === 'claude' });

    const result = await shay.ask({ site_id: 'site-a', conversation_id: 'conv_a', text: 'say hello' });
    expect(result.status).toBe('ok');
    expect(result.provider_name).toBe('Claude Code CLI');
    expect(result.cards).toHaveLength(1);
    expect(result.cards[0]).toMatchObject({ type: 'success', title: 'Shay rail is online', site_id: 'site-a', conversation_id: 'conv_a' });
    expect(typeof result.cards[0].card_id).toBe('string');

    const conversation = createConversation({ paths });
    const entries = conversation.read('site-a');
    expect(entries).toHaveLength(2);
    expect(entries[0].role).toBe('operator');
    expect(entries[1].role).toBe('system');
    expect(entries[1].card).toMatchObject({ type: 'success', title: 'Shay rail is online' });
  });

  it('drops an invalid candidate card with a reason and never persists it, while keeping the valid ones', async () => {
    const paths = createPaths();
    const spawnImpl = () => {
      const child = makeFakeChild();
      closeWith(child, {
        stdout: JSON.stringify({
          cards: [
            { type: 'plan', title: 'good card' },
            { type: 'nonsense_type', title: 'bad card' },
          ],
        }),
      });
      return child;
    };
    const shay = createShay({ paths, spawnImpl, commandExistsImpl: (cmd) => cmd === 'claude' });

    const result = await shay.ask({ site_id: 'site-a', conversation_id: 'conv_a', text: 'do two things' });
    expect(result.status).toBe('ok');
    expect(result.cards).toHaveLength(1);
    expect(result.cards[0].title).toBe('good card');
    expect(result.dropped).toHaveLength(1);
    expect(result.dropped[0].candidate.title).toBe('bad card');

    const conversation = createConversation({ paths });
    const systemEntries = conversation.read('site-a').filter((e) => e.role === 'system');
    expect(systemEntries).toHaveLength(1);
  });

  it('status provider_error: a non-zero CLI exit produces an honest failure, never a fabricated card', async () => {
    const paths = createPaths();
    const spawnImpl = () => {
      const child = makeFakeChild();
      closeWith(child, { stderr: 'boom', code: 1 });
      return child;
    };
    const shay = createShay({ paths, spawnImpl, commandExistsImpl: (cmd) => cmd === 'claude' });

    const result = await shay.ask({ site_id: 'site-a', conversation_id: 'conv_a', text: 'do the thing' });
    expect(result.status).toBe('provider_error');
    expect(result.classification).toBe('nonzero_exit');
    expect(result.cards).toEqual([]);
    expect(result.provider_name).toBe('Claude Code CLI');

    // The operator's own message is still real and still persisted even
    // though the provider call failed.
    const conversation = createConversation({ paths });
    const entries = conversation.read('site-a');
    expect(entries).toHaveLength(1);
    expect(entries[0].role).toBe('operator');
  });

  it('status provider_error: a CLI that hangs past the timeout is killed and reported, never fabricated', async () => {
    const paths = createPaths();
    const child = makeFakeChild(); // never closes on its own
    const spawnImpl = () => child;
    const shay = createShay({ paths, spawnImpl, commandExistsImpl: (cmd) => cmd === 'claude' });

    const result = await shay.ask({ site_id: 'site-a', conversation_id: 'conv_a', text: 'do the thing', timeoutMs: 30 });
    expect(result.status).toBe('provider_error');
    expect(result.classification).toBe('timed_out');
    expect(result.cards).toEqual([]);
    expect(child.kill).toHaveBeenCalled();
  });

  it('status provider_error: unparseable stdout produces an honest failure naming it, never a fabricated card', async () => {
    const paths = createPaths();
    const spawnImpl = () => {
      const child = makeFakeChild();
      closeWith(child, { stdout: 'no json here, just prose' });
      return child;
    };
    const shay = createShay({ paths, spawnImpl, commandExistsImpl: (cmd) => cmd === 'claude' });

    const result = await shay.ask({ site_id: 'site-a', conversation_id: 'conv_a', text: 'do the thing' });
    expect(result.status).toBe('provider_error');
    expect(result.classification).toBe('unparseable_output');
    expect(result.cards).toEqual([]);
  });
});

describe('resolveProvider / readConfiguredProviderId: config/shay.json seam (owned by the Settings/admin lane; shape confirmed against server/modules/admin/index.js: { provider, timeout_ms })', () => {
  let tmpConfigDir;
  let tmpConfigRoot;
  let fakePaths;

  beforeEach(() => {
    tmpConfigRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-next-shay-config-'));
    tmpConfigDir = path.join(tmpConfigRoot, 'config');
    fs.mkdirSync(tmpConfigDir, { recursive: true });
    // Only configFile's directory matters to this seam (the shay.json reader
    // looks for a sibling file next to it); paths.json itself need not exist.
    // This tmp dir is entirely private to this test -- never the real
    // repo-tracked config/shay.json the Settings/admin lane owns.
    fakePaths = { configFile: path.join(tmpConfigDir, 'paths.json') };
  });

  afterEach(() => {
    fs.rmSync(tmpConfigRoot, { recursive: true, force: true });
  });

  it('returns null when config/shay.json is absent (tolerated, not an error)', () => {
    expect(readConfiguredProviderId(fakePaths)).toBeNull();
    expect(readConfiguredTimeoutMs(fakePaths)).toBeNull();
  });

  it('returns null when the file exists but is not valid JSON (tolerated, not thrown)', () => {
    fs.writeFileSync(path.join(tmpConfigDir, 'shay.json'), 'not json{{{');
    expect(readConfiguredProviderId(fakePaths)).toBeNull();
  });

  it('reads the "provider" field when the Settings/admin lane has written it', () => {
    fs.writeFileSync(path.join(tmpConfigDir, 'shay.json'), JSON.stringify({ schema_version: 1, provider: 'codex', timeout_ms: 60000 }));
    expect(readConfiguredProviderId(fakePaths)).toBe('codex');
  });

  it('reads the "timeout_ms" field alongside the provider', () => {
    fs.writeFileSync(path.join(tmpConfigDir, 'shay.json'), JSON.stringify({ schema_version: 1, provider: 'claude', timeout_ms: 45000 }));
    expect(readConfiguredTimeoutMs(fakePaths)).toBe(45000);
  });

  it('ignores a non-positive or non-numeric timeout_ms rather than passing it through', () => {
    fs.writeFileSync(path.join(tmpConfigDir, 'shay.json'), JSON.stringify({ provider: 'claude', timeout_ms: -5 }));
    expect(readConfiguredTimeoutMs(fakePaths)).toBeNull();
    fs.writeFileSync(path.join(tmpConfigDir, 'shay.json'), JSON.stringify({ provider: 'claude', timeout_ms: 'soon' }));
    expect(readConfiguredTimeoutMs(fakePaths)).toBeNull();
  });

  it('resolveProvider falls back to the default id when no config file is present', () => {
    const provider = resolveProvider({ paths: fakePaths, commandExistsImpl: (cmd) => cmd === 'claude' });
    expect(provider.id).toBe('claude');
  });

  it('resolveProvider honors a configured known id when it is installed', () => {
    fs.writeFileSync(path.join(tmpConfigDir, 'shay.json'), JSON.stringify({ provider: 'codex' }));
    const provider = resolveProvider({ paths: fakePaths, commandExistsImpl: (cmd) => cmd === 'codex' });
    expect(provider.id).toBe('codex');
  });

  it('resolveProvider falls back to the default id when the configured id is unknown', () => {
    fs.writeFileSync(path.join(tmpConfigDir, 'shay.json'), JSON.stringify({ provider: 'not-a-real-adapter' }));
    const provider = resolveProvider({ paths: fakePaths, commandExistsImpl: (cmd) => cmd === 'claude' });
    expect(provider.id).toBe('claude');
  });

  it('resolveProvider returns null (honest unavailability) when nothing resolvable is installed', () => {
    fs.writeFileSync(path.join(tmpConfigDir, 'shay.json'), JSON.stringify({ provider: 'codex' }));
    const provider = resolveProvider({ paths: fakePaths, commandExistsImpl: () => false });
    expect(provider).toBeNull();
  });
});

describe('createShay.ask: honors config/shay.json timeout_ms as the default when the caller does not override it', () => {
  // config/shay.json is real, repo-tracked, shared-worktree state owned by
  // the Settings/admin lane (confirmed above) -- these tests must never
  // write to the actual file. Instead they take the real tmp-rooted `paths`
  // (so conversation/journal persistence still isolates into tmpRoot exactly
  // like every other test here) and override just `configFile` to point at
  // a private, disposable directory, so the shay.json this describe block
  // writes is never the shared one.
  const scratchConfigDirs = [];

  afterEach(() => {
    while (scratchConfigDirs.length) {
      fs.rmSync(scratchConfigDirs.pop(), { recursive: true, force: true });
    }
  });

  function pathsWithScratchConfigDir() {
    const realPaths = createPaths();
    const scratchConfigDir = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-next-shay-config-scratch-'));
    scratchConfigDirs.push(scratchConfigDir);
    return { ...realPaths, configFile: path.join(scratchConfigDir, 'paths.json') };
  }

  it('a configured timeout_ms shorter than the CLI response time surfaces as an honest timed_out failure', async () => {
    const paths = pathsWithScratchConfigDir();
    fs.writeFileSync(path.join(path.dirname(paths.configFile), 'shay.json'), JSON.stringify({ schema_version: 1, provider: 'claude', timeout_ms: 25 }));

    const child = makeFakeChild(); // never closes on its own
    const spawnImpl = () => child;
    const shay = createShay({ paths, spawnImpl, commandExistsImpl: (cmd) => cmd === 'claude' });

    // No timeoutMs passed here -- it must come from config/shay.json.
    const result = await shay.ask({ site_id: 'site-a', conversation_id: 'conv_a', text: 'do the thing' });
    expect(result.status).toBe('provider_error');
    expect(result.classification).toBe('timed_out');
  });

  it('an explicit ask({ timeoutMs }) always wins over config/shay.json', async () => {
    const paths = pathsWithScratchConfigDir();
    // A generous configured timeout that would comfortably let the call finish...
    fs.writeFileSync(path.join(path.dirname(paths.configFile), 'shay.json'), JSON.stringify({ schema_version: 1, provider: 'claude', timeout_ms: 60000 }));

    const child = makeFakeChild(); // never closes on its own
    const spawnImpl = () => child;
    const shay = createShay({ paths, spawnImpl, commandExistsImpl: (cmd) => cmd === 'claude' });

    // ...but the caller's own short timeoutMs must still be what applies.
    const result = await shay.ask({ site_id: 'site-a', conversation_id: 'conv_a', text: 'do the thing', timeoutMs: 25 });
    expect(result.status).toBe('provider_error');
    expect(result.classification).toBe('timed_out');
  });
});
