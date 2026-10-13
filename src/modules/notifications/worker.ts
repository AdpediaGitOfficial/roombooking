// Outbox delivery worker (COM-04, COM-06, COM-07). Claims queued emails,
// renders and sends them, and schedules retries with backoff. A failure
// never touches the business record the notification is about.
import { prisma } from "@/lib/db";
import { recordAudit } from "@/lib/audit";
import { renderEmail } from "./templates";
import { transportFromEnv, type MailTransport } from "./transport";

export const MAX_ATTEMPTS = Number(process.env.EMAIL_MAX_ATTEMPTS ?? 5);
/** Minutes to wait before the next attempt, by attempt number. */
export const BACKOFF_MINUTES = [1, 5, 30, 120, 720];
const CLAIM_TIMEOUT_MS = 5 * 60 * 1000;

export function backoffFor(attempt: number, now: Date): Date {
  const minutes = BACKOFF_MINUTES[Math.min(attempt - 1, BACKOFF_MINUTES.length - 1)];
  return new Date(now.getTime() + minutes * 60000);
}

export type WorkerResult = { claimed: number; sent: number; failed: number; permanentlyFailed: number; skipped: number };

/**
 * Processes up to `limit` queued emails whose next attempt is due. Rows are
 * claimed one at a time with a conditional update, so two workers running
 * concurrently never send the same notification.
 */
export async function processOutbox(opts: { limit?: number; now?: Date; transport?: MailTransport } = {}): Promise<WorkerResult> {
  const now = opts.now ?? new Date();
  const limit = opts.limit ?? 50;
  const transport = opts.transport ?? transportFromEnv();
  const result: WorkerResult = { claimed: 0, sent: 0, failed: 0, permanentlyFailed: 0, skipped: 0 };
  if (transport.name === "disabled") return result;

  const candidates = await prisma.notification.findMany({
    where: {
      channel: "EMAIL",
      status: "QUEUED",
      OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: now } }],
      AND: [{ OR: [{ lockedAt: null }, { lockedAt: { lt: new Date(now.getTime() - CLAIM_TIMEOUT_MS) } }] }],
    },
    orderBy: { createdAt: "asc" },
    take: limit,
    select: { id: true, lockedAt: true },
  });

  for (const candidate of candidates) {
    const claim = await prisma.notification.updateMany({ where: { id: candidate.id, status: "QUEUED", lockedAt: candidate.lockedAt }, data: { lockedAt: now } });
    if (claim.count !== 1) { result.skipped++; continue; }
    result.claimed++;
    const n = await prisma.notification.findUniqueOrThrow({ where: { id: candidate.id }, include: { recipient: { select: { id: true, name: true, email: true, status: true } } } });

    if (!n.recipient.email || n.recipient.status === "DEACTIVATED") {
      await prisma.notification.update({ where: { id: n.id }, data: { status: "FAILED", lockedAt: null, nextAttemptAt: null, lastError: !n.recipient.email ? "Recipient has no email address" : "Recipient account is deactivated", attempts: { increment: 1 } } });
      result.permanentlyFailed++;
      continue;
    }

    const rendered = renderEmail(n.event, n.payload, n.recipient.name);
    try {
      const { messageId } = await transport.send({ to: n.recipient.email, subject: rendered.subject, text: rendered.text, html: rendered.html });
      await prisma.notification.update({ where: { id: n.id }, data: { status: "SENT", sentAt: new Date(), lockedAt: null, nextAttemptAt: null, lastError: null, subject: rendered.subject, deliveredTo: n.recipient.email, providerMessageId: messageId, attempts: { increment: 1 } } });
      result.sent++;
    } catch (error) {
      const attempts = n.attempts + 1;
      const message = (error instanceof Error ? error.message : String(error)).slice(0, 500);
      const permanent = attempts >= MAX_ATTEMPTS;
      await prisma.notification.update({ where: { id: n.id }, data: { status: permanent ? "FAILED" : "QUEUED", lockedAt: null, attempts, lastError: message, subject: rendered.subject, nextAttemptAt: permanent ? null : backoffFor(attempts, now) } });
      if (permanent) {
        await recordAudit({ actorId: null, action: "NOTIFICATION_FAILED", entityType: "Notification", entityId: n.id, after: { event: n.event, recipientId: n.recipientId, attempts, error: message }, source: "worker" });
        result.permanentlyFailed++;
      } else {
        result.failed++;
      }
    }
  }
  return result;
}

/** Puts a failed notification back in the queue for an immediate attempt (admin action). */
export async function retryNotification(id: string, actorId: string) {
  const updated = await prisma.notification.updateMany({ where: { id, status: "FAILED" }, data: { status: "QUEUED", nextAttemptAt: null, lockedAt: null, lastError: null } });
  if (updated.count === 1) await recordAudit({ actorId, action: "NOTIFICATION_RETRIED", entityType: "Notification", entityId: id });
  return updated.count === 1;
}

export async function outboxStats() {
  const rows = await prisma.notification.groupBy({ by: ["channel", "status"], _count: { _all: true } });
  const stats: Record<string, Record<string, number>> = {};
  for (const r of rows) {
    stats[r.channel] ??= {};
    stats[r.channel][r.status] = r._count._all;
  }
  const due = await prisma.notification.count({ where: { channel: "EMAIL", status: "QUEUED", OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: new Date() } }] } });
  const oldestQueued = await prisma.notification.findFirst({ where: { channel: "EMAIL", status: "QUEUED" }, orderBy: { createdAt: "asc" }, select: { createdAt: true } });
  return { stats, due, oldestQueuedAt: oldestQueued?.createdAt ?? null };
}
