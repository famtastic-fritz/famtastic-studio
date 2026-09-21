#!/usr/bin/env node
import { pathToFileURL } from 'node:url';
import { runPhase2ShadowProof } from '../tests/helpers/durable-execution-phase2-proof.js';
import {
  assertPhase2HttpCheckpointProofReport,
  runPhase2HttpCheckpointProof,
} from '../tests/helpers/phase2-proof-http.js';

export async function proveDurableExecutionPhase2() {
  const shadow = await runPhase2ShadowProof();
  const httpCheckpoint = assertPhase2HttpCheckpointProofReport(
    await runPhase2HttpCheckpointProof(),
  );
  return { ...shadow, in_process_http_checkpoint: httpCheckpoint };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    console.log(JSON.stringify(await proveDurableExecutionPhase2(), null, 2));
  } catch (error) {
    console.error(JSON.stringify({
      proof_scope: 'phase2_composed_in_process_http_fixture',
      status: 'failed',
      error: error.code || error.name,
      message: error.message,
    }, null, 2));
    process.exitCode = 1;
  }
}
