const int = (name: string, fallback: number) => {
  const v = Number(process.env[name]);
  return Number.isFinite(v) && v > 0 ? v : fallback;
};

export function loadConfig(env: NodeJS.ProcessEnv = process.env) {
  return {
    host: env.API_HOST ?? "0.0.0.0",
    port: int("API_PORT", 4000),
    logLevel: env.LOG_LEVEL ?? "info",
    /** Behind nginx the real client address arrives in X-Forwarded-For. */
    trustProxy: (env.TRUST_PROXY ?? "true") !== "false",
    corsOrigins: (env.CORS_ORIGINS ?? "").split(",").map((s) => s.trim()).filter(Boolean),
    rateLimitMax: int("RATE_LIMIT_MAX", 1200),
    rateLimitWindowSeconds: int("RATE_LIMIT_WINDOW_SECONDS", 60),
    /** How long a resolved session is reused before the database is asked again. */
    sessionCacheTtlMs: Number(env.SESSION_CACHE_TTL_MS ?? 10000),
    sessionCacheMax: int("SESSION_CACHE_MAX", 20000),
    maxUploadBytes: int("MAX_UPLOAD_BYTES", 5 * 1024 * 1024),
    metricsToken: env.METRICS_TOKEN ?? "",
    bodyLimitBytes: int("API_BODY_LIMIT_BYTES", 12 * 1024 * 1024),
  };
}

export type Config = ReturnType<typeof loadConfig>;
