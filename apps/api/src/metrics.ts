import client from "prom-client";

export function createMetrics() {
  const registry = new client.Registry();
  client.collectDefaultMetrics({ register: registry });
  const duration = new client.Histogram({
    name: "http_request_duration_seconds",
    help: "Request duration by operation and status",
    labelNames: ["op", "method", "status"],
    buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5],
    registers: [registry],
  });
  const sessionCache = new client.Gauge({ name: "session_cache_entries", help: "Entries in the session cache", registers: [registry] });
  return { registry, duration, sessionCache };
}

export type Metrics = ReturnType<typeof createMetrics>;
