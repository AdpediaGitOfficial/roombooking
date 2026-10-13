// Standalone delivery worker: `npm run start:worker`.
// Polls the outbox every EMAIL_WORKER_INTERVAL_SECONDS (default 30).
import { loadRootEnv } from "@sam/core/lib/env";
loadRootEnv();
import { processOutbox } from "@sam/core/modules/notifications/worker";
import { transportFromEnv } from "@sam/core/modules/notifications/transport";
import { whatsappTransportFromEnv } from "@sam/core/modules/notifications/whatsapp";
import { runDailySweeps } from "@sam/core/modules/jobs/daily";

const interval = Number(process.env.EMAIL_WORKER_INTERVAL_SECONDS ?? 30) * 1000;
const transport = transportFromEnv();
const whatsapp = whatsappTransportFromEnv();
console.info(`[worker] email transport: ${transport.description}`);
console.info(`[worker] whatsapp transport: ${whatsapp.description}`);

let stopping = false;
const sweepEvery = Number(process.env.SWEEP_INTERVAL_MINUTES ?? 60) * 60_000;
let lastSweep = 0;
process.on("SIGINT", () => { stopping = true; });
process.on("SIGTERM", () => { stopping = true; });

async function loop() {
  while (!stopping) {
    try {
      const r = await processOutbox({ transport, whatsapp });
      if (r.claimed > 0) console.info(`[worker] ${new Date().toISOString()} sent=${r.sent} retry=${r.failed} failed=${r.permanentlyFailed}`);
    } catch (error) {
      console.error("[worker] run failed", error);
    }
    if (Date.now() - lastSweep >= sweepEvery) {
      lastSweep = Date.now();
      try { console.info("[worker] sweeps", JSON.stringify(await runDailySweeps())); } catch (error) { console.error("[worker] sweeps failed", error); }
    }
    await new Promise((resolve) => setTimeout(resolve, interval));
  }
  console.info("[worker] stopped");
  process.exit(0);
}
void loop();
