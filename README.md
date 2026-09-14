# Site Studio Next

Independent source repository: [famtastic-studio](https://github.com/famtastic-fritz/famtastic-studio).
Site Studio builds and verifies customer sites. It does not own their businesses,
accounts, databases or source repositories.

## Start and verify

Node 24 is the supported runtime. Run `npm ci`, `npm run lint`, `npm test` and
`node vendor/site-foundation/test.mjs`. Start the local operator console with
`npm start` (loopback port 3400). No production restart or service migration is
performed by cloning this repository.

## Independent source and portable libraries

Customer Git roots default to `~/Development/FAMtastic-Repos`. Set
`STUDIO_REPOSITORIES_ROOT` to an explicit external checkout directory. An explicit
`STUDIO_DATA_ROOT` retains isolated sandbox site storage unless the repository
root is separately configured. The preflight rejects nested Git roots even when
the paths configuration is wrong.

Set `FAMTASTIC_REPOSITORY_CHECKOUTS` to a JSON object mapping `component-studio` and
`media-studio` to their independent absolute checkout paths. Library revisions
and repository identities are pinned in `config/repositories/catalog.v1.json`.
No sibling directory is imported implicitly. Missing, modified or mismatched
catalogs return explicit unavailable states.
The older `STUDIO_LIBRARY_ROOTS` name is accepted as a lower-priority alias.

Read [the repository standard](docs/capabilities/SITE-REPOSITORY-STANDARD.md),
[design.md](design.md), [agent instructions](AGENTS.md), and
[the changelog](docs/CHANGELOG.md). A library can be available while its full
studio platform and individual package installation remain unproven.
