import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createHmac } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { enqueueNotification } from "@/lib/notifications";
import { KNOWN_EVENTS } from "@/modules/notifications/templates";
import { renderWhatsApp, requiredTemplates, WHATSAPP_EVENTS } from "@/modules/notifications/whatsapp-templates";
import { DisabledWhatsAppTransport, LogWhatsAppTransport, MetaCloudTransport, normalisePhone, parseStatusWebhook, toWaId, verifyWebhookSignature, WhatsAppError, whatsappTransportFromEnv, type OutgoingWhatsApp, type WhatsAppTransport } from "@/modules/notifications/whatsapp";
import { DisabledTransport } from "@/modules/notifications/transport";
import { applyStatusUpdates, outboxStats, processOutbox } from "@/modules/notifications/worker";

let orgId: string;
let consented: string;
let noConsent: string;
const stamp = Date.now().toString(36);
const noMail = new DisabledTransport();
const env = (o: Record<string, string>) => o as unknown as NodeJS.ProcessEnv;

class FailingWa implements WhatsAppTransport {
  name = "failing"; description = "fails"; calls = 0;
  constructor(private readonly permanent: boolean) {}
  async send(): Promise<{ messageId: string }> { this.calls++; throw new WhatsAppError(this.permanent ? "WhatsApp API 400 code 131026: Message undeliverable" : "WhatsApp API unreachable: timeout", this.permanent, this.permanent ? 131026 : undefined); }
}

async function queue(event: string, payload: Prisma.InputJsonObject, recipient = consented, key = `${event}:wa:${stamp}:${Math.random().toString(36).slice(2)}`) {
  await prisma.$transaction((tx) => enqueueNotification(tx, { recipientId: recipient, channel: "WHATSAPP", event, idempotencyKey: key, payload }));
  return prisma.notification.findUniqueOrThrow({ where: { idempotencyKey: key } });
}

beforeAll(async () => {
  const org = await prisma.organization.upsert({ where: { code: "TEST" }, update: {}, create: { code: "TEST", name: "Test Org" } });
  orgId = org.id;
  consented = (await prisma.user.upsert({ where: { email: "wa-yes@example.com" }, update: { status: "ACTIVE", whatsappNumber: "+971500000001", whatsappNotifications: true, whatsappConsentAt: new Date() }, create: { organizationId: orgId, email: "wa-yes@example.com", name: "Wa Yes", status: "ACTIVE", whatsappNumber: "+971500000001", whatsappNotifications: true, whatsappConsentAt: new Date() } })).id;
  noConsent = (await prisma.user.upsert({ where: { email: "wa-no@example.com" }, update: { status: "ACTIVE", whatsappNumber: "+971500000002", whatsappNotifications: true, whatsappConsentAt: null, emailNotifications: false }, create: { organizationId: orgId, email: "wa-no@example.com", name: "Wa No", status: "ACTIVE", whatsappNumber: "+971500000002", whatsappNotifications: true, emailNotifications: false } })).id;
  await prisma.notification.updateMany({ where: { channel: "WHATSAPP", status: "QUEUED" }, data: { status: "FAILED", lastError: "drained by test setup" } });
});

afterAll(async () => { await prisma.$disconnect(); });

describe("numbers", () => {
  it("normalises to E.164 and rejects numbers that cannot be international", () => {
    expect(normalisePhone("+971 50 123 4567")).toBe("+971501234567");
    expect(normalisePhone("00971501234567")).toBe("+971501234567");
    expect(normalisePhone("050 123 4567", "971")).toBe("+971501234567");
    expect(normalisePhone("501234567", "+971")).toBe("+971501234567");
    expect(normalisePhone("0501234567", "")).toBeNull();
    expect(normalisePhone("+12")).toBeNull();
    expect(normalisePhone("+0123456789")).toBeNull();
    expect(normalisePhone("")).toBeNull();
    expect(toWaId("+971501234567")).toBe("971501234567");
  });
});

