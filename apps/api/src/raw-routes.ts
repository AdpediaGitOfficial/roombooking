// Endpoints that are not part of the typed contract because their callers are not our own clients:
// the WhatsApp provider's webhook (authenticated by a signature over the raw body) and the
// scheduler hook (authenticated by a shared secret).
import { timingSafeEqual } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { runScheduledJobs } from "@sam/core/modules/jobs/service";
import { parseStatusWebhook, verifyWebhookSignature } from "@sam/core/modules/notifications/whatsapp";
import { applyStatusUpdates } from "@sam/core/modules/notifications/worker";
import { bearerToken } from "./auth";
import type { ReadCache } from "./cache";

function safeEqual(a: string, b: string): boolean {
  return a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

export async function registerRawRoutes(app: FastifyInstance, cache: ReadCache) {
  // Webhook bodies must reach the handler as the exact text the provider signed.
  await app.register(async (scope) => {
    scope.addContentTypeParser("application/json", { parseAs: "string" }, (_req, body, done) => done(null, body));

    /** Meta's verification handshake: echoes hub.challenge when the verify token matches. */
    scope.get("/webhooks/whatsapp", async (request, reply) => {
      const q = request.query as Record<string, string | undefined>;
      const token = process.env.WHATSAPP_VERIFY_TOKEN;
      if (q["hub.mode"] === "subscribe" && token && q["hub.verify_token"] === token) return reply.type("text/plain").send(q["hub.challenge"] ?? "");
      return reply.code(403).send({ error: { code: "FORBIDDEN", message: "verification failed" } });
    });

    /** Delivery receipts (COM-04), authenticated with X-Hub-Signature-256 over the raw payload. */
    scope.post("/webhooks/whatsapp", async (request, reply) => {
      const raw = typeof request.body === "string" ? request.body : "";
      const header = request.headers["x-hub-signature-256"];
      if (!verifyWebhookSignature(raw, typeof header === "string" ? header : null, process.env.WHATSAPP_APP_SECRET ?? "")) {
        return reply.code(401).send({ error: { code: "UNAUTHENTICATED", message: "invalid signature" } });
      }
      let body: unknown;
      try {
        body = JSON.parse(raw);
      } catch {
        return reply.code(400).send({ error: { code: "BAD_REQUEST", message: "invalid json" } });
      }
      const result = await applyStatusUpdates(parseStatusWebhook(body));
      cache.clear();
      return result;
    });
  });

  /** Scheduler entry point: POST with `Authorization: Bearer <JOBS_SECRET>`. */
  app.post("/jobs/run", async (request, reply) => {
    const secret = process.env.JOBS_SECRET;
    const provided = bearerToken(request) ?? "";
    if (!secret || !safeEqual(provided, secret)) return reply.code(401).send({ error: { code: "UNAUTHENTICATED", message: "unauthorized" } });
    const limit = Number((request.query as { limit?: string }).limit ?? 50);
    const result = await runScheduledJobs({ limit: Number.isFinite(limit) ? limit : 50 });
    cache.clear();
    return result;
  });
}
