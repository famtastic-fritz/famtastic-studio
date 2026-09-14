# Site Studio Next state

2026-09-14: independent source foundation and pinned library discovery implemented
and tested locally. Customer ownership and Git identity are enforced across the
direct/conversational/retry build paths. Customer checkouts and studio/library
repositories are separate. The full Component and Media Studio platforms are
planned, while their independent libraries are available at pinned revisions.

The authorized local launchd cutover now runs the new independent checkout on
loopback port 3400. Its actual existing data root was preserved; no running jobs
or data were lost. The real pipeline rejected a wrong-repository build before
writing. See docs/evidence/repository-reconciliation-2026-09-14/RUNTIME-CUTOVER.md.
Customer-repository migration and website production evidence remain in the
ecosystem orchestrator's separate release ledger.
