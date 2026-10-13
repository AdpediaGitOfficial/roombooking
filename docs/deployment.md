# Deploying to a live server

Three services (web, API, worker) on one or more Linux servers (Ubuntu 22.04 or
24.04): Node.js 22, PostgreSQL 16, PM2 to run the services, nginx in front with
HTTPS. No Docker. For a managed host, `render.yaml` in the repository root is a
Render blueprint for the same layout.

| Service | Runs | Port | Public? |
|---------|------|------|---------|
| web | Next.js: pages and forms | 3000 | yes, through nginx |
| api | Fastify: all business operations and the database | 4000 | no (127.0.0.1) |
| worker | email and WhatsApp delivery, booking and request sweeps | 4200 (health) | no |

Browsers only talk to the web service. The web service calls the API over the
private address in `API_URL`. The API is the only part that serves requests
against the database; the worker also uses it.

Commands below run on the server as a user with sudo. Replace
`accommodation.example.com` with your domain and choose real passwords.

## 1. Install the software

```bash
sudo apt update && sudo apt install -y curl git nginx postgresql postgresql-contrib certbot python3-certbot-nginx
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs
sudo npm install -g pm2
node -v    # v22.x
```

## 2. Create the database

```bash
sudo -u postgres psql <<'SQL'
CREATE USER sam WITH PASSWORD 'choose-a-strong-password';
CREATE DATABASE sam OWNER sam;
SQL
```

## 3. Get the code and configure

```bash
sudo mkdir -p /srv/staff-accommodation && sudo chown $USER:$USER /srv/staff-accommodation
git clone <repository-url> /srv/staff-accommodation
cd /srv/staff-accommodation
git checkout claude/separate-backend-api      # or the branch you deploy from
cp .env.example .env
nano .env
```

All three services read the same `.env`. Set at least:

| Key | Value |
|-----|-------|
| `DATABASE_URL` | `postgresql://sam:choose-a-strong-password@localhost:5432/sam?schema=public&connection_limit=10` |
| `APP_BASE_URL` | `https://accommodation.example.com` (used in email links) |
| `API_URL` | `http://127.0.0.1:4000` (where the web service reaches the API) |
| `JOBS_SECRET` | a random string, at least 32 characters (`openssl rand -hex 32`) |
| `UPLOAD_DIR` | `/srv/staff-accommodation/uploads` |
| `MAIL_FROM`, `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS` | your mail server; or `EMAIL_TRANSPORT=disabled` until you have one |
| `WHATSAPP_*` | only if WhatsApp is used; otherwise leave `WHATSAPP_TRANSPORT=disabled` |

