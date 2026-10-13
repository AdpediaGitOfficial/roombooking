import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { SMTPServer } from "smtp-server";
import type { Prisma } from "@prisma/client";
import { prisma } from "../src/lib/db";
import { enqueueNotification } from "../src/lib/notifications";
import { renderEmail, KNOWN_EVENTS } from "../src/modules/notifications/templates";
import { LogTransport, SmtpTransport, transportFromEnv, type MailTransport, type OutgoingMail } from "../src/modules/notifications/transport";
import { backoffFor, MAX_ATTEMPTS, outboxStats, processOutbox, retryNotification } from "../src/modules/notifications/worker";

let orgId: string;
let userId: string;
let noEmailUserId: string;
const stamp = Date.now().toString(36);

class FailingTransport implements MailTransport {
  name = "failing"; description = "always fails"; calls = 0;
  async send(): Promise<{ messageId: string }> { this.calls++; throw new Error("SMTP 451 try again later"); }
}
class SlowTransport implements MailTransport {
  name = "slow"; description = "slow"; sent: OutgoingMail[] = [];
  async send(mail: OutgoingMail) { await new Promise((r) => setTimeout(r, 50)); this.sent.push(mail); return { messageId: `slow-${this.sent.length}` }; }
}

async function queue(event: string, payload: Prisma.InputJsonObject, recipient = userId, key = `${event}:${stamp}:${Math.random().toString(36).slice(2)}`) {
  await prisma.$transaction((tx) => enqueueNotification(tx, { recipientId: recipient, channel: "EMAIL", event, idempotencyKey: key, payload }));
  return prisma.notification.findUniqueOrThrow({ where: { idempotencyKey: key } });
}

beforeAll(async () => {
  process.env.APP_BASE_URL = "https://accommodation.example.com";
  const org = await prisma.organization.upsert({ where: { code: "TEST" }, update: {}, create: { code: "TEST", name: "Test Org" } });
  orgId = org.id;
  userId = (await prisma.user.upsert({ where: { email: "mail-test@example.com" }, update: { status: "ACTIVE", emailNotifications: true }, create: { organizationId: orgId, email: "mail-test@example.com", name: "Mail Tester", status: "ACTIVE" } })).id;
  noEmailUserId = (await prisma.user.upsert({ where: { email: "mail-off@example.com" }, update: { status: "ACTIVE", emailNotifications: false }, create: { organizationId: orgId, email: "mail-off@example.com", name: "Mail Off", status: "ACTIVE", emailNotifications: false } })).id;
  // Drain anything other tests queued so counts here are deterministic.
  await prisma.notification.updateMany({ where: { channel: "EMAIL", status: "QUEUED" }, data: { status: "FAILED", lastError: "drained by test setup" } });
});

afterAll(async () => { await prisma.$disconnect(); });

describe("templates", () => {
  it("renders every known event with a subject, greeting, link and no undefined", () => {
    for (const event of KNOWN_EVENTS) {
      const r = renderEmail(event, { bed: "A-01-1", building: "Block A", room: "A-01", startDate: "2026-10-12", ticketNumber: "MR-2026-000001", workOrderId: "w1", requestId: "r1", type: "Room change request", code: "K-1", invitePath: "/invite/tok", path: "/invite/tok2", priority: "HIGH" }, "Sample Resident");
      expect(r.subject.length).toBeGreaterThan(3);
      expect(r.text).toContain("Hello Sample");
      expect(r.text).toContain("https://accommodation.example.com/");
      expect(r.text).not.toContain("undefined");
      expect(r.html).toContain("<a href=\"https://accommodation.example.com/");
    }
  });
  it("escapes HTML in payload values and falls back for unknown events", () => {
    const r = renderEmail("request.rejected", { type: "Visitor stay", comment: "<script>alert(1)</script>", requestId: "r9" }, "A B");
    expect(r.html).not.toContain("<script>");
    expect(r.html).toContain("&lt;script&gt;");
    expect(r.text).toContain("<script>");
    const u = renderEmail("something.new", {}, "X");
    expect(u.subject).toBe("something new");
    expect(u.text).toContain("/my");
  });
});

