#!/usr/bin/env node
// Explicit local capability module required. No bundled live provider and no
// ambient credential discovery. Configure separately after activation review.
import { pathToFileURL } from 'node:url';
import path from 'node:path';
const runtimeFile = process.argv[2];
if (!runtimeFile || !path.isAbsolute(runtimeFile)) {
  console.error('Usage: node scripts/selected-staging-worker.mjs /absolute/reviewed-runtime.mjs [--once]');
  process.exit(2);
}
const { createRuntime } = await import(pathToFileURL(runtimeFile));
const runtime = await createRuntime();
let stopping = false;
process.on('SIGTERM', () => { stopping = true; });
process.on('SIGINT', () => { stopping = true; });
do {
  try {
    const jobs = await runtime.wake();
    for (const job of jobs) console.log(JSON.stringify({ job_id: job.id, state: job.state, stage: job.stage }));
  } catch (error) { console.error(JSON.stringify({ code: error.code || 'worker_failed' })); }
  if (process.argv.includes('--once') || stopping) break;
  await new Promise(resolve => setTimeout(resolve, 5000));
} while (!stopping);
runtime.close();
