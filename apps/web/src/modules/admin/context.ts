import "server-only";
import type { Role } from "@prisma/client";
import { prisma } from "@sam/core/lib/db";
import { ALL_ROLES } from "@sam/core/lib/permissions/roles";
import { CAPABILITIES } from "@sam/core/lib/permissions/matrix";
import { CAPABILITY_SETS } from "@sam/core/lib/permissions/sets";

/** Everything the grant form offers: users to grant to, roles, capability sets and single grantable capabilities. */
export async function grantTargets(organizationId: string) {
  const users = await prisma.user.findMany({ where: { organizationId, status: { in: ["ACTIVE", "INVITED"] }, roleAssignments: { some: {} } }, select: { id: true, name: true, username: true }, orderBy: { name: "asc" }, take: 500 });
  const grantable = CAPABILITIES.filter((c) => Object.values(c.cells).some((cell) => cell.state === "G"));
  return {
    users: users.map((u) => ({ id: u.id, label: `${u.name} (${u.username})` })),
    roles: ALL_ROLES as Role[],
    sets: CAPABILITY_SETS.map((s) => ({ id: s.id, label: s.label, adds: s.adds })),
    capabilities: grantable.map((c) => ({ key: c.key, label: c.label, module: c.module })),
  };
}