describe("templates", () => {
  it("maps every email event to an approved template and keeps sensitive details out of the parameters", () => {
    const payload = { bed: "A-01-1", building: "Block A", room: "A-01", startDate: "2026-10-12", endDate: "2026-11-01", ticketNumber: "MR-2026-000001", workOrderId: "w1", requestId: "r1", type: "Room change request", code: "K-A-01", invitePath: "/invite/secret-token", path: "/invite/secret-token", facility: "Gym", date: "2026-10-14", startTime: "09:00", reference: "LF-000001", reason: "Private reason", comment: "Private comment", note: "Private note" };
    for (const event of KNOWN_EVENTS.filter((e) => !e.startsWith("user."))) {
      const m = renderWhatsApp(event, payload, "Sample Resident", "971500000001", env({ WHATSAPP_LANGUAGE: "en" }));
      expect(m.template).toMatch(/^sam_[a-z_]+$/);
      expect(m.language).toBe("en");
      expect(m.parameters[0]).toBe("Sample");
      expect(m.text).not.toContain("{{");
      expect(m.text).not.toContain("undefined");
      const joined = m.parameters.join(" ") + m.text;
      for (const secret of ["A-01-1", "K-A-01", "secret-token", "Private reason", "Private comment", "Private note"]) expect(joined).not.toContain(secret);
    }
    expect(WHATSAPP_EVENTS.length).toBeGreaterThan(20);
  });
  it("falls back to a generic template, honours overrides, prefix and language, and lists required templates", () => {
    const g = renderWhatsApp("something.new", {}, "X Y", "1", env({}));
    expect(g.template).toBe("sam_notification");
    expect(g.text).toContain("something new");
    const o = renderWhatsApp("allocation.confirmed", { startDate: "2026-10-12" }, "A B", "1", env({ WHATSAPP_TEMPLATE_MAP: '{"allocation.confirmed":"acme_alloc_v2"}', WHATSAPP_TEMPLATE_PREFIX: "acme_", WHATSAPP_LANGUAGE: "ar" }));
    expect(o.template).toBe("acme_alloc_v2");
    expect(o.language).toBe("ar");
    expect(renderWhatsApp("key.issued", {}, "A", "1", env({ WHATSAPP_TEMPLATE_PREFIX: "acme_" })).template).toBe("acme_key_update");
    const req = requiredTemplates(env({}));
    expect(req.map((r) => r.name)).toContain("sam_maintenance_update");
    expect(req.find((r) => r.name === "sam_maintenance_update")!.events.length).toBeGreaterThanOrEqual(7);
  });
});

describe("meta cloud transport", () => {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const fakeFetch = (status: number, body: unknown) => (async (url: string | URL | Request, init?: RequestInit) => { calls.push({ url: String(url), init: init ?? {} }); return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } }); }) as typeof fetch;
  const msg: OutgoingWhatsApp = { to: "971500000001", template: "sam_test_message", language: "en", parameters: ["Sample"], text: "Hello Sample" };

  it("posts a template message with bearer auth and returns the provider message id", async () => {
    const t = new MetaCloudTransport({ accessToken: "tok", phoneNumberId: "12345", fetchImpl: fakeFetch(200, { messages: [{ id: "wamid.ABC" }] }) });
    expect((await t.send(msg)).messageId).toBe("wamid.ABC");
    const call = calls.at(-1)!;
    expect(call.url).toBe("https://graph.facebook.com/v21.0/12345/messages");
    expect((call.init.headers as Record<string, string>).Authorization).toBe("Bearer tok");
    const body = JSON.parse(String(call.init.body));
    expect(body).toMatchObject({ messaging_product: "whatsapp", to: "971500000001", type: "template", template: { name: "sam_test_message", language: { code: "en" }, components: [{ type: "body", parameters: [{ type: "text", text: "Sample" }] }] } });
  });
  it("classifies provider errors as permanent or retryable", async () => {
    const bad = new MetaCloudTransport({ accessToken: "tok", phoneNumberId: "1", fetchImpl: fakeFetch(400, { error: { message: "Template name does not exist", code: 132001 } }) });
    const e1 = await bad.send(msg).catch((e) => e as WhatsAppError);
    expect(e1).toBeInstanceOf(WhatsAppError);
    expect((e1 as WhatsAppError).permanent).toBe(true);
    expect((e1 as WhatsAppError).message).toContain("132001");
    const limited = new MetaCloudTransport({ accessToken: "tok", phoneNumberId: "1", fetchImpl: fakeFetch(429, { error: { message: "Rate limit hit", code: 130429 } }) });
    expect(((await limited.send(msg).catch((e) => e)) as WhatsAppError).permanent).toBe(false);
    const down = new MetaCloudTransport({ accessToken: "tok", phoneNumberId: "1", fetchImpl: fakeFetch(503, { error: { message: "Service unavailable", code: 2 } }) });
    expect(((await down.send(msg).catch((e) => e)) as WhatsAppError).permanent).toBe(false);
    const offline = new MetaCloudTransport({ accessToken: "tok", phoneNumberId: "1", fetchImpl: (async () => { throw new Error("ECONNRESET"); }) as typeof fetch });
    expect(((await offline.send(msg).catch((e) => e)) as WhatsAppError).permanent).toBe(false);
  });
  it("picks the transport from the environment", () => {
    expect(whatsappTransportFromEnv(env({}))).toBeInstanceOf(DisabledWhatsAppTransport);
    expect(whatsappTransportFromEnv(env({ WHATSAPP_TRANSPORT: "log" }))).toBeInstanceOf(LogWhatsAppTransport);
    expect(whatsappTransportFromEnv(env({ WHATSAPP_ACCESS_TOKEN: "t", WHATSAPP_PHONE_NUMBER_ID: "p" }))).toBeInstanceOf(MetaCloudTransport);
    expect(() => whatsappTransportFromEnv(env({ WHATSAPP_TRANSPORT: "meta" }))).toThrow(/requires/);
  });
});