describe("worker", () => {
  it("sends due emails, records subject, recipient and message id, and leaves the business row untouched", async () => {
    const n = await queue("allocation.confirmed", { bed: "A-01-1", building: "Block A", room: "A-01", startDate: "2026-10-12", allocationId: "x" });
    const transport = new LogTransport();
    const r = await processOutbox({ transport });
    expect(r.sent).toBe(1);
    const sent = await prisma.notification.findUniqueOrThrow({ where: { id: n.id } });
    expect(sent.status).toBe("SENT");
    expect(sent.subject).toContain("A-01-1");
    expect(sent.deliveredTo).toBe("mail-test@example.com");
    expect(sent.providerMessageId).toMatch(/^log-/);
    expect(sent.attempts).toBe(1);
    expect(transport.sent[0].to).toBe("mail-test@example.com");
  });

  it("retries with backoff and fails permanently after the maximum attempts, with an audit event", async () => {
    const n = await queue("key.issued", { code: "K-9" });
    const transport = new FailingTransport();
    const base = new Date("2026-10-13T10:00:00Z");
    let row = n;
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      const now = row.nextAttemptAt ?? base;
      const r = await processOutbox({ transport, now });
      row = await prisma.notification.findUniqueOrThrow({ where: { id: n.id } });
      expect(row.attempts).toBe(attempt);
      expect(row.lastError).toContain("451");
      if (attempt < MAX_ATTEMPTS) {
        expect(r.failed).toBe(1);
        expect(row.status).toBe("QUEUED");
        expect(row.nextAttemptAt?.getTime()).toBe(backoffFor(attempt, now).getTime());
        // Not due yet: a run a second later does nothing.
        expect((await processOutbox({ transport, now: new Date(now.getTime() + 1000) })).claimed).toBe(0);
      } else {
        expect(r.permanentlyFailed).toBe(1);
        expect(row.status).toBe("FAILED");
        expect(row.nextAttemptAt).toBeNull();
      }
    }
    expect(transport.calls).toBe(MAX_ATTEMPTS);
    expect(await prisma.auditEvent.findFirst({ where: { entityType: "Notification", entityId: n.id, action: "NOTIFICATION_FAILED" } })).not.toBeNull();
    // Manual retry re-queues it and the next run sends it.
    expect(await retryNotification(n.id, userId)).toBe(true);
    const ok = await processOutbox({ transport: new LogTransport() });
    expect(ok.sent).toBe(1);
    expect((await prisma.notification.findUniqueOrThrow({ where: { id: n.id } })).status).toBe("SENT");
  });

  it("two concurrent workers never send the same email twice", async () => {
    const ids = await Promise.all([1, 2, 3, 4].map((i) => queue("maintenance.received", { ticketNumber: `MR-${i}`, workOrderId: `w${i}` })));
    const t1 = new SlowTransport();
    const t2 = new SlowTransport();
    const [r1, r2] = await Promise.all([processOutbox({ transport: t1 }), processOutbox({ transport: t2 })]);
    expect(r1.sent + r2.sent).toBe(4);
    expect(t1.sent.length + t2.sent.length).toBe(4);
    const rows = await prisma.notification.findMany({ where: { id: { in: ids.map((n) => n.id) } } });
    expect(rows.every((n) => n.status === "SENT" && n.attempts === 1)).toBe(true);
  });

  it("fails permanently without a recipient address and skips everything when the transport is disabled", async () => {
    const ghost = await prisma.user.create({ data: { organizationId: orgId, email: `ghost-${stamp}@example.com`, name: "Ghost", status: "DEACTIVATED" } });
    const n = await queue("key.returned", { code: "K-2" }, ghost.id);
    const r = await processOutbox({ transport: new LogTransport() });
    expect(r.permanentlyFailed).toBe(1);
    expect((await prisma.notification.findUniqueOrThrow({ where: { id: n.id } })).lastError).toContain("deactivated");
    await queue("key.returned", { code: "K-3" });
    process.env.EMAIL_TRANSPORT = "disabled";
    const disabled = await processOutbox({ transport: transportFromEnv() });
    delete process.env.EMAIL_TRANSPORT;
    expect(disabled.claimed).toBe(0);
    expect((await outboxStats()).due).toBeGreaterThanOrEqual(1);
    await processOutbox({ transport: new LogTransport() });
  });
});

describe("fan-out", () => {
  it("queues an email copy of in-app notifications only for users who allow it", async () => {
    const key = `fan:${stamp}`;
    await prisma.$transaction(async (tx) => {
      await enqueueNotification(tx, { recipientId: userId, event: "allocation.confirmed", idempotencyKey: key, payload: { bed: "B-1" } });
      await enqueueNotification(tx, { recipientId: noEmailUserId, event: "allocation.confirmed", idempotencyKey: `${key}:off`, payload: { bed: "B-2" } });
    });
    const on = await prisma.notification.findMany({ where: { idempotencyKey: { in: [key, `${key}:email`] } } });
    expect(on.map((n) => n.channel).sort()).toEqual(["EMAIL", "IN_APP"]);
    const off = await prisma.notification.findMany({ where: { idempotencyKey: { in: [`${key}:off`, `${key}:off:email`] } } });
    expect(off.map((n) => n.channel)).toEqual(["IN_APP"]);
    // Re-queueing the same key is a no-op (COM-07).
    await prisma.$transaction((tx) => enqueueNotification(tx, { recipientId: userId, event: "allocation.confirmed", idempotencyKey: key, payload: { bed: "B-1" } }));
    expect(await prisma.notification.count({ where: { idempotencyKey: { startsWith: key } } })).toBe(3);
    await processOutbox({ transport: new LogTransport() });
  });
});

describe("smtp transport", () => {
  it("delivers over a real SMTP connection with from, to, subject and both bodies", async () => {
    const received: Array<{ from: string; to: string[]; raw: string }> = [];
    const server = new SMTPServer({
      authOptional: true,
      disabledCommands: ["STARTTLS"],
      onData(stream, session, callback) {
        let raw = "";
        stream.on("data", (c) => { raw += c.toString(); });
        stream.on("end", () => { received.push({ from: session.envelope.mailFrom ? session.envelope.mailFrom.address : "", to: session.envelope.rcptTo.map((r) => r.address), raw }); callback(); });
      },
    });
    const port = await new Promise<number>((resolve) => server.listen(0, "127.0.0.1", () => resolve((server.server.address() as { port: number }).port)));
    try {
      const transport = new SmtpTransport({ host: "127.0.0.1", port, secure: false, from: "Staff Accommodation <no-reply@example.com>" });
      const n = await queue("user.invited", { invitePath: "/invite/abc123" });
      const r = await processOutbox({ transport });
      expect(r.sent).toBe(1);
      expect(received).toHaveLength(1);
      expect(received[0].from).toBe("no-reply@example.com");
      expect(received[0].to).toEqual(["mail-test@example.com"]);
      expect(received[0].raw).toContain("Subject: Your staff accommodation account");
      expect(received[0].raw).toContain("https://accommodation.example.com/invite/abc123");
      expect(received[0].raw).toContain("text/html");
      const row = await prisma.notification.findUniqueOrThrow({ where: { id: n.id } });
      expect(row.status).toBe("SENT");
      expect(row.providerMessageId).toContain("@");
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});
