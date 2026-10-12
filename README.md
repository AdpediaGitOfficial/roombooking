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
