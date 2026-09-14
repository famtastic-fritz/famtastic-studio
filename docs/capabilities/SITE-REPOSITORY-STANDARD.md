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

## Portable library discovery

`config/repositories/catalog.v1.json` pins repository_url, revision, catalog_path,
kind and readiness for each library. `FAMTASTIC_REPOSITORY_CHECKOUTS` is the machine-local
JSON map of absolute paths; it is not committed identity. GET /api/libraries and
the existing components/media views verify the Git root, origin, HEAD and exact
tracked JSON catalog. Missing checkout/pin, changed catalog and wrong origin
produce explicit unavailable reasons. Catalog code is never executed.
`STUDIO_LIBRARY_ROOTS` remains a lower-priority compatibility alias.

Discovery and individual package installation are separate proofs. Full studio
platforms remain planned. Runtime services were not restarted by this source
change. Production deployment and fleet migrations belong to the orchestrator's
release ledger, not these source-test claims.
