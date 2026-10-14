"use server";

import { revalidatePath } from "next/cache";
import { requireRole, requireUser } from "@/lib/auth/authorize";
import { api } from "@/lib/api";
import { ApiError } from "@sam/contract/index";
import { USER_ADMIN_ROLES } from "@sam/core/modules/admin/access";

export type ActionState = { error?: string; message?: string; values?: Record<string, string> };

export async function runWorkerAction(): Promise<ActionState> {
  await requireRole(USER_ADMIN_ROLES, "/admin/notifications");
  const result = await api.notifications.runWorker();
  revalidatePath("/admin/notifications");
  return { message: `Processed ${result.claimed}: ${result.sent} sent, ${result.failed} to retry, ${result.permanentlyFailed} failed permanently.` };
}

export async function retryAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  await requireRole(USER_ADMIN_ROLES, "/admin/notifications");
  const { queued } = await api.notifications.retry({ id: String(formData.get("id") ?? "") });
  revalidatePath("/admin/notifications");
  return queued ? { message: "Queued for another attempt." } : { error: "Only failed notifications can be retried." };
}

async function test(channel: "EMAIL" | "WHATSAPP"): Promise<ActionState> {
  await requireRole(USER_ADMIN_ROLES, "/admin/notifications");
  const result = await api.notifications.sendTest({ channel });
  revalidatePath("/admin/notifications");
  return result.ok ? { message: result.message } : { error: result.message };
}

export const sendTestEmailAction = async (): Promise<ActionState> => test("EMAIL");

export async function setEmailPreferenceAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  await requireUser("/my/profile");
  const enabled = String(formData.get("emailNotifications") ?? "") === "on";
  await api.me.setEmailPreference({ enabled });
  revalidatePath("/my/profile");
  return { message: enabled ? "You will receive email copies of notifications." : "Email copies switched off. You will still see notifications in the app." };
}

export async function sendTestWhatsAppAction(): Promise<ActionState> {
  return test("WHATSAPP");
}

export async function setWhatsAppPreferenceAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  await requireUser("/my/profile");
  const raw = String(formData.get("whatsappNumber") ?? "").trim();
  const enabled = String(formData.get("whatsappNotifications") ?? "") === "on";
  const consent = String(formData.get("whatsappConsent") ?? "") === "on";
  const values = { whatsappNumber: raw, whatsappNotifications: enabled ? "on" : "", whatsappConsent: consent ? "on" : "" };
  try {
    const result = await api.me.setWhatsAppPreference({ number: raw, enabled, consent });
    revalidatePath("/my/profile");
    return { message: enabled ? `WhatsApp messages will be sent to ${result.number}. You can withdraw consent here at any time.` : "WhatsApp messages switched off." };
  } catch (error) {
    if (error instanceof ApiError && error.status < 500) return { error: error.message, values };
    throw error;
  }
}
