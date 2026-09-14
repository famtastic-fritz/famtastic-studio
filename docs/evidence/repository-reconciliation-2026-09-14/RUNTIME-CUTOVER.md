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
validate it with plutil, bootout only gui/501/com.famtastic.studio-next, then
bootstrap that label's plist. The old checkout and actual data root remain in
place. Read back process cwd, data root, build inventory and loopback port after
rollback. Do not erase the independent repos or replace customer business data.
