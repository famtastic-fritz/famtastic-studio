# Repository standards implementation

## Purpose

Prevent cross-business source ownership and knowledge loss during generation.

## Goal

Every supported new-site path creates and preserves the same independent source
contract, with portable read-only library discovery.

## Tasks

- [x] Ground the independent checkout and read conventions/Build DNA skills.
- [x] Implement foundation, preflight and fresh-clone proof.
- [x] Integrate direct, conversational and retry paths; preserve authored files.
- [x] Replace sibling imports and invented remote URLs.
- [x] Add portable pinned catalog tests and standalone source records.
- [x] Complete final test/browser pass and catalog pins.
- [ ] Complete scoped push and coordinated existing-runtime cutover after job/data preflight.

## Status

Source implementation and local verification complete; publication and runtime
cutover preflight in progress.

## Started

2026-09-14

## Ended

Pending final proof.

## Execution

Independent checkout Development/FAMtastic-Repos/site-studio-next on
codex/repository-standards. Main landing only after tests and remote reconciliation.
Initial lane excluded service restart. The orchestrator subsequently authorized
a scoped local launchd cutover only after preserving the actual runtime data and
proving there are no active jobs to interrupt.

## Research

See docs/research/REPOSITORY-RECONCILIATION-2026-09-14.md.

## Review

Adversarial identity, remote, common-directory, duplicate, dirty-state and rebuild
tests. Fresh clone runs the validator without any neighboring FAMtastic checkout.

## Skills

site-studio-conventions and dna-capture govern module boundaries and stage evidence.

## Proof

Full Vitest suite: 930 passed across 78 files. Foundation: 5 tests passed.
Browser: both libraries at 390/768/1280, no clipping or page exceptions. See
docs/evidence/repository-reconciliation-2026-09-14/README.md.
