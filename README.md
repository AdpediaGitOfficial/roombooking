# Staff Accommodation Management

Web platform for managing staff accommodation and related facility operations:
accommodation hierarchy and allocation, staff self-service, maintenance,
digital forms with multi-level approval, facility booking, keys, inventory,
lost and found, notifications, reporting and administration.

Requirements and the release plan are in [docs/requirements-analysis.md](docs/requirements-analysis.md).

## Stack

| Layer | Choice |
|-------|--------|
| Runtime | Node.js 22 |
| Framework | Next.js 16 (App Router, TypeScript, Tailwind CSS 4) |
| Database | PostgreSQL 16 |
| ORM / migrations | Prisma 6 |
| Lint / types | ESLint 9, TypeScript 5 |

The application is a modular monolith: Next.js serves both the UI and the
API (route handlers and server actions) against one PostgreSQL database.
Business rules that must hold under concurrency (no double-booked beds,
one open key issue per key, one open assignment per serialised asset,
non-negative stock, append-only audit log) are enforced in the database
itself; see `prisma/migrations/*/migration.sql`.

## Getting started

```bash
cp .env.example .env            # DATABASE_URL
docker compose up -d db         # PostgreSQL 16 on localhost:5432
npm install                     # also runs prisma generate
npm run db:deploy               # apply migrations
npm run db:seed                 # demo organisation, site, rooms, beds, forms
npm run dev                     # http://localhost:3000
```

`GET /api/health` returns `{"status":"ok","database":"up"}` when the app can
reach the database.

The seed creates three demo accounts, all with password `ChangeMe123!`
(override with `SEED_PASSWORD`):

| Email | Role |
|-------|------|
| admin@example.com | System Administrator |
| officer@example.com | Accommodation Officer |
| staff@example.com | Staff / Resident (linked to employee E1001) |
| manager@example.com | Approver (line manager step) |
| engineer@example.com | Maintenance engineer |
| vendor@example.com | Vendor technician (CoolAir Services) |
| custodian@example.com | Inventory / key custodian |
| facility@example.com | Facility manager |
| auditor@example.com | Auditor (read-only, reports without names) |

## Accommodation and bed management

A room is a container for individually tracked bed spaces. Capacity is the
count of beds in service; each bed's availability is derived from
allocations as of the site's local date (`src/modules/accommodation/occupancy.ts`):

| Bed state | Meaning |
|-----------|---------|
| Occupied | A resident is checked in |
| Allocated · awaiting check-in | A confirmed allocation has started, nobody has checked in |
| Vacant | In service with no current allocation (a future arrival may be shown) |
| Blocked | Temporarily out of use with a reason, or the room is not active |
| Retired | Permanently removed from capacity |

Pages: `/accommodation` (sites and buildings), `/accommodation/buildings/:id`
(rooms), `/accommodation/rooms/:id` (beds, occupants, dates, next arrival).
System and accommodation administrators can add beds, block/unblock/retire
beds and block rooms; officers and auditors have read-only access. Every
change writes an audit event.

## Allocation engine

`src/modules/allocations/service.ts` owns every change to who holds a bed.
Each operation runs in one database transaction, writes an audit event and
queues an in-app notification to the resident's user account where one
exists. The exclusion constraint on `Allocation` is the final guard against
two people being given one bed at the same time.

| Operation | Rules |
|-----------|-------|
| Search | Beds in service, in active rooms and buildings, matching the room's gender policy, with no confirmed or checked-in allocation overlapping the requested dates |
| Allocate | Staff must be active; one bed per person at a time; validated dates (end exclusive) |
| Check in | Confirmed only; early arrival moves the start date to today; arriving at a transfer destination closes the previous stay |
| Check out | Checked-in only; outstanding keys or assets block it unless an administrator overrides with a reason; end date becomes today |
| Transfer | Same-day moves the resident now; future-dated keeps the current bed until the effective date; before arrival the allocation is replaced; old and new records are linked |
| Cancel | Confirmed only, reason required, administrators only |

Pages: `/accommodation/allocations` (list by status), `/accommodation/allocations/new`
(search and allocate), `/accommodation/allocations/:id` (detail, check-in,
check-out, cancel), `/accommodation/allocations/:id/transfer`.
Administrators and reception officers operate; auditors read.

## Staff self-service portal

Residents (users holding only the STAFF role) land on `/my` after sign-in,
a mobile-first portal with bottom navigation:

