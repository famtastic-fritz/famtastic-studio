# Customer messaging component candidate

Status: source candidate, 2026-10-04. Component Studio
`packages/consent-sms-loop` version 0.1.0 at commit
`09fb09a1b61c9251a151862559db9792a8c88004` supplies a provider-neutral
reply classifier, a signed Textbee webhook verifier and an allowlisted lab
sender. Its package tests and independent installer test passed locally. This
record is a pointer, not a Studio library pin or customer implementation.

The agency-wide contract is
`FAMtastic/docs/agent-startup/CUSTOMER-MESSAGING-CONTRACT.v1.md`. Each client
site owns appointment authority, SMS-specific consent, suppression, durable
outbox, reply matching, owner review and release evidence. YES can request
attendance confirmation; NO requires follow-up; STOP suppresses future SMS.
None changes an appointment without an approved site workflow.

## Adoption gates

1. Pin an exact Component Studio revision in Studio's repository catalog and
   independently verify the catalog bytes. This has not happened.
2. Install an exact package version in an independent customer repo and test it
   there. A sibling checkout is not a runtime dependency.
3. Use an approved business sender and site-specific consent text. Fritz's
   personal Textbee phone is for fictional technical testing only.
4. Prove one hosted send, signed reply, STOP, duplicate and uncertain outcome
   against the client's own state. Provider acceptance is not handset delivery.
5. Record a release-matched owner phone task before marking owner accepted.

Current state: `source_captured` and `install_tested` in Component Studio;
`candidate` in Site Studio Next. No SMS provider is installed, configured or
enabled by this Studio change.
