// Integrations (document sections 2, 6, 13): HRMS sync that owns name, employee ID, department, grade, gender and dates;
// API keys with scopes; signed webhooks with retry; and a system health view. Only the Super Admin configures them.
import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import type { IntegrationKind, Prisma } from "@prisma/client";
import { prisma } from "../../lib/db";
import { recordAudit } from "../../lib/audit";
import { actorCan, type ActorLike } from "../../lib/permissions/actor";
import { WEBHOOK_EVENTS, PUBLIC_EVENTS } from "../../lib/webhook-emitter";
import { cancel as cancelAllocation } from "../allocations/service";

export class IntegrationError extends Error {
  constructor(public readonly code: "NOT_FOUND" | "FORBIDDEN" | "VALIDATION" | "UNAUTHORIZED", message: string) {
    super(message);
    this.name = "IntegrationError";
  }
}
void WEBHOOK_EVENTS;
export { PUBLIC_EVENTS };
const need = (actor: ActorLike) => { if (!actorCan(actor, "setup.integrations")) throw new IntegrationError("FORBIDDEN", "Only a Super Admin manages integrations."); };

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

export const INTEGRATION_KINDS: Array<{ kind: IntegrationKind; label: string; hint: string }> = [
  { kind: "HRMS", label: "HRMS", hint: "Joiners, transfers and exits flow in; the HRMS owns name, employee ID, department, grade, gender and dates." },
  { kind: "SSO", label: "Single sign-on", hint: "Optional, later." },
  { kind: "EMAIL", label: "Email", hint: "Sender and relay (configured by environment today)." },
  { kind: "SMS", label: "SMS", hint: "Gateway for temporary passwords and alerts." },
  { kind: "WHATSAPP", label: "WhatsApp", hint: "Business API for notifications (configured by environment today)." },
];

export async function listIntegrations(organizationId: string) {
  const rows = await prisma.integrationConfig.findMany({ where: { organizationId }, include: { runs: { orderBy: { startedAt: "desc" }, take: 5 } } });
  return INTEGRATION_KINDS.map((k) => ({ ...k, config: rows.find((r) => r.kind === k.kind) ?? null }));
}

export async function configureIntegration(actor: ActorLike, organizationId: string, kind: IntegrationKind, input: { enabled: boolean; settings?: Record<string, unknown> }) {
  need(actor);
  const row = await prisma.integrationConfig.upsert({ where: { organizationId_kind: { organizationId, kind } }, update: { enabled: input.enabled, ...(input.settings ? { settings: input.settings as Prisma.InputJsonValue } : {}) }, create: { organizationId, kind, name: INTEGRATION_KINDS.find((k) => k.kind === kind)!.label, enabled: input.enabled, settings: (input.settings ?? {}) as Prisma.InputJsonValue } });
  await recordAudit({ actorId: actor.id, action: "INTEGRATION_CONFIGURED", entityType: "IntegrationConfig", entityId: row.id, after: { kind, enabled: input.enabled } });
  return row;
}

// ---------------------------------------------------------------------------
// HRMS sync
// ---------------------------------------------------------------------------

export type HrmsRecord = { employeeId: string; hrmsId?: string | null; firstName: string; lastName: string; phone?: string | null; email?: string | null; department?: string | null; grade?: string | null; gender?: "MALE" | "FEMALE" | "ANY" | null; company?: string | null; designation?: string | null; joiningDate?: string | null; status?: "ACTIVE" | "EXITED"; lastDay?: string | null };
export type SyncResult = { runId: string; created: number; updated: number; failed: number; joiners: number; exits: number; rehired: number; errors: Array<{ employeeId: string; error: string }> };

const isDate = (v?: string | null) => !!v && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v));

/**
 * Applies HRMS records. The HRMS owns identity and employment fields; the app never overwrites accommodation data.
 * A match is on employee ID (a rehire reactivates the archived profile, never a duplicate); a phone-only match is left for
 * the duplicate review screen. Exits cancel reservations that have not started and open an exit case.
 */
