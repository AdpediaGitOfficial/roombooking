// Standalone delivery worker: `npm run notifications:worker`.
// Polls the outbox every EMAIL_WORKER_INTERVAL_SECONDS (default 30).
import { processOutbox } from "../src/modules/notifications/worker";
import { transportFromEnv } from "../src/modules/notifications/transport";

const interval = Number(process.env.EMAIL_WORKER_INTERVAL_SECONDS ?? 30) * 1000;
const transport = transportFromEnv();
console.info(`[worker] email transport: ${transport.description}`);

let stopping = false;
process.on("SIGINT", () => { stopping = true; });
process.on("SIGTERM", () => { stopping = true; });

async function loop() {
  while (!stopping) {
    try {
      const r = await processOutbox({ transport });
      if (r.claimed > 0) console.info(`[worker] ${new Date().toISOString()} sent=${r.sent} retry=${r.failed} failed=${r.permanentlyFailed}`);
    } catch (error) {
      console.error("[worker] run failed", error);
    }
    await new Promise((resolve) => setTimeout(resolve, interval));
  }
  console.info("[worker] stopped");
  process.exit(0);
}
void loop();
