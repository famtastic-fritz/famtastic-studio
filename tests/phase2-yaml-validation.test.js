import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, it, expect } from 'vitest';

describe('offline Phase 2 safe YAML parsing', () => {
  const script = 'infra/gcp/phase2/scripts/validate-yaml.sh';
  it.each([
    ['mapping', 'phase: 2\npaused: true\n', true],
    ['malformed', 'broken: [\n', false],
    ['aliases', 'a: &a [1]\nb: *a\n', false],
    ['object tags', 'a: !ruby/object:Object {}\n', false],
  ])('%s has the expected validation result', (_name, content, accepted) => {
    const dir = mkdtempSync(path.join(tmpdir(), 'phase2-yaml-'));
    try {
      const file = path.join(dir, 'fixture.yaml');
      writeFileSync(file, content);
      const result = spawnSync('bash', [script, file], { encoding: 'utf8' });
      expect(result.error).toBeUndefined();
      expect(result.status === 0, result.stderr).toBe(accepted);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
  it('fails closed when no parser is available', () => {
    const result = spawnSync('/bin/bash', [script], {
      env: { PATH: '/nonexistent-phase2-parser-path' }, encoding: 'utf8',
    });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('no safe YAML parser');
  });
});
