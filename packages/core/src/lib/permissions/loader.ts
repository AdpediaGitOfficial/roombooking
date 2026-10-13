import type { Prisma, Role } from "@prisma/client";
import { prisma } from "../db";

/** Grants that are live now for a user holding the given roles (user-addressed and role-addressed). */
export async function activeGrantsFor(userId: string, roles: Role[], db: Prisma.TransactionClient | typeof prisma = prisma) {
  const now = new Date();
  return db.permissionGrant.findMany({
    where: {
      revokedAt: null,
      AND: [{ OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] }, { OR: [{ userId }, ...(roles.length ? [{ role: { in: roles } }] : [])] }],
    },
  });
}
