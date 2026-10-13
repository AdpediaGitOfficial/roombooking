// Standalone delivery worker: `npm run notifications:worker`.
// Polls the outbox every EMAIL_WORKER_INTERVAL_SECONDS (default 30).
import { processOutbox } from "../src/modules/notifications/worker";
import { transportFromEnv } from "../src/modules/notifications/transport";
import { whatsappTransportFromEnv } from "../src/modules/notifications/whatsapp";

const interval = Number(process.env.EMAIL_WORKER_INTERVAL_SECONDS ?? 30) * 1000;
const transport = transportFromEnv();
const whatsapp = whatsappTransportFromEnv();
console.info(`[worker] email transport: ${transport.description}`);
console.info(`[worker] whatsapp transport: ${whatsapp.description}`);

let stopping = false;
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
    await new Promise((resolve) => setTimeout(resolve, interval));
  }
  console.info("[worker] stopped");
  process.exit(0);
}
void loop();
