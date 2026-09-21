# Site Studio Next agent instructions

Read CONVENTIONS.md and `.claude/skills/site-studio-conventions/SKILL.md` before
editing. Read `.claude/skills/dna-capture/SKILL.md` for pipeline work. Read
design.md, SITE-LEARNINGS.md and CONVERSATIONS.md before changing direction.

Verify the actual Git root, branch, worktree/common directory and origin before
writes. This repo owns the studio generator, not customer source. Every customer
site must have its own Git repository independent of agency/platform Git ownership (ignored checkout collections are allowed), with a
matching site manifest, versioned design and startup records. Shared hosting,
builder credit or a reusable component never changes business ownership.

Use `vendor/site-foundation` for the contract and scaffold. Do not create another
generator-specific scaffold or a silent artifact-copy fallback. Preflight before
site writes; preserve authored documents, backend code, credentials and records.
Dirty or foreign targets must fail closed. Do not invent remote URLs or change a
foreign origin. Private repositories are the default for new customer sites.

Keep library discovery declarative, read-only and pinned. Business-specific
assets are not generally reusable without provenance and permission. Local,
pushed, deployed and production-proven states must remain distinct. Update the
changelog, site learnings, research and evidence after meaningful changes. Never
copy raw private conversations or customer data into shared catalogs.

The parent FAMtastic ecosystem owns universal doctrine. This independent repo
consumes that doctrine; old parent-tracked copies are not alternate sources.

Read `docs/contracts/CLIENT-SELECTED-BUILD-FLOW.md` for the owner's selected-site
continuation policy and proven FAMtastic Inc cPanel route. Client selection
starts build and protected review without per-site Fritz approval; revisions
continue until explicit client acceptance of the current artifact. Never charge
from selection, QA, silence or a deployment receipt. Escalate exceptions, not
every routine build. Review hosting is separate from final production launch.
Check the existing cPanel/vault recipe before declaring SFTP's missing settings
to be missing hosting access. Documentation is not an enabled queue consumer.
## Creator credit mandate (2026-09-18)

Follow [the owner-approved creator-credit policy](docs/creator-credit/POLICY.md) for every authored site, proof, prototype, lead demo and applicable output. Preserve existing footer text; append one final centered accessible link using the exact PNG. No tier exemption or alternate-brand inference; only explicit recorded owner override. Preserve financial, authentication and customer state, historical artifacts and approval hashes. PNG/video pixels are not clickable: use visible credit plus the destination in accompanying metadata/caption or supported clickable PDF/web wrapper. Do not cover QR/legal text. Source implementation is not fleet deployment proof.

## Customer-site checkout location — owner correction, 2026-09-21

Create customer source repositories at `/Users/famtastic-fritz/Development/FAMtastic/sites/site-<business-slug>` (portable form: `~/Development/FAMtastic/sites/site-<business-slug>`). StockandShip98 belongs at `~/Development/FAMtastic/sites/site-stockandship98`. `FAMtastic-Repos` is not the default customer-site collection.

Each site must own its Git root, common directory, manifest and verified remote. The ecosystem ignores `/sites/`; independent repositories beneath that ignored directory are valid. A tracked folder, submodule/gitlink, or worktree sharing the agency/platform Git common directory is not an independent customer repository. Verify the parent ignore rule and absence of tracked target paths before creation.

Studio/library checkouts retain their separately configured locations. Explicit sandbox roots remain supported. New customer identities should use `site-<business-slug>`; preserve existing IDs and registry bindings on continuation. Check existing source and registry before creating a duplicate. This rule does not automatically move existing repositories or authorize deployment, credentials, DNS or customer communication. Fritz assigned the StockandShip98 move to its own task.

Historical migration receipts retain their original paths as evidence; this current rule supersedes their use as defaults. When an authorized move is performed, preserve history, dirty work and remotes, then update the local project/launcher mappings and current handoff documents. Confirm the actual new checkout before claiming migration complete.
