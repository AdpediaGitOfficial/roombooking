// PM2 process file: web, API and worker as three separate services.
//
//   pm2 start ecosystem.config.cjs     # start all three
//   pm2 reload ecosystem.config.cjs    # zero-downtime restart after a deploy
//
// Settings come from .env in this directory (read by each service). Override
// per machine with environment variables, e.g. API_INSTANCES=4.
const path = require("node:path");
const root = __dirname;

// Ports and addresses come from .env (or the shell), so nothing is hardcoded here.
// PM2 hands these values to each service, and they win over the service's own .env read.
try { process.loadEnvFile(path.join(root, ".env")); } catch { /* no .env: use the shell and the defaults below */ }
const env = process.env;
const WEB_PORT = env.WEB_PORT || 3000;
const API_PORT = env.API_PORT || 4000;
const API_HOST = env.API_HOST || "127.0.0.1";
const API_URL = env.API_URL || `http://127.0.0.1:${API_PORT}`;
const WORKER_HEALTH_PORT = env.WORKER_HEALTH_PORT || 4200;

module.exports = {
  apps: [
    {
      // The API holds all business logic and talks to the database. It runs in
      // cluster mode: one process per CPU core, sharing API_PORT. Browsers never
      // call it directly; only the web service (and nginx for health checks) do.
      name: "sam-api",
      cwd: path.join(root, "apps/api"),
      script: "dist/index.js",
      exec_mode: "cluster",
      instances: process.env.API_INSTANCES || 2,
      max_memory_restart: "700M",
      kill_timeout: 10000,          // > SHUTDOWN_GRACE_MS so in-flight requests finish
      listen_timeout: 15000,
      env: { NODE_ENV: "production", API_PORT, API_HOST },
    },
    {
      // The Next.js server renders pages by calling the API. One or two processes
      // are plenty: it does no database work.
      name: "sam-web",
      cwd: path.join(root, "apps/web"),
      script: require.resolve("next/dist/bin/next", { paths: [root] }),
      args: `start -p ${WEB_PORT}`,
      exec_mode: "fork",
      instances: 1,
      max_memory_restart: "700M",
      env: { NODE_ENV: "production", PORT: WEB_PORT, API_URL },
    },
    {
      // Background jobs: email and WhatsApp delivery, booking and request sweeps.
      // Run exactly one worker.
      name: "sam-worker",
      cwd: path.join(root, "apps/worker"),
      script: "dist/index.js",
      exec_mode: "fork",
      instances: 1,
      max_memory_restart: "400M",
      env: { NODE_ENV: "production", WORKER_HEALTH_PORT },
    },
  ],
};
