"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/auth/authorize";
import { SESSION_COOKIE } from "@/lib/auth/session";
import { SelfServiceError, changeOwnPassword, markNotificationRead, updateOwnProfile } from "./service";

export type ActionState = { error?: string; message?: string };

function str(formData: FormData, key: string): string {
  return String(formData.get(key) ?? "");
}

export async function updateProfileAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requireUser("/my/profile");
  const staff = await prisma.staffProfile.findUnique({ where: { userId: user.id }, select: { id: true } });
  if (!staff) return { error: "No staff record is linked to your account." };
  try {
    await updateOwnProfile(staff.id, user.id, {
      phone: str(formData, "phone"),
      emergencyContactName: str(formData, "emergencyContactName"),
      emergencyContactPhone: str(formData, "emergencyContactPhone"),
    });
  } catch (error) {
    if (error instanceof SelfServiceError) return { error: error.message };
    throw error;
  }
  revalidatePath("/my/profile");
  return { message: "Profile updated." };
}

export async function changePasswordAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requireUser("/my/profile");
  const newPassword = str(formData, "newPassword");
  if (newPassword !== str(formData, "confirmPassword")) return { error: "The new passwords do not match." };
  const cookieStore = await cookies();
  try {
    const { otherSessionsRevoked } = await changeOwnPassword({
      userId: user.id,
      currentPassword: str(formData, "currentPassword"),
      newPassword,
      keepSessionToken: cookieStore.get(SESSION_COOKIE)?.value ?? null,
    });
    return { message: otherSessionsRevoked > 0 ? `Password changed. ${otherSessionsRevoked} other device${otherSessionsRevoked === 1 ? " was" : "s were"} signed out.` : "Password changed." };
  } catch (error) {
    if (error instanceof SelfServiceError) return { error: error.message };
    throw error;
  }
}

export async function markReadAction(formData: FormData) {
  const user = await requireUser("/my");
  await markNotificationRead(user.id, str(formData, "notificationId"));
  revalidatePath("/my");
}
