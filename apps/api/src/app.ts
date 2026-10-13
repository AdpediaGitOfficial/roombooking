import { randomUUID, createHash } from "node:crypto";
import Fastify, { type FastifyInstance } from "fastify";
import compress from "@fastify/compress";
import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import multipart from "@fastify/multipart";
import rateLimit from "@fastify/rate-limit";
import { contract } from "@sam/contract/index";
import type { Contract } from "@sam/contract/define";
import { prisma } from "@sam/core/lib/db";
import { bearerToken, createAuthenticator } from "./auth";
import { ReadCache } from "./cache";
import { loadConfig, type Config } from "./config";
import { toHttpError } from "./errors";
import { handlers } from "./handlers";
import { createMetrics } from "./metrics";
import { buildOpenApi } from "./openapi";
import { registerRawRoutes } from "./raw-routes";
import { registerOps } from "./register";

export interface BuildOptions {
  config?: Partial<Config>;
  logger?: boolean;
  /** Additional operations to serve; used by tests to exercise the engine with small contracts. */
  extraOps?: { contract: Contract; handlers: unknown };
}

const DOCS_HTML = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Staff Accommodation API</title></head><body><redoc spec-url="/openapi.json"></redoc><script src="https://cdn.jsdelivr.net/npm/redoc@2.1.5/bundles/redoc.standalone.js"></script></body></html>`;

export async function buildApp(options: BuildOptions = {}): Promise<FastifyInstance & { draining: boolean }> {
  const config: Config = { ...loadConfig(), ...options.config };
  const app = Fastify({
    logger: options.logger ? { level: config.logLevel, redact: ["req.headers.authorization", "req.headers.cookie"] } : false,
    trustProxy: config.trustProxy,
    bodyLimit: config.bodyLimitBytes,
    requestIdHeader: "x-request-id",
    genReqId: () => randomUUID(),
  }) as unknown as FastifyInstance & { draining: boolean };
  app.draining = false;

  const authenticator = createAuthenticator(config.sessionCacheTtlMs, config.sessionCacheMax);
  const metrics = createMetrics();
  const cache = new ReadCache(config.readCacheTtlMs);

  await app.register(helmet, { contentSecurityPolicy: false });
  if (config.corsOrigins.length > 0) await app.register(cors, { origin: config.corsOrigins, credentials: false, maxAge: 600 });
  await app.register(compress, { threshold: 1024 });
  await app.register(multipart, { limits: { fileSize: config.maxUploadBytes, files: 5 } });
  await app.register(rateLimit, {
    global: true,
    max: config.rateLimitMax,
    timeWindow: config.rateLimitWindowSeconds * 1000,
    keyGenerator: (request) => {
      const token = bearerToken(request);
      return token ? `t:${createHash("sha256").update(token).digest("hex").slice(0, 16)}` : `ip:${request.ip}`;
    },
    errorResponseBuilder: (_req, context) => ({
      statusCode: 429,
      code: "RATE_LIMITED",
      message: `Too many requests. Try again in ${Math.ceil(context.ttl / 1000)} seconds.`,
    }),
  });

  app.addHook("onRequest", async (request, reply) => {
    reply.header("x-request-id", request.id);
  });
  app.addHook("onResponse", async (request, reply) => {
    const opId = request.routeOptions.config?.opId ?? "other";
    metrics.duration.observe({ op: opId, method: request.method, status: String(reply.statusCode) }, reply.elapsedTime / 1000);
  });

  app.setErrorHandler((error, request, reply) => {
    const mapped = toHttpError(error);
    if (mapped) {
      return reply.code(mapped.status).send({
        error: { code: mapped.code, message: mapped.message, ...(Object.keys(mapped.fieldErrors).length ? { fieldErrors: mapped.fieldErrors } : {}), ...(mapped.details ? { details: mapped.details } : {}), requestId: request.id },
      });
    }
    const status = (error as { statusCode?: number }).statusCode;
    if (status && status >= 400 && status < 500) {
      const code = status === 429 ? "RATE_LIMITED" : status === 413 ? "TOO_LARGE" : status === 404 ? "NOT_FOUND" : "BAD_REQUEST";
      const message = (error as { message?: string }).message ?? "The request could not be processed.";
      return reply.code(status).send({ error: { code, message, requestId: request.id } });
    }
    request.log.error({ err: error }, "unhandled error");
    return reply.code(500).send({ error: { code: "INTERNAL", message: "Something went wrong on our side. Try again, and contact support with the request id if it continues.", requestId: request.id } });
  });
  app.setNotFoundHandler((request, reply) => reply.code(404).send({ error: { code: "NOT_FOUND", message: "No such endpoint.", requestId: request.id } }));

  // Operational endpoints: no sign-in and exempt from rate limiting.
  const open = { config: { rateLimit: false as const } };
  app.get("/health", open, async () => ({ status: "ok", uptimeSeconds: Math.round(process.uptime()) }));
  app.get("/ready", open, async (_req, reply) => {
    if (app.draining) return reply.code(503).send({ status: "draining" });
    try {
      await prisma.$queryRaw`SELECT 1`;
      return { status: "ready", database: "up" };
    } catch {
      return reply.code(503).send({ status: "unavailable", database: "down" });
    }
  });
  app.get("/metrics", open, async (request, reply) => {
    if (config.metricsToken && bearerToken(request) !== config.metricsToken) return reply.code(401).send({ error: { code: "UNAUTHENTICATED", message: "Metrics token required." } });
    metrics.sessionCache.set(authenticator.cacheSize);
    return reply.header("content-type", metrics.registry.contentType).send(await metrics.registry.metrics());
  });
  const openApi = buildOpenApi({ ...contract, ...(options.extraOps?.contract ?? {}) }, { title: "Staff Accommodation API", version: "1.0.0", description: "REST API for accommodation, allocations, maintenance, keys, inventory, facilities and approvals. Authenticate with POST /v1/auth/login and send the token as a bearer token." });
  app.get("/openapi.json", open, async () => openApi);
  app.get("/docs", open, async (_req, reply) => reply.header("content-type", "text/html; charset=utf-8").send(DOCS_HTML));

  registerOps(app, contract, handlers, { authenticator, cache, maxUploadBytes: config.maxUploadBytes });
  if (options.extraOps) registerOps(app, options.extraOps.contract, options.extraOps.handlers as never, { authenticator, cache, maxUploadBytes: config.maxUploadBytes });
  await registerRawRoutes(app, cache);
  return app;
}