describe("fan-out and worker", () => {
  it("queues a WhatsApp copy of in-app notifications only with number, switch and consent", async () => {
    const key = `fan:wa:${stamp}`;
    await prisma.$transaction((tx) => enqueueNotification(tx, { recipientId: consented, event: "booking.confirmed", idempotencyKey: key, payload: { facility: "Gym", date: "2026-10-14", startTime: "09:00", endTime: "10:00" } }));
    await prisma.$transaction((tx) => enqueueNotification(tx, { recipientId: noConsent, event: "booking.confirmed", idempotencyKey: `${key}:nc`, payload: { facility: "Gym" } }));
    expect(await prisma.notification.findUnique({ where: { idempotencyKey: `${key}:whatsapp` } })).toMatchObject({ channel: "WHATSAPP", status: "QUEUED" });
    expect(await prisma.notification.findUnique({ where: { idempotencyKey: `${key}:nc:whatsapp` } })).toBeNull();
    // Re-running the business action is a no-op for the copy too (COM-07).
    await prisma.$transaction((tx) => enqueueNotification(tx, { recipientId: consented, event: "booking.confirmed", idempotencyKey: key, payload: { facility: "Gym" } }));
    expect(await prisma.notification.count({ where: { idempotencyKey: { in: [key, `${key}:email`, `${key}:whatsapp`] } } })).toBe(3);
  });

  it("sends due WhatsApp messages, records text, number and provider id, and leaves email alone", async () => {
    const wa = new LogWhatsAppTransport();
    const n = await queue("allocation.confirmed", { bed: "A-01-1", building: "Block A", room: "A-01", startDate: "2026-10-12" });
    const r = await processOutbox({ whatsapp: wa, transport: noMail, channels: ["WHATSAPP"] });
    expect(r.sent).toBeGreaterThanOrEqual(1);
    const sent = await prisma.notification.findUniqueOrThrow({ where: { id: n.id } });
    expect(sent.status).toBe("SENT");
    expect(sent.deliveredTo).toBe("+971500000001");
    expect(sent.providerMessageId).toMatch(/^wamid\./);
    expect(sent.subject).toContain("2026-10-12");
    expect(sent.subject).not.toContain("A-01");
    expect(wa.sent.at(-1)?.to).toBe("971500000001");
  });

  it("fails permanently without consent or on a permanent provider error, retries transient ones, and skips when disabled", async () => {
    const nc = await queue("test.whatsapp", {}, noConsent);
    await processOutbox({ whatsapp: new LogWhatsAppTransport(), transport: noMail, channels: ["WHATSAPP"] });
    expect((await prisma.notification.findUniqueOrThrow({ where: { id: nc.id } })).lastError).toContain("consent");
    const perm = await queue("test.whatsapp", {});
    const pf = new FailingWa(true);
    await processOutbox({ whatsapp: pf, transport: noMail, channels: ["WHATSAPP"] });
    const p = await prisma.notification.findUniqueOrThrow({ where: { id: perm.id } });
    expect(p.status).toBe("FAILED");
    expect(p.attempts).toBe(1);
    expect(p.lastError).toContain("131026");
    expect(await prisma.auditEvent.findFirst({ where: { entityType: "Notification", entityId: perm.id, action: "NOTIFICATION_FAILED" } })).not.toBeNull();
    const trans = await queue("test.whatsapp", {});
    const tf = new FailingWa(false);
    const now = new Date();
    await processOutbox({ whatsapp: tf, transport: noMail, channels: ["WHATSAPP"], now });
    const t = await prisma.notification.findUniqueOrThrow({ where: { id: trans.id } });
    expect(t.status).toBe("QUEUED");
    expect(t.nextAttemptAt!.getTime()).toBe(now.getTime() + 60000);
    const off = await processOutbox({ whatsapp: new DisabledWhatsAppTransport(), transport: noMail, channels: ["WHATSAPP"], now: new Date(now.getTime() + 120000) });
    expect(off.claimed).toBe(0);
    const stats = await outboxStats(new Date(now.getTime() + 120000));
    expect(stats.dueWhatsApp).toBeGreaterThanOrEqual(1);
    await prisma.notification.update({ where: { id: trans.id }, data: { status: "FAILED", lastError: "cleaned up by test" } });
  });

  it("verifies webhook signatures and applies delivered and failed receipts", async () => {
    const n = await queue("test.whatsapp", {});
    await processOutbox({ whatsapp: new LogWhatsAppTransport(), transport: noMail, channels: ["WHATSAPP"] });
    const { providerMessageId } = await prisma.notification.findUniqueOrThrow({ where: { id: n.id } });
    const other = await queue("test.whatsapp", {});
    await processOutbox({ whatsapp: new LogWhatsAppTransport(), transport: noMail, channels: ["WHATSAPP"] });
    const otherId = (await prisma.notification.findUniqueOrThrow({ where: { id: other.id } })).providerMessageId!;
    const body = { object: "whatsapp_business_account", entry: [{ id: "1", changes: [{ field: "messages", value: { messaging_product: "whatsapp", statuses: [
      { id: providerMessageId, status: "delivered", timestamp: "1760349600", recipient_id: "971500000001" },
      { id: otherId, status: "failed", timestamp: "1760349601", errors: [{ code: 131026, title: "Message undeliverable", message: "Message undeliverable", error_data: { details: "Recipient is not a WhatsApp user" } }] },
      { id: "wamid.unknown", status: "read", timestamp: "1760349602" },
    ] } }, { field: "messages", value: { messages: [{ from: "971500000001", type: "text", text: { body: "hi" } }] } }] }] };
    const raw = JSON.stringify(body);
    const sig = `sha256=${createHmac("sha256", "app-secret").update(raw).digest("hex")}`;
    expect(verifyWebhookSignature(raw, sig, "app-secret")).toBe(true);
    expect(verifyWebhookSignature(raw, sig, "wrong")).toBe(false);
    expect(verifyWebhookSignature(raw, null, "app-secret")).toBe(false);
    expect(verifyWebhookSignature(raw, "sha256=00", "app-secret")).toBe(false);
    const updates = parseStatusWebhook(body);
    expect(updates).toHaveLength(3);
    expect(updates[1].error).toContain("131026");
    const applied = await applyStatusUpdates(updates);
    expect(applied).toEqual({ matched: 2, delivered: 1, failed: 1 });
    const d = await prisma.notification.findUniqueOrThrow({ where: { id: n.id } });
    expect(d.status).toBe("DELIVERED");
    expect(d.deliveredAt?.toISOString()).toBe("2025-10-13T10:00:00.000Z");
    const f = await prisma.notification.findUniqueOrThrow({ where: { id: other.id } });
    expect(f.status).toBe("FAILED");
    expect(f.lastError).toContain("not a WhatsApp user");
    expect(parseStatusWebhook({ nonsense: true })).toEqual([]);
  });
});
