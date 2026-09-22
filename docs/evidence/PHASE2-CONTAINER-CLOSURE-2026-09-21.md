# Phase 2 copied container closure, 2026-09-21

September22 follow-up: actual filtered Linux/AMD64 builds and non-root, networkless
SDK/entrypoint probes now pass. See `PHASE2-LINUX-IMAGES-2026-09-22.md`. This
supersedes the image-build limitation below, not its cloud activation boundary.
The former temporary raw receipts below are unavailable; the new receipt is
retained outside temporary storage.

Base: `2da81faf84f52d293758b7e0bb4715a46742dffd`.
Branch: `codex/mac-phase-cli-entry`.
Isolated worktree: `/tmp/famtastic-mac-phase-cli.vu42M5/studio`.

## Narrow source repair

The Mac CLI entry fix imported `server/kernel/cli-entry.js` from both cloud
entrypoints, but neither filtered image copied that file. Add that exact helper
to both Dockerfiles, both Dockerfile-specific context allowlists, and both role
inventories in `source-boundaries.yaml`. No broader kernel directory is admitted.
No runtime JS, package/lockfile, provisioning script or activation flag changed.
The conventions/DNA guidance keeps this receipt explicitly source-only.

## Executed red and green evidence

Node 24.19.0, Vitest 3.2.7. Package and lockfiles matched the existing candidate
byte-for-byte. The existing `node_modules` symlink was preserved; no install ran.

`tests/phase2-container-closure.test.js` copies the actual literal Docker COPY
inputs into fresh disposable roots, checking context admission and declared
source boundaries. It supports the current restricted packaging grammar, not
arbitrary Docker syntax. Node, not an import regex, evaluates each copied entry.

- Before the fix, both role imports failed in actual children with
  `ERR_MODULE_NOT_FOUND` for the missing copied `cli-entry.js`.
- All 17 new tests pass. The 17 child processes prove inert role imports, exact
  exit-1 `phase2_config_invalid` direct entry, missing-COPY failure, and computed
  specifier/file-URL imports with the helper present and then absent. Separate
  assertions reject omissions from the context filter and source inventory.
- Three of those children intentionally attempt fetch, loopback connection or
  listening. The preload blocks them and forces exit 97 even when caught.
- Final adjacent verification: 64/64 tests in five files, both lints, offline
  infrastructure validation and whitespace checks pass. The Mac CLI tests also
  execute and validate both synthetic proof scripts under both symlink modes.

Final command, through the existing isolation wrapper:

```sh
node /tmp/famtastic-phase2-review.NVAfPl/run-integration-check.mjs phase2-container-closure-final \
  'cd /tmp/famtastic-mac-phase-cli.vu42M5/studio && node node_modules/vitest/vitest.mjs run tests/phase2-container-closure.test.js tests/mac-phase-cli-entry.test.js tests/durable-execution-phase2-entrypoints.test.js tests/invariant-p0-i1.test.js tests/phase2-yaml-validation.test.js --no-file-parallelism --maxWorkers=1 --no-cache && npm run lint && bash infra/gcp/phase2/scripts/validate.sh && git diff --check'
```

Wrapper: exit 0, 8,383 ms, `stoppedFor: null`, `protectedDataUnchanged: true`.
The 200 MiB disk guard stayed satisfied; the nearby final check showed
2,697,436 KiB available. Children have empty environments and inherit the
wrapper's external-network, authoritative-data and credential-directory denial.
Their additional preload denies loopback and listening, including caught calls.

Receipts and bounded logs remain under `/tmp/famtastic-phase2-review.NVAfPl/`:

- `phase2-container-closure-red.wvbBS0`: initial missing-inventory assertion.
- `phase2-container-closure-red-child.qclh6C`: both actual child import failures.
- `phase2-container-closure-green.30G3kN`: 17/17 focused tests.
- `phase2-container-closure-final.D509iB`: 64/64 adjacent checks and validation.

## Limits and unchanged activation boundary

This verifies copied application source on the installed Mac Node runtime with
existing dependencies. It does not prove a clean production dependency install,
a Linux image build, every unexecuted lazy SDK branch, or a cloud deployment.
No image build, provider/auth/preflight call, real database access, customer
write, full suite, deploy or push occurred. The parent integration checkout was
not changed.

`apply-inert.sh` remains byte-for-byte unchanged and hard-disabled before any
cloud call. Create-only provisioning is not implemented here. As the parent
verified in the official references, Cloud Tasks queue state is output-only
and changed by pause/resume ([queue reference](https://docs.cloud.google.com/tasks/docs/reference/rest/v2/projects.locations.queues));
empty or missing Cloud Run traffic defaults to all traffic on the latest ready
revision ([service reference](https://docs.cloud.google.com/run/docs/reference/rest/v2/projects.locations.services)).
Those remaining provisioning constraints are not grounds to relax the guard.
