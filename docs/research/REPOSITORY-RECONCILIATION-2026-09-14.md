# Repository reconciliation evidence

Observed at baseline 028b70ac77bfbf3a86576f05bf5743ccc3a6eb95:

- repo-scaffold.js was not used by the direct pipeline.
- shay-routine.js wrote short agent/design files after the pipeline and could
  overwrite authored records even after a failed build.
- git-delivery.js wrote files before Git checks and replaced a foreign origin.
- sites settings synthesized a GitHub URL without observing an actual remote.
- Components and Media imported executable code from fixed sibling directories;
  missing general catalogs silently became empty arrays.

Decision: a single vendored, dependency-free foundation package and a declarative
versioned library catalog. Local source preflight and portable-clone tests prove
the boundary; prose alone does not. No customer data is migrated by this change.

Source trace: server/kernel/{repo-scaffold,shay-routine,git-delivery,pipeline}.js,
server/modules/{sites,components,media}/index.js at the baseline above; approved
Codex task 01a097f9-4915-7640-b92f-abd74a1e49ca on 2026-09-14. No external claim
or synthetic market research is used to justify these repository observations.
