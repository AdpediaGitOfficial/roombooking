// Runs the scheduled jobs once by calling POST /api/jobs/notifications:
// outbox delivery (email, WhatsApp) and the booking and request sweeps.
// Meant for a systemd timer or cron: `npm run jobs`.
//
// Reads JOBS_SECRET (and PORT) from the environment, falling back to the
// .env file in the project root. No dependencies, so it runs with plain node.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

function loadDotEnv() {
  const file = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", ".env");
  let text;
  try { text = readFileSync(file, "utf8"); } catch { return {}; }
  const values = {};
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq < 0) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    const quoted = value.match(/^(["'])(.*)\1/);
    if (quoted) value = quoted[2];
    else value = value.replace(/\s+#.*$/, "");
    values[key] = value;
  }
  return values;
}

const env = { ...loadDotEnv(), ...process.env };
const secret = env.JOBS_SECRET;
if (!secret) {
  console.error("JOBS_SECRET is not set; add it to .env");
  process.exit(2);
}
const url = env.JOBS_URL ?? `http://127.0.0.1:${env.PORT ?? 3000}/api/jobs/notifications`;

const response = await fetch(url, { method: "POST", headers: { authorization: `Bearer ${secret}` } });
const body = await response.text();
if (!response.ok) {
  console.error(`jobs call failed: ${response.status} ${body}`);
  process.exit(1);
}
console.log(`${new Date().toISOString()} ${body}`);
