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

## Scripts

| Script | Purpose |
|--------|---------|
| `npm run dev` | Development server |
| `npm run build` / `npm start` | Production build and serve |
| `npm run lint` | ESLint |
| `npm run typecheck` | `tsc --noEmit` |
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
    api/health/        liveness + database check
  lib/db.ts            Prisma client singleton
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
