// Research adapter dispatch (plan 2.5, ENDGAME items 6-7): shay-native now
// runs real research through the operator's own `claude` CLI (server/kernel/
// shay-adapters/), so every CLI invocation here is stubbed via spawnImpl
// injection (same pattern as tests/shay-adapters.test.js) and every source_uri
// verification is stubbed via fetchImpl injection, for a fast, deterministic
// suite that never touches a real CLI or network. The one real end-to-end
// proof (against the actual `claude` CLI, with live WebSearch/WebFetch,
// against the Beehive Studio brief) lives outside this suite and is reported
// separately, matching shay-adapters.test.js's own convention.
//
// Coverage: dispatch validation, the honest adapter_failed path (CLI missing,
// spawn error, timeout, nonzero exit, unparseable output), the core honesty
// property that a source_uri is only ever trusted after an independent fetch
// confirms it -- never the model's or the brief's own say-so -- execution_status
// classification, the exact CLI argv shape (including the --allowedTools/-p
// ordering bug this build hit and fixed), customer_claims separation,
// required_capabilities, notebooklm-import's unchanged normalizer, and
// journal/persistence/cross-site isolation.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { createPaths, loadPathsConfig } from '../server/kernel/paths.js';
import { createJournal } from '../server/kernel/journal.js';
import { runResearch, ADAPTERS } from '../server/kernel/research.js';
import { listPackets, validatePacket } from '../server/kernel/packet.js';

let tmpRoot;
let prevEnvValue;
const config = loadPathsConfig();

beforeEach(() => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-next-research-'));
  prevEnvValue = process.env[config.data_root_env];
  process.env[config.data_root_env] = tmpRoot;
});

