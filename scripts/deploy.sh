#!/usr/bin/env bash
# Builds and restarts the app on a single server. Run from the checkout as
# the deploy user after `git pull`:
#
#   ./scripts/deploy.sh
#
# Expects .env in the checkout (see .env.example; Next.js and Prisma read it
# themselves) and the systemd unit from deploy/ installed. Each step stops
# on error, so a failed migration or build leaves the running version alone.
set -euo pipefail
cd "$(dirname "$0")/.."
export NODE_ENV=production

echo "==> installing dependencies"
npm ci

echo "==> applying migrations"
npx prisma migrate deploy

echo "==> building"
npm run build

echo "==> restarting"
sudo systemctl restart staff-accommodation
for _ in $(seq 1 20); do
  if curl -fsS "http://127.0.0.1:${PORT:-3000}/api/health"; then echo; echo "==> deployed"; exit 0; fi
  sleep 1
done
echo "app did not report healthy; check: journalctl -u staff-accommodation -n 50" >&2
exit 1
