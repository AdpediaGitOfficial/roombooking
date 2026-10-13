// Outbox delivery worker (COM-04, COM-06, COM-07). Claims queued emails and
// WhatsApp messages, renders and sends them, and schedules retries with
// backoff. A failure never touches the business record the notification is
// about.
import type { NotificationChannel } from "@prisma/client";
import { prisma } from "../../lib/db";
import { recordAudit } from "../../lib/audit";
import { renderEmail } from "./templates";
import { transportFromEnv, type MailTransport } from "./transport";
import { renderWhatsApp } from "./whatsapp-templates";
import { toWaId, WhatsAppError, whatsappTransportFromEnv, type StatusUpdate, type WhatsAppTransport } from "./whatsapp";

export const MAX_ATTEMPTS = Number(process.env.EMAIL_MAX_ATTEMPTS ?? 5);
/** Minutes to wait before the next attempt, by attempt number. */
export const BACKOFF_MINUTES = [1, 5, 30, 120, 720];
const CLAIM_TIMEOUT_MS = 5 * 60 * 1000;
const DELIVERY_CHANNELS: NotificationChannel[] = ["EMAIL", "WHATSAPP"];

export function backoffFor(attempt: number, now: Date): Date {
  const minutes = BACKOFF_MINUTES[Math.min(attempt - 1, BACKOFF_MINUTES.length - 1)];
  return new Date(now.getTime() + minutes * 60000);
}

export type WorkerResult = { claimed: number; sent: number; failed: number; permanentlyFailed: number; skipped: number };
type Prepared = { subject: string; to: string } & ({ kind: "email"; send: () => Promise<{ messageId: string }> } | { kind: "whatsapp"; send: () => Promise<{ messageId: string }> });

/**
 * Processes up to `limit` queued messages per channel whose next attempt is
 * due. Rows are claimed one at a time with a conditional update, so two
 * workers running concurrently never send the same notification.
 */
export async function processOutbox(opts: { limit?: number; now?: Date; transport?: MailTransport; whatsapp?: WhatsAppTransport; channels?: NotificationChannel[] } = {}): Promise<WorkerResult> {
  const now = opts.now ?? new Date();
  const limit = opts.limit ?? 50;
  const result: WorkerResult = { claimed: 0, sent: 0, failed: 0, permanentlyFailed: 0, skipped: 0 };
  const channels = opts.channels ?? DELIVERY_CHANNELS;
  const mail = channels.includes("EMAIL") ? (opts.transport ?? transportFromEnv()) : null;
  const wa = channels.includes("WHATSAPP") ? (opts.whatsapp ?? whatsappTransportFromEnv()) : null;

  for (const channel of channels) {
    if (channel === "EMAIL" && (!mail || mail.name === "disabled")) continue;
    if (channel === "WHATSAPP" && (!wa || wa.name === "disabled")) continue;
    if (channel === "IN_APP") continue;
    const candidates = await prisma.notification.findMany({
      where: { channel, status: "QUEUED", OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: now } }], AND: [{ OR: [{ lockedAt: null }, { lockedAt: { lt: new Date(now.getTime() - CLAIM_TIMEOUT_MS) } }] }] },
      orderBy: { createdAt: "asc" },
      take: limit,
      select: { id: true, lockedAt: true },
    });

    for (const candidate of candidates) {
      const claim = await prisma.notification.updateMany({ where: { id: candidate.id, status: "QUEUED", lockedAt: candidate.lockedAt }, data: { lockedAt: now } });
      if (claim.count !== 1) { result.skipped++; continue; }
      result.claimed++;
      const n = await prisma.notification.findUniqueOrThrow({ where: { id: candidate.id }, include: { recipient: { select: { id: true, name: true, email: true, status: true, whatsappNumber: true, whatsappNotifications: true, whatsappConsentAt: true } } } });

      // Recipient checks that no retry can fix.
      let blocked: string | null = null;
      if (n.recipient.status === "DEACTIVATED") blocked = "Recipient account is deactivated";
      else if (channel === "EMAIL" && !n.recipient.email) blocked = "Recipient has no email address";
      else if (channel === "WHATSAPP" && !n.recipient.whatsappNumber) blocked = "Recipient has no WhatsApp number";
      else if (channel === "WHATSAPP" && (!n.recipient.whatsappNotifications || !n.recipient.whatsappConsentAt)) blocked = "Recipient has not consented to WhatsApp messages";
      if (blocked) {
        await prisma.notification.update({ where: { id: n.id }, data: { status: "FAILED", lockedAt: null, nextAttemptAt: null, lastError: blocked, attempts: { increment: 1 } } });
        result.permanentlyFailed++;
        continue;
      }

      let prepared: Prepared;
      if (channel === "EMAIL") {
        const rendered = renderEmail(n.event, n.payload, n.recipient.name);
        prepared = { kind: "email", subject: rendered.subject, to: n.recipient.email!, send: () => mail!.send({ to: n.recipient.email!, subject: rendered.subject, text: rendered.text, html: rendered.html }) };
      } else {
        const message = renderWhatsApp(n.event, n.payload, n.recipient.name, toWaId(n.recipient.whatsappNumber!));
        prepared = { kind: "whatsapp", subject: message.text, to: n.recipient.whatsappNumber!, send: () => wa!.send(message) };
      }

      try {
        const { messageId } = await prepared.send();
        await prisma.notification.update({ where: { id: n.id }, data: { status: "SENT", sentAt: new Date(), lockedAt: null, nextAttemptAt: null, lastError: null, subject: prepared.subject, deliveredTo: prepared.to, providerMessageId: messageId, attempts: { increment: 1 } } });
        result.sent++;
      } catch (error) {
        const attempts = n.attempts + 1;
        const message = (error instanceof Error ? error.message : String(error)).slice(0, 500);
        const permanent = attempts >= MAX_ATTEMPTS || (error instanceof WhatsAppError && error.permanent);
        await prisma.notification.update({ where: { id: n.id }, data: { status: permanent ? "FAILED" : "QUEUED", lockedAt: null, attempts, lastError: message, subject: prepared.subject, nextAttemptAt: permanent ? null : backoffFor(attempts, now) } });
        if (permanent) {
          await recordAudit({ actorId: null, action: "NOTIFICATION_FAILED", entityType: "Notification", entityId: n.id, after: { channel, event: n.event, recipientId: n.recipientId, attempts, error: message }, source: "worker" });
          result.permanentlyFailed++;
        } else {
          result.failed++;
        }
      }
    }
  }
  return result;
}