export async function syncHrms(organizationId: string, records: HrmsRecord[], opts: { actorId: string; trigger?: string }): Promise<SyncResult> {
  const cfg = await prisma.integrationConfig.upsert({ where: { organizationId_kind: { organizationId, kind: "HRMS" } }, update: {}, create: { organizationId, kind: "HRMS", name: "HRMS" } });
  const run = await prisma.syncRun.create({ data: { integrationId: cfg.id, trigger: opts.trigger ?? "manual" } });
  const out: SyncResult = { runId: run.id, created: 0, updated: 0, failed: 0, joiners: 0, exits: 0, rehired: 0, errors: [] };
  if (records.length > 5000) throw new IntegrationError("VALIDATION", "Send at most 5000 records per sync.");
  for (const r of records) {
    try {
      if (!r.employeeId?.trim() || !r.firstName?.trim() || !r.lastName?.trim()) throw new Error("employeeId, firstName and lastName are required.");
      const employeeId = r.employeeId.trim();
      const data = { firstName: r.firstName.trim(), lastName: r.lastName.trim(), department: r.department?.trim() || null, grade: r.grade?.trim() || null, company: r.company?.trim() || null, designation: r.designation?.trim() || null, ...(r.gender ? { gender: r.gender } : {}), ...(isDate(r.joiningDate) ? { joiningDate: new Date(`${r.joiningDate}T00:00:00.000Z`) } : {}), hrmsId: r.hrmsId ?? employeeId };
      let staff = await prisma.staffProfile.findUnique({ where: { organizationId_employeeId: { organizationId, employeeId } } });
      if (!staff) {
        staff = await prisma.staffProfile.create({ data: { organizationId, employeeId, ...data, phone: r.phone?.trim() || null, email: r.email?.trim().toLowerCase() || null, source: "HRMS", verificationStatus: "VERIFIED", verifiedAt: new Date() } });
        out.created++;
        if (isDate(r.joiningDate) && new Date(r.joiningDate!) >= new Date(Date.now() - 7 * 86400000) && r.status !== "EXITED") {
          await prisma.joiner.create({ data: { staffId: staff.id, expectedArrival: new Date(`${r.joiningDate}T00:00:00.000Z`), source: "HRMS", raisedById: opts.actorId } });
          out.joiners++;
        }
      } else {
        const rehire = (staff.archivedAt || staff.employmentStatus === "TERMINATED") && r.status !== "EXITED";
        await prisma.staffProfile.update({ where: { id: staff.id }, data: { ...data, ...(r.phone && !staff.phone ? { phone: r.phone.trim() } : {}), ...(r.email && !staff.email ? { email: r.email.trim().toLowerCase() } : {}), ...(rehire ? { archivedAt: null, archivedById: null, archiveReason: null, employmentStatus: "ACTIVE", verificationStatus: "UNVERIFIED", verifiedAt: null } : {}) } });
        if (rehire) { out.rehired++; await recordAudit({ actorId: opts.actorId, action: "STAFF_REHIRED", entityType: "StaffProfile", entityId: staff.id, after: { source: "HRMS" } }); }
        out.updated++;
      }
      if (r.status === "EXITED" && isDate(r.lastDay)) {
        const open = await prisma.exitCase.findFirst({ where: { staffId: staff.id, status: { in: ["OPEN", "CHECKOUT_DUE", "CLEARING"] } } });
        if (!open && staff.employmentStatus === "ACTIVE") {
          await prisma.exitCase.create({ data: { staffId: staff.id, triggeredById: opts.actorId, source: "HRMS", lastDay: new Date(`${r.lastDay}T00:00:00.000Z`), reason: "HRMS exit" } });
          out.exits++;
          // A reservation that has not started is cancelled and its bed released; a stay in progress runs to checkout.
          const reserved = await prisma.allocation.findMany({ where: { staffId: staff.id, status: "CONFIRMED" } });
          for (const a of reserved) await cancelAllocation({ allocationId: a.id, actorId: opts.actorId, reason: "HRMS exit" }).catch(() => undefined);
          await prisma.joiner.updateMany({ where: { staffId: staff.id, status: { in: ["EXPECTED", "ALLOCATED"] } }, data: { status: "CANCELLED" } });
        }
      }
    } catch (e) {
      out.failed++;
      out.errors.push({ employeeId: r.employeeId ?? "?", error: e instanceof Error ? e.message : String(e) });
    }
  }
  const status = out.failed === 0 ? "OK" : out.failed === records.length ? "FAILED" : "PARTIAL";
  await prisma.syncRun.update({ where: { id: run.id }, data: { finishedAt: new Date(), status, created: out.created, updated: out.updated, failed: out.failed, errors: out.errors.slice(0, 50) as Prisma.InputJsonValue } });
  await prisma.integrationConfig.update({ where: { id: cfg.id }, data: { lastSyncAt: new Date(), lastStatus: status, lastError: out.errors[0]?.error ?? null } });
  await recordAudit({ actorId: opts.actorId, action: "HRMS_SYNC", entityType: "IntegrationConfig", entityId: cfg.id, after: { created: out.created, updated: out.updated, failed: out.failed, exits: out.exits, joiners: out.joiners }, source: opts.trigger ?? "manual" });
  return out;
}

