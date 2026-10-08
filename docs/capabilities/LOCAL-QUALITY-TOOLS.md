# Shared local quality tools

FAMtastic owns the installed, locked quality package. This Studio discovers three tools using `config/local-quality-tools.json`, pinned to their reviewed source bytes. No executable sibling import or Studio runtime dependency is added.

From this Studio checkout, invoke the shared package explicitly:

```sh
node "$HOME/Development/FAMtastic/tools/research-quality/studio-consumer.cjs" describe
node "$HOME/Development/FAMtastic/tools/research-quality/studio-consumer.cjs" report /absolute/owning/review-record.json
node "$HOME/Development/FAMtastic/tools/research-quality/studio-consumer.cjs" scan /absolute/owning/source
node "$HOME/Development/FAMtastic/tools/research-quality/studio-consumer.cjs" axe-local http://127.0.0.1:PORT/authorized-page
```

The descriptor verifies package version, source pins, registry entries and installed tools before executing the fixed shared CLI. It requires an explicit target. If the owning package is absent, use its reviewed installer; do not silently download or select a client. Pin changes require review and matching descriptor updates.

The structured report check catches missing competitor, opportunity, owner, team and site-administration sections and declared-evidence inconsistencies. It does not certify facts or grade arbitrary prose. Gitleaks detects configured credential patterns, not all personal data. Axe checks one authorized rendered loopback state; manual accessibility and owner acceptance remain separate.

Evidence: shared `tools/research-quality/evidence/studio-consumers.json` tests discovery and actual clean/rejected command handoffs from both canonical Studio checkouts. This proves local CLI use. Automatic Studio pipelines, UI controls, CI activation, customer installations and provider execution are not enabled.

Classification: changed (internal tooling discovery). Client site source and services are unchanged.
