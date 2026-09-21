# Site Studio learnings

The maintained record is [docs/SITE-LEARNINGS.md](docs/SITE-LEARNINGS.md).
Read it before continuing work. Independent runtime does not imply independent
source ownership; enforce both boundaries with tests, not only documentation.
## 2026-09-18: mandatory creator credit

Site Foundation 1.1.0 is vendored from the Component Studio creator-credit lane. Static/model authorship is finalized once before DNA hashing; approved bundles and build/export boundaries validate without rewriting evidence. CMS adapters add credit to actual Twig/PHP/React template source, not only previews. Existing auth, payment and customer state is untouched. Source tests and local browser proof are not installed CMS or live runtime proof.

Post-evaluation: source enforcement, immutable evidence, and live coverage need separate proof. Exact inventory and limitations: docs/creator-credit/AUDIT.md. Parent authorized main integration after the first MBSH release; deployment claims remain scoped to independent receipts.

## Customer-site checkout location — owner correction, 2026-09-21

Create customer source repositories at `/Users/famtastic-fritz/Development/FAMtastic/sites/site-<business-slug>` (portable form: `~/Development/FAMtastic/sites/site-<business-slug>`). StockandShip98 belongs at `~/Development/FAMtastic/sites/site-stockandship98`. `FAMtastic-Repos` is not the default customer-site collection.

Each site must own its Git root, common directory, manifest and verified remote. The ecosystem ignores `/sites/`; independent repositories beneath that ignored directory are valid. A tracked folder, submodule/gitlink, or worktree sharing the agency/platform Git common directory is not an independent customer repository. Verify the parent ignore rule and absence of tracked target paths before creation.

Studio/library checkouts retain their separately configured locations. Explicit sandbox roots remain supported. New customer identities should use `site-<business-slug>`; preserve existing IDs and registry bindings on continuation. Check existing source and registry before creating a duplicate. This rule does not automatically move existing repositories or authorize deployment, credentials, DNS or customer communication. Fritz assigned the StockandShip98 move to its own task.

Historical migration receipts retain their original paths as evidence; this current rule supersedes their use as defaults. When an authorized move is performed, preserve history, dirty work and remotes, then update the local project/launcher mappings and current handoff documents. Confirm the actual new checkout before claiming migration complete.
