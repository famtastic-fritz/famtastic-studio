#!/usr/bin/env node
// Interactive Shay CLI session
// Usage: node scripts/shay-cli.mjs [optional initial prompt]

import readline from 'node:readline';
import { createPaths } from '../server/kernel/paths.js';
import { createShayRoutine } from '../server/kernel/shay-routine.js';

const paths = createPaths({ config: { sites_root: 'sites', data_root: '.studio' } });
const routine = createShayRoutine({ paths });
const conversationId = `shay-cli-${Date.now()}`;

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
  prompt: '\x1b[35mshay › \x1b[0m',
});

console.log('\x1b[1m\x1b[35m=== Shay AI Boss — Interactive Console ===\x1b[0m');
console.log('\x1b[2mType your request naturally. Shay will clarify details and wait for your build command.\x1b[0m\n');

async function handleInput(line) {
  const text = line.trim();
  if (!text) {
    rl.prompt();
    return;
  }

  if (text.toLowerCase() === 'exit' || text.toLowerCase() === 'quit') {
    console.log('\x1b[2mSession closed.\x1b[0m');
    process.exit(0);
  }

  try {
    const response = await routine.handleConversationalTurn({
      prompt: text,
      conversationId,
    });

    console.log(`\n\x1b[36mShay:\x1b[0m ${response.text}`);

    if (response.card) {
      console.log(`\n\x1b[33m[Card: ${response.card.title}]\x1b[0m`);
      console.log(`\x1b[2m${response.card.body}\x1b[0m`);
      if (response.card.actions) {
        console.log(`\x1b[32mActions: ${response.card.actions.map(a => `[${a.label}]`).join(' ')}\x1b[0m`);
      }
    }

    if (response.result && response.result.outcome === 'success') {
      console.log(`\n\x1b[32m✓ Site ${response.site_id} is live and ready in Canvas Editor!\x1b[0m`);
    }
  } catch (err) {
    console.error(`\x1b[31mError: ${err.message}\x1b[0m`);
  }

  console.log('');
  rl.prompt();
}

const initialArg = process.argv.slice(2).join(' ');
if (initialArg) {
  console.log(`\x1b[35mshay › \x1b[0m${initialArg}`);
  handleInput(initialArg).then(() => {
    rl.on('line', handleInput);
  });
} else {
  rl.prompt();
  rl.on('line', handleInput);
}