Tuning values (all optional) are listed under
[Settings that matter at scale](#settings-that-matter-at-scale).

## 4. Build and migrate

```bash
cd /srv/staff-accommodation
npm ci                      # installs dependencies and generates the Prisma client
npm run db:deploy           # creates and upgrades the tables
npm run db:seed             # demo organisation and accounts (optional; skip on a clean production database)
npm run build               # builds the API, worker and web app
```

The seed creates the demo accounts listed in the README with the password
`ChangeMe123!`. On a real server set `SEED_PASSWORD` in `.env` before seeding,
or delete the demo accounts after creating your own administrator.

## 5. Run the services with PM2

```bash
cd /srv/staff-accommodation
pm2 start ecosystem.config.cjs
pm2 save
pm2 startup       # prints one sudo command; run it so PM2 starts on boot
```

`ecosystem.config.cjs` defines three processes:

- `sam-api`: PM2 cluster mode, 2 processes by default. Set `API_INSTANCES=4`
  (for example, one per CPU core) before `pm2 start` to change it.
- `sam-web`: one process on port 3000.
- `sam-worker`: exactly one process. Do not scale it up.

Check each service:

```bash
curl -s http://127.0.0.1:4000/ready          # {"status":"ready","database":"up"}
curl -s http://127.0.0.1:3000/api/health     # {"status":"ok","api":"up","database":"up"}
curl -s http://127.0.0.1:4200/health         # worker: last outbox run and sweep times
```

## 6. Put nginx in front with HTTPS

```bash
sudo cp deploy/nginx.conf.example /etc/nginx/sites-available/staff-accommodation
sudo nano /etc/nginx/sites-available/staff-accommodation     # set server_name
sudo ln -s /etc/nginx/sites-available/staff-accommodation /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
sudo certbot --nginx -d accommodation.example.com
```

HTTPS is required: session cookies are marked Secure in production, so sign-in
over plain HTTP does not keep a session. Point your domain's DNS A record at
the server before running certbot.

The example file also contains an optional `sam_api` upstream for balancing
several API servers (see [Scaling out](#scaling-out)).

## 7. Scheduled jobs

The worker runs them: outbox delivery every 20 seconds and the booking and
request sweeps every minute (`OUTBOX_INTERVAL_SECONDS`, `SWEEP_INTERVAL_SECONDS`).
No cron entry is needed. `GET :4200/health` shows when each last ran and how many
errors there have been.

If you prefer an external scheduler instead of the worker, stop `sam-worker`
and call `POST /jobs/run` on the API (or `POST /api/jobs/notifications` on the web
service, which relays to it) with `Authorization: Bearer $JOBS_SECRET` every
minute. `npm run jobs` does the latter and suits a cron entry.

## 8. Check

- Open `https://accommodation.example.com` and sign in.
- `pm2 status` shows `sam-api` (×N), `sam-web` and `sam-worker` online.
- `pm2 logs sam-api --lines 50` shows one JSON line per request.
- `/admin/notifications` lists deliveries and any failures.
- `https://accommodation.example.com/api/health` returns `ok`.

The API publishes its own documentation at `http://127.0.0.1:4000/docs`
(OpenAPI at `/openapi.json`). It is not exposed through nginx by default; add a
`location /v1/` and `/docs` block that proxies to port 4000 only if external
systems need to call the API, and protect it as you would any public endpoint.

## Updating later

```bash
cd /srv/staff-accommodation
git pull
npm ci
npm run db:deploy
npm run build
pm2 reload ecosystem.config.cjs
```

`reload` restarts API processes one at a time, so the site stays up. A failed
migration or build stops before the reload, so the running version stays
active. Keep migrations backward compatible with the running release (add columns and
indexes first, remove old ones in a later release), because old API processes
keep serving while the new ones start.

## Settings that matter at scale

| Setting | Default | What it does |
|---------|---------|--------------|
| `API_INSTANCES` | 2 | API processes under PM2. About one per CPU core, up to the database's capacity. |
| `connection_limit` in `DATABASE_URL` | Prisma default (cores × 2 + 1) | Database connections per API/worker process. Keep processes × limit under PostgreSQL `max_connections` (default 100), or use PgBouncer. |
| `READ_CACHE_TTL_MS` | 5000 | How long shared views (dashboard, pick lists) are reused. 0 turns it off. Each API process has its own cache, so a change can take up to this long to show on another process. |
| `SESSION_CACHE_TTL_MS` | 10000 | How long a verified session is reused before the database is asked again. A sign-out or deactivation takes effect on other processes within this time. |
| `RATE_LIMIT_MAX` / `RATE_LIMIT_WINDOW_SECONDS` | 1200 / 60 | Requests allowed per client address per window. The web service forwards the visitor's address, so this is per visitor. |
| `MAX_UPLOAD_BYTES` | 5242880 | Largest photo. nginx `client_max_body_size` must be at least this. |
| `METRICS_TOKEN` | empty | If set, `GET /metrics` requires `Authorization: Bearer <token>`. |
| `OUTBOX_INTERVAL_SECONDS`, `SWEEP_INTERVAL_SECONDS` | 20, 60 | Worker timings. |
| `LOG_LEVEL` | info | `warn` during load tests. |

### Connection pool and PgBouncer

Each API process opens up to `connection_limit` connections. With 4 API
processes at 10 each plus the worker, that is about 50, within PostgreSQL's
default of 100. Beyond about 8 API processes in total, put PgBouncer in
front: `deploy/pgbouncer.ini.example` is a ready configuration (transaction
pooling) with the `DATABASE_URL` form to use. Run migrations against
PostgreSQL directly, not through PgBouncer.

### Uploaded photos

Photos are stored on disk in `UPLOAD_DIR` and served by the API. With a single
API server this just works (back the folder up with the database). If you run
the API on several servers, they must all see the same folder: mount a shared
network volume (NFS, or the host's equivalent) at the same path on each, or the
photo uploaded through one server will be missing on the others. Processes on
one server already share the folder.

## Scaling out

Sized for 500 named users, one server with 4 vCPU and 8 GB runs everything
comfortably (see `docs/load-testing.md`: 500 simulated users at 108 page views
per second, no errors, on one API process). To grow:

1. **More API processes** on the same server: raise `API_INSTANCES`, then
   `pm2 reload`.
2. **Separate servers.** Put PostgreSQL on its own machine (change
   `DATABASE_URL`). Run web on one or two servers and API on one or two more.
   On each web server set `API_URL` to the API address, or to the nginx upstream
   in `deploy/nginx.conf.example` that balances several API servers. Keep one
   worker only. Share the uploads folder as above.
3. **Database.** Add PgBouncer, then a larger instance. The schema has indexes on
   every list and filter used by the screens.

## Backups

```bash
# daily at 02:00, keep 14 days
0 2 * * * pg_dump -U sam sam | gzip > /srv/backups/sam-$(date +\%F).sql.gz && find /srv/backups -mtime +14 -delete
```

Back up `/srv/staff-accommodation/uploads` together with the database: the
database holds the attachment records and the folder holds the photos.

## Troubleshooting

| Symptom | Check |
|---------|-------|
| 502 from nginx | `pm2 status`; `pm2 logs sam-web --lines 100` |
| Pages show an error and `/api/health` says `degraded` | `pm2 logs sam-api`; `curl http://127.0.0.1:4000/ready`; `API_URL` in `.env` |
| `/ready` says database down | `DATABASE_URL`; `sudo systemctl status postgresql`; too many connections (see pool settings) |
| Sign-in loops back to the login page | the site is not on HTTPS, or `APP_BASE_URL` is wrong |
| Emails not sent | `EMAIL_TRANSPORT` and `SMTP_*`; failures appear at `/admin/notifications`; `pm2 logs sam-worker` |
| Reminders and escalations never fire | `pm2 status` shows `sam-worker`; `curl http://127.0.0.1:4200/health` shows recent `lastSweepAt` |
| Photos fail to upload | `UPLOAD_DIR` exists and is writable by the PM2 user; nginx `client_max_body_size` |
| Many 429 errors | `RATE_LIMIT_MAX` too low for the traffic, or the web service is not forwarding visitor addresses (check `TRUST_PROXY`) |
