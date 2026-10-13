import { loadRootEnv } from "@sam/core/lib/env";
loadRootEnv();

const { prisma } = await import("@sam/core/lib/db");
const { buildApp } = await import("./app");
const { loadConfig } = await import("./config");

const config = loadConfig();
const app = await buildApp({ logger: true });

async function shutdown(signal: string) {
  app.log.info({ signal }, "shutting down");
  app.draining = true;
  // Let the load balancer see /ready fail before connections are closed.
  await new Promise((resolve) => setTimeout(resolve, Number(process.env.SHUTDOWN_GRACE_MS ?? 3000)));
  try {
    await app.close();
    await prisma.$disconnect();
    process.exit(0);
  } catch (error) {
    app.log.error({ err: error }, "error during shutdown");
    process.exit(1);
  }
}
process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));

await app.listen({ host: config.host, port: config.port });
