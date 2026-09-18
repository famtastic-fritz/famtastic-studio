# Independent review inbox: tested candidate

Date: 2026-09-18. Status: documented candidate; not a registered executable generator or promoted Component Studio recipe.

## Neutral pattern

A multi-page business review site can use a self-contained PHP 8.3/PDO SQLite backend with no agency runtime. Keep public assets and PHP entrypoints in public/, business config/bootstrap outside public/, and secrets, database and sessions in a separate persistent state directory. Each business owns independent source, state, authentication and session cookie name/path. Install the source foundation through the actual version-pinned scaffold, then author site-specific design.

Owner desk capabilities: service-specific inquiries, true empty state, authenticated status changes, editable headline/introduction/contacts and allowlisted official social profile URLs. Review forms explicitly save a demo and send no mail or booking confirmation. Settings are a focused content editor, not a generic page builder.

## Acceptance evidence

Two independent real site fixtures, both private Git repos:

- https://github.com/famtastic-fritz/site-your-concierge-guru at 0fcdf04d583ac82da77d83427616911440960b11: 37 isolated integration checks; 29 hosted checks; browser submission persisted and was removed precisely.
- https://github.com/famtastic-fritz/site-south-shore-communication-systems at 9105c9727e8773de195f31e9eb1c0c2452f9f64f: 35 isolated integration checks; 27 hosted checks; browser submission persisted and was removed precisely.

Evidence is in each site's docs/verification/. Both first release sources passed fresh-clone npm install, validator and isolated synthetic lifecycle with no neighboring repos. Final follow-up handles host interstitials and reuses SSH connections; backend semantics are unchanged. Browser checks use the actual hosted mount.

## Failure prevention

1. PHP's development server may route unknown private-looking paths through index.php; reject PATH_INFO and assert denied paths rather than accepting any homepage HTML.
2. A shared host may return an anti-bot HTML document with HTTP 200. Require application/json and explicit ok before rendering success. Pace live tests; keep host protections active; let normal browser verification complete.
3. Upload only explicit backend/public allowlists into immutable releases, expose only public/, and link private persistent state. Source docs and credentials are never web artifacts.
4. Share SSH transport within a deployment instead of opening a connection per small operation. Record hashes, current pointer and prior release.
5. Only remove uniquely identified synthetic test rows; preserve all real inquiries.

## Promotion boundary and opportunities

Do not copy business branding or imagery into a neutral package. Extract an installer and independent fixtures before recipe promotion. Review data retention, notification approval, spam controls and owner-managed credential recovery before live customer operation. No evidence here implies payments, production DNS changes, historical data migration, bookings or email delivery.

## Tested opt-in and reply-preview extension — 2026-09-18

Third independent fixture: https://github.com/famtastic-fritz/site-coastbound-electric deployed application `c760bf071613504f3fb31ea765c1f9438df345c0`. Evidence: 51 isolated integration checks, 17 hosted checks, actual browser inquiry/signup/private withdrawal, and precise synthetic cleanup. Source docs retain version-specific fresh-clone evidence.

Store reply previews separately with `preview_only` status; never equate persistence with email delivery. Require explicit mailing consent, unique normalized subscriber email, a hashed private withdrawal token, and nonredeemable review coupon labeling. Duplicate signup must not reveal an existing withdrawal secret. Keep public contact/credential forms explicitly POST even without JavaScript. No mail transport or domain provisioning is implied. This remains a documented candidate, not a promoted executable recipe.
