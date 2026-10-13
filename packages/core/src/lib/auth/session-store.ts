// Pure database operations for sessions. No Next.js imports so this can be
// unit-tested and reused by API clients.
import { createHash, randomBytes } from "node:crypto";
import { prisma } from "../db";
import { activeGrantsFor } from "../permissions/loader";

export const SESSION_TTL_HOURS = Number(process.env.SESSION_TTL_HOURS ?? 12);
const TOUCH_INTERVAL_MS = 5 * 60 * 1000;

export function hashSessionToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export async function createSessionRecord(
  userId: string,
  meta: { ipAddress?: string | null; userAgent?: string | null } = {},
) {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + SESSION_TTL_HOURS * 60 * 60 * 1000);
  const session = await prisma.session.create({
    data: {
      userId,
      tokenHash: hashSessionToken(token),
      expiresAt,
      ipAddress: meta.ipAddress ?? null,
      userAgent: meta.userAgent?.slice(0, 512) ?? null,
    },
  });
  return { token, session };
}

/**
 * Resolves a token to its user. Returns null when the session is unknown,
 * expired, revoked, or the user is no longer ACTIVE (deactivation revokes
 * access immediately, SRS 3.1).
 */
export async function resolveSession(token: string) {
  const session = await prisma.session.findUnique({
    where: { tokenHash: hashSessionToken(token) },
    include: { user: { include: { roleAssignments: true } } },
  });
  if (!session) return null;
  const now = new Date();
  if (session.revokedAt || session.expiresAt <= now) return null;
  if (session.user.status !== "ACTIVE") return null;
  // Time-limited accounts (contractors) lose access when their window ends (MNT-07).
  if (session.user.accessExpiresAt && session.user.accessExpiresAt <= now) return null;

  if (now.getTime() - session.lastSeenAt.getTime() > TOUCH_INTERVAL_MS) {
    await prisma.session.update({ where: { id: session.id }, data: { lastSeenAt: now } });
  }
  // Capability grants live now, addressed to the user or to a role they hold (document section 3).
  const grants = await activeGrantsFor(session.userId, [...new Set(session.user.roleAssignments.map((r) => r.role))]);
  return { ...session, user: { ...session.user, grants } };
}

export async function revokeSessionByToken(token: string) {
  await prisma.session.updateMany({
    where: { tokenHash: hashSessionToken(token), revokedAt: null },
    data: { revokedAt: new Date() },
  });
}

/** Ends every active session for a user (deactivation, password change, admin action). */
export async function revokeUserSessions(userId: string) {
  const result = await prisma.session.updateMany({
    where: { userId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
  return result.count;
}

/** Ends every other active session for a user, keeping the one identified by `keepToken`. */
export async function revokeOtherUserSessions(userId: string, keepToken: string) {
  const result = await prisma.session.updateMany({
    where: { userId, revokedAt: null, tokenHash: { not: hashSessionToken(keepToken) } },
    data: { revokedAt: new Date() },
  });
  return result.count;
}
