# Customer messaging component candidate

Status: source candidate, 2026-10-04. Component Studio
`packages/consent-sms-loop` version 0.2.0 at commit
`77a3fc352cb178389497267a15bbff55a7293144` supplies a disabled-by-default
provider-neutral reminder workflow, reply classifier, signed Textbee webhook
verifier and allowlisted lab sender. Its 13 package tests and independent
eight-file hashed installation passed locally. Studio's repository catalog is
now pinned to the merged Component Studio main revision for read-only discovery.
This does not install an executable workflow or customer implementation.

The agency-wide contract is
`FAMtastic/docs/agent-startup/CUSTOMER-MESSAGING-CONTRACT.v1.md`. It was tracked
on GitHub main but absent from the inspected local umbrella checkout on
2026-10-04; umbrella review PR #30 adds an evidence amendment. Each client
site owns appointment authority, SMS-specific consent, suppression, durable
outbox, reply matching, owner review and release evidence. YES can request
attendance confirmation; NO requires follow-up; STOP suppresses future SMS.
None changes an appointment without an approved site workflow.

## Adoption gates

1. Pin an exact Component Studio revision in Studio's repository catalog and
   independently verify the catalog bytes. The 0.2 merged-main pin/discovery
   passed locally; Site Studio Next PR #6 remains under review.
2. Install an exact package version in an independent customer repo and test it
   there. A sibling checkout is not a runtime dependency.
3. Use an approved business sender and site-specific consent text. Fritz's
   personal Textbee phone is for fictional technical testing only.
4. Prove one hosted send, signed reply, STOP, duplicate and uncertain outcome
   against the client's own state. Provider acceptance is not handset delivery.
5. Record a release-matched owner phone task before marking owner accepted.

Current state: `source_captured` and `install_tested` in Component Studio;
`discovery_only` in Site Studio Next's local review. `executable_import_proven`,
`production_proven` and `customer_sending_enabled` remain false. No SMS provider
is installed, configured or enabled by this Studio change.
