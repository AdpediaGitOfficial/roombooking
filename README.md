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

WhatsApp is not implemented yet; it will be another transport on the same
outbox.

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