| Page | Content |
|------|---------|
| `/my` | Current bed, pending actions (upcoming arrival, booked move, stay ending within 14 days), in-app notifications with mark-as-read |
| `/my/stay` | Site, building, room, bed, dates, room sharing (counts only, never other residents' details), next bed if a transfer is booked, previous stays, accommodation office contact |
| `/my/profile` | Employment record read-only; editable phone and emergency contact; password change that signs out other sessions |

All queries in `src/modules/self-service/service.ts` are scoped to the
signed-in user's own staff record and notifications (SRS 3.1, SS-01..03).

## Digital forms and approvals

Request types carry a JSON form schema (`WorkflowVersion.formSchema`) and an
ordered approval route (`ApprovalStep`). A request pins the workflow version
current at submission, so changing a form or route never affects requests in
flight. `src/modules/requests/service.ts` enforces the SRS rules:

- validation on the server from the schema plus per-type rules (for example departure after arrival);
- submit with an idempotency token, so a double click returns the existing request;
- approvers must hold the step's role, cannot decide their own request, and must comment where the step requires it or when rejecting or returning;
- two approvers deciding the same step at once resolve to one winner;
- "changes requested" lets the requester edit and resubmit; every submitted version and every decision is kept;
- the requester can withdraw while the request is pending or returned;
- fulfilment runs exactly once inside the approval transaction: visitor and family requests complete on approval, exit clearance sets the resident's allocation end date, and an approved room change is completed by the officer's transfer, which references the request and closes it.

Pages: `/my/requests` (resident: list, new, detail, resubmit, withdraw) and
`/approvals` (inbox of steps waiting on your role; administrators also see all
requests by status). Seeded routes: line manager approval, then accommodation
administrator approval with a mandatory comment. Demo approver:
`manager@example.com`.

### Form builder

Administrators design request forms and approval routes at `/admin/forms`
(WF-02, WF-03). A request type starts with an empty draft; the builder adds
fields (short text, paragraph, date, number, choice with fixed options or
active buildings, checkbox) with labels, stored names, required flags, help
text, placeholders, ranges and lengths, and a *show only when* condition on an
earlier field (equals, does not equal, has a value, is empty, ticked, not
ticked). The route is an ordered list of steps with an approver role and an
optional mandatory comment. A preview renders the form as residents will see
it, with conditional fields appearing as values are entered.

Drafts are saved, previewed and then published as a new version with a change
note; one draft exists at a time, publishing requires at least one field, and
published versions are never edited. Requests pin the version they were
submitted under, so changing a form never alters an in-flight request. Hidden
fields are neither required nor stored on submission. Types can be set
inactive to hide them from residents. Every create, save, publish, discard and
settings change is audited.

### Expiry, escalation and reassignment

Each request type carries a pending-step policy, set on its form builder page
(WF-07): remind the approvers after N days, escalate the step to a chosen role
after N days, and expire the request after N days; 0 switches a rule off. The
clock starts when a step begins and restarts at each step and on
resubmission. The jobs endpoint applies the policy (`sweepRequests`): a
reminder goes once to the approvers of the step; escalation moves the step to
the escalation role, notifies that role and the requester, and shows on the
request as escalated; expiry marks the request expired, notifies the
requester, and lets them resubmit, which restarts the route. Administrators
can also reassign a pending step to another role with a reason, for example
when the usual approver has left; the new role's holders are notified. Every
policy action and reassignment is audited.

### Delegation and absence cover

Approvers hand their approvals to a colleague for a period of leave at
`/approvals/delegations` (WF-06); administrators can arrange cover for anyone.
A delegation names the delegator, the delegate, the roles covered (all of the
delegator's approver roles unless narrowed), start and end dates and a reason.
While it is live the delegate sees the delegator's pending steps in their
inbox, marked as cover, and may decide them; each such decision records the
delegate, the person they acted for and the delegation, in the request
history and the audit log. Cover never applies to the delegator's own
requests, cannot be passed on, and ends at the end date or when the
delegator, the delegate or an administrator ends it. Both people are notified
when cover starts, is arranged for them, or ends.

## Maintenance

Residents report issues from the portal (`/my/maintenance`) with location,
category, urgency, description, preferred contact and an optional photo.
Coordinators work the queue at `/maintenance`. Rules in
`src/modules/maintenance/service.ts`:

- ticket numbers come from a database sequence (`MR-<year>-<n>`), and each urgency carries an SLA target (urgent 4 h, high 24 h, medium 72 h, low 168 h) used for overdue flags;
- statuses follow the SRS model: new → triaged → assigned → in progress → waiting for resident, parts or access → resolved → closed, with reopen (within 7 days, by the requester) and cancel; each transition is checked against who may make it and audited;
- only coordinators (system or accommodation administrators and officers) assign, to active maintenance members or vendors; engineers and vendor users see and update only tickets assigned to them;
- resolving, reopening and cancelling require a note; internal notes are hidden from residents and vendors; vendor users see only their vendor's tickets with limited requester details, and their accounts can carry an access expiry that ends sessions;
- photos are validated by file content (JPEG, PNG, WebP, max 5 MB), stored under `UPLOAD_DIR` and served through `/api/attachments/:id` only to people who may see the ticket;
- residents are notified when a ticket is received, assigned, waiting on them, resolved, closed or cancelled, and asked to confirm closure or reopen.

Demo accounts: `engineer@example.com` (maintenance) and `vendor@example.com` (CoolAir Services contractor).

## Key register

`/keys` lists every key with its status and current holder, summary tiles
(available, issued, overdue, exceptions) and filters; `/keys/:id` shows the
permanent transaction history and the actions for its state. Rules in
`src/modules/keys/service.ts`:

- keys are registered per site against a room or a facility; copies are separate key records;
- issue records holder (resident or named outsider), custodian, condition, expected return and notes; a key has one open issue at a time (database constraint) and overdue keys are flagged;
- return closes the issue and records condition; a damaged return moves the key to damaged, then under repair, then back to available;
- lost keys stay issued against the holder, so check-out clearance still flags them, until the key is found or replaced; replacement retires the old key, closes the issue and registers the new key linked to the old one;
- retirement is refused while a key is out; history rows are never deleted;
- custodians and administrators manage keys; officers issue and return, including from the allocation page at check-in and check-out; residents see the keys they hold in My stay.

Demo custodian: `custodian@example.com`.

## Lost and found

Reception, custodians and administrators run the register at `/lost-found`
(summary, filters, search, register with photos) and each item at
`/lost-found/:id` (storage, photos, claims, verification, handover, disposal,
edit, permanent timeline). Residents browse found items and submit claims at
`/my/lost-found`. Rules in `src/modules/lost-found/service.ts`:

- every found item gets a unique reference (`LF-000001`, …) with description, category, where and when found, finder, custodian and optional photos; it is *reported* until a storage location is recorded, then *in storage*;
- a retention date is set at registration (default 90 days, `LOST_FOUND_RETENTION_DAYS`); items past it are flagged *due for disposal*;
- on registration and on each open item the register shows possibly matching open items (same category or shared description words, found within 14 days) so duplicates are spotted;
- claims record the claimant (resident or named walk-in), contact and the ownership details they gave; a person has one pending claim per item, several people may claim the same item, and the item is *claim pending* while any claim is open. Claimant details and the storage location are shown only to lost and found staff; residents see the public description, photos and their own claims;
- staff verify or reject a claim (rejection needs a reason); verifying one claim rejects the others and the claimant is notified in-app and by email. If all claims are rejected or withdrawn the item returns to storage;
- handover needs a verified claim and records the recipient, who handed it over, a note and optional evidence photo; the owner is notified;
- disposal needs an accommodation administrator, no pending claim and an expired retention date, and records method, reason and authoriser;
- claims and the timeline cannot be deleted; every change is audited.

Demo data: four found items at the demo site, one past its retention date.

## Inventory

Custodians and administrators keep the register at `/inventory` (summary,
filters, search, add item), work each item at `/inventory/:id` (receive, issue,
return, damage, count adjustment, transfer, retire, edit, permanent history)
and read `/inventory/reports` (stock balance by category, asset condition,
allocated items by location, movements with filters and CSV export). Rules in
`src/modules/inventory/service.ts`:

- two kinds of item: a *stock line* (SKU, counted units, unit of measure, reorder threshold) and a *serialised asset* (one unit tracked by serial number or asset tag with a condition). A site has one stock line per SKU; serial numbers are unique;
- every change to the on-hand figure is a logged movement with actor, timestamp, signed quantity, balance after, destination, condition, reference and notes. The log cannot be deleted;
- stock is issued to and returned from a room, a resident or a facility; the units out at each place are derived from the log, and a return cannot exceed what is out there. Units returned damaged are written off in the same step;
- an asset is issued to exactly one place at a time (database constraint), is taken back with a condition, and cannot be issued while damaged. Its on-hand count is 1 in store and 0 while issued, so the stock check also guards against double issue;
- issues run under a row lock and a conditional decrement, so two concurrent issues cannot take stock below zero; the database also refuses a negative quantity;
- adjustments set a counted figure with a mandatory reason; damage write-offs and retirement need a reason; retirement is refused while anything is still out;
- transfers move stock to the same SKU at another site, creating the line there if needed, as two linked movements; an asset in store can be re-homed to another site;
- stock at or below its reorder threshold is flagged on the register, on the item and in the summary (`Low stock` filter);
- items issued to a resident appear on their allocation page (return and issue from there) and in My stay, and count as check-out clearance blockers alongside keys.

Demo data: bedding, linen, toiletries and electrical stock lines (two below
threshold), five appliances and electronics assets (one damaged), a mini fridge
and two pillows issued to the resident E1001.

## Facility booking

Residents book shared facilities at `/my/facilities` (list, day-by-day
availability grid, book, change, cancel, history). Facility managers,
administrators and officers run `/facilities` (overview, approvals, 30-day
utilisation) and `/facilities/:id` (day schedule, approve/decline, mark used or
no-show, cancel with a reason, book on behalf, settings). Rules in
`src/modules/facilities/service.ts` and `rules.ts`:

- each facility has a capacity (people at once), per-day opening hours in the site's time zone, and booking rules: slot length, minimum and maximum duration, advance window, buffer before and after each booking, cancellation cut-off, maximum upcoming bookings and bookings per day per person;
- availability is computed per slot from the bookings that hold capacity (awaiting approval, confirmed, in use), including the buffer; a booking is accepted only if the headcount fits for its whole duration;
- the capacity check runs under a row lock on the facility, so two concurrent requests for the last place cannot both succeed; submissions carry an idempotency key, so a retried submission returns the same booking;
- facilities flagged as needing approval create bookings as *awaiting approval* (they hold their place); managers approve or decline with a note, and pending requests expire when their start time passes;
- bookers can cancel until the cut-off; after that only a manager can, and must give a reason, which the booker receives;
- once a booking has started, staff mark it used or no-show; used bookings complete automatically at their end time (the sweep runs with the notifications job);
- confirmations, pending notices, declines and manager cancellations go to the booker in-app and by email;
- every change is audited; the overview reports bookings, attendance, no-shows, cancellations and utilisation (booked person-hours against capacity × opening hours) per facility.

Demo facility manager: `facility@example.com`. The demo site has a gym (no
approval, 30-minute slots) and a community hall (approval required, closed on
Fridays, one group at a time).

## User and role administration

System administrators manage accounts at `/admin/users`; administrators and
auditors read the audit log at `/admin/audit`. Rules in
`src/modules/admin/users-service.ts`:

- users are created as *invited* with roles scoped to all sites, a site or a building, optionally linked to a staff record (one user per record) or a vendor (required for the vendor role, with an access expiry);
- invites and password resets are one-time links (`/invite/:token`) with an expiry; only a hash of the token is stored; using a link sets the password, activates the account and ends other sessions. Until email delivery exists the link is shown to the administrator and queued in the outbox;
- suspending or deactivating requires a reason, ends sessions immediately and keeps history; reactivation needs a password to exist;
- you cannot remove your own administrator role or change your own status, and the last active system administrator cannot be demoted, suspended or deactivated;
- every change writes an audit event with actor, target and before/after values; the user page shows the account's history and `/admin/audit` the whole log with filters.

## Occupancy dashboard and reports

`/dashboard` (administrators, officers, auditors) shows, per site or across
all sites as of the site's local date: occupancy rate and bed counts, capacity
by building as a stacked bar, occupied beds over the last 30 days from actual
check-in and check-out times, arrivals and departures due in the next 14 days
with overdue arrivals and overstays flagged, and pending-action counts
(overdue arrivals, overstays, approved room changes awaiting a move, requests
awaiting approval, overdue keys, unassigned maintenance) that link to the
relevant queue. `GET /api/reports/occupancy.csv?siteId=` exports the bed list;
every export is audited (RPT-07). Chart colours come from the validated
reference palette in `src/app/globals.css` with light and dark steps, legends
and table views.

## Bulk import and export

Administrators load staff profiles or buildings, rooms and beds from CSV at
`/admin/import` (ACM-10). A file is parsed and validated into a preview that
shows every row with its outcome (create, update, unchanged or error), the
exact problems on each failing row, and duplicates within the file; nothing
is written at that step. The import then runs in a single transaction, so a
failure writes nothing, and rows with errors stop it unless the administrator
explicitly chooses to import the valid rows and leave the rest out. Existing
employee IDs and rooms are updated rather than duplicated; new beds are added
to existing rooms. Templates and exports of the current data use the same
layout, so a download can be edited and re-imported. Previews, imports,
discards and exports are audited.

## Report suite

`/reports` is the hub for the filtered reports (RPT-02..RPT-08), each with
date range, site, building and report-specific filters and a CSV export that
is recorded in the audit log:

- **Movements** (`/reports/movements`): allocations overlapping the range with
  arrivals, departures, transfers and cancellations; status and person
  filters.
- **Maintenance** (`/reports/maintenance`): backlog by status and priority,
  overdue tickets, resolution times (mean and median hours, SLA met), workload
  per assignee and vendor, categories, and the ticket list.
- **Facility use** (`/reports/facilities`): bookings, attendance, no-shows,
  cancellations, declined and pending requests, people, booked and open hours
  and utilisation per facility.
- **Keys** (`/reports/keys`): register by site (available, issued, overdue,
  lost, damaged, under repair, retired), transactions in the range and the
  outstanding keys with holders.

Row-level access (RPT-07): a person whose reporting role is scoped to sites or
buildings sees only those sites, and a site outside their scope yields an
empty report. Auditors see employee IDs only; names appear for administrators
and officers. Every page explains its formulas and time-zone boundaries
(RPT-08): a report day runs midnight to midnight in the selected site's time
zone, or UTC when all sites are shown; facility days follow the facility
site's calendar. `src/modules/reports/suite.ts` holds the definitions.

## Email delivery

Business actions write notifications to the outbox inside their own
transaction; delivery is separate, so a mail failure never undoes an
allocation, approval or ticket change (COM-06). In-app notifications also
queue an email copy for people who have an address and have not switched
email off in their profile (COM-01).

- `src/modules/notifications/worker.ts` claims due emails one by one (two
  workers never send the same one), renders the template, sends, and records
  subject, recipient, provider message id, attempts and the last error.
  Failures retry after 1, 5, 30, 120 and 720 minutes, then fail permanently
  with an audit event; administrators can retry from `/admin/notifications`.
- Transports: SMTP via nodemailer (`SMTP_*`, `MAIL_FROM`), a log transport
  for development, or disabled. Links use `APP_BASE_URL`.
- Run delivery with `npm run notifications:worker` (polls every
  `EMAIL_WORKER_INTERVAL_SECONDS`) or have a scheduler call
  `POST /api/jobs/notifications` with `Authorization: Bearer $JOBS_SECRET`.
- `/admin/notifications` shows transport health, queue counts, recent
  emails with failure reasons, retry, run-now and a test email.

### WhatsApp

WhatsApp is a second transport on the same outbox (COM-02, COM-04, COM-05):

- residents opt in on `/my/profile`: a number in international format, the
  switch, and an explicit consent tick that is timestamped and audited.
  Nothing is queued or sent without all three, and consent can be withdrawn
  there at any time;
- in-app notifications fan out to a WhatsApp copy (`WHATSAPP_FANOUT`) with
  its own idempotency key, so a retried business action never queues twice;
- messages are provider-approved **templates** (business-initiated messages
  must be). `src/modules/notifications/whatsapp-templates.ts` maps each
  event to a template name (`WHATSAPP_TEMPLATE_PREFIX` + name, overridable
  per event with `WHATSAPP_TEMPLATE_MAP`) and body parameters in
  `WHATSAPP_LANGUAGE`. Parameters carry no room or bed codes, reasons or
  links with tokens: the message says what happened and points to the
  portal. `/admin/notifications?channel=WHATSAPP` lists the templates to
  create in WhatsApp Manager with their bodies;
- transports: Meta WhatsApp Business Platform Cloud API
  (`WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`), a log transport
  for development, or disabled. Provider errors that cannot succeed on
  retry (unknown template, invalid or non-WhatsApp number, policy blocks)
  fail immediately with the provider code; the rest retry with the same
  backoff as email;
- delivery receipts: Meta posts status updates to
  `POST /api/webhooks/whatsapp`, authenticated with `X-Hub-Signature-256`
  and `WHATSAPP_APP_SECRET` (the GET handshake uses
  `WHATSAPP_VERIFY_TOKEN`). *Delivered* and *read* mark the row delivered;
  *failed* records the provider reason and an audit event;
- the worker, the jobs endpoint and the admin page handle both channels;
  the admin page shows WhatsApp transport health, opted-in count, per-status
  counts and a test message to yourself.

### Broadcasts

Administrators and officers send announcements from `/admin/broadcasts`
(COM-03). An audience is a set of roles (none ticked means everyone) narrowed
to sites and/or buildings: residents belong to the building they currently
occupy, other roles to the site or building their role assignment is scoped
to, and a global assignment counts for every site. The form previews who
matches before anything is sent. Drafts can be edited or cancelled; sending
writes one in-app notification per recipient through the outbox, keyed per
person so an interrupted send can be re-run without duplicates, with optional
email copies (full text) and WhatsApp copies (title only, to people who opted
in). The broadcast page shows recipients, how many have read it in the app,
and email and WhatsApp copies by status. Residents read announcements at
`/my/announcements`; opening one marks it read.

## Authentication

Sessions are owned by the application, not a third-party provider, so the
SRS rules on session expiry, revocation and auditing can be enforced
directly:

- Passwords are hashed with scrypt (`src/lib/auth/password.ts`); the hash
  string is self-describing so parameters can be raised later.
- A login creates a `Session` row and sets an `HttpOnly`, `SameSite=Lax`
  cookie containing a random token. Only the SHA-256 hash of the token is
  stored. Sessions expire after `SESSION_TTL_HOURS` (default 12).
- Five failed attempts lock the account for `LOGIN_LOCKOUT_MINUTES`.
  Unknown emails and wrong passwords return the same message, and the
  unknown-email path still runs a hash so timing does not reveal accounts.
- Deactivating or suspending a user ends their access on the next request;
  `revokeUserSessions()` ends all sessions immediately (ADM-05).
- Every sign-in, failure, lockout and sign-out writes an `AuditEvent`.
- `src/proxy.ts` sends unauthenticated page requests to `/login` and
  returns 401 for API routes. It only checks that a cookie exists; real
  validation is done server-side by `requireUser()` / `requireRole()` in
  `src/lib/auth/authorize.ts`, which every page and action must call.
- `GET /api/auth/me` returns the signed-in user and role assignments.

Not yet implemented: password reset / account recovery (SS-08), SSO and
MFA (client decision), and per-site scoping of role checks.

## Deployment

The repository ships a production image and a compose stack. The image is a
Next.js standalone server running as the unprivileged `node` user; the only
state outside PostgreSQL is the photo store under `UPLOAD_DIR`, which the
stack keeps on a named volume.

```bash
cp .env.example .env                           # then set the values below
docker compose --profile app up -d --build     # db, migrate, app, scheduler
docker compose --profile app run --rm migrate npm run db:seed   # optional demo data
curl -fsS http://localhost:3000/api/health     # {"status":"ok","database":"up"}
```

Services in the `app` profile:

| Service | Role |
|---------|------|
| `db` | PostgreSQL 16 on the `pgdata` volume (also used alone for development) |
| `migrate` | One-shot `prisma migrate deploy`; the app waits for it to finish |
| `app` | The web app on `APP_PORT` (default 3000) with the `uploads` volume mounted at `/app/uploads` |
| `scheduler` | Calls `POST /api/jobs/notifications` every `JOBS_INTERVAL_SECONDS` (default 60): outbox delivery plus booking and request sweeps |

Before go-live, set in `.env`:

- `POSTGRES_PASSWORD`: a real password; the compose default `sam`/`sam` is
  for development only. Inside the stack the app and migrations reach the
  database as `db` with the `POSTGRES_*` values, so `DATABASE_URL` in `.env`
  only matters for commands run on the host.
- `JOBS_SECRET`: random, at least 32 characters; the scheduler refuses to
  start without it and the jobs endpoint rejects every call without it.
- `APP_BASE_URL`: the public `https://` origin, used in email and WhatsApp
  links.
- `MAIL_FROM` and the `SMTP_*` settings, or `EMAIL_TRANSPORT=disabled`.
- The `WHATSAPP_*` settings if WhatsApp is in use, including the webhook
  verify token and app secret, and `DEFAULT_COUNTRY_CODE` for local numbers.
- `SEED_PASSWORD` only if the demo accounts are seeded on a shared
  environment; change those passwords or delete the accounts afterwards.

Run the app behind a TLS-terminating reverse proxy. Session cookies carry the
`Secure` flag in production, so sign-in over plain HTTP will not keep a
session. The WhatsApp webhook must be reachable at
`APP_BASE_URL/api/webhooks/whatsapp`.

Operational notes:

- Migrations run on every `up`; a failed migration stops the stack before
  the app starts, and nothing is applied twice.
- Run exactly one scheduler. The app itself is stateless and can be scaled
  behind the proxy as long as every replica mounts the same `uploads`
  volume (or a shared filesystem).
- Back up the `pgdata` volume and the `uploads` volume together; the
  database holds the attachment metadata and the volume holds the files.
- `GET /api/health` reports `503` when the database is unreachable; the
  container health check uses it.
- Logs go to stdout. The notification worker inside the jobs endpoint
  retries failed deliveries up to `EMAIL_MAX_ATTEMPTS` and the admin page
  at `/admin/notifications` shows what failed permanently.

Without Docker, the same steps are `npm ci`, `npm run db:deploy`,
`npm run build`, then `npm start` with `NODE_ENV=production`, plus a cron
entry or `npm run notifications:worker` for delivery (the worker delivers
the outbox but does not run the sweeps; the jobs endpoint does both).

## Scripts

| Script | Purpose |
|--------|---------|
| `npm run dev` | Development server |
| `npm run build` / `npm start` | Production build and serve |
| `npm run lint` | ESLint |
| `npm run typecheck` | Next type generation + `tsc --noEmit` |
| `npm test` | Vitest unit tests and database integration tests (needs `DATABASE_URL`) |
| `npm run db:migrate` | Create and apply a new migration from schema changes (dev) |
| `npm run db:deploy` | Apply pending migrations (CI/production) |
| `npm run db:seed` | Seed demo data (idempotent) |
| `npm run db:studio` | Browse the database |
| `npm run db:reset` | Drop, recreate, migrate and seed (dev only) |
| `npm run notifications:worker` | Email delivery worker (long-running) |

## Project layout

```
prisma/
  schema.prisma        data model (SRS section 4 and 8)
  migrations/          SQL migrations incl. constraints Prisma cannot express
  seed.ts              demo data
src/
  app/                 Next.js App Router pages and API routes
    login/             sign-in page, server actions (login/logout)
    api/health/        liveness + database check
    api/auth/me/       current user
  lib/db.ts            Prisma client singleton
  lib/auth/            password hashing, session store, cookie session, authorisation
  modules/accommodation/  occupancy rules and queries, server actions, components
  modules/allocations/    allocation engine (service), server actions, components
  modules/self-service/   resident portal: stay, profile, password, notifications
  modules/requests/       form schemas, approval workflow service, actions, components
  modules/maintenance/    work order service, actions, components
  modules/keys/           key register service, actions, components
  modules/admin/          users and roles administration, audit log
  modules/reports/        occupancy dashboard, trend, CSV export, chart components
  modules/notifications/  email templates, transports, outbox worker, admin actions
scripts/notifications-worker.ts  standalone delivery process
  lib/uploads.ts          photo validation and storage
  lib/notifications.ts   notification outbox writer
  lib/audit.ts         append-only audit writer
  proxy.ts             request gate (redirect to /login)
tests/                 vitest suites
Dockerfile             production image (standalone server, node user)
docker-compose.yml     db for development; --profile app adds migrate, app, scheduler
docs/
  requirements-analysis.md
```

## Conventions

- Store timestamps in UTC; each site carries an IANA timezone for display and
  report boundaries.
- Every state transition on allocations, requests, work orders, keys and
  inventory writes an `AuditEvent` in the same transaction.
- Notifications are written to the `Notification` outbox in the same
  transaction as the business action and delivered by a worker; a delivery
  failure never rolls back the action.
- Authorisation is checked on the server for every mutation, scoped by
  organisation, site and building through `RoleAssignment`.
