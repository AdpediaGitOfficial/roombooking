# Architecture: separate web, API and worker services

Target: 500+ users at launch, with room to grow, on plain servers (no Docker).
The system is split into three deployable services that share one database
and one domain library.

```
                      ┌───────────────┐
 browsers ──────────► │ nginx (TLS)   │
                      └───────┬───────┘
                              │ only the web app is public
                      ┌───────▼───────┐        private network
                      │ web  ×N       │
                      │ Next.js, UI   │
                      │ no DB access  │
                      └───────┬───────┘
                              │ typed client, bearer token
                      ┌───────▼───────┐       ┌───────────────┐
                      │ api   ×N      │       │ worker ×1     │
                      │ Fastify, REST │       │ outbox,       │
                      │ + OpenAPI     │       │ sweeps        │
                      └───────┬───────┘       └───────┬───────┘
                              │   (PgBouncer, optional)│
                              ▼                        ▼
                         PostgreSQL 16        (+ uploads folder, served by the API)
```

| Service | Package | Responsibility | State |
|---------|---------|----------------|-------|
| web | `apps/web` | Pages, forms, layout. Calls the API. No database access. | stateless |
| api | `apps/api` | All business operations over HTTP: authentication, role policy, validation, rate limiting, audit, file storage. The only service that serves requests against the database. | stateless apart from short in-memory caches (sessions, shared views) and the uploads folder |
| worker | `apps/worker` | Email and WhatsApp delivery every 20 s; booking and request sweeps (reminders, escalation, expiry) every minute; `/health` with last run times. | stateless, one instance |
| core | `packages/core` | Prisma schema and migrations, domain services, access rules, notification rendering. Imported by api and worker. | library |
| contract | `packages/contract` | The API definition: operations, input schemas, roles, output types. Imported by api (to implement) and web (to call). | library |

## Why this shape

- **Independent scaling.** The web tier is CPU-bound on rendering and the API
  tier is bound by database work. Each scales on its own.
- **One source of truth for rules.** Every operation lives in the API.
  Screens, other systems and future mobile apps all go through the same
  validation, role checks and audit trail.
- **Failure isolation.** A slow report or a notification backlog cannot take
  the screens down: the worker is a separate process and the API applies
  rate limits per client.
- **A stable public API.** External systems get documented REST endpoints
  (OpenAPI at `/docs`) with token authentication. The API is not exposed to
  browsers by default; expose it through nginx only when external systems need it.

## Contract and calling convention

Each operation is defined once in `packages/contract` with an id, HTTP
method and path, the roles allowed, a zod input schema and the output type.

- The API registers a handler per operation. Authentication, role policy,
  validation, error mapping and audit context are applied uniformly.
- The web app calls operations through a typed client generated from the same
  definitions, so a change to an operation is a compile error in every
  caller.
- External clients use the REST routes and the OpenAPI document.

Authentication: the API issues opaque session tokens (stored hashed, as
today). The web app keeps the token in an httpOnly cookie and forwards it as
a bearer token. The same endpoint serves API clients. Roles and site scope
are enforced in the API on every call.

## How the pieces enforce the split

- `apps/web` may not import the database or domain services. An ESLint rule
  (`eslint.config.mjs`) fails the build if it does; only pure rule modules
  (`access`, `rules`, `forms`, `lib/time`) and types are shared. The web app
  runs with an unreachable `DATABASE_URL`.
- Every contract operation needs an API handler: the handler table is typed
  from the contract, so a missing one is a compile error.
- Who may call an operation is declared in the contract (public,
  authenticated, or a list of roles) and enforced once, in the API pipeline.
  Actor identity and roles always come from the verified session, never from
  the request body.
- Domain errors are mapped to HTTP statuses in one place
  (`apps/api/src/errors.ts`); secrets such as password hashes are stripped
  centrally from every response.
- Operations that are not part of the contract (the WhatsApp webhook, whose
  signature is checked against the raw body, and the scheduler entry point
  `POST /jobs/run`) live in `apps/api/src/raw-routes.ts`.

## Performance measures

- Database indexes for every list and filter used by the screens
  (migration `20261014090000_scale_indexes`).
- Paging on the large lists (allocations, maintenance, keys, inventory,
  lost and found, audit, users) with `page` and `pageSize` (maximum 100).
- Counts computed in the database instead of loading rows; slim response
  shapes on list endpoints.
- Short-lived in-memory caches in each API process: resolved sessions
  (`SESSION_CACHE_TTL_MS`, default 10 s) and shared read-mostly views such as
  the dashboard and pick lists (`READ_CACHE_TTL_MS`, default 5 s) with
  single-flight so concurrent identical requests share one query. The read
  cache is cleared by any write handled by the same process; other processes
  may serve a view up to the TTL old.
- Compressed responses, connection pooling (`connection_limit`, optional
  PgBouncer), per-client rate limits.

## Capacity

Assumptions for 500 named users: 150 concurrent at peak, a page view every
15 seconds each, about 10 requests per second at peak and bursts of 5x.

| Tier | Launch sizing | Notes |
|------|---------------|-------|
| web | 1-2 processes | does no database work |
| api | 2 PM2 cluster processes (one per core as you grow) | each holds at most `connection_limit` database connections |
| worker | 1 process | claims messages one by one, so a second instance would not double-send, but one is enough |
| PgBouncer | optional, transaction mode | add when processes × `connection_limit` approaches `max_connections` |
| PostgreSQL | 4 vCPU, 8 GB, SSD | |

Measured (see [load-testing.md](load-testing.md)): 500 simulated residents
plus 6 staff on a single API process, 108 page views per second (about
four times the expected real peak), 12,042 API calls, no errors, p95 under
65 ms for resident pages and under 140 ms for the heaviest staff pages.
A single process tops out around 550-600 simple calls per second on a
shared 4-core machine; two processes improved both latency and throughput.

## Known limits and next steps

- Uploads live on disk. Several API servers need a shared volume (see
  `docs/deployment.md`); object storage (S3-compatible) would remove that.
- Per-process caches mean another API process can show a changed dashboard
  or pick list for up to `READ_CACHE_TTL_MS`. Set it to 0 to disable, or move
  the cache to Redis if strict cross-process freshness matters.
- The staff pick list (`lookups.staff`) returns all active staff. It is cached,
  but a type-ahead search would be better beyond a few thousand people.
- Reports and CSV exports run synchronously. For very large exports, move them
  to a worker job that writes a file.

## Migration plan (completed)

1. Workspaces and the shared core library (no behaviour change).
2. API service foundation: registry, auth, policy, validation, OpenAPI.
3. Module by module: operations and handlers in the API, web pages and
   actions moved to the typed client, lint guard on database access.
4. Worker, caching, paging, indexes, load test tooling and results.
5. CI and deployment documents for the multi-service layout.
