import "server-only";
import { prisma } from "@sam/core/lib/db";
import { hasRole, type CurrentUser } from "@/lib/auth/authorize";
import { FACILITY_MANAGE_ROLES, FACILITY_OPERATE_ROLES } from "@sam/core/modules/facilities/access";
import type { Actor } from "@sam/core/modules/facilities/service";

export function actorFor(user: CurrentUser): Actor {
  return { id: user.id, isManager: hasRole(user, ...FACILITY_MANAGE_ROLES), isOperator: hasRole(user, ...FACILITY_OPERATE_ROLES) };
}

/** Users who can be booked on behalf of: active staff with an account. */
export async function bookableUsers() {
  const staff = await prisma.staffProfile.findMany({ where: { employmentStatus: "ACTIVE", userId: { not: null } }, orderBy: [{ lastName: "asc" }, { firstName: "asc" }] });
  return staff.filter((s) => s.userId).map((s) => ({ id: s.userId as string, label: `${s.lastName}, ${s.firstName} (${s.employeeId})` }));
}

export async function siteOptions() {
  const sites = await prisma.site.findMany({ where: { status: "ACTIVE" }, orderBy: { name: "asc" } });
  return sites.map((s) => ({ id: s.id, label: s.name }));
}