export const listSyncRuns = (organizationId: string) => prisma.syncRun.findMany({ where: { integration: { organizationId } }, orderBy: { startedAt: "desc" }, take: 30, include: { integration: { select: { kind: true } } } });

// ---------------------------------------------------------------------------
// API keys
// ---------------------------------------------------------------------------

export const API_SCOPES = [
  { scope: "hrms.sync", label: "Push HRMS records" },
  { scope: "occupancy.read", label: "Read occupancy figures" },
] as const;
const hash = (token: string) => createHash("sha256").update(token).digest("hex");

/** The token is shown once; only its hash is stored. */
export async function createApiKey(actor: ActorLike, organizationId: string, input: { name: string; scopes: string[]; expiresAt?: string | null }) {
  need(actor);
  if (!input.name?.trim()) throw new IntegrationError("VALIDATION", "Name the key.");
  const scopes = input.scopes.filter((s) => API_SCOPES.some((x) => x.scope === s));
  if (scopes.length === 0) throw new IntegrationError("VALIDATION", "Choose at least one scope.");
  const token = `sam_${randomBytes(30).toString("base64url")}`;
  const key = await prisma.apiKey.create({ data: { organizationId, name: input.name.trim(), prefix: token.slice(0, 10), tokenHash: hash(token), scopes, expiresAt: input.expiresAt ? new Date(input.expiresAt) : null, createdById: actor.id } });
  await recordAudit({ actorId: actor.id, action: "API_KEY_CREATED", entityType: "ApiKey", entityId: key.id, after: { name: key.name, scopes } });
  return { key, token };
}

export async function revokeApiKey(actor: ActorLike, id: string) {
  need(actor);
  const k = await prisma.apiKey.findUnique({ where: { id } });
  if (!k) throw new IntegrationError("NOT_FOUND", "Key not found.");
  await prisma.apiKey.update({ where: { id }, data: { revokedAt: new Date() } });
  await recordAudit({ actorId: actor.id, action: "API_KEY_REVOKED", entityType: "ApiKey", entityId: id });
}

export const listApiKeys = (organizationId: string) => prisma.apiKey.findMany({ where: { organizationId }, orderBy: { createdAt: "desc" } });

export async function verifyApiKey(token: string | null | undefined, scope: string) {
  if (!token) throw new IntegrationError("UNAUTHORIZED", "Missing API key.");
  const k = await prisma.apiKey.findUnique({ where: { tokenHash: hash(token) } });
  if (!k || k.revokedAt || (k.expiresAt && k.expiresAt < new Date())) throw new IntegrationError("UNAUTHORIZED", "Invalid or expired API key.");
  if (!k.scopes.includes(scope)) throw new IntegrationError("FORBIDDEN", `That key does not have the ${scope} scope.`);
  await prisma.apiKey.update({ where: { id: k.id }, data: { lastUsedAt: new Date() } });
  return k;
}

// ---------------------------------------------------------------------------
// Webhooks
// ---------------------------------------------------------------------------

