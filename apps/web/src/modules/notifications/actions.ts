"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@sam/core/lib/db";
import { requireRole, requireUser } from "@/lib/auth/authorize";
import { recordAudit } from "@sam/core/lib/audit";
import { enqueueNotification } from "@sam/core/lib/notifications";
import { USER_ADMIN_ROLES } from "@sam/core/modules/admin/access";
import { normalisePhone } from "@sam/core/modules/notifications/whatsapp";
import { processOutbox, retryNotification } from "@sam/core/modules/notifications/worker";

export type ActionState = { error?: string; message?: string; values?: Record<string, string> };

export async function runWorkerAction(): Promise<ActionState> {
  const actor = await requireRole(USER_ADMIN_ROLES, "/admin/notifications");
  const result = await processOutbox({ limit: 50 });
  await recordAudit({ actorId: actor.id, action: "NOTIFICATION_WORKER_RUN", entityType: "Notification", entityId: "outbox", after: result });
  revalidatePath("/admin/notifications");
  return { message: `Processed ${result.claimed}: ${result.sent} sent, ${result.failed} to retry, ${result.permanentlyFailed} failed permanently.` };
}

export async function retryAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const actor = await requireRole(USER_ADMIN_ROLES, "/admin/notifications");
  const id = String(formData.get("id") ?? "");
  const ok = await retryNotification(id, actor.id);
  revalidatePath("/admin/notifications");
  return ok ? { message: "Queued for another attempt." } : { error: "Only failed notifications can be retried." };
}

export async function sendTestEmailAction(): Promise<ActionState> {
  const actor = await requireRole(USER_ADMIN_ROLES, "/admin/notifications");
  const key = `test.email:${actor.id}:${Date.now()}`;
  await prisma.$transaction((tx) => enqueueNotification(tx, { recipientId: actor.id, channel: "EMAIL", event: "test.email", idempotencyKey: key, payload: { sentBy: actor.email } }));
  const result = await processOutbox({ limit: 5 });
  revalidatePath("/admin/notifications");
  const row = await prisma.notification.findUnique({ where: { idempotencyKey: key } });
  if (row?.status === "SENT") return { message: `Test email sent to ${row.deliveredTo} (message id ${row.providerMessageId}).` };
  return { error: `Test email not sent: ${row?.lastError ?? "transport disabled or queue busy"} (${result.claimed} processed).` };
}

export async function setEmailPreferenceAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requireUser("/my/profile");
  const enabled = String(formData.get("emailNotifications") ?? "") === "on";
  await prisma.user.update({ where: { id: user.id }, data: { emailNotifications: enabled } });
  await recordAudit({ actorId: user.id, action: "EMAIL_PREFERENCE_CHANGED", entityType: "User", entityId: user.id, after: { emailNotifications: enabled } });
  revalidatePath("/my/profile");
  return { message: enabled ? "You will receive email copies of notifications." : "Email copies switched off. You will still see notifications in the app." };
}

export async function sendTestWhatsAppAction(): Promise<ActionState> {
  const actor = await requireRole(USER_ADMIN_ROLES, "/admin/notifications");
  const me = await prisma.user.findUniqueOrThrow({ where: { id: actor.id }, select: { whatsappNumber: true, whatsappNotifications: true, whatsappConsentAt: true } });
  if (!me.whatsappNumber || !me.whatsappNotifications || !me.whatsappConsentAt) return { error: "Add your WhatsApp number and consent in your profile first (My profile → Notifications)." };
  const key = `test.whatsapp:${actor.id}:${Date.now()}`;
  await prisma.$transaction((tx) => enqueueNotification(tx, { recipientId: actor.id, channel: "WHATSAPP", event: "test.whatsapp", idempotencyKey: key, payload: { sentBy: actor.email } }));
  const result = await processOutbox({ limit: 5, channels: ["WHATSAPP"] });
  revalidatePath("/admin/notifications");
  const row = await prisma.notification.findUnique({ where: { idempotencyKey: key } });
  if (row?.status === "SENT") return { message: `Test message sent to ${row.deliveredTo} (provider id ${row.providerMessageId}).` };
  return { error: `Test message not sent: ${row?.lastError ?? "transport disabled or queue busy"} (${result.claimed} processed).` };
}

export async function setWhatsAppPreferenceAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requireUser("/my/profile");
  const raw = String(formData.get("whatsappNumber") ?? "").trim();
  const enabled = String(formData.get("whatsappNotifications") ?? "") === "on";
  const consent = String(formData.get("whatsappConsent") ?? "") === "on";
  const number = raw ? normalisePhone(raw) : null;
  const values = { whatsappNumber: raw, whatsappNotifications: enabled ? "on" : "", whatsappConsent: consent ? "on" : "" };
  if (raw && !number) return { error: "Enter the number in international format, e.g. +971 50 123 4567.", values };
  if (enabled && !number) return { error: "Enter your WhatsApp number to switch messages on.", values };
  if (enabled && !consent) return { error: "Tick the consent box to receive WhatsApp messages.", values };
  const before = await prisma.user.findUniqueOrThrow({ where: { id: user.id }, select: { whatsappNumber: true, whatsappNotifications: true, whatsappConsentAt: true } });
  const consentAt = enabled ? (before.whatsappConsentAt && before.whatsappNumber === number ? before.whatsappConsentAt : new Date()) : null;
  await prisma.user.update({ where: { id: user.id }, data: { whatsappNumber: number, whatsappNotifications: enabled, whatsappConsentAt: consentAt } });
  await recordAudit({ actorId: user.id, action: "WHATSAPP_PREFERENCE_CHANGED", entityType: "User", entityId: user.id, before: { number: before.whatsappNumber, enabled: before.whatsappNotifications, consentAt: before.whatsappConsentAt?.toISOString() ?? null }, after: { number, enabled, consentAt: consentAt?.toISOString() ?? null } });
  revalidatePath("/my/profile");
  return { message: enabled ? `WhatsApp messages will be sent to ${number}. You can withdraw consent here at any time.` : "WhatsApp messages switched off." };
}
