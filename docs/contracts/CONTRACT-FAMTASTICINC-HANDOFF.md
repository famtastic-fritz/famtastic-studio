# FAMtastic Inc handoff contract v1

Site Studio Next prepares and verifies a selected build locally, then creates
an explicit handoff plan for the FAMtastic Inc delivery boundary. The target is
the FAMtastic Inc cPanel/SFTP path, never Netlify, Vercel, or Cloudflare.

Hosting and repository choices are configuration, not hidden assumptions. The
default is `famtasticinc-shared`, but the same contract supports an explicit VPS
target or an existing client repository with a URL and branch. A target still
needs a real transport receipt before it can claim a dispatch.

The default Git-to-hosting layout is a per-site subdirectory under the
FAMtastic Inc root: `/home/nineoo/public_html/famtasticinc-landing/{site_id}`.
The root is never a customer site. A different relative subdirectory may be
selected explicitly, but traversal (`..`) and absolute paths are rejected.

New repository scaffolds include `AGENTS.md`, `CLAUDE.md`, `design.md`, and a
machine-readable `.famtastic/site-manifest.json`. The scaffold is local and
deterministic; GitHub repository creation and push are a separate operation so
an existing client repo can be selected instead of silently creating a new one.

The adapter is intentionally dry-run first. It can report:

- the selected site id and immutable manifest hash;
- staging versus production intent;
- the target root and configured credential names (never values);
- whether an injected transport and required preflight are present; and
- a receipt that distinguishes `planned`, `dry_run`, `dispatched`, and failure.

No DNS change is part of this adapter. Domain purchase and DNS cutover are a
separate, owner-authorized post-payment operation. A real dispatch requires an
explicitly injected transport, a durable external receipt, and a callback or
polling proof from FAMtastic Inc. The default path refuses rather than
claiming that a local copy reached production.

## Standard customer lifecycle

The normal path is deliberately **staging before payment**:

1. FAMtastic records the customer's accepted proof direction.
2. Lock-in creates the standalone site repository, immutable manifest, and
   FAMtastic Inc staging subdirectory/subdomain. This is a working preview,
   not production and not a payment receipt.
3. The customer/owner reviews the staging URL and records any final QA notes.
4. Verified payment promotes the locked staging artifact into the paid
   fulfillment lane.
5. Production cutover adds the customer's real domain, DNS, SSL, and email,
   then records a launch receipt.

The same repository and artifact move through the lifecycle; the system must
not rebuild a second, visually different site after payment. A higher-tier
hosting target or an existing client repository is selected through the
configuration contract, not by changing the lifecycle order.

Shay's build is a recorded pilot exception because it was built before this
order was formalized. It must not become the template for future customers.
