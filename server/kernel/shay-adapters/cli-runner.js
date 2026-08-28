// Low-level process plumbing shared by every Shay CLI adapter. Nothing here
// knows about Shay, envelopes, or cards -- it only knows how to run one CLI
// invocation to completion (or kill it) and how to pull a JSON object out of
// whatever the CLI printed. This is the one place a child process gets
// spawned, so it is the one place tests inject a stub in place of the real
// `node:child_process`.
import { spawn as nodeSpawn, spawnSync } from 'node:child_process';

// Sync, cheap, no network: "is this CLI on PATH at all". Overridable per
// adapter instance so tests never depend on what happens to be installed on
// the machine running them.
export function commandExists(command) {
  try {
    const result = spawnSync('which', [command], { encoding: 'utf8' });
    return result.status === 0 && Boolean(result.stdout && result.stdout.trim());
  } catch {
    return false;
  }
}

// Runs one CLI invocation and collects stdout/stderr fully in memory -- these
// are single JSON-sized replies, never a stream worth chunk-processing.
// stdin is always closed immediately: codex exec in particular will sit
// waiting on stdin that never arrives if it is left open, and a hang here is
// exactly the failure mode the timeout below exists to survive rather than
// mask. On timeout the child is sent SIGTERM, then SIGKILL after a short
// grace period if it is still alive -- a wedged CLI must not wedge the
// server that spawned it.
export function runCli({ command, args, timeoutMs = 45000, spawnImpl = nodeSpawn, cwd } = {}) {
  return new Promise((resolve) => {
    let stdout = '';
    let stderr = '';
    let settled = false;
    let timedOut = false;
    let child;

    const timer = setTimeout(() => {
      timedOut = true;
      if (!child) return;
      try { child.kill('SIGTERM'); } catch { /* already gone */ }
      const killTimer = setTimeout(() => {
        try { child.kill('SIGKILL'); } catch { /* already gone */ }
      }, 3000);
      killTimer.unref?.();
    }, timeoutMs);
    timer.unref?.();

    function finish(partial) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ exitCode: null, signal: null, stdout, stderr, timedOut, spawnError: null, ...partial });
    }

    try {
      child = spawnImpl(command, args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (error) {
      finish({ ok: false, spawnError: error });
      return;
    }

    child.stdout?.on('data', (chunk) => { stdout += chunk.toString('utf8'); });
    child.stderr?.on('data', (chunk) => { stderr += chunk.toString('utf8'); });
    child.on('error', (error) => finish({ ok: false, spawnError: error }));
    child.on('close', (code, signal) => finish({ ok: !timedOut && code === 0, exitCode: code, signal }));
  });
}

// Pulls a JSON object out of CLI stdout that may carry a banner, a reasoning
// trace, a leading bullet, or a ```json fence``` around the real answer.
// Tries, in order: the whole trimmed output as-is; every fenced block
// (```json ... ```), most-recent first; then every balanced top-level
// {...} region found by brace counting, most-recent first -- these CLIs
// print their thinking before the final answer, not after, so the last
// balanced block is the best guess. The first candidate that parses as an
// object wins.
export function extractJson(text) {
  if (typeof text !== 'string') return { ok: false, reason: 'not_a_string' };
  const trimmed = text.trim();
  if (!trimmed) return { ok: false, reason: 'empty_output' };

  const candidates = [trimmed];

  const fenceRe = /```(?:json)?\s*([\s\S]*?)```/gi;
  const fenced = [];
  let match;
  while ((match = fenceRe.exec(trimmed))) fenced.push(match[1].trim());
  candidates.push(...fenced.reverse());

  const braceBlocks = [];
  let depth = 0;
  let start = -1;
  for (let i = 0; i < trimmed.length; i += 1) {
    const ch = trimmed[i];
    if (ch === '{') {
      if (depth === 0) start = i;
      depth += 1;
    } else if (ch === '}') {
      if (depth > 0) {
        depth -= 1;
        if (depth === 0 && start >= 0) {
          braceBlocks.push(trimmed.slice(start, i + 1));
          start = -1;
        }
      }
    }
  }
  candidates.push(...braceBlocks.reverse());

  for (const candidate of candidates) {
    if (!candidate) continue;
    try {
      const parsed = JSON.parse(candidate);
      if (parsed && typeof parsed === 'object') return { ok: true, value: parsed, matched: candidate };
    } catch {
      // try the next candidate
    }
  }
  return { ok: false, reason: 'unparseable', sample: trimmed.slice(0, 400) };
}
