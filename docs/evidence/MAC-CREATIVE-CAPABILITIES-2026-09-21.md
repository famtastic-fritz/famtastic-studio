# Mac creative capability and dispatch evidence

September 21, 2026. Local source verification, not worker activation.

## Preserve the actual creative workflow

Requests 8, 16 and 17 used active agent research, custom customer source,
managed imagery, customer-specific build scripts and independent review. There
is no verified single unattended command that reproduces that full workflow.
The six-direction benchmark and static artifact packaging are not replacements.
See the companion Designs `docs/contracts/MAC-CREATIVE-WORKER-V1.md`.

Read-only probes under OS network and filesystem-write denial found:

- Codex CLI 0.147.0, logged in using ChatGPT.
- `image_generation`, `apps`, `plugins` and `remote_plugin`: stable and enabled.
- Noninteractive `exec`, explicit working directory, JSON output and output
  schema are advertised CLI capabilities. `--image` supplies input images.
- Independent metadata-only inspection found enabled OpenArt HTTP and Photoshop
  and Premiere stdio connectors. No connector was contacted; no credentials or
  configuration values were copied into this evidence.

These facts do not prove a headless session receives the required managed image
tool, can execute it, has an enforceable per-operation budget, or reproduces the
existing creative process. `--ignore-user-config` can change integrations.
Desktop bridges are not headless cloud capabilities. Do not run the existing
adapter's model-backed authentication probe as an offline inventory command.

The next real creative canary needs a versioned recipe, confined independent
customer repository, trusted tool/cost policy, durable per-operation checkpoints,
unknown-outcome reconciliation and the authoritative proof importer. CLI prompt
instructions alone are not a tool, network or spending firewall. Missing cost
or provider receipts stay unknown, never zero. Existing raw image workers lack
the required crash-safe per-call reconciliation and must not be adopted unchanged.

## Actual bounded CLI and route topology

`tests/bounded-worker-ingress-roundtrip.test.js` runs the existing Designs CLI
as a child process against ephemeral loopback HTTP. It verifies exact worker
HMAC bytes, follows the actual signed ingress into the actual selected route,
and executes the real static staging pipeline against disposable source and
simulated hosting. Drupal claims and final acknowledgements are explicit test
doubles, not an installed Drupal instance or multi-process claim proof.

The public ingress accepts `/api/pipeline/staging/accept` and forwards exact
signed bytes to internal `/api/pipeline/selected-staging/accept`. The internal
`/api/pipeline/staging/accept` remains Phase 1 mock/disposable only. Do not point
a real selected worker directly at the internal mock route or expose the Studio
UI as a workaround. The tests never contact the installed port 3400 service.

The first actual CLI test failed because Node resolved its module through
macOS `/private/tmp`, while its direct-execution guard compared unresolved
`/tmp` argv. It exited zero without doing work. The Designs guard now resolves
both paths. A separate symlink test confirms direct execution fails closed when
unconfigured, while importing the module remains inert.

Repaired checks: nine Node worker tests and two Studio cross-repository CLI tests
pass, plus Studio lints and whitespace. A lost first finish acknowledgement
retries the same receipt without redispatch; a later replay retains exactly one
build and one captured callback, with zero generation calls. An unconfigured
selected runtime fails instead of entering the mock queue or claiming success.
This is static continuation evidence, not fresh proof creation, SMTP or cloud.

Evidence under `/tmp/famtastic-phase2-review.NVAfPl`:
`bounded-cli-ingress.ydkRaY` retains the two initial failures;
`bounded-cli-ingress-repaired.QffRxD` retains the first successful run;
`bounded-cli-final.28iJVQ` also covers preserve-symlinks-main through the canonical
module and argv comparison. No source integration total is inferred from these
separate focused runs.
Both authoritative data inventories stayed unchanged. For repetition, set
`SELECTED_DISPATCH_WORKER` to the paired Designs `scripts/cloud-worker/worker.mjs`
and run the test under the existing isolated verification wrapper. Without that
explicit source input these cross-repository tests are skipped, not passed.

## Transport measurements and remaining limits

Independent PHP serializer measurements found canonical PNG size 2,020,725 bytes,
base64 size 2,694,300 bytes and a **3,364-byte selected dispatch**. Selected
continuation sends compact authority/file references, not the inline original
bundle, so it fits the one-MiB signed ingress limit.

A minimal inline original bundle is 2,695,830 bytes. Sending that through the
separate initial `/api/pipeline/run` HTTP route would exceed its one-MiB limit;
the current completed-source fixture uses the service seam directly. Do not
confuse this with selected-dispatch size. Minimum serialized export/association
bodies measured 2,697,863 / 5,395,783 bytes using reduced synthetic metadata.
Those are lower bounds, not captured production packets or proven overflows of
Drupal's separate 24-MiB callback cap. Original private archive/reference transport
and actual complete-body boundary tests remain required; no global cap was raised.

Ad-hoc browser verification remains CUA-only under Designs instructions. Existing
repository Playwright regression tests remain usable; neither a metadata probe
nor the presence of those tests proves unattended cloud visual review.
