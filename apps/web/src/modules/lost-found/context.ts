import "server-only";
import { prisma } from "@sam/core/lib/db";
import { hasRole, type CurrentUser } from "@/lib/auth/authorize";
import { LOST_FOUND_MANAGE_ROLES, LOST_FOUND_OPERATE_ROLES } from "@sam/core/modules/lost-found/access";
import type { Actor } from "@sam/core/modules/lost-found/service";

export function actorFor(user: CurrentUser): Actor {
  return { id: user.id, isOperator: hasRole(user, ...LOST_FOUND_OPERATE_ROLES), isManager: hasRole(user, ...LOST_FOUND_MANAGE_ROLES) };
}

export async function registerOptions() {
  const [sites, staff] = await Promise.all([
    prisma.site.findMany({ where: { status: "ACTIVE" }, orderBy: { name: "asc" } }),
    prisma.staffProfile.findMany({ where: { employmentStatus: "ACTIVE" }, orderBy: [{ lastName: "asc" }, { firstName: "asc" }] }),
  ]);
  return { sites: sites.map((s) => ({ id: s.id, label: s.name })), staff: staff.map((s) => ({ id: s.id, label: `${s.lastName}, ${s.firstName} (${s.employeeId})`, userId: s.userId })) };
}
