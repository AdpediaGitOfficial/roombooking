"use server";

import { redirect } from "next/navigation";
import { prisma } from "@sam/core/lib/db";
import { hashPassword, verifyPassword } from "@sam/core/lib/auth/password";
import { createSession, destroyCurrentSession, getCurrentUser } from "@/lib/auth/session";
import { safeReturnPath } from "@/lib/auth/authorize";
import { recordAudit } from "@sam/core/lib/audit";

export type LoginState = { error?: string };

const MAX_FAILED_ATTEMPTS = Number(process.env.LOGIN_MAX_FAILED_ATTEMPTS ?? 5);
const LOCKOUT_MINUTES = Number(process.env.LOGIN_LOCKOUT_MINUTES ?? 15);
// One message for every failure (wrong name, wrong password, locked account) so sign-in never reveals which accounts exist.
const INVALID = "Invalid username or password. After repeated failures the account is locked until a Super Admin unlocks it.";

// Used to keep response time similar whether or not the email exists.
const dummyHashPromise = hashPassword("dummy-password-for-timing");

export async function login(_prev: LoginState, formData: FormData): Promise<LoginState> {
  // Sign-in name: employee ID, phone number or email (document section 9).
  const username = String(formData.get("username") ?? formData.get("email") ?? "").trim().toLowerCase();
  const password = String(formData.get("password") ?? "");
  const returnTo = safeReturnPath(String(formData.get("next") ?? ""));

  if (!username || !password) return { error: "Enter your username and password." };

  const user = await prisma.user.findFirst({ where: { OR: [{ username }, { email: username }] } });
  const now = new Date();

  if (!user) {
    await verifyPassword(password, await dummyHashPromise);
    await recordAudit({ action: "LOGIN_FAILED", entityType: "User", entityId: username, after: { reason: "unknown_username" } });
    return { error: INVALID };
  }

  if (user.lockedUntil && user.lockedUntil > now) {
    const minutes = Math.max(1, Math.ceil((user.lockedUntil.getTime() - now.getTime()) / 60000));
    await recordAudit({ actorId: user.id, action: "LOGIN_BLOCKED", entityType: "User", entityId: user.id, after: { reason: "locked" } });
    void minutes;
    return { error: INVALID };
  }

  const ok = await verifyPassword(password, user.passwordHash);
  if (!ok) {
    const attempts = user.failedLoginAttempts + 1;
    const lock = attempts >= MAX_FAILED_ATTEMPTS;
    await prisma.user.update({
      where: { id: user.id },
      data: {
        failedLoginAttempts: lock ? 0 : attempts,
        lockedUntil: lock ? new Date(now.getTime() + LOCKOUT_MINUTES * 60000) : null,
      },
    });
    await recordAudit({
      actorId: user.id,
      action: lock ? "LOGIN_LOCKED" : "LOGIN_FAILED",
      entityType: "User",
      entityId: user.id,
      after: { reason: "bad_password", attempts },
    });
    return { error: INVALID };
  }

  if (user.status !== "ACTIVE") {
    await recordAudit({ actorId: user.id, action: "LOGIN_BLOCKED", entityType: "User", entityId: user.id, after: { reason: user.status } });
    return { error: "Your account is not active. Contact the accommodation office." };
  }

  await prisma.user.update({
    where: { id: user.id },
    data: { failedLoginAttempts: 0, lockedUntil: null, lastLoginAt: now },
  });
  await createSession(user.id);
  await recordAudit({ actorId: user.id, action: "LOGIN_SUCCESS", entityType: "User", entityId: user.id });

  // A temporary password must be replaced before anything else is reachable.
  if (user.mustChangePassword) redirect("/change-password");
  redirect(returnTo);
}

export async function logout() {
  const user = await getCurrentUser();
  await destroyCurrentSession();
  if (user) {
    await recordAudit({ actorId: user.id, action: "LOGOUT", entityType: "User", entityId: user.id });
  }
  redirect("/login");
}
