// Background worker: `npm run start:worker`.
//   - delivers queued email and WhatsApp messages (the outbox) every OUTBOX_INTERVAL_SECONDS
//   - expires and completes bookings and runs request reminders, escalations and expiry
//     every SWEEP_INTERVAL_SECONDS
// Safe to run on more than one machine: outbox rows are claimed with a conditional update and the
// sweeps are idempotent, so two workers never send the same message or expire a request twice.
import { createServer } from "node:http";
import { loadRootEnv } from "@sam/core/lib/env";
loadRootEnv();

const { prisma } = await import("@sam/core/lib/db");
const { processOutbox } = await import("@sam/core/modules/notifications/worker");
const { transportFromEnv } = await import("@sam/core/modules/notifications/transport");
const { whatsappTransportFromEnv } = await import("@sam/core/modules/notifications/whatsapp");
const { sweepBookings } = await import("@sam/core/modules/facilities/service");
const { sweepRequests } = await import("@sam/core/modules/requests/service");

const seconds = (name: string, fallback: number, legacy?: string) => {
  const v = Number(process.env[name] ?? (legacy ? process.env[legacy] : undefined));
  return (Number.isFinite(v) && v > 0 ? v : fallback) * 1000;
};
const outboxEvery = seconds("OUTBOX_INTERVAL_SECONDS", 20, "EMAIL_WORKER_INTERVAL_SECONDS");
const sweepEvery = seconds("SWEEP_INTERVAL_SECONDS", 60);

const transport = transportFromEnv();
const whatsapp = whatsappTransportFromEnv();
const log = (message: string, extra: Record<string, unknown> = {}) => console.info(JSON.stringify({ at: new Date().toISOString(), service: "worker", message, ...extra }));
log("started", { email: transport.description, whatsapp: whatsapp.description, outboxEverySeconds: outboxEvery / 1000, sweepEverySeconds: sweepEvery / 1000 });

const health = { startedAt: new Date().toISOString(), lastOutboxAt: null as string | null, lastSweepAt: null as string | null, outboxErrors: 0, sweepErrors: 0 };
let stopping = false;

async function runOutbox() {
  try {
    const r = await processOutbox({ transport, whatsapp });
    health.lastOutboxAt = new Date().toISOString();
    if (r.claimed > 0) log("outbox", { sent: r.sent, retry: r.failed, failed: r.permanentlyFailed });
  } catch (error) {
    health.outboxErrors++;
    log("outbox run failed", { error: error instanceof Error ? error.message : String(error) });
  }
}

async function runSweeps() {
  try {
    const [bookings, requests] = [await sweepBookings(), await sweepRequests()];
    health.lastSweepAt = new Date().toISOString();
    if (bookings.expired || bookings.completed || requests.reminded || requests.escalated || requests.expired) log("sweep", { bookings, requests });
  } catch (error) {
    health.sweepErrors++;
    log("sweep failed", { error: error instanceof Error ? error.message : String(error) });
  }
}

/** Repeats a task on its own timer; a slow run delays the next one rather than overlapping it. */
async function every(ms: number, task: () => Promise<void>) {
  while (!stopping) {
    await task();
    await new Promise((resolve) => setTimeout(resolve, ms));
  }
}

const healthPort = Number(process.env.WORKER_HEALTH_PORT ?? 0);
if (healthPort > 0) {
  createServer((req, res) => {
    const staleAfter = Math.max(outboxEvery, sweepEvery) * 3;
    const age = (iso: string | null) => (iso ? Date.now() - Date.parse(iso) : Infinity);
    const ok = req.url === "/health" ? !stopping && age(health.lastOutboxAt) < staleAfter && age(health.lastSweepAt) < staleAfter : true;
    res.writeHead(ok ? 200 : 503, { "content-type": "application/json" }).end(JSON.stringify({ status: ok ? "ok" : "stale", ...health }));
  }).listen(healthPort, "0.0.0.0");
}

async function shutdown(signal: string) {
  if (stopping) return;
  stopping = true;
  log("stopping", { signal });
  await prisma.$disconnect().catch(() => undefined);
  process.exit(0);
}
process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));

void every(outboxEvery, runOutbox);
void every(sweepEvery, runSweeps);
