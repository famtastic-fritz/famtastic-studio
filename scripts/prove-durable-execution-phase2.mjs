#!/usr/bin/env node
import { isDirectExecution } from '../server/kernel/cli-entry.js';
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

if (isDirectExecution(import.meta.url)) {
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
