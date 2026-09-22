# Existing cloud project, read-only verification

Verified September 21, 2026 through the already-authenticated Google Cloud
Console in Chrome. Earlier local CLI inspection alone was incomplete: an empty
`gcloud auth list` and unset CLI project do not establish that the user has no
existing project or browser access.

## Current observed facts

- Project name: FAMtastic Site Studio.
- Project ID: `gen-lang-client-0744578052`.
- Project number: `207847737018`.
- The project-scoped Cloud Run Services inventory displays no services.
- The project-scoped Cloud Run Jobs inventory displays no jobs.
- The project-scoped VM inventory displays one VM,
  `instance-20260904-000606`, in `us-central1-a`, with explicit status **Stopped**.
- The local CLI still has no active identity or selected project. No login,
  credential transfer, ADC change or `gcloud config set` occurred.

These are UI inventory observations, not API absence preconditions, IAM approval,
resource ownership guarantees for a future create, runtime health evidence or a
cloud-worker execution receipt. Do not assume the stopped VM is safe to reuse or
restart its retired agents. No process inspection or workload attribution ran.

## Read-only sources

- [Project dashboard](https://console.cloud.google.com/home/dashboard?project=gen-lang-client-0744578052)
- [Cloud Run services](https://console.cloud.google.com/run/services?project=gen-lang-client-0744578052)
- [Cloud Run jobs](https://console.cloud.google.com/run/jobs?project=gen-lang-client-0744578052)
- [VM instances](https://console.cloud.google.com/compute/instances?project=gen-lang-client-0744578052)

The existing project was located from prior audit notes and then verified live;
old billing totals and resource assumptions were not treated as current facts.
No API was enabled, resource created/started/stopped/deleted, setting changed,
Cloud Shell launched, SSH opened, IAM grant changed or provider called.

## Consequence for the integration plan

Project discovery is resolved; a new project is not required just because the
local CLI is unset. Future automation can plan against this known existing
project while retaining exact resource-absence checks and no-adoption rules.
CLI authorization, safe provisioning, pinned image provenance, shared Drupal
claim execution and laptop-unavailable proof remain unfulfilled. The source
`apply-inert.sh` hard stop and the production pause/off controls remain intact.

This observation does not broaden the approved incremental budget or authorize
changes to existing unrelated resources. The Mac workflow remains first-class.
