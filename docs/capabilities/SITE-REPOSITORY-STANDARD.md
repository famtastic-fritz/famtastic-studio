# Independent site source contract 1.0.0

## Implemented behavior

The single source package is `vendor/site-foundation`, captured byte-for-byte by
Component Studio under packages/site-foundation. Public API:

- `createRepoScaffold(input)` returns manifest/files, without mutation.
- `preflightRepository(input)` reads Git identity/remote/common directory and
  fails before target writes for nested, foreign, duplicate or dirty targets.
- `scaffoldChanges(root, scaffold)` returns missing files only.
- `requireRepositoryContract(root, siteId)` validates the source contract/files.

The manifest lives at `.famtastic/site-manifest.json`, with schema_version 1,
contract_version 1.0.0 and format source_repository. Business owner and builder
are separate fields. Repository state is local_only until a remote push receipt
has verified the exact remote ref. No URL is inferred from a site name.

## Consumer integration

The direct pipeline runs a repository preflight before research and before any
site content write. The spec stage materializes the same scaffold before imagery
or spec files. Foundation artifacts are hashed into that stage's Build DNA.
Conversational intake uses the same pipeline and no longer rewrites documents
afterward. Successful builds commit only their validated changes; authored files
remain preserved. Retry accepts only the exact dirty-file snapshot recorded for
the failed run and its unchanged Git HEAD. A per-repository exclusive lock stops
overlapping builds; an interrupted stale lock requires inspection, not blind
deletion. Application repositories cannot use the brochure generator.

The release seam validates every path and all Git conditions before writing.
It never changes a foreign origin, and checks remote ref equality after an
owner-authorized push. An explicit standalone migration backfills legacy repos;
the generator cannot adopt unowned nonempty folders or rebind another site.

New scaffolds are staging-only: robots disallow indexing and legal/SEO review
remain required. Rebuilds preserve the site's authored robots and sitemap.
The scaffold does not invent a business policy, verified canonical domain,
owner approval, provider deployment or customer workflow proof.

## Reproducible static output

The deterministic composer adds dependency-free package/lockfiles, local HTML
tests, CI, a public-file manifest, build and preview tools. `npm run build` runs
the vendored source validator and HTML tests, then emits only allowlisted files
into `dist/`. Neither private Markdown/JSON nor backend paths/symlinks are public
artifacts. Existing authored scripts/docs and backend/server configuration are
preserved on rebuild. Production hosting must point to a reviewed artifact, not
the Git root. The local static deploy adapter reads the same explicit public-file
manifest and refuses source repos lacking it; it never executes customer scripts
while planning deployment. Application/CMS runtime configuration requires a
separate reviewed recipe, not broadening the static source-public boundary.
At the same `.famtastic/public-files.json` path, an existing explicit array of
relative strings and the version 1 `{schema_version,files}` object are both
accepted through identical validation. No duplicate manifest or migration is
required merely to discover/deploy an already governed static repository.
The generated builder keeps its exact output ownership receipt in Git-local
metadata, refuses tracked or unowned/changed `dist` contents, and stages the next
artifact before replacing the receipted predecessor. An existing directory with
no receipt is not implicitly disposable; inspect and preserve it explicitly.
The exact root `.htaccess` is a server-control packaging exception, not public
document content. An allowlist may include it for Apache; local previews return
404 for it. This does not permit any other hidden path or raw application source.

## Portable library discovery

`config/repositories/catalog.v1.json` pins repository_url, revision, catalog_path,
kind and readiness for each library. `FAMTASTIC_REPOSITORY_CHECKOUTS` is the machine-local
JSON map of absolute paths; it is not committed identity. GET /api/libraries and
the existing components/media views verify the Git root, origin, HEAD and exact
tracked JSON catalog. Missing checkout/pin, changed catalog and wrong origin
produce explicit unavailable reasons. Catalog code is never executed.
`STUDIO_LIBRARY_ROOTS` remains a lower-priority compatibility alias.

Discovery and individual package installation are separate proofs. Full studio
platforms remain planned. The separately authorized local launchd cutover is
recorded in the runtime receipt, including actual data-root preservation and a
real wrong-repository rejection. Customer production deployment and fleet
migrations belong to the orchestrator's release ledger, not source-test claims.
