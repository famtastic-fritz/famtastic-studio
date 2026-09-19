#!/usr/bin/env node
import { pathToFileURL } from 'node:url';
import { runDurableExecutionProof } from '../tests/helpers/durable-execution-proof.js';

export function proveDurableExecution() {
  return runDurableExecutionProof();
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    console.log(JSON.stringify(proveDurableExecution(), null, 2));
  } catch (error) {
    console.error(JSON.stringify({
      proof_scope: 'synthetic_fixture_only',
      status: 'failed',
      error: error.code || error.name,
      message: error.message,
    }, null, 2));
    process.exitCode = 1;
  }
}
