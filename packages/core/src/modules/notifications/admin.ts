// Operations view of the notification outbox: queues, failures, transport health and test sends.
import type { NotificationChannel, NotificationStatus } from "@prisma/client";
import { prisma } from "../../lib/db";
import { recordAudit } from "../../lib/audit";
import { enqueueNotification } from "../../lib/notifications";
import { transportFromEnv } from "./transport";
import { whatsappTransportFromEnv } from "./whatsapp";
import { requiredTemplates } from "./whatsapp-templates";
import { outboxStats, processOutbox, retryNotification } from "./worker";

const describe = (f: () => { name: string; description: string }) => {
  try {
    const t = f();
    return { name: t.name, description: t.description };
  } catch (e) {
    return { name: "error", description: e instanceof Error ? e.message : String(e) };
  }
};

/** Queue statistics, the latest messages on a channel, transport settings and (WhatsApp) the templates to approve. */
export async function notificationsView(channel: NotificationChannel, status: NotificationStatus | null) {
  const [stats, recent, unread, consented] = await Promise.all([
    outboxStats(),
    prisma.notification.findMany({ where: { channel, ...(status ? { status } : {}) }, include: { recipient: { select: { name: true, email: true } } }, orderBy: { createdAt: "desc" }, take: 100 }),
    prisma.notification.count({ where: { channel: "IN_APP", readAt: null } }),
    prisma.user.count({ where: { whatsappNotifications: true, whatsappConsentAt: { not: null }, whatsappNumber: { not: null } } }),
  ]);
  return {
    ...stats,
    recent,
    unread,
    consented,
    transport: describe(() => transportFromEnv()),
    whatsappTransport: describe(() => whatsappTransportFromEnv()),
    templates: channel === "WHATSAPP" ? requiredTemplates() : [],
    whatsappLanguage: process.env.WHATSAPP_LANGUAGE ?? "en",
  };
}

/** Delivers whatever is due now and records who asked for it. */
export async function runOutbox(actorId: string) {
  const result = await processOutbox({ limit: 50 });
  await recordAudit({ actorId, action: "NOTIFICATION_WORKER_RUN", entityType: "Notification", entityId: "outbox", after: result });
  return result;
}

export async function retryFailed(id: string, actorId: string) {
  return retryNotification(id, actorId);
}

/** Queues a test message to the administrator themselves, delivers it, and reports what happened. */
export async function sendTest(channel: "EMAIL" | "WHATSAPP", actor: { id: string; email: string }): Promise<{ ok: boolean; message: string }> {
  if (channel === "WHATSAPP") {
    const me = await prisma.user.findUniqueOrThrow({ where: { id: actor.id }, select: { whatsappNumber: true, whatsappNotifications: true, whatsappConsentAt: true } });
    if (!me.whatsappNumber || !me.whatsappNotifications || !me.whatsappConsentAt) return { ok: false, message: "Add your WhatsApp number and consent in your profile first (My profile → Notifications)." };
  }
  const event = channel === "EMAIL" ? "test.email" : "test.whatsapp";
  const key = `${event}:${actor.id}:${Date.now()}`;
  await prisma.$transaction((tx) => enqueueNotification(tx, { recipientId: actor.id, channel, event, idempotencyKey: key, payload: { sentBy: actor.email } }));
  const result = await processOutbox({ limit: 5, ...(channel === "WHATSAPP" ? { channels: ["WHATSAPP"] } : {}) });
  const row = await prisma.notification.findUnique({ where: { idempotencyKey: key } });
  if (row?.status === "SENT") {
    return { ok: true, message: channel === "EMAIL" ? `Test email sent to ${row.deliveredTo} (message id ${row.providerMessageId}).` : `Test message sent to ${row.deliveredTo} (provider id ${row.providerMessageId}).` };
  }
  return { ok: false, message: `${channel === "EMAIL" ? "Test email" : "Test message"} not sent: ${row?.lastError ?? "transport disabled or queue busy"} (${result.claimed} processed).` };
}