afterEach(() => {
  if (prevEnvValue === undefined) delete process.env[config.data_root_env];
  else process.env[config.data_root_env] = prevEnvValue;
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

const BRIEF = {
  business: { name: 'Peachtree Locksmith', location: 'Atlanta, GA' },
  required_capabilities: ['official emergency contact number'],
};
const THIN_BRIEF = { business_name: 'I sell shoes', business_category: 'unsure' };

const EMPTY_MODEL_JSON = {
  facts: [], open_questions: [], confidence_notes: '',
  brand: {}, site_needs: { pages: [], sections_per_page: {}, offers: [], ctas: [] },
  media_prompts: [], seo_targets: { keywords: [], meta_direction: '' },
};

// A fake child_process.ChildProcess: an EventEmitter with .stdout/.stderr
// EventEmitters and a .kill() that simulates the OS eventually delivering a
// 'close' after a signal (same fixture shape as shay-adapters.test.js).
function makeFakeChild() {
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.kill = vi.fn((signal) => { setImmediate(() => child.emit('close', null, signal)); });
  return child;
}
function closeWith(child, { stdout = '', stderr = '', code = 0, delayMs = 0 } = {}) {
  setTimeout(() => {
    if (stdout) child.stdout.emit('data', Buffer.from(stdout));
    if (stderr) child.stderr.emit('data', Buffer.from(stderr));
    child.emit('close', code, null);
  }, delayMs);
}
// Spawns a child that immediately answers with the given parsed JSON body.
function spawnReturning(modelJson) {
  return () => { const child = makeFakeChild(); closeWith(child, { stdout: JSON.stringify(modelJson) }); return child; };
}
// A fetchImpl stub keyed by exact URL. `{status}` (default 200) answers
// without throwing; `{fail: true}` simulates a network/DNS-level failure.
function stubFetch(routes) {
  return async (url) => {
    const spec = routes[url];
    if (!spec || spec.fail) throw new Error(spec?.message || `stub fetch: no route for ${url}`);
    return {
      status: spec.status ?? 200,
      headers: { get: (name) => (name === 'content-type' ? (spec.contentType ?? 'text/html') : null) },
      text: async () => spec.body ?? '<html>ok</html>',
    };
  };
}
const NEVER_CALLED_FETCH = async () => { throw new Error('fetchImpl should not have been called'); };

describe('ADAPTERS', () => {
  it('names exactly the two MVP adapters', () => {
    expect(ADAPTERS).toEqual(['shay-native', 'notebooklm-import']);
  });
});

describe('runResearch dispatch validation (always rejects, never throws sync -- runResearch is async)', () => {
  it('rejects an unknown adapter', async () => {
    const paths = createPaths();
    await expect(runResearch({ paths, site_id: 's1', adapter: 'made-up', brief: BRIEF })).rejects.toThrow(/unknown adapter/);
  });
  it('requires site_id', async () => {
    const paths = createPaths();
    await expect(runResearch({ paths, adapter: 'shay-native', brief: BRIEF })).rejects.toThrow(/site_id/);
  });
  it('requires a brief', async () => {
    const paths = createPaths();
    await expect(runResearch({ paths, site_id: 's1', adapter: 'shay-native' })).rejects.toThrow(/brief/);
  });
});

describe('shay-native: adapter_failed is honest, never a fabricated packet', () => {
  it('reports adapter_failed and never spawns anything when the claude CLI is not on PATH', async () => {
    const paths = createPaths();
    const spawnImpl = vi.fn();
    const packet = await runResearch({ paths, site_id: 'site-notinstalled', adapter: 'shay-native', brief: BRIEF, options: { spawnImpl, commandExistsImpl: () => false } });
    expect(packet.execution_status).toBe('adapter_failed');
    expect(packet.confidence_notes).toMatch(/not_installed/);
    expect(spawnImpl).not.toHaveBeenCalled();
    expect(validatePacket(packet, { paths, site_id: 'site-notinstalled' }).valid).toBe(true);
  });

  it('classifies a hung CLI as timed_out and kills the child', async () => {
    const paths = createPaths();
    const child = makeFakeChild(); // never closes on its own
    const packet = await runResearch({ paths, site_id: 'site-timeout', adapter: 'shay-native', brief: BRIEF, options: { spawnImpl: () => child, commandExistsImpl: () => true, timeoutMs: 30 } });
    expect(packet.execution_status).toBe('adapter_failed');
    expect(packet.confidence_notes).toMatch(/timed_out/);
    expect(child.kill).toHaveBeenCalled();
  });

  it('classifies a nonzero CLI exit as nonzero_exit, with stderr context', async () => {
    const paths = createPaths();
    const spawnImpl = () => { const child = makeFakeChild(); closeWith(child, { stderr: 'boom: something broke\n', code: 7 }); return child; };
    const packet = await runResearch({ paths, site_id: 'site-nonzero', adapter: 'shay-native', brief: BRIEF, options: { spawnImpl, commandExistsImpl: () => true } });
    expect(packet.execution_status).toBe('adapter_failed');
    expect(packet.confidence_notes).toMatch(/nonzero_exit/);
    expect(packet.confidence_notes).toMatch(/7/);
  });

  it('classifies a spawn error as spawn_failed', async () => {
    const paths = createPaths();
    const spawnImpl = () => { const child = makeFakeChild(); setImmediate(() => child.emit('error', new Error('spawn claude ENOENT'))); return child; };
    const packet = await runResearch({ paths, site_id: 'site-spawnerr', adapter: 'shay-native', brief: BRIEF, options: { spawnImpl, commandExistsImpl: () => true } });
    expect(packet.execution_status).toBe('adapter_failed');
    expect(packet.confidence_notes).toMatch(/spawn_failed/);
    expect(packet.confidence_notes).toMatch(/ENOENT/);
  });

  it('classifies exit-0-but-no-JSON output as unparseable_output', async () => {
    const paths = createPaths();
    const spawnImpl = () => { const child = makeFakeChild(); closeWith(child, { stdout: 'Sure, here is my answer in plain prose with no JSON at all.' }); return child; };
    const packet = await runResearch({ paths, site_id: 'site-unparse', adapter: 'shay-native', brief: BRIEF, options: { spawnImpl, commandExistsImpl: () => true } });
    expect(packet.execution_status).toBe('adapter_failed');
    expect(packet.confidence_notes).toMatch(/unparseable_output/);
  });
});

describe('shay-native: a source_uri is only ever trusted after an independent fetch confirms it', () => {
  it('never invents a source_uri: a model fact candidate with none goes to not_found, not facts[]', async () => {
    const paths = createPaths();
    const modelJson = { ...EMPTY_MODEL_JSON, facts: [{ claim: 'We are the best locksmith in town', source_uri: '' }] };
    const packet = await runResearch({ paths, site_id: 'site-nosrc', adapter: 'shay-native', brief: BRIEF, options: { spawnImpl: spawnReturning(modelJson), commandExistsImpl: () => true, fetchImpl: NEVER_CALLED_FETCH } });
    expect(packet.facts).toEqual([]);
    expect(packet.not_found.some((n) => n.claim.includes('best locksmith'))).toBe(true);
  });

  it('does not trust the model\'s own verification_state:"verified" claim: an unfetchable source_uri is demoted to not_found', async () => {
    const paths = createPaths();
    const modelJson = { ...EMPTY_MODEL_JSON, facts: [{ claim: 'Licensed and insured', source_uri: 'https://fake.example/proof', verification_state: 'verified' , design_use: 'fixture — what this finding changes', mutable: true}] };
    const fetchImpl = async () => { throw new Error('DNS lookup failed'); };
    const packet = await runResearch({ paths, site_id: 'site-unverifiable', adapter: 'shay-native', brief: BRIEF, options: { spawnImpl: spawnReturning(modelJson), commandExistsImpl: () => true, fetchImpl } });
    expect(packet.facts).toEqual([]);
    expect(packet.not_found[0].reason).toMatch(/could not be independently confirmed/);
    expect(packet.not_found[0].reason).toMatch(/DNS lookup failed/);
  });

  it('a 404/500 source_uri is demoted to not_found, not treated as confirmed just because the model cited it', async () => {
    const paths = createPaths();
    const modelJson = { ...EMPTY_MODEL_JSON, facts: [{ claim: 'Open 24 hours', source_uri: 'https://real.example/hours' , design_use: 'fixture — what this finding changes', mutable: true}] };
    const fetchImpl = stubFetch({ 'https://real.example/hours': { status: 404 } });
    const packet = await runResearch({ paths, site_id: 'site-404', adapter: 'shay-native', brief: BRIEF, options: { spawnImpl: spawnReturning(modelJson), commandExistsImpl: () => true, fetchImpl } });
    expect(packet.facts).toEqual([]);
    expect(packet.not_found[0].reason).toMatch(/http_404/);
  });

  it('promotes a fact to facts[] only once an independent fetch confirms it, recording real provenance (status, hash)', async () => {
    const paths = createPaths();
    const modelJson = { ...EMPTY_MODEL_JSON, facts: [{ claim: 'Founded in 2015', source_uri: 'https://real.example/about', verification_state: 'unverified' , design_use: 'fixture — what this finding changes', mutable: true}] };
    const fetchImpl = stubFetch({ 'https://real.example/about': { status: 200, body: '<html>Founded 2015</html>' } });
    const packet = await runResearch({ paths, site_id: 'site-verified', adapter: 'shay-native', brief: BRIEF, options: { spawnImpl: spawnReturning(modelJson), commandExistsImpl: () => true, fetchImpl } });
    expect(packet.facts).toHaveLength(1);
    expect(packet.facts[0].source_uri).toBe('https://real.example/about');
    expect(packet.facts[0].verification_state).toBe('verified');
    expect(packet.facts[0].http_status).toBe(200);
    expect(typeof packet.facts[0].content_sha256).toBe('string');
    expect(validatePacket(packet, { paths, site_id: 'site-verified' }).valid).toBe(true);
  });

  it('verifies each distinct source_uri only once even when several fact candidates share it', async () => {
    const paths = createPaths();
    const modelJson = {
      ...EMPTY_MODEL_JSON,
      facts: [
        { claim: 'Address', source_uri: 'https://real.example/shared' , design_use: 'fixture — what this finding changes', mutable: true},
        { claim: 'Hours', source_uri: 'https://real.example/shared' , design_use: 'fixture — what this finding changes', mutable: true},
      ],
    };
    let fetchCount = 0;
    const fetchImpl = async () => { fetchCount += 1; return { status: 200, headers: { get: () => null }, text: async () => 'x' }; };
    const packet = await runResearch({ paths, site_id: 'site-dedupe', adapter: 'shay-native', brief: BRIEF, options: { spawnImpl: spawnReturning(modelJson), commandExistsImpl: () => true, fetchImpl } });
    expect(packet.facts).toHaveLength(2);
    expect(fetchCount).toBe(1);
  });
});

describe('shay-native: brief-supplied facts are independently re-verified too, never trusted blindly', () => {
  const briefWithFact = { ...BRIEF, facts: [{ claim: 'Licensed locksmith #12345', source_uri: 'https://sos.ga.gov/verify/12345' , design_use: 'fixture — what this finding changes', mutable: true}] };

  it('promotes a brief-supplied fact only when its source_uri independently verifies', async () => {
    const paths = createPaths();
    const fetchImpl = stubFetch({ 'https://sos.ga.gov/verify/12345': { status: 200 } });
    const packet = await runResearch({ paths, site_id: 'site-briefpartial', adapter: 'shay-native', brief: briefWithFact, options: { spawnImpl: spawnReturning(EMPTY_MODEL_JSON), commandExistsImpl: () => true, fetchImpl } });
    expect(packet.facts).toHaveLength(1);
    expect(packet.facts[0].source_uri).toBe('https://sos.ga.gov/verify/12345');
    expect(packet.facts[0].verification_state).toBe('verified');
  });

  it('demotes a brief-supplied fact to not_found when its source_uri does not verify, even though a human supplied it', async () => {
    const paths = createPaths();
    const fetchImpl = stubFetch({ 'https://sos.ga.gov/verify/12345': { status: 404 } });
    const packet = await runResearch({ paths, site_id: 'site-briefdown', adapter: 'shay-native', brief: briefWithFact, options: { spawnImpl: spawnReturning(EMPTY_MODEL_JSON), commandExistsImpl: () => true, fetchImpl } });
    expect(packet.facts).toEqual([]);
    expect(packet.not_found.some((n) => n.claim.includes('Licensed locksmith'))).toBe(true);
  });

  it('brief-supplied facts survive and are still independently verified even when the CLI itself fails', async () => {
    const paths = createPaths();
    const fetchImpl = stubFetch({ 'https://sos.ga.gov/verify/12345': { status: 200 } });
    const packet = await runResearch({ paths, site_id: 'site-briefsurv', adapter: 'shay-native', brief: briefWithFact, options: { commandExistsImpl: () => false, fetchImpl } });
    expect(packet.execution_status).toBe('adapter_failed');
    expect(packet.facts).toHaveLength(1);
    expect(packet.facts[0].source_uri).toBe('https://sos.ga.gov/verify/12345');
  });
});

describe('shay-native: execution_status reflects what was actually found', () => {
  it('reports no_findings only when the CLI returns a genuinely empty packet', async () => {
    const paths = createPaths();
    const packet = await runResearch({ paths, site_id: 'site-empty', adapter: 'shay-native', brief: THIN_BRIEF, options: { spawnImpl: spawnReturning(EMPTY_MODEL_JSON), commandExistsImpl: () => true } });
    expect(packet.execution_status).toBe('no_findings');
    expect(packet.facts).toEqual([]);
  });

  it('reports partial (not no_findings) when the CLI finds real strategic direction but zero verifiable facts -- the expected shape for a thin brief', async () => {
    const paths = createPaths();
    const modelJson = { ...EMPTY_MODEL_JSON, open_questions: ['what is the booking platform'], brand: { voice: 'direct' } };
    const packet = await runResearch({ paths, site_id: 'site-partial-nofacts', adapter: 'shay-native', brief: THIN_BRIEF, options: { spawnImpl: spawnReturning(modelJson), commandExistsImpl: () => true } });
    expect(packet.facts).toEqual([]);
    expect(packet.execution_status).toBe('partial');
    expect(packet.brand.voice).toBe('direct');
  });

  it('reports ok when every verified fact held and no source was rejected', async () => {
    const paths = createPaths();
    const modelJson = { ...EMPTY_MODEL_JSON, facts: [{ claim: 'x', source_uri: 'https://real.example/x' , design_use: 'fixture — what this finding changes', mutable: true}], open_questions: [] };
    const fetchImpl = stubFetch({ 'https://real.example/x': { status: 200 } });
    const packet = await runResearch({ paths, site_id: 'site-ok', adapter: 'shay-native', brief: BRIEF, options: { spawnImpl: spawnReturning(modelJson), commandExistsImpl: () => true, fetchImpl } });
    expect(packet.execution_status).toBe('ok');
  });

  // REGRESSION: open questions must NEVER downgrade status. They are a
  // positive signal -- honest research surfaces unknowns -- and gating 'ok'
  // on having none made 'ok' unreachable for any real run, collapsing a
  // packet with 8 verified facts and one with 0 both to 'partial'. The five
  // real customer runs on 2026-08-23 all reported 'partial' for this reason.
  it('still reports ok when facts verify cleanly even though open questions remain', async () => {
    const paths = createPaths();
    const modelJson = { ...EMPTY_MODEL_JSON, facts: [{ claim: 'x', source_uri: 'https://real.example/x' , design_use: 'fixture — what this finding changes', mutable: true}], open_questions: ['still unsure about y'] };
    const fetchImpl = stubFetch({ 'https://real.example/x': { status: 200 } });
    const packet = await runResearch({ paths, site_id: 'site-mixed', adapter: 'shay-native', brief: BRIEF, options: { spawnImpl: spawnReturning(modelJson), commandExistsImpl: () => true, fetchImpl } });
    expect(packet.open_questions.length).toBeGreaterThan(0);
    expect(packet.execution_status).toBe('ok');
  });

  // The real discriminator: a rejected source is what makes a packet partial.
  it('reports partial when a fact verifies but another cited source was rejected', async () => {
    const paths = createPaths();
    const modelJson = { ...EMPTY_MODEL_JSON, facts: [
      { claim: 'good', source_uri: 'https://real.example/x' , design_use: 'fixture — what this finding changes', mutable: true},
      { claim: 'bad', source_uri: 'https://dead.example/y' , design_use: 'fixture — what this finding changes', mutable: true},
    ] };
    const fetchImpl = stubFetch({ 'https://real.example/x': { status: 200 }, 'https://dead.example/y': { status: 403 } });
    const packet = await runResearch({ paths, site_id: 'site-rejected', adapter: 'shay-native', brief: BRIEF, options: { spawnImpl: spawnReturning(modelJson), commandExistsImpl: () => true, fetchImpl } });
    expect(packet.facts.length).toBe(1);
    expect(packet.not_found.length).toBe(1);
    expect(packet.execution_status).toBe('partial');
  });
});

describe('shay-native: a completely empty packet is retried once, then reported honestly', () => {
  // Returns a different modelJson per call so a retry can be distinguished.
  function spawnSequence(...payloads) {
    let i = 0;
    return () => {
      const child = makeFakeChild();
      const payload = payloads[Math.min(i, payloads.length - 1)];
      i += 1;
      closeWith(child, { stdout: JSON.stringify(payload) });
      return child;
    };
  }

  const RICH = { ...EMPTY_MODEL_JSON, open_questions: ['who owns the booking page'], brand: { voice: 'warm' } };

  it('retries when the first call returns a completely empty packet, and keeps the retry result', async () => {
    const paths = createPaths();
    const spawnImpl = spawnSequence(EMPTY_MODEL_JSON, RICH);
    const packet = await runResearch({ paths, site_id: 'site-empty-retry', adapter: 'shay-native', brief: THIN_BRIEF, options: { spawnImpl, commandExistsImpl: () => true } });
    expect(packet.execution_status).toBe('partial');
    expect(packet.open_questions).toContain('who owns the booking page');
    expect(packet.confidence_notes).toMatch(/this is the retry/i);
  });

  it('does NOT retry an honest thin result -- zero facts with real open questions is a legitimate answer, not a failure', async () => {
    const paths = createPaths();
    const spawnImpl = vi.fn(spawnSequence(RICH));
    const packet = await runResearch({ paths, site_id: 'site-thin-noretry', adapter: 'shay-native', brief: THIN_BRIEF, options: { spawnImpl, commandExistsImpl: () => true } });
    expect(packet.facts).toEqual([]);
    expect(spawnImpl).toHaveBeenCalledTimes(1);
    expect(packet.confidence_notes).not.toMatch(/retry/i);
  });

  it('reports honestly, never dressed up, when both attempts come back empty', async () => {
    const paths = createPaths();
    const spawnImpl = vi.fn(spawnSequence(EMPTY_MODEL_JSON));
    const packet = await runResearch({ paths, site_id: 'site-empty-twice', adapter: 'shay-native', brief: THIN_BRIEF, options: { spawnImpl, commandExistsImpl: () => true } });
    expect(spawnImpl).toHaveBeenCalledTimes(2);
    expect(packet.execution_status).toBe('no_findings');
    expect(packet.confidence_notes).toMatch(/Attempted 2 times/i);
  });
});

describe('shay-native: transient adapter failures are retried, permanent ones are not', () => {
  function spawnSequence(...payloads) {
    let i = 0;
    return () => {
      const child = makeFakeChild();
      const payload = payloads[Math.min(i, payloads.length - 1)];
      i += 1;
      if (payload === 'GARBAGE') closeWith(child, { stdout: 'not json at all' });
      else closeWith(child, { stdout: JSON.stringify(payload) });
      return child;
    };
  }
  const RICH = { ...EMPTY_MODEL_JSON, open_questions: ['what is the booking platform'], brand: { voice: 'warm' } };

  // This is the exact failure that broke a real acceptance run: exit 0 with
  // nothing parseable, which was previously not retried at all.
  it('retries unparseable CLI output and keeps the good second result', async () => {
    const paths = createPaths();
    const spawnImpl = vi.fn(spawnSequence('GARBAGE', RICH));
    const packet = await runResearch({ paths, site_id: 'unparseable-retry', adapter: 'shay-native', brief: THIN_BRIEF, options: { spawnImpl, commandExistsImpl: () => true } });
    expect(spawnImpl).toHaveBeenCalledTimes(2);
    expect(packet.execution_status).toBe('partial');
    expect(packet.open_questions).toContain('what is the booking platform');
  });

  it('does NOT retry when the CLI is simply not installed -- a second probe cannot help', async () => {
    const paths = createPaths();
    const commandExistsImpl = vi.fn(() => false);
    const packet = await runResearch({ paths, site_id: 'not-installed-noretry', adapter: 'shay-native', brief: THIN_BRIEF, options: { spawnImpl: spawnSequence(RICH), commandExistsImpl } });
    expect(packet.execution_status).toBe('adapter_failed');
    expect(packet.confidence_notes).toMatch(/not_installed/);
  });

  it('reports honestly when both attempts fail to parse', async () => {
    const paths = createPaths();
    const spawnImpl = vi.fn(spawnSequence('GARBAGE'));
    const packet = await runResearch({ paths, site_id: 'unparseable-twice', adapter: 'shay-native', brief: THIN_BRIEF, options: { spawnImpl, commandExistsImpl: () => true } });
    expect(spawnImpl).toHaveBeenCalledTimes(2);
    expect(packet.execution_status).toBe('adapter_failed');
    expect(packet.confidence_notes).toMatch(/unparseable_output/);
  });
});

describe('shay-native: CLI invocation shape', () => {
  it('invokes claude with --allowedTools WebSearch,WebFetch BEFORE -p (placing -p first swallows the prompt into the tools flag -- hit and fixed on this build), stdin closed', async () => {
    const paths = createPaths();
    const spawnImpl = vi.fn(spawnReturning(EMPTY_MODEL_JSON));
    await runResearch({ paths, site_id: 'site-argv', adapter: 'shay-native', brief: BRIEF, options: { spawnImpl, commandExistsImpl: () => true } });
    expect(spawnImpl).toHaveBeenCalledTimes(1);
    const [command, args, opts] = spawnImpl.mock.calls[0];
    expect(command).toBe('claude');
    expect(args).toEqual(['--allowedTools', 'WebSearch,WebFetch', '-p', expect.any(String)]);
    expect(args[3]).toContain('Peachtree Locksmith');
    expect(opts.stdio[0]).toBe('ignore');
  });

  it('honors options.timeoutMs, overriding the default', async () => {
    const paths = createPaths();
    const child = makeFakeChild(); // never closes
    const started = Date.now();
    const packet = await runResearch({ paths, site_id: 'site-customtimeout', adapter: 'shay-native', brief: BRIEF, options: { spawnImpl: () => child, commandExistsImpl: () => true, timeoutMs: 25 } });
    expect(Date.now() - started).toBeLessThan(3000);
    expect(packet.execution_status).toBe('adapter_failed');
  });
});

describe('shay-native: customer_claims and required_capabilities', () => {
  it('keeps customer-supplied brief details as customer_claims, never as facts', async () => {
    const paths = createPaths();
    const packet = await runResearch({ paths, site_id: 'site-customerclaims', adapter: 'shay-native', brief: BRIEF, options: { spawnImpl: spawnReturning(EMPTY_MODEL_JSON), commandExistsImpl: () => true } });
    expect(packet.customer_claims.some((c) => c.claim === 'Peachtree Locksmith')).toBe(true);
    expect(packet.facts).toEqual([]);
  });

  it('leaves an open_question for a required_capability the model did not address', async () => {
    const paths = createPaths();
    const packet = await runResearch({ paths, site_id: 'site-reqcap', adapter: 'shay-native', brief: BRIEF, options: { spawnImpl: spawnReturning(EMPTY_MODEL_JSON), commandExistsImpl: () => true } });
    expect(packet.open_questions.some((q) => q.includes('official emergency contact number'))).toBe(true);
  });
});

describe('notebooklm-import (unchanged: no live I/O, still fully synchronous internally)', () => {
  it('requires raw_import', async () => {
    const paths = createPaths();
    await expect(runResearch({ paths, site_id: 's1', adapter: 'notebooklm-import', brief: BRIEF })).rejects.toThrow(/raw_import/);
  });

  it('stores the raw import immutably and records import_ref/import_hash on the packet', async () => {
    const paths = createPaths();
    const packet = await runResearch({ paths, site_id: 'site-import', adapter: 'notebooklm-import', brief: BRIEF, raw_import: 'Peachtree Locksmith is a locksmith. https://example.com/about' , design_use: 'fixture — what this finding changes', mutable: true});
    expect(packet.import_ref).toBeTruthy();
    expect(packet.import_hash).toMatch(/^[0-9a-f]{64}$/);
    const stored = fs.readFileSync(paths.within('packets', 'site-import', packet.import_ref), 'utf8');
    expect(stored).toContain('Peachtree Locksmith');
  });

  it('maps a passage with a detectable source URL to a fact', async () => {
    const paths = createPaths();
    const packet = await runResearch({ paths, site_id: 'site-map', adapter: 'notebooklm-import', brief: BRIEF, raw_import: 'They have served Atlanta since 1998. https://example.com/history' , design_use: 'fixture — what this finding changes', mutable: true});
    expect(packet.facts).toHaveLength(1);
    expect(packet.facts[0].source_uri).toBe('https://example.com/history');
    expect(packet.facts[0].verification_state).toBe('unverified');
  });

  it('never silently drops an unmappable passage: it lands in not_found with an honest reason', async () => {
    const paths = createPaths();
    const packet = await runResearch({ paths, site_id: 'site-unmapped', adapter: 'notebooklm-import', brief: BRIEF, raw_import: 'They are generally considered the best in town, according to local buzz.' , design_use: 'fixture — what this finding changes', mutable: true });
    expect(packet.facts).toEqual([]);
    expect(packet.not_found[0].reason).toMatch(/no source url/i);
    expect(packet.execution_status).toBe('no_findings');
  });

  it('reports ok when every passage maps, partial when some do and some do not', async () => {
    const paths = createPaths();
    const mixed = await runResearch({ paths, site_id: 'site-mixed-nb', adapter: 'notebooklm-import', brief: BRIEF, raw_import: 'Founded in 1998. https://example.com/a\n\nPeople say great things about them, generally.' , design_use: 'fixture — what this finding changes', mutable: true });
    expect(mixed.execution_status).toBe('partial');
    const clean = await runResearch({ paths, site_id: 'site-clean', adapter: 'notebooklm-import', brief: BRIEF, raw_import: 'Founded in 1998. https://example.com/a' , design_use: 'fixture — what this finding changes', mutable: true});
    expect(clean.execution_status).toBe('ok');
  });

  it('produces a packet that passes validatePacket including the import-hash re-check', async () => {
    const paths = createPaths();
    const packet = await runResearch({ paths, site_id: 'site-valid-import', adapter: 'notebooklm-import', brief: BRIEF, raw_import: 'Founded in 1998. https://example.com/a' , design_use: 'fixture — what this finding changes', mutable: true});
    expect(validatePacket(packet, { paths, site_id: 'site-valid-import' }).valid).toBe(true);
  });
});

describe('journal and persistence side effects', () => {
  it('journals the run and persists a packet that list/read can find', async () => {
    const paths = createPaths();
    const journal = createJournal({ paths });
    const packet = await runResearch({ paths, journal, site_id: 'site-journaled', adapter: 'shay-native', brief: BRIEF, options: { spawnImpl: spawnReturning(EMPTY_MODEL_JSON), commandExistsImpl: () => true } });
    const entries = journal.read('site-journaled');
    expect(entries.some((e) => e.intent === 'research.run:shay-native')).toBe(true);
    const list = listPackets({ paths, site_id: 'site-journaled' });
    expect(list.map((p) => p.packet_id)).toContain(packet.packet_id);
  });
});

describe('cross-site isolation of research runs', () => {
  it('running research for one site never surfaces in another site\'s packet list', async () => {
    const paths = createPaths();
    await runResearch({ paths, site_id: 'site-iso-a', adapter: 'shay-native', brief: BRIEF, options: { spawnImpl: spawnReturning(EMPTY_MODEL_JSON), commandExistsImpl: () => true } });
    await runResearch({ paths, site_id: 'site-iso-b', adapter: 'shay-native', brief: BRIEF, options: { spawnImpl: spawnReturning(EMPTY_MODEL_JSON), commandExistsImpl: () => true } });
    const a = listPackets({ paths, site_id: 'site-iso-a' });
    const b = listPackets({ paths, site_id: 'site-iso-b' });
    expect(a.length).toBe(1);
    expect(b.length).toBe(1);
    expect(a[0].packet_id).not.toBe(b[0].packet_id);
  });
});
