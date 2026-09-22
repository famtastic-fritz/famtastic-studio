# Phase 2 local Linux image verification, September 22, 2026

**Locally proven Linux packaging/startup only. Not deployed or activated.**

Source: clean `bc57d71a35bdd76e24519af80d2b878174722d06`.
The full paired suite already passed1,588/135, including executable entrypoint and
filtered-copy closure checks. The previously unavailable disk headroom recovered.
The owner's default Colima profile was stopped and remained untouched. A separate
`famtastic-phase2-proof-20260922` profile used2CPUs,3GiB memory,12GiB root/data
disk limits, no host mounts, no SSH-agent forwarding, no published application
ports and no active-context switch. The profile was stopped after verification;
its local images remain recoverable. No global Docker configuration was edited.

Buildx0.37.1 was installed from the Homebrew bottle (62.6MB). Colima0.10.3 and
Docker29.5.2 were observed. A task-local Docker configuration discovered the plugin;
it contained no registry or cloud credentials. Build dependency downloads were
permitted; application probes had Docker `--network none`, read-only roots,
non-root uid1000, all capabilities dropped and no host mounts or exposed ports.

## Immutable input and actual results

The official `node:24-bookworm-slim` AMD64 manifest was resolved before building:
`node@sha256:5cbc7caba8c2c0f0bca675d1b61b9f2857e1cf1853c6164ee9dd409501a936e7`.
This exact digest, not the mutable tag, was supplied as `NODE_BASE_IMAGE` to both
unchanged role Dockerfiles with `--platform linux/amd64 --load`. Their existing
Dockerfile-specific context filters applied. No unfiltered archive was sent.

| Role | Local image ID | Build time | Import probe | Unconfigured entry |
| --- | --- | --- | --- | --- |
| control | `sha256:ec0277851f243b511f84ecee8570d57d530e5f283c0a73e3dbcd636922bfe98b` |18.995s|4.229s|3.470s, exit1|
| worker | `sha256:4cbb79f8f03be1677112454fcd0f166b456d4df8cc64a75f62ac38a3311b1cce` |0.285s (shared cache)|3.847s|3.280s, exit1|

Both report Node v24.21.0, Linux/x64 and uid1000. Each probe imports the actual
role entrypoint plus Firestore, Storage, Tasks, GenAI and Google Auth packages
without credentials, then compares all36 copied server/package file hashes with
the source checkout. Vitest, Playwright, `.git` and `.env` are absent. Actual CMD
execution fails with the expected `phase2_config_invalid`, not missing imports.
The Docker warning about an unset default `NODE_BASE_IMAGE` is expected: no
mutable fallback base is provided. The real build supplied the required digest.

Total34.298s. Both authoritative protected-data inventories remain byte/metadata
identical. No image push, provider call, cloud resource, customer operation or
production service restart occurred. The probes prove importability and closed
startup, not every SDK request path, cloud IAM or Firestore concurrency.

## Retained evidence and reproduction

Raw logs, manifest/image inspection, per-file hashes, protected inventories and
`receipt.json`:
`/Users/famtastic-fritz/Development/FAMtastic/worktrees/autopipeline-recovery.ggJXc1/evidence-linux-images.lbnXV5`.
The task-local reproducible driver is the sibling `prove-linux-images.mjs`;
it rejects dirty Studio source, uses only the owned daemon socket and bounds each
command to ten minutes with a2GiB disk preflight. It records failures, not just
success. No private raw evidence is committed here.

To reproduce, use the role commands in `infra/gcp/phase2/README.md`, supply the
digest above and `--platform linux/amd64`, and run each resulting image with
`--network none --read-only --cap-drop ALL --security-opt no-new-privileges`.
Use a disposable local daemon/profile and credential-free Docker configuration;
do not start or repurpose an owner's existing workload to run these checks.

The earlier copied-source receipt remains historical; its former temporary raw
files are absent. This fresh image receipt closes that earlier Linux packaging
limitation only. The cloud create-only/initial-containment apply blockers, missing
CLI cloud authorization, real GCP canary and laptop-unavailable test remain open.
The hard-disabled apply and all runtime effect firewalls are unchanged.
