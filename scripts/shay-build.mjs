#!/usr/bin/env node
// Shay CLI Build Routine Runner
// Usage: node scripts/shay-build.mjs "build me a site for Big Mike's Movers in Port St. Lucie"

import { createPaths } from '../server/kernel/paths.js';
import { createShayRoutine } from '../server/kernel/shay-routine.js';
import { stubResearchOptions } from '../tests/research-stub.mjs';
import { makeCopyStub } from '../tests/copy-stub.mjs';

const promptArg = process.argv.slice(2).join(' ') || "build a site for Big Mike's Movers in Port St. Lucie, colorful with 50% coupon";

console.log(`[shay-cli] Intake prompt: "${promptArg}"`);

const paths = createPaths();
const routine = createShayRoutine({
  paths,
  researchOptions: stubResearchOptions,
  copyOptions: makeCopyStub(),
});

console.log('[shay-cli] Shay parsing prompt to structured brief...');
const { site_id, brief } = routine.parsePromptToBrief(promptArg);
console.log(`[shay-cli] Target Site ID: ${site_id}`);
console.log(`[shay-cli] Business: ${brief.business.name} (${brief.business.location}) | Style: ${brief.business.style}`);

console.log('[shay-cli] Dispatching autonomous build pipeline...');
const result = await routine.executeIntakeAndBuild({
  prompt: promptArg,
  conversationId: 'shay-cli-session',
});

console.log(`[shay-cli] Build completed with outcome: ${result.outcome}`);
console.log(`[shay-cli] Pages generated: ${result.pages.map((p) => p.path).join(', ')}`);
console.log(`[shay-cli] Site is now live in Site Studio! Open /site?site_id=${site_id}`);
