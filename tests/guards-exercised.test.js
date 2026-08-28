import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createPaths, loadPathsConfig } from '../server/kernel/paths.js';
import { createDna } from '../server/kernel/dna.js';
import { createMutation } from '../server/kernel/mutation.js';
import { createJournal } from '../server/kernel/journal.js';
import { createEvents } from '../server/kernel/events.js';

// A guard that has never fired is indistinguishable from one that cannot fire.
// deriveSpecFromPacket's packet_required guard called a helper its module never
// defined: it threw a ReferenceError instead of its structured error and had
// never once worked, because no test took that path.
//
// A structural sweep confirmed that was the only module throwing an undefined
// helper, so the remaining untested guards are undemonstrated rather than
// broken. These exercise the ones on the DNA and mutation paths, which carry the
// replay manifest and the undo trail. Each asserts the CODE, because the code is
// the contract and the message is prose.

let tmp;
const orig = process.env[loadPathsConfig().data_root_env];
beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'guards-'));
  process.env[loadPathsConfig().data_root_env] = tmp;
});
afterEach(() => {
  if (orig === undefined) delete process.env[loadPathsConfig().data_root_env];
  else process.env[loadPathsConfig().data_root_env] = orig;
  fs.rmSync(tmp, { recursive: true, force: true });
});

function throwsCode(fn, code) {
  try {
    fn();
    throw new Error(`expected ${code}, but nothing was thrown`);
  } catch (e) {
    expect(e.code).toBe(code);
    // A guard that fires with no message is only half a guard.
    expect(typeof e.message).toBe('string');
    expect(e.message.length).toBeGreaterThan(0);
    return e;
  }
}

describe('DNA guards actually fire', () => {
  const dna = () => createDna({ paths: createPaths() });
  const ok = { source_commit: 'c', tree_hash: 't', stage_graph: [{ stage: 'research' }] };

  it('startRun refuses a run with no source_commit, tree_hash or stage_graph', () => {
    throwsCode(() => dna().startRun({ ...ok, source_commit: null }), 'dna_source_commit_required');
    throwsCode(() => dna().startRun({ ...ok, tree_hash: null }), 'dna_tree_hash_required');
    throwsCode(() => dna().startRun({ ...ok, stage_graph: [] }), 'dna_stage_graph_required');
  });

  it('recordStage refuses a stage with no run_id, stage or status', () => {
    throwsCode(() => dna().recordStage({ stage: 'research', status: 'success' }), 'dna_run_id_required');
    throwsCode(() => dna().recordStage({ run_id: 'r', status: 'success' }), 'dna_stage_required');
    throwsCode(() => dna().recordStage({ run_id: 'r', stage: 'research' }), 'dna_status_required');
  });

  // A retry pointing at an attempt that does not exist would silently orphan the
  // retry chain in the replay manifest.
  it('recordStage refuses a retry_of that references an unknown attempt', () => {
    const d = dna();
    const { run_id } = d.startRun(ok);
    throwsCode(
      () => d.recordStage({ run_id, stage: 'research', status: 'success', retry_of: 'attempt_nope' }),
      'dna_retry_of_unknown',
    );
  });

  it('finishRun refuses a run with no outcome, and an unknown run_id', () => {
    const d = dna();
    const { run_id } = d.startRun(ok);
    throwsCode(() => d.finishRun({ run_id }), 'dna_outcome_required');
    throwsCode(() => d.finishRun({ run_id: 'run_nope', outcome: { status: 'success' } }), 'dna_run_not_found');
  });
});

describe('mutation guards actually fire', () => {
  const kit = () => {
    const paths = createPaths();
    return createMutation({ paths, journal: createJournal({ paths }), events: createEvents({ paths }) });
  };

  it('refuses a mutation with no intent and one with no changes', () => {
    throwsCode(() => kit().apply({ site_id: 's', initiator: 'test', changes: [{ path: 'a.html', contents: 'x' }] }), 'intent_required');
    throwsCode(() => kit().apply({ site_id: 's', initiator: 'test', intent: 'i', changes: [] }), 'no_changes');
  });

  // Path containment is the boundary three separate escapes already got through.
  it('refuses a change path that escapes the site', () => {
    throwsCode(
      () => kit().apply({ site_id: 's', initiator: 'test', intent: 'i', changes: [{ path: '../other/x.html', contents: 'x' }] }),
      'invalid_change_path',
    );
  });

  it('refuses an undo with no token', () => {
    throwsCode(() => kit().undo({ site_id: 's', initiator: 'test' }), 'undo_token_required');
  });
});
