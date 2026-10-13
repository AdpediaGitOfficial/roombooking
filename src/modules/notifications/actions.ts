"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { requireRole, requireUser } from "@/lib/auth/authorize";
import { recordAudit } from "@/lib/audit";
import { enqueueNotification } from "@/lib/notifications";
import { USER_ADMIN_ROLES } from "@/modules/admin/access";
import { processOutbox, retryNotification } from "./worker";

export type ActionState = { error?: string; message?: string };

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
