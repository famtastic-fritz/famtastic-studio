# Blast radius: the SEO direction published as meta description

**Asked 2026-08-26:** were any pages ever deployed with the SEO *direction* live
as their meta description, and if so which sites and for how long.

**Answer: no page with this defect ever reached a public URL. Stated from deploy
receipts, not assumed.**

## What was checked

Every deploy receipt under `.studio/deploys/`:

- **One site has ever been deployed by studio-next: `accept4-starlight`.** Two
  receipts (`dep_mt6fjv2hb99ruo2x`, `dep_mt6fjv39o9rbej6m`) plus an active
  pointer, produced by the **M5 rollback rehearsal** on 2026-08-23.
- **Every deploy target is a local filesystem path**
  (`.studio/famtasticinc/accept4-starlight/dep_…`). Zero non-filesystem targets
  across all receipts. No domain, no host, no DNS.
- **None of the calibration sites** (`cal-*`, `aft-*`, `af3-*`) has a deploy
  receipt at all. They were built, captured, and scored — never deployed.

## Did the deployed artifact carry the defect?

**Yes.** `accept4-starlight/index.html` shipped:

> `<meta name="description" content="Every page title should carry the brand plus
> a service-or-intent term plus the city, in th…">`

So the defect was present in the one artifact that was ever deployed. It was
deployed **to a local directory as a rollback rehearsal**, never served.

## Blast radius

| | |
|---|---|
| Public URLs affected | **0** |
| Customer-facing sites affected | **0** |
| Search engines that could have indexed it | **0** (never served) |
| Local deploys carrying it | 1, a throwaway rehearsal build |
| Duration live | **never live** |

**It only ever hit throwaway builds**, which is where it should have surfaced —
and it did surface, on a throwaway, before anything real was deployed.

## The honest caveat

This covers **studio-next**, the system of record for builds since the 2026-08-23
cutover. Legacy Site Studio deploys are a separate lineage with a separate
receipt store, and the defect is in studio-next's `compose.js`, which legacy does
not use. Nothing here makes a claim about pages legacy deployed.

Recorded per the standing rule that blast radius is stated, not assumed.
