# Git delivery contract v1

The approved artifact is first materialized into a per-site Git repository.
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

