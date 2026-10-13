"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getCurrentUser, SESSION_COOKIE } from "@/lib/auth/session";
import { SelfServiceError, changeOwnPassword } from "@sam/core/modules/self-service/service";

export type PasswordState = { error?: string };

/** Replaces a temporary password (or any password) and continues to the app. Reachable while a change is forced. */
export async function forcedPasswordChangeAction(_prev: PasswordState, formData: FormData): Promise<PasswordState> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const newPassword = String(formData.get("newPassword") ?? "");
  if (newPassword !== String(formData.get("confirmPassword") ?? "")) return { error: "The new passwords do not match." };
  const cookieStore = await cookies();
  try {
    await changeOwnPassword({
      userId: user.id,
      currentPassword: String(formData.get("currentPassword") ?? ""),
      newPassword,
      keepSessionToken: cookieStore.get(SESSION_COOKIE)?.value ?? null,
    });
  } catch (error) {
    if (error instanceof SelfServiceError) return { error: error.message };
    throw error;
  }
  redirect("/");
}