/** Applies provider delivery receipts (COM-04): delivered/read mark the row delivered, failed marks it failed with the provider's reason. */
export async function applyStatusUpdates(updates: StatusUpdate[]): Promise<{ matched: number; delivered: number; failed: number }> {
  const out = { matched: 0, delivered: 0, failed: 0 };
  for (const u of updates) {
    const n = await prisma.notification.findFirst({ where: { providerMessageId: u.messageId, channel: "WHATSAPP" } });
    if (!n) continue;
    out.matched++;
    if (u.status === "delivered" || u.status === "read") {
      if (n.status !== "DELIVERED") { await prisma.notification.update({ where: { id: n.id }, data: { status: "DELIVERED", deliveredAt: u.timestamp, lastError: null } }); out.delivered++; }
    } else if (u.status === "failed") {
      await prisma.notification.update({ where: { id: n.id }, data: { status: "FAILED", lastError: `Provider: ${u.error ?? "delivery failed"}`, nextAttemptAt: null } });
      await recordAudit({ actorId: null, action: "NOTIFICATION_FAILED", entityType: "Notification", entityId: n.id, after: { channel: "WHATSAPP", event: n.event, recipientId: n.recipientId, error: u.error ?? "delivery failed", providerMessageId: u.messageId }, source: "webhook" });
      out.failed++;
    }
  }
  return out;
}

/** Puts a failed notification back in the queue for an immediate attempt (admin action). */
export async function retryNotification(id: string, actorId: string) {
  const updated = await prisma.notification.updateMany({ where: { id, status: "FAILED" }, data: { status: "QUEUED", nextAttemptAt: null, lockedAt: null, lastError: null } });
  if (updated.count === 1) await recordAudit({ actorId, action: "NOTIFICATION_RETRIED", entityType: "Notification", entityId: id });
  return updated.count === 1;
}

export async function outboxStats(now: Date = new Date()) {
  const rows = await prisma.notification.groupBy({ by: ["channel", "status"], _count: { _all: true } });
  const stats: Record<string, Record<string, number>> = {};
  for (const r of rows) {
    stats[r.channel] ??= {};
    stats[r.channel][r.status] = r._count._all;
  }
  const dueWhere = (channel: NotificationChannel) => ({ channel, status: "QUEUED" as const, OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: now } }] });
  const [due, dueWhatsApp, oldestQueued, oldestWhatsApp] = await Promise.all([
    prisma.notification.count({ where: dueWhere("EMAIL") }),
    prisma.notification.count({ where: dueWhere("WHATSAPP") }),
    prisma.notification.findFirst({ where: { channel: "EMAIL", status: "QUEUED" }, orderBy: { createdAt: "asc" }, select: { createdAt: true } }),
    prisma.notification.findFirst({ where: { channel: "WHATSAPP", status: "QUEUED" }, orderBy: { createdAt: "asc" }, select: { createdAt: true } }),
  ]);
  return { stats, due, dueWhatsApp, oldestQueuedAt: oldestQueued?.createdAt ?? null, oldestWhatsAppQueuedAt: oldestWhatsApp?.createdAt ?? null };
}
