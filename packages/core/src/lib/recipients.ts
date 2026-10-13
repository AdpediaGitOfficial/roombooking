// Who to notify: active users in the site's organisation whose role assignment covers the site
// (all sites, that site, or one of its buildings). Keeps alerts from fanning out across unrelated sites.
import type { Prisma, Role } from "@prisma/client";
import { prisma } from "./db";

type Db = Prisma.TransactionClient | typeof prisma;

export async function usersWithRoles(db: Db, roles: Role[], siteId: string | null | undefined, opts: { excludeId?: string } = {}): Promise<Array<{ id: string }>> {
  const site = siteId ? await db.site.findUnique({ where: { id: siteId }, select: { organizationId: true } }) : null;
  const covers: Prisma.RoleAssignmentWhereInput[] = siteId ? [{ siteId: null, buildingId: null }, { siteId }, { building: { siteId } }] : [{}];
  return db.user.findMany({
    where: {
      status: "ACTIVE",
      ...(site ? { organizationId: site.organizationId } : {}),
      ...(opts.excludeId ? { id: { not: opts.excludeId } } : {}),
      roleAssignments: { some: { role: { in: roles }, OR: covers } },
    },
    select: { id: true },
  });
}