function checkUrl(url: string) {
  let u: URL;
  try { u = new URL(url); } catch { throw new IntegrationError("VALIDATION", "Enter a valid URL."); }
  const local = /^(localhost|127\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.|\[?::1\]?$)/.test(u.hostname);
  if (u.protocol !== "https:" && !(process.env.ALLOW_INSECURE_WEBHOOKS === "true" && u.protocol === "http:")) throw new IntegrationError("VALIDATION", "Webhook addresses must use https.");
  if (local && process.env.ALLOW_INSECURE_WEBHOOKS !== "true") throw new IntegrationError("VALIDATION", "Webhook addresses must be public.");
  return u.toString();
}

export async function createWebhook(actor: ActorLike, organizationId: string, input: { url: string; events: string[] }) {
  need(actor);
  const url = checkUrl(input.url);
  const events = input.events.filter((e) => PUBLIC_EVENTS.includes(e));
  if (events.length === 0) throw new IntegrationError("VALIDATION", "Choose at least one event.");
  const secret = randomBytes(24).toString("base64url");
  const hook = await prisma.webhook.create({ data: { organizationId, url, events, secret, createdById: actor.id } });
  await recordAudit({ actorId: actor.id, action: "WEBHOOK_CREATED", entityType: "Webhook", entityId: hook.id, after: { url, events } });
  return { hook, secret };
}

export async function setWebhookActive(actor: ActorLike, id: string, active: boolean) {
  need(actor);
  await prisma.webhook.update({ where: { id }, data: { active, ...(active ? { failureCount: 0 } : {}) } });
  await recordAudit({ actorId: actor.id, action: active ? "WEBHOOK_ENABLED" : "WEBHOOK_DISABLED", entityType: "Webhook", entityId: id });
}

export const listWebhooks = (organizationId: string) => prisma.webhook.findMany({ where: { organizationId }, orderBy: { createdAt: "desc" }, include: { deliveries: { orderBy: { createdAt: "desc" }, take: 5 } } });

export const sign = (secret: string, body: string, timestamp: string) => `sha256=${createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex")}`;
export function verifySignature(secret: string, body: string, timestamp: string, signature: string) {
  const expected = Buffer.from(sign(secret, body, timestamp));
  const given = Buffer.from(signature);
  return expected.length === given.length && timingSafeEqual(expected, given);
}

const BACKOFF_MINUTES = [1, 5, 30, 120, 720];

/** Delivers due webhook events, signing each body; failures retry with growing delays and the webhook switches off after repeated failure. */
export async function deliverWebhooks(opts: { now?: Date; limit?: number; fetchImpl?: typeof fetch } = {}) {
  const now = opts.now ?? new Date();
  const doFetch = opts.fetchImpl ?? fetch;
  const due = await prisma.webhookDelivery.findMany({ where: { deliveredAt: null, nextAttemptAt: { lte: now }, webhook: { active: true } }, include: { webhook: true }, orderBy: { createdAt: "asc" }, take: opts.limit ?? 50 });
  let delivered = 0, failed = 0;
  for (const d of due) {
    const body = JSON.stringify(d.payload);
    const ts = String(Math.floor(now.getTime() / 1000));
    let status: number | null = null, error: string | null = null;
    try {
      const res = await doFetch(d.webhook.url, { method: "POST", headers: { "content-type": "application/json", "x-sam-event": d.event, "x-sam-delivery": d.id, "x-sam-timestamp": ts, "x-sam-signature": sign(d.webhook.secret, body, ts) }, body, signal: AbortSignal.timeout(8000), redirect: "manual" });
      status = res.status;
      if (res.status < 200 || res.status >= 300) error = `HTTP ${res.status}`;
    } catch (e) { error = e instanceof Error ? e.message : String(e); }
    const attempts = d.attempts + 1;
    if (!error) {
      await prisma.webhookDelivery.update({ where: { id: d.id }, data: { deliveredAt: now, status, attempts, error: null, nextAttemptAt: null } });
      await prisma.webhook.update({ where: { id: d.webhookId }, data: { lastDeliveryAt: now, lastStatus: status, failureCount: 0 } });
      delivered++;
    } else {
      failed++;
      const giveUp = attempts > BACKOFF_MINUTES.length;
      await prisma.webhookDelivery.update({ where: { id: d.id }, data: { status, error, attempts, nextAttemptAt: giveUp ? null : new Date(now.getTime() + BACKOFF_MINUTES[attempts - 1] * 60000) } });
      const hook = await prisma.webhook.update({ where: { id: d.webhookId }, data: { failureCount: { increment: 1 }, lastStatus: status } });
      if (hook.failureCount >= 20) await prisma.webhook.update({ where: { id: d.webhookId }, data: { active: false } });
    }
  }
  return { delivered, failed };
}

