# Load testing

Tools in `scripts/loadtest/` exercise the API with realistic data volumes. They
run against a **separate database** (its name must end in `_load`); the data
generator refuses to run anywhere else.

## Setup

```bash
# 1. A throwaway copy of the schema
createdb -U sam sam_load            # or: CREATE DATABASE sam_load OWNER sam;
export DATABASE_URL="postgresql://sam:PASSWORD@localhost:5432/sam_load?schema=public"
npm run db:deploy && npm run db:seed

# 2. Volume: 650 residents, 800 beds, 3,000 tickets, 12,000 notifications, 40,000 audit events
npm run loadtest:data

# 3. Start the API against that database (same DATABASE_URL), on its own port
RATE_LIMIT_MAX=10000000 API_PORT=4100 npm run start:api &

# 4. Sessions for the generated residents (skips password hashing during the test)
npm run loadtest:tokens
```

Raise `RATE_LIMIT_MAX` for the test; the default (1200 requests per minute per
client address) is meant for real users and would throttle a single test machine.

## Per-endpoint throughput

```bash
BASE=http://127.0.0.1:4100 C=50 D=8 npm run loadtest:bench
ONLY=dashboard,keys npm run loadtest:bench      # a subset
```

Prints requests per second and latency percentiles per endpoint (autocannon).

## Simulated users

```bash
RESIDENTS=500 OPS=6 DURATION=40 npm run loadtest:simulate
```

Each simulated person loops: open a page, read it for 2–6 seconds, open another.
A page view is the set of API calls the web server makes to render it (the shell
plus the page's own data). Residents mostly open home, stay, tickets and
facilities; staff open the dashboard, allocations, maintenance queue, keys and
approvals. Some residents report a problem (a write). Several API addresses can
be given with `BASES=http://127.0.0.1:4101,http://127.0.0.1:4102` to test
several instances.

## Reference result

500 residents and 6 staff at once, on one API process, a 4-core shared sandbox
that also ran the database and the load generator:

| | |
|--|--|
| People | 506 |
| Page views | 4,959 in 46 s (108 per second) |
| API calls | 12,042 (263 per second) |
| Errors | 0 |
| Latency p95 | 12–65 ms for resident pages, 103–136 ms for the heaviest staff pages (dashboard, accommodation overview) |

Real traffic is far lighter than this test: 500 named users reading a page
every 15 seconds or so is about 30 page views per second, with only a fraction
online together. A single API process has roughly 4x headroom over that; run
two or more (see `docs/deployment.md`) for resilience and extra margin.

Measured single-process ceiling on that machine: about 550–600 simple calls per
second. Two instances improved both latency and throughput, so capacity grows by
adding instances.

## What to watch while testing

- `GET /metrics` on the API (with `METRICS_TOKEN` if set): request counts and latency.
- PostgreSQL: `SELECT count(*) FROM pg_stat_activity;` stays below the pool size.
- API process CPU (`pm2 monit`). If one process sits at 100% while the database is idle, add instances.
