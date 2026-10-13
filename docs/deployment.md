# Deploying to a live server

Plain deployment on one Linux server (Ubuntu 22.04 or 24.04): Node.js 22,
PostgreSQL 16, the app under PM2, nginx in front with HTTPS, and a cron
entry for the scheduled jobs. No Docker.

Commands below are run on the server as a user with sudo. Replace
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

## 3. Get the code

```bash
sudo mkdir -p /srv/staff-accommodation && sudo chown $USER:$USER /srv/staff-accommodation
git clone <repository-url> /srv/staff-accommodation
cd /srv/staff-accommodation
git checkout claude/festive-davinci-d1r1w6     # or the branch you deploy from
cp .env.example .env
nano .env
```

Set at least these values in `.env`:

| Key | Value |
|-----|-------|
| `DATABASE_URL` | `postgresql://sam:choose-a-strong-password@localhost:5432/sam?schema=public` |
| `APP_BASE_URL` | `https://accommodation.example.com` |
| `JOBS_SECRET` | a random string, at least 32 characters (`openssl rand -hex 32`) |
| `UPLOAD_DIR` | `/srv/staff-accommodation/uploads` |
| `MAIL_FROM`, `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS` | your mail server; or `EMAIL_TRANSPORT=disabled` until you have one |
| `WHATSAPP_*` | only if WhatsApp is used; otherwise leave `WHATSAPP_TRANSPORT=disabled` |

## 4. Build and seed

```bash
cd /srv/staff-accommodation
npm ci                      # installs dependencies and generates the Prisma client
npx prisma migrate deploy   # creates the tables
npm run db:seed             # demo organisation and accounts (optional; skip on a clean production database)
npm run build               # production build
```

The seed creates the demo accounts listed in the README with the password
`ChangeMe123!`. On a real server set `SEED_PASSWORD` in `.env` before
seeding, or delete the demo accounts after creating your own administrator.

## 5. Run it with PM2

```bash
cd /srv/staff-accommodation
PORT=3000 pm2 start npm --name staff-accommodation -- start
pm2 save
pm2 startup       # prints one sudo command; run it so PM2 starts on boot
curl -s http://127.0.0.1:3000/api/health      # {"status":"ok","database":"up"}
```

## 6. Put nginx in front with HTTPS

```bash
sudo tee /etc/nginx/sites-available/staff-accommodation >/dev/null <<'NGINX'
server {
    listen 80;
    server_name accommodation.example.com;
    client_max_body_size 10m;
    location / {
        proxy_pass         http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header   Host $host;
        proxy_set_header   X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header   X-Forwarded-Proto $scheme;
    }
}
NGINX
sudo ln -s /etc/nginx/sites-available/staff-accommodation /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
sudo certbot --nginx -d accommodation.example.com     # obtains the certificate and adds the HTTPS server block
```

HTTPS is required: session cookies are marked Secure in production, so
sign-in over plain HTTP does not keep a session. Point your domain's DNS
A record at the server before running certbot.

## 7. Schedule the jobs

The jobs endpoint delivers email and WhatsApp notifications and runs the
booking and request sweeps (reminders, escalation, expiry). Run it every
minute:

```bash
crontab -e
# add this line
* * * * * cd /srv/staff-accommodation && /usr/bin/npm run jobs --silent >> /srv/staff-accommodation/jobs.log 2>&1
```

Test once by hand: `cd /srv/staff-accommodation && npm run jobs`.

## 8. Check

- Open `https://accommodation.example.com` and sign in.
- `pm2 status` shows `staff-accommodation` online; `pm2 logs staff-accommodation` shows requests.
- `tail /srv/staff-accommodation/jobs.log` shows a line per minute.
- `/admin/notifications` lists deliveries and any failures.

## Updating later

```bash
cd /srv/staff-accommodation
git pull
npm ci
npx prisma migrate deploy
npm run build
pm2 restart staff-accommodation
```

A failed migration or build stops before the restart, so the running
version stays up.

## Backups

```bash
# daily at 02:00, keep 14 days
0 2 * * * pg_dump -U sam sam | gzip > /srv/backups/sam-$(date +\%F).sql.gz && find /srv/backups -mtime +14 -delete
```

Back up `/srv/staff-accommodation/uploads` together with the database:
the database holds the attachment records and the folder holds the photos.

## Troubleshooting

| Symptom | Check |
|---------|-------|
| 502 from nginx | `pm2 status`; `pm2 logs staff-accommodation --lines 100` |
| Health says database down | `DATABASE_URL` in `.env`; `sudo systemctl status postgresql` |
| Sign-in loops back to the login page | the site is not on HTTPS, or `APP_BASE_URL` is wrong |
| Emails not sent | `EMAIL_TRANSPORT` and `SMTP_*` in `.env`; failures appear at `/admin/notifications` |
| Reminders and escalations never fire | the cron line; `jobs.log`; `JOBS_SECRET` set in `.env` |
| Photos fail to upload | `UPLOAD_DIR` exists and is writable by the PM2 user |