// ---------------------------------------------------------------------------
// System health
// ---------------------------------------------------------------------------

export async function systemHealth(organizationId: string, now: Date = new Date()) {
  const day = new Date(now.getTime() - 86400000), week = new Date(now.getTime() - 7 * 86400000);
  const [pending, failedNotes, oldestPending, failedRuns, lastRun, hooks, failingHooks, backlog, locked, pendingChanges, sweepSetting] = await Promise.all([
    prisma.notification.count({ where: { status: "QUEUED" } }),
    prisma.notification.count({ where: { status: "FAILED", updatedAt: { gte: day } } }),
    prisma.notification.findFirst({ where: { status: "QUEUED" }, orderBy: { createdAt: "asc" }, select: { createdAt: true } }),
    prisma.syncRun.count({ where: { status: "FAILED", startedAt: { gte: week } } }),
    prisma.syncRun.findFirst({ orderBy: { startedAt: "desc" } }),
    prisma.webhook.count({ where: { organizationId, active: true } }),
    prisma.webhook.count({ where: { organizationId, OR: [{ active: false }, { failureCount: { gt: 0 } }] } }),
    prisma.webhookDelivery.count({ where: { deliveredAt: null, nextAttemptAt: { not: null } } }),
    prisma.user.count({ where: { organizationId, lockedUntil: { gt: now } } }),
    prisma.changeRequest.count({ where: { organizationId, status: "PENDING" } }),
    prisma.orgSetting.findUnique({ where: { organizationId_key: { organizationId, key: "system.lastSweepAt" } } }),
  ]);
  const lastSweep = sweepSetting?.value ? new Date(String(sweepSetting.value)) : null;
  const checks = [
    { name: "Notification delivery", ok: failedNotes === 0 && (!oldestPending || now.getTime() - oldestPending.createdAt.getTime() < 3600000), detail: `${pending} waiting, ${failedNotes} failed in the last 24 hours${oldestPending ? `, oldest waiting since ${oldestPending.createdAt.toISOString().slice(11, 16)} UTC` : ""}` },
    { name: "Scheduled jobs", ok: !!lastSweep && now.getTime() - lastSweep.getTime() < 3 * 3600000, detail: lastSweep ? `Last ran ${lastSweep.toISOString().slice(0, 16).replace("T", " ")} UTC` : "Has not run yet: is the worker started?" },
    { name: "Integration syncs", ok: failedRuns === 0, detail: `${failedRuns} failed in the last 7 days${lastRun ? `; last run ${lastRun.status.toLowerCase()} at ${lastRun.startedAt.toISOString().slice(0, 16).replace("T", " ")}` : ""}` },
    { name: "Webhooks", ok: failingHooks === 0 && backlog < 100, detail: `${hooks} active, ${failingHooks} with failures, ${backlog} deliveries waiting` },
    { name: "Locked accounts", ok: locked === 0, detail: `${locked} locked` },
    { name: "Maker-checker queue", ok: pendingChanges < 5, detail: `${pendingChanges} change(s) waiting for a second Super Admin` },
  ];
  return { asOf: now, ok: checks.every((c) => c.ok), checks };
}

export async function markSweepRun(organizationId: string, now: Date = new Date()) {
  await prisma.orgSetting.upsert({ where: { organizationId_key: { organizationId, key: "system.lastSweepAt" } }, update: { value: now.toISOString() }, create: { organizationId, key: "system.lastSweepAt", value: now.toISOString() } });
}
