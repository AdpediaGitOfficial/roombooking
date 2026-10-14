"use server";

import { revalidatePath } from "next/cache";
import { ApiError } from "@sam/contract/index";
import { api } from "@/lib/api";
import { requireUser } from "@/lib/auth/authorize";

export type ActionState = { error?: string; message?: string };

function str(formData: FormData, key: string): string {
  return String(formData.get(key) ?? "");
}

export async function updateProfileAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  await requireUser("/my/profile");
  try {
    await api.me.updateProfile({
      phone: str(formData, "phone"),
      emergencyContactName: str(formData, "emergencyContactName"),
      emergencyContactPhone: str(formData, "emergencyContactPhone"),
    });
  } catch (error) {
    if (error instanceof ApiError && error.status < 500) return { error: error.message };
    throw error;
  }
  revalidatePath("/my/profile");
  return { message: "Profile updated." };
}

export async function changePasswordAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  await requireUser("/my/profile");
  const newPassword = str(formData, "newPassword");
  if (newPassword !== str(formData, "confirmPassword")) return { error: "The new passwords do not match." };
  try {
    const { otherSessionsRevoked } = await api.me.changePassword({ currentPassword: str(formData, "currentPassword"), newPassword });
    return { message: otherSessionsRevoked > 0 ? `Password changed. ${otherSessionsRevoked} other device${otherSessionsRevoked === 1 ? " was" : "s were"} signed out.` : "Password changed." };
  } catch (error) {
    if (error instanceof ApiError && error.status < 500) return { error: error.message };
    throw error;
  }
}

export async function markReadAction(formData: FormData) {
  await requireUser("/my");
  await api.me.markNotificationRead({ id: str(formData, "notificationId") });
  revalidatePath("/my");
}
