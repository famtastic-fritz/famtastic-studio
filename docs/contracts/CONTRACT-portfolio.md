# Contract: portfolio registry (L2) — B1

**Blocks acceptance**, because acceptance requires MBSH loaded from the real
sites root.

## Sources of truth

- `~/Development/FAMtastic/sites` — 20+ directories
- `~/Development/FAMtastic/Apps` — currently 1 (`famtastic-by-the-numbers`)

**Read-only.** This lane never writes into a real site directory. Backfilled
specs land in Studio's own data root, never beside the customer's files.

## Required behaviour

1. **Inventory** every directory under both roots. A directory that is not a site
   is reported as such, not skipped silently.
2. **Backfill a spec** where one is absent, marked `derivation: 'backfilled'` and
   `spec_present: false` so a backfilled spec is never mistaken for a built one.
3. **`capability_class` per site**, computed: a site with a `backend/` directory,
   a `schema.sql`, or server-side endpoints is `application`; otherwise
   `brochure`. **MBSH must classify as `application`.**
4. **`origin` per site** (`legit | test | unknown`), reusing `classifyOrigin`.
   Never guess: `unknown` is the honest answer for anything undeclared.
5. **Counts state what they mean.** "23 directories" is not "23 sites". The
   surface shows directories, sites with specs, legit vs test vs undeclared, and
   brochure vs application, each labelled with the rule that produced it.

## Non-negotiable

- **`studio_can_rebuild` is false for every `application`.** Studio deploys and
  verifies a backend; it cannot author one. Any surface implying otherwise is a
  defect.
- No write to any path under the real roots. Enforced by a test.

## Acceptance

`sites` screen at 1440 and 390 showing the real portfolio, with MBSH visible,
classified `application`, and marked not-rebuildable.
