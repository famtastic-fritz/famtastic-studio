# Independent Codex verification prompt

Copy everything below into a fresh Codex session with access to the Mac and the
local repository.

```text
Act as an independent verifier. Do not trust the implementation summary. Prove
or disprove the durable execution Phase 1 branch with direct evidence.

Repository:
/Users/famtastic-fritz/Development/FAMtastic-Repos/site-studio-next

Candidate branch:
codex/durable-execution-phase1-20260919

Fallback patch if the branch is not on origin:
~/Downloads/famtastic-durable-execution-phase1.patch

Required fallback base commit:
b43e440fdfb8a25b2bc81c3c879c01d52df7a33b

Safety rules:
- Do not merge, rebase, force-push, deploy, start a worker, enable a schedule,
  call a real model, send a callback/message, or change any Google/Oracle cloud
  resource.
- Do not write to ~/.config/famtastic/studio.db or its WAL/SHM files.
- Preserve every existing local change. Use a separate temporary Git worktree.
- Run execution code only with FAMTASTIC_EXECUTION_MODE=mock and
  FAMTASTIC_EXECUTION_SCOPE=phase1-disposable.
- If branch drift or an unsafe precondition appears, stop and report it. Do not
  silently repair or reinterpret evidence.

1. Inspect the original checkout with git status, branch, HEAD, worktree/common
   directory and origin. Read AGENTS.md, CONVENTIONS.md, both required skills,
   design.md, SITE-LEARNINGS.md, CONVERSATIONS.md and
   docs/contracts/CLIENT-SELECTED-BUILD-FLOW.md.

2. Fetch origin and try to resolve
   origin/codex/durable-execution-phase1-20260919. If it exists, create a
   temporary detached worktree at that exact SHA. If it does not exist, require
   the fallback patch above, verify that the required base commit exists, create
   the temporary detached worktree at that base and apply the patch there with
   `git am --3way`. Do not switch or modify the owner's existing checkout. Do
   not apply the patch on any other base. Compare the candidate with its merge
   base and current default branch. Report material overlapping drift and which
   candidate source you used.

3. Inspect every changed file. Independently verify:
   - task, job, dispatch intent and initial transition commit atomically before
     any 202 response;
   - identical duplicates return the original receipt and conflicting reuse is
     409;
   - a failed SQLite transaction returns non-202 with no partial durable rows;
   - journal and event writes are post-commit idempotent projections and pending
     projections can be reconciled;
   - controls default paused/off, pause is rechecked before execution, leases
     expire, fencing rejects stale workers, retries are bounded and exhausted
     work reaches dead letter;
   - only the internal deterministic mock can execute, model cost stays zero and
     callback, outbound, publish and deploy effects cannot complete;
   - artifacts are deterministic, no-overwrite and recover after file-write to
     database-commit interruption;
   - the Phase 1 manual gate is not mislabeled as routine Fritz approval;
   - reconciliation scopes only phase1_mock and never catches up legacy jobs or
     enabled schedules.

4. In the candidate worktree run:
   npm ci
   npm run lint
   npx vitest run tests/durable-execution-schema.test.js tests/durable-execution-store.test.js tests/durable-execution-runtime.test.js tests/durable-execution-recovery.test.js tests/staging-acceptance.test.js tests/kernel-journal-durable.test.js
   npm run prove:execution
   npm test
   git diff --check

   Record exact pass/fail totals. Separate candidate failures from pre-existing
   environment failures such as a missing Playwright browser. Do not call a test
   green if it did not run.

5. Prove migration against a disposable online backup of the authoritative Mac
   database. First locate the actual database and confirm it is the assessed
   Studio database. Use sqlite3 .backup or the SQLite online backup API, never a
   raw copy of an active database. Put the disposable copy at:
   $VERIFY_ROOT/.studio/execution/studio.phase1-disposable.db
   where VERIFY_ROOT is a new mktemp directory. Set the execution directory to
   mode 0700 and the copied DB to 0600. Export:
   STUDIO_DATA_ROOT=$VERIFY_ROOT
   FAMTASTIC_EXECUTION_MODE=mock
   FAMTASTIC_EXECUTION_SCOPE=phase1-disposable
   FAMTASTIC_AGENT_DB_PATH=$VERIFY_ROOT/.studio/execution/studio.phase1-disposable.db

6. Before migration, run integrity_check and foreign_key_check on the disposable
   copy. Record application_id, schema, table counts and stable ordered row hashes
   for the real legacy job, schedule and performance tables. Confirm or correct
   the assessed counts of 448 parked jobs, seven schedules and three performance
   records. If names differ, identify them from schema evidence rather than
   guessing.

7. Open only the disposable copy through createExecutionStore with safeRoot set
   to $VERIFY_ROOT/.studio/execution. Run migration twice. Re-run integrity,
   foreign keys, legacy counts and ordered row hashes. They must be unchanged.
   Confirm the original database path, inode metadata and files were never used
   as FAMTASTIC_AGENT_DB_PATH. If a nonzero foreign application_id blocks the
   copy, report the blocker and do not bypass the guard.

8. Against only the disposable copy, test one correctly signed staging packet,
   one identical duplicate, one same-key content conflict and one forced outbox
   insert abort. Prove the 202 has task/job/outbox rows, the duplicate has the
   original receipt, the conflict is 409 and the forced abort has no partial
   rows. Keep dispatch and worker controls off for this database exercise.

9. Search the diff and history for credentials, absolute private paths,
   FAMTASTIC_PROOF variables, real provider SDK calls, cloud mutation commands,
   schedule activation, callback/message code and deploy calls. Report exact
   findings. Confirm no file exceeds 500 lines and no em dash was introduced.

10. Produce one PASS or FAIL receipt containing:
    - candidate branch and tested SHA;
    - merge-base/default-branch drift;
    - exact commands and test totals;
    - synthetic proof JSON summary;
    - authoritative-copy pre/post integrity, counts and hashes;
    - proof that the original DB and all cloud/external systems were untouched;
    - each invariant above with evidence paths;
    - unresolved risks and the smallest required fixes.

Do not merge, push, deploy or enable anything after verification. Stop with the
receipt so Fritz can decide the next step.
```
