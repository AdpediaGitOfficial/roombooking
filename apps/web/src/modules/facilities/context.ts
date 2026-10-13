import "server-only";
import { prisma } from "@sam/core/lib/db";
import { userCan, type CurrentUser } from "@/lib/auth/authorize";
import type { Actor } from "@sam/core/modules/facilities/service";

export function actorFor(user: CurrentUser): Actor {
  // Managers approve and cancel any booking (Admins, or Officers holding the Facility manager grant); operators book on behalf and record attendance.
  return { id: user.id, isManager: userCan(user, "fac.approve") || userCan(user, "fac.cancel_any"), isOperator: userCan(user, "fac.book_behalf") };
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
