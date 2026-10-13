# Architecture: separate web, API and worker services

Target: 500+ users at launch, with room to grow, on plain servers (no Docker).
The system is split into three deployable services that share one database
and one domain library.

```
                      ┌───────────────┐
 browsers ──────────► │ nginx (TLS)   │
                      └───┬───────┬───┘
                 app.example.com  api.example.com
                          │       │
                ┌─────────▼─┐   ┌─▼──────────┐        ┌──────────┐
                │ web  ×N   │──►│ api   ×N   │───────►│ worker×1 │
                │ Next.js   │   │ Fastify    │        │ outbox,  │
                │ UI only   │   │ REST + doc │        │ sweeps   │
                └───────────┘   └─────┬──────┘        └────┬─────┘
                                      │  PgBouncer         │
                                      ▼                    ▼
                                 PostgreSQL 16  (+ uploads volume)
```

| Service | Package | Responsibility | State |
|---------|---------|----------------|-------|
| web | `apps/web` | Pages, forms, layout. Calls the API. No database access. | stateless |
| api | `apps/api` | All business operations over HTTP: authentication, role policy, validation, rate limiting, audit, file storage. The only service that serves requests against the database. | stateless (session cache is optional) |
| worker | `apps/worker` | Email and WhatsApp delivery, booking and request sweeps (reminders, escalation, expiry). | stateless, one active instance |
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
  (OpenAPI at `/docs`) with token authentication.

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

## Capacity model

Assumptions for 500 named users: 150 concurrent at peak, a page view every
15 seconds each, about 10 requests per second at peak and bursts of 5x. Even
at 20x that, the plan holds.

| Tier | Launch sizing | Notes |
|------|---------------|-------|
| web | 2 instances × 1 vCPU | PM2, round-robin behind nginx |
| api | 2 instances × 2 vCPU, PM2 cluster | each instance holds at most 10 database connections |
| worker | 1 instance | uses `SKIP LOCKED`, so a second instance is safe when needed |
| PgBouncer | transaction mode, 50 server connections | api instances connect through it |
| PostgreSQL | 4 vCPU, 8 GB, SSD | indexes on every hot filter, see the schema |

Targets, verified by the load test in `docs/load-testing.md`: p95 under
300 ms for list and dashboard operations at 500 concurrent virtual users, no
errors, and database connections within the pool limit.

Performance measures in the design: short-lived cache for session
resolution and navigation counts, cursor/offset paging on large lists,
compressed responses, connection pooling, indexes on filter columns, and
batched notification delivery.

## Migration plan

1. Workspaces and the shared core library (no behaviour change).
2. API service foundation: registry, auth, policy, validation, OpenAPI.
3. Module by module: define operations, implement handlers, move the web
   pages and actions to the client. After each module the app, the unit
   tests and the browser walkthrough pass.
4. Worker, caching, paging, pool settings and the load test.
5. CI and deployment documents for the multi-service layout.
