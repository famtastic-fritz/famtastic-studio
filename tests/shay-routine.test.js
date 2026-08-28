import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createPaths, loadPathsConfig } from '../server/kernel/paths.js';
import { createShayRoutine, parsePromptToBrief } from '../server/kernel/shay-routine.js';
import { stubResearchOptions } from './research-stub.mjs';
import { makeCopyStub } from './copy-stub.mjs';

let tmpRoot;
let prevEnvValue;
const config = loadPathsConfig();

beforeEach(() => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-next-shay-routine-'));
  prevEnvValue = process.env[config.data_root_env];
  process.env[config.data_root_env] = tmpRoot;
});

afterEach(() => {
  if (prevEnvValue === undefined) delete process.env[config.data_root_env];
  else process.env[config.data_root_env] = prevEnvValue;
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

describe('Shay Conversational Intake & Site Creation Routine', () => {
  it('parses natural conversational prompt into structured site brief', () => {
    const prompt = "shay build me a site for my home boy, trucking business... Big Mike's Movers in Port St. Lucie, colorful with a 50% discount coupon hook";
    const { site_id, brief } = parsePromptToBrief(prompt);

    expect(site_id).toBe('site-big-mikes-movers');
    expect(brief.business.name).toBe("Big Mike's Movers");
    expect(brief.business.location).toBe('Port St. Lucie');
    expect(brief.business.style).toBe('vibrant-colorful');
    expect(brief.business.coupon_hook).toMatch(/50%/);
  });

  it('runs intake, builds site on disk, and records Shay conversation cards', async () => {
    const paths = createPaths();
    const routine = createShayRoutine({
      paths,
      researchOptions: stubResearchOptions,
      copyOptions: makeCopyStub(),
    });

    const result = await routine.executeIntakeAndBuild({
      prompt: "build me a site for Big Mike's Movers in Port St. Lucie",
      conversationId: 'convo_test_123',
    });

    expect(result.site_id).toBe('site-big-mikes-movers');
    expect(result.outcome).toBe('success');
    expect(result.pages.length).toBeGreaterThan(0);

    const siteDir = paths.within('sites', 'site-big-mikes-movers');
    expect(fs.existsSync(path.join(siteDir, 'index.html'))).toBe(true);
    expect(fs.existsSync(path.join(siteDir, 'spec.json'))).toBe(true);
    expect(fs.existsSync(path.join(siteDir, 'styles.css'))).toBe(true);
  });

  it('conducts multi-turn conversational intake dialogue and waits for build confirmation', async () => {
    const paths = createPaths();
    const routine = createShayRoutine({
      paths,
      researchOptions: stubResearchOptions,
      copyOptions: makeCopyStub(),
    });

    const convoId = 'convo_multiturn_777';

    // Turn 1: Vague initial idea
    const turn1 = await routine.handleConversationalTurn({
      prompt: 'shay build me a site for my home boy, trucking business',
      conversationId: convoId,
    });
    expect(turn1.text).toMatch(/what's the name/i);
    expect(turn1.result).toBeUndefined(); // Did not build yet

    // Turn 2: Details supplied
    const turn2 = await routine.handleConversationalTurn({
      prompt: "name is Big Mike's Movers in Port St. Lucie, make it colorful, give him a 50% discount coupon",
      conversationId: convoId,
    });
    expect(turn2.text).toMatch(/plan for Big Mike's Movers/i);
    expect(turn2.card).toBeDefined();
    expect(turn2.card.type).toBe('proposal');
    expect(turn2.result).toBeUndefined(); // Proposed, but waiting for confirmation

    // Turn 3: Operator says build it
    const turn3 = await routine.handleConversationalTurn({
      prompt: 'build it',
      conversationId: convoId,
    });
    expect(turn3.site_id).toBe('site-big-mikes-movers');
    expect(turn3.result).toBeDefined();
    expect(turn3.result.outcome).toBe('success');

    const siteDir = paths.within('sites', 'site-big-mikes-movers');
    expect(fs.existsSync(path.join(siteDir, 'index.html'))).toBe(true);
  });

  it('builds a blank red hello world site with local git repo from user prompt', async () => {
    const paths = createPaths();
    const routine = createShayRoutine({
      paths,
      researchOptions: stubResearchOptions,
      copyOptions: makeCopyStub(),
    });

    const prompt = 'create a blank red test site is the nam do everythin from set up a local to the git repo, a resd hello world set up.';
    const { site_id, brief } = parsePromptToBrief(prompt);

    expect(site_id).toBe('site-blank-red-test-site');
    expect(brief.business.name).toBe('Blank Red Test Site');
    expect(brief.business.style).toBe('crimson-red');
    expect(brief.site_needs.pages).toEqual(['home']);

    const result = await routine.executeIntakeAndBuild({
      prompt,
      conversationId: 'convo_blank_red_test',
    });

    expect(result.site_id).toBe('site-blank-red-test-site');
    expect(result.outcome).toBe('success');

    const siteDir = paths.within('sites', 'site-blank-red-test-site');
    expect(fs.existsSync(path.join(siteDir, 'index.html'))).toBe(true);
    expect(fs.existsSync(path.join(siteDir, 'styles.css'))).toBe(true);
    expect(fs.existsSync(path.join(siteDir, 'spec.json'))).toBe(true);
    expect(fs.existsSync(path.join(siteDir, '.git'))).toBe(true);
    expect(fs.existsSync(path.join(siteDir, '.gitignore'))).toBe(true);
    expect(fs.existsSync(path.join(siteDir, 'CLAUDE.md'))).toBe(true);

    const cssContent = fs.readFileSync(path.join(siteDir, 'styles.css'), 'utf8');
    expect(cssContent).toMatch(/--accent:\s*#e11d48/);
  });
});
