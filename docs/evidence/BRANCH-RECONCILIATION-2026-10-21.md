# Site Studio Next source reconciliation evidence

Classification: `changed`, isolated source/local verification only.

- Owning repository: `https://github.com/famtastic-fritz/famtastic-studio.git`.
- Worktree: `/Users/famtastic-fritz/Development/FAMtastic/worktrees/branch-reconcile-site-studio-20261021`.
- Branch: `codex/branch-reconcile-site-studio-20261021`.
- Preserved local main: `d4b90e79b28a11e5aa2488ff23076c451abd8c1b`.
- Freshly fetched remote main: `112619b3e8cfd0c15bebdba7eccc8be3fe5224bd`.
- Integration method: branch from remote main, merge local main with `--no-commit --no-ff`.
- Canonical checkout main remains unchanged. No commit, push, runtime restart or deployment performed by this lane.

## Reconciliation and source review

Only `docs/CHANGELOG.md` and `docs/SITE-LEARNINGS.md` conflicted. Their dated
remote insertions and common/local history were retained. Both October 7 quality
discovery commits carry identical `config/local-quality-tools.json` bytes; no
second descriptor or source pin was invented. Remote Phase 2 cloud-shadow source,
Mac-safe parser and SMS catalog records are retained. Existing inert apply gates,
provider controls, routing boundaries and privacy doctrine remain in force.

Local foundation 1.2.0 source introduces generated communication intent records,
required central template versions and Shay signature with no direct mail sender.
Its generated manifest moves to contract 1.1.0 while runtime validation explicitly
retains legacy 1.0.0. Review caught a stale bundled JSON schema still restricted to
1.0.0. The repair aligns that schema to both supported versions and adds a new
regression proving generated-schema agreement and legacy validation without the
new communication files. Capability documentation distinguishes the local vendored
repair from publication in Component Studio. No sibling package was changed.

## Commands and results

Node `v24.19.0`; locked dependencies installed in this isolated worktree using
`npm ci --ignore-scripts --no-audit --no-fund` (219 packages). No lockfile or
package changes were made by installation. No frontend build output was produced.

| Command | Result |
| --- | --- |
| `fnm exec --using=24 -- npm run lint` | Pass, existing recorded line-limit exceptions retained |
| `fnm exec --using=24 -- npx vitest run tests/repo-scaffold.test.js tests/repository-creation-guard.test.js tests/library-discovery.test.js --maxWorkers=1` | 3 files, 12 tests pass |
| `fnm exec --using=24 -- npm test` | Initial default-concurrency attempt: 9 tests hit existing 5-second deadlines, 1,149 passed; no assertion failures recorded |
| `fnm exec --using=24 -- npm test -- --maxWorkers=1` | 101 files, 1,159 tests pass, unchanged deadlines |
| `fnm exec --using=24 -- bash infra/gcp/phase2/scripts/validate.sh` | Offline validation passes |
| `node /Users/famtastic-fritz/Development/FAMtastic/tools/research-quality/studio-consumer.cjs describe` | `ready:true`, three pinned capability IDs, explicit CLI handoff only |
| `git diff --check` | Pass |

The serial full run includes the added schema regression; the initial parallel
run began before it was added. Serial full-suite log:
`/tmp/site-studio-reconciliation-tests-20261021.log`. Offline validator log:
`/tmp/site-studio-reconciliation-infra-20261021.log`. Reducing worker contention
did not change product source behavior or increase a test deadline.

## Capability boundaries

| capability_id | Customer job / role | Entry and saved result | Evidence | Provider | Acceptance / consumption | Gap and next owner |
| --- | --- | --- | --- | --- | --- | --- |
| `studio.source-reconciliation` | Maintainer preserves two source histories | Isolated merge/index; coordinator owns commit/push | `local_tested`, source heads above, 2026-10-21 | `not_applicable` | `not_requested` / `not_applicable` | Coordinator reviews and integrates |
| `site-foundation.repository-contract` | Generator creates independent customer source | `createRepoScaffold`, manifest/schema/docs in temporary test roots | `local_tested`, generated and legacy contract regression | `not_applicable` | `not_requested` / `source_captured` | No fleet install or Component Studio republish proved |
| `studio.local-quality-discovery` | Operator identifies pinned local quality commands | Explicit `describe` from isolated checkout, no application state write | `local_tested`, descriptor source pins verified | `not_applicable` | `not_requested` / `discovered` | No automatic pipeline/UI/CI consumption |

No owner-facing task UI changed, so a new illustrated guide or owner-task exercise
is not applicable. Cloud activation, real model execution, customer sending,
canonical service consumption, deployment and owner acceptance remain unverified.
Historical PR/review and test-count records were preserved as dated records;
they are not fresh GitHub/production claims.
