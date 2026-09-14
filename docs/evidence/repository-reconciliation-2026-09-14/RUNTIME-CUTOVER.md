# Local Studio runtime cutover

2026-09-14, after source a2cd89263d0138f69b32685cbe940d8e4888819f was pushed and
its remote main ref was read back. The orchestrator authorized this follow-on
after the initial source-only lane. No customer website runtime was restarted.

## Preflight and preservation

- Existing launchd label: com.famtastic.studio-next, gui/501.
- Old PID: 5623; no child process, active TCP connection or recorded build run.
- Actual existing data root: `/Users/famtastic-fritz/Development/famtastic-wt-phase-0/.studio-next-data`.
- Existing store inventory: zero files, two directories. This was verified on
  the running service before the cutover, not replaced with a newly empty store.
- The existing Node executable, PATH, log files, port 3400, loopback binding and
  exact STUDIO_DATA_ROOT remained unchanged.
- Previous plist retained at
  `/Users/famtastic-fritz/.local/state/famtastic/repository-reconciliation-2026-09-14/com.famtastic.studio-next.previous.plist`.

## Applied and observed

Launchd WorkingDirectory now points to the independent
`/Users/famtastic-fritz/Development/FAMtastic-Repos/site-studio-next` checkout.
STUDIO_REPOSITORIES_ROOT points to FAMtastic-Repos. The preferred
FAMTASTIC_REPOSITORY_CHECKOUTS map points to the two independent libraries.

The immediate bootstrap after bootout returned macOS error 5. A second bootstrap
after confirming the service was absent succeeded. New PID 38688 was observed
listening only on 127.0.0.1:3400; lsof verified its actual new working directory.

- GET /api/libraries: both libraries available, Component pin 7745a9fe (6
  records), Media pin 8d6371f2 (4 records).
- GET /api/admin/paths: unchanged actual data root and new independent site root.
- GET /api/builds: zero runs before and after.
- Data inventory: zero files/two directories before and after.
- Real guarded POST /api/pipeline/run with site_id=site-studio-next: 409
  repository_identity_required, with no target writes or new DNA files. The
  generator correctly refused to adopt its own non-customer source repository.

## Rollback

Inspect active jobs first. Restore the exact prior plist from the saved path,
but update its WorkingDirectory to the preserved old checkout at
`/Users/famtastic-fritz/Development/FAMtastic-Repos/retired-nested-checkouts.Ty4jPH/site-studio-next`:
the orchestrator relocated that intact nested repository after cutover, so the
saved old directory must not be used verbatim. Its node_modules and original Git
HEAD were checked. Validate with plutil, bootout only gui/501/com.famtastic.studio-next,
then bootstrap that label's plist. The exact actual data root remains unchanged.
Read back cwd, data root, build inventory and loopback port after rollback. Do not
erase the independent repos or replace customer business data. This describes
rollback; no rollback was needed or executed.

## Static build/public-boundary follow-on

Source a7bd14e770c169dde12ac145e62657fd7659ccb1 was pushed to main and the scoped
branch and read back before reloading. This adds real generated-clone npm build,
lockfiles/tests/CI and allowlisted static output/preview/deployment. All 932 tests
across 79 files, lint and the five unchanged foundation tests passed.

Before reload, PID 38688 had no children and GET /api/builds reported zero runs.
`launchctl kickstart -k gui/501/com.famtastic.studio-next` succeeded. New PID 99610
has the independent checkout as cwd and listens only on 127.0.0.1:3400. Read-back
checks confirmed both pinned libraries available, the same exact old data root,
zero runs and zero files/two directories in that data root. A fresh guarded POST
to /api/pipeline/run?site_id=site-studio-next returned 409 repository_identity_required
without new data or source writes. No customer site process was restarted.

## Existing-site compatibility and output ownership

Source 5a75508f88269399207db8198da4f8be2b23d044 (including ownership change
631456b793396fd1d971c2876aeb82170ec37fae) passed all 936 tests across 80 files
and lint before push/ref readback. The generated builder now refuses tracked,
unowned, changed or extra dist contents, and supports the same explicit-array
public manifests used by existing governed sites. Exact root .htaccess is
packaged for Apache but remains inaccessible from the local preview server.

After another zero-job/no-child preflight, the existing local service was reloaded
to PID 72336. Its cwd/data root were unchanged, both catalogs remained available,
and data inventory remained zero files/two directories. Read-only POST
/api/sites/plan-deploy?site_id=site-famtastic-inc returned 200, 13 files including
.htaccess, and dispatched:false. Its manifest hash
`a895dc1d7d2c806f93429561962a7bb394deb7a693c16f5d6144f841eabc64c7`
exactly matched the independent Inc GitHub-clone artifact proof at 498dbf999bbb7b656c93a324e56dfac8842d1ba2.
No deployment receipt was created and no customer runtime was changed.
