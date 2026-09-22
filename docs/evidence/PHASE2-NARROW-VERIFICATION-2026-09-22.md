# Narrow durable execution Phase 2 verification

## Result

The Phase 2 cloud-shadow foundation was reapplied to current Studio `main`
without the unrelated selected-staging series. This receipt covers a local,
inert review branch only. It does not enable or deploy any runtime.

| Field | Value |
| --- | --- |
| Branch | `codex/phase2-cloud-shadow-20260922` |
| Base | `bf1ef9ca09276d08c6555690737eafb3d4b6e109` |
| Phase 2 commits | `a715913`, `49ae6bb` |
| Node | `v24.19.0` |
| Phase 2 focused suite | 14 files, 169 tests passed |
| Phase 1 boundary suite | 6 files, 42 tests passed |
| Full suite | 101 files, 1,157 tests passed |
| Managed source or service changed | No |
| Google Cloud, provider, message, payment or deployment effect | None |

## Commands and results

```text
npm ci                                      pass
npm audit --omit=dev                        pass, 0 vulnerabilities
npm audit                                   2 moderate development-only vulnerabilities
npm run lint                                pass
git diff --check 16fc24e...HEAD             pass
Phase 2 focused Vitest                      pass, 169 tests
npm run prove:execution:phase2              pass, hermetic in-process fixture
Phase 1 boundary Vitest                     pass, 42 tests
npm run prove:execution                     pass, synthetic fixture only
npx vitest run --maxWorkers=2 --minWorkers=1 pass, 1,157 tests
bash infra/gcp/phase2/scripts/validate.sh   pass
example-value offline plan                  pass, no cloud mutation
```

The production-only audit is clean. The full audit reports the known two
moderate findings through `@vitest/mocker`; its offered remediation moves Vitest
to a breaking major version, so it was not applied in this Phase 2 rebase.

`npm run prove:execution:phase2` records 20 synthetic jobs, 18 awaiting pilot
review, two dead letters, 25 attempts, 23 fake provider calls, 18 artifacts,
one checkpoint-recovery provider call, and generation-10 manual review. It
also records zero real provider calls, zero external effects and all four
runtime controls disabled. It explicitly says activation, Firestore-emulator
concurrency and a Google Cloud canary are unproven.

The regular execution proof remains separate and synthetic. It does not open
the authoritative Studio database, run existing schedules or catch up parked
jobs. The offline example plan uses placeholder values and makes no network
call. `apply-inert.sh` exits at its create-only Cloud Run refusal before its
first `gcloud` call and was inspected, not run.

## Source inspection

- Phase 2 is not statically imported by the existing Studio boot path.
- No new source file exceeds the 500-line limit. The large changed file is the
  generated dependency lockfile.
- The diff scan found no key, token, private key block, public ingress, default
  Firestore fallback, mutable deploy image, customer record or credential.
- The only added absolute-home reference is a safety instruction that forbids
  writing to the authoritative Studio SQLite database.
- No em dash was added.

## Remaining activation blockers

1. Cloud Run still needs a separately reviewed atomic create-only mechanism.
2. Queue creation and pause remain separate proposed operations, so an initially
   paused queue has not been proven.
3. Real Firestore contention, actual named-database bindings, container image
   provenance, internal IAM, queue/Scheduler setup, zero-traffic revision probe,
   low-cap Vertex canary and in-flight provider drain are unproven.
4. The current Mac creative workflow, customer intake, independent managed QA,
   client notification, selection and exactly-one staging build are separate
   work. No customer-facing automation is claimed by this Phase 2 receipt.
