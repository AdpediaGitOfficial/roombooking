import type { Role } from "@prisma/client";
import { prisma } from "@sam/core/lib/db";
import { hashPassword } from "@sam/core/lib/auth/password";
import { createSessionRecord } from "@sam/core/lib/auth/session-store";

export const PASSWORD = "Test-Password-2026";

export async function testOrg() {
  return prisma.organization.upsert({ where: { code: "APITEST" }, update: {}, create: { code: "APITEST", name: "API Test Org" } });
}

/** Creates or resets an active user with exactly the given roles. */
export async function ensureUser(email: string, roles: Role[], opts: { password?: string } = {}) {
  const org = await testOrg();
  const passwordHash = await hashPassword(opts.password ?? PASSWORD);
  const user = await prisma.user.upsert({
    where: { email },
    update: { status: "ACTIVE", passwordHash, failedLoginAttempts: 0, lockedUntil: null, accessExpiresAt: null },
    create: { organizationId: org.id, email, name: email.split("@")[0], status: "ACTIVE", passwordHash },
  });
  await prisma.roleAssignment.deleteMany({ where: { userId: user.id } });
  for (const role of roles) await prisma.roleAssignment.create({ data: { userId: user.id, role } });
  return user;
}

export async function tokenFor(userId: string) {
  return (await createSessionRecord(userId)).token;
}

export const bearer = (token: string) => ({ authorization: `Bearer ${token}` });
