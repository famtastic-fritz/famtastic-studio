# Git delivery contract v2

The accepted proof is first locked into a per-site Git repository and a
FAMtastic Inc staging target. Payment promotes that same repository and
artifact into production; it must not cause a second visual rebuild.

The approved artifact is materialized into a per-site Git repository.
The local proof must show:

1. a real `main` branch;
2. a real commit containing the approved artifact, design doctrine, and
   `.famtastic/site-manifest.json`;
3. a clean worktree; and
4. a declared hosting target that is a site subdirectory, never the shared
   hosting root.

The external push is a separate receipt-backed step. Site Studio must not say
“pushed” until a configured remote accepts the commit and returns a receipt.
The local proof script intentionally leaves `remote` null and does not call
GitHub, cPanel, DNS, Netlify, or any provider.

## Required Git sequence

The canonical sequence is:

1. materialize the accepted artifact and default operating files into a
   per-site repository;
2. initialize or open the declared branch (default `main`);
3. `git add --all`, commit, and verify a clean worktree;
4. verify the target is a declared site subdirectory, never the shared root;
5. configure the explicit repository remote (or use an existing client remote);
6. publish the staging target and retain its receipt for customer/owner review;
7. after verified payment, promote the same commit/artifact to production and
   retain the production receipt.

An invalid GitHub credential or absent remote is a real readiness failure. It
must be reported as `remote_not_configured`/`auth_not_ready`; it is not repaired
by silently switching providers or copying files outside Git. Local bare-repo
tests prove the Git protocol only and are labeled local evidence.
