import type { RoleAssignment, User } from "@prisma/client";
import { prisma } from "../../lib/db";
import { recordAudit } from "../../lib/audit";
import { hashPassword, verifyPassword } from "../../lib/auth/password";
import { createSessionRecord, revokeSessionByToken } from "../../lib/auth/session-store";
import { AuthError } from "./errors";
import { acceptToken, lookupToken } from "../admin/users-service";
import { AdminError } from "../admin/errors";

const MAX_FAILED_ATTEMPTS = Number(process.env.LOGIN_MAX_FAILED_ATTEMPTS ?? 5);
const LOCKOUT_MINUTES = Number(process.env.LOGIN_LOCKOUT_MINUTES ?? 15);
const INVALID = "Invalid email or password.";

// Used to keep response time similar whether or not the email exists.
const dummyHashPromise = hashPassword("dummy-password-for-timing");

export type SignInMeta = { ipAddress?: string | null; userAgent?: string | null };

/**
 * Checks the credentials, applies the lockout policy and starts a session.
 * Every outcome is audited. Throws AuthError with the message to show.
 */
export async function signIn(input: { email: string; password: string }, meta: SignInMeta = {}) {
  const email = input.email.trim().toLowerCase();
  const password = input.password;
  if (!email || !password) throw new AuthError("VALIDATION", "Enter your email and password.");

  const user = await prisma.user.findUnique({ where: { email }, include: { roleAssignments: true } });
  const now = new Date();

  if (!user) {
    await verifyPassword(password, await dummyHashPromise);
    await recordAudit({ action: "LOGIN_FAILED", entityType: "User", entityId: email, after: { reason: "unknown_email" } });
    throw new AuthError("INVALID_CREDENTIALS", INVALID);
  }

  if (user.lockedUntil && user.lockedUntil > now) {
    const minutes = Math.max(1, Math.ceil((user.lockedUntil.getTime() - now.getTime()) / 60000));
    await recordAudit({ actorId: user.id, action: "LOGIN_BLOCKED", entityType: "User", entityId: user.id, after: { reason: "locked" } });
    throw new AuthError("LOCKED", `Too many failed attempts. Try again in ${minutes} minute${minutes === 1 ? "" : "s"}.`);
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
    throw new AuthError("INVALID_CREDENTIALS", INVALID);
  }

  if (user.status !== "ACTIVE") {
    await recordAudit({ actorId: user.id, action: "LOGIN_BLOCKED", entityType: "User", entityId: user.id, after: { reason: user.status } });
    throw new AuthError("INACTIVE", "Your account is not active. Contact the accommodation office.");
  }

  await prisma.user.update({
    where: { id: user.id },
    data: { failedLoginAttempts: 0, lockedUntil: null, lastLoginAt: now },
  });
  const { token, session } = await createSessionRecord(user.id, meta);
  await recordAudit({ actorId: user.id, action: "LOGIN_SUCCESS", entityType: "User", entityId: user.id });
  return { token, expiresAt: session.expiresAt, user: toSessionUser({ ...user, lastLoginAt: now }) };
}

/** Ends the session behind a token and audits the sign-out. */
export async function signOut(token: string, userId?: string) {
  await revokeSessionByToken(token);
  if (userId) await recordAudit({ actorId: userId, action: "LOGOUT", entityType: "User", entityId: userId });
}

/** The part of a user that clients may see: no password hash, tokens or lockout counters. */
export function toSessionUser(user: User & { roleAssignments: RoleAssignment[] }) {
  return {
    id: user.id,
    organizationId: user.organizationId,
    email: user.email,
    name: user.name,
    status: user.status,
    vendorId: user.vendorId,
    accessExpiresAt: user.accessExpiresAt,
    lastLoginAt: user.lastLoginAt,
    emailNotifications: user.emailNotifications,
    whatsappNumber: user.whatsappNumber,
    whatsappConsentAt: user.whatsappConsentAt,
    whatsappNotifications: user.whatsappNotifications,
    roleAssignments: user.roleAssignments.map((r) => ({ id: r.id, role: r.role, siteId: r.siteId, buildingId: r.buildingId })),
  };
}

export type SessionUser = ReturnType<typeof toSessionUser>;

/** What an invite or reset link is for, without revealing anything beyond the person it was sent to. */
export async function inviteInfo(token: string) {
  const user = await lookupToken(token);
  if (!user) throw new AdminError("NOT_FOUND", "This link is invalid or has expired.");
  return { name: user.name, email: user.email, purpose: (user.tokenPurpose === "RESET" ? "RESET" : "INVITE") as "INVITE" | "RESET" };
}

/** Sets the password from an invite or reset link, then starts a session for the person. */
export async function acceptInvite(input: { token: string; password: string }, meta: SignInMeta = {}) {
  const accepted = await acceptToken(input);
  const { token, session } = await createSessionRecord(accepted.id, meta);
  await recordAudit({ actorId: accepted.id, action: "LOGIN_SUCCESS", entityType: "User", entityId: accepted.id, after: { via: "invite_link" } });
  const user = await prisma.user.findUniqueOrThrow({ where: { id: accepted.id }, include: { roleAssignments: true } });
  return { token, expiresAt: session.expiresAt, user: toSessionUser(user) };
}
