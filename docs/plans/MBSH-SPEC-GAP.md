# Can the spec model represent MBSH? No.

**Asked:** determine whether Studio's spec model can represent a site with a
backend, database, and admin surface. **Answer: it cannot, and not narrowly.**

## What MBSH actually is

`sites/site-mbsh-reunion/backend/` is a full-stack PHP application:

**Database** — `schema.sql`, five tables: `poll_questions`, `poll_options`,
`poll_votes`, `menu_selections`, `ticket_orders`.

**Authenticated admin surface** — 12 pages under `backend/admin/`:
`login.php`, `logout.php`, `dashboard.php`, `polls.php`, `menu-results.php`,
`reports.php`, `capsules.php`, `chatbot.php`, `follow-up.php`,
`export-emails.php`, `import-survey-csv.php`, `manage-in-memory.php`.

**Server-side libraries** — `lib/`: `admin-auth.php`, `db.php`, `csrf.php`,
`cors.php`, `rate-limit.php`, `resend.php` (email), `upload.php`, `config.php`.

**Public endpoints** — ~14 PHP handlers: `rsvp.php`, `poll.php`, `survey.php`,
`survey2.php`, `menu.php`, `ticket-order.php`, `sponsor.php`, `sponsors.php`,
`memory.php`, `capsule.php`, `attendees.php`, `chatbot-question.php`,
`in-memory.php`.

**Also** — `cron/`, `uploads/`, `config/site-config.json`, and a documented
production deploy to `mbsh96reunion.com`.

The repo history confirms it was built directly by chat while Studio was down:
`b7cf172 fix(schema): add menu_selections table with email tracking columns`,
`5d24377 fix(menu): enforce exactly 2 entrées + add third notification email`,
`4b6fe26 docs: add DEPLOY.md with GoDaddy prod details`.

## What the spec model can represent

Read from a real spec (`accept4-starlight/spec.json`):

```
spec keys:  media_slots, media_summary, generated_from, brand,
            pages, offers, ctas, seo_targets, open_questions
page keys:  id, path, title, heading, sections
```

That is the complete vocabulary. There is no field for a database, a table, an
endpoint, a request handler, a session, an auth boundary, a scheduled job, an
upload target, an environment variable, or a secret. Not "a field that is
currently unused" — **no representation exists**, and a grep for
`database|endpoint|auth|cron|upload` across `spec.js` and `spec-derive.js`
returns nothing.

Downstream matches: compose emits static HTML plus one CSS file, and deploy
writes files and verifies them over HTTP. Nothing in the chain has a concept of
a server-side runtime.

**Studio models a static brochure site. MBSH is an application.** The gap is a
category difference, not missing fields.

## What this changes

### 1. The acceptance test is measuring the wrong thing
Acceptance today is "a page rendered and verified." For MBSH the load-bearing
behavior is: does a vote record, is a duplicate rejected, does the menu enforce
its entrée rule, does the admin login hold, does the notification email send.
**A rendered page proves none of it.** An acceptance test built only on DOM
verification would pass a completely broken MBSH.

This is the same class as the outline defect: absence-checking cannot see a page
with all its parts and none of its substance, and it equally cannot see a form
that posts into a void.

### 2. The data model needs a decision before it needs code
Three honest options:

**A. Declare it out of scope.** Studio builds brochure sites; applications are
hand-built. Cheapest, and it means MBSH — the most valuable site in the
portfolio — permanently lives outside the system of record for builds.

**B. Represent the backend as an opaque attachment.** The spec gains a
`backend` block naming a directory, a schema file, a deploy target and a
migration command, which Studio deploys and verifies but does not generate or
understand. Studio becomes able to *carry* MBSH without claiming to author it.
Modest work, honest, and it makes the portfolio complete. **This is my
recommendation.**

**C. Model the backend properly** — entities, endpoints, auth, jobs — so Studio
can generate applications. This is a different product. Months, and it would
need its own verification story (migrations, fixtures, endpoint tests).

### 3. Two claims need correcting regardless
- The console counts MBSH under the same denominators as brochure sites, which
  overstates what Studio can reproduce. `spec.origin` marks test vs legit; there
  is no mark for *what kind of thing this is*.
- Any statement that Studio is "the system of record for production site builds"
  is true only for sites it can represent. MBSH is deployed and live and Studio
  could not rebuild it.

## Recommendation

Option B, and **before** it, a `capability_class` on the spec
(`brochure | application`) so the console stops implying Studio can rebuild
things it cannot. That one field makes the gap visible immediately, costs almost
nothing, and is a prerequisite for either B or C.
