// What the application shell shows around every page: the unread count, the
// user's site scope and the attention counts next to navigation entries.
import type { Role } from "@prisma/client";
import { prisma } from "../../lib/db";
import { ALLOCATION_OPERATE_ROLES } from "../allocations/access";
import { APPROVALS_AREA_ROLES } from "../requests/access";
import { MAINTENANCE_COORDINATOR_ROLES } from "../maintenance/access";
import { countUnreadNotifications } from "../self-service/service";

type ShellUser = { id: string; roleAssignments: Array<{ role: Role; siteId: string | null }> };

const holds = (user: ShellUser, roles: readonly Role[]) => user.roleAssignments.some((a) => roles.includes(a.role));

export async function getShellSummary(user: ShellUser) {
  const counts: Record<string, number> = {};
  const siteIds = [...new Set(user.roleAssignments.map((r) => r.siteId).filter((id): id is string => !!id))];
  const jobs: Promise<unknown>[] = [];

  if (holds(user, ALLOCATION_OPERATE_ROLES)) {
    jobs.push(prisma.allocation.count({ where: { status: "CONFIRMED", startDate: { lt: new Date() } } }).then((n) => { if (n) counts["/accommodation/allocations"] = n; }));
  }
  if (holds(user, APPROVALS_AREA_ROLES)) {
    jobs.push(prisma.request.count({ where: { status: { in: ["SUBMITTED", "PENDING_APPROVAL", "RESUBMITTED"] } } }).then((n) => { if (n) counts["/approvals"] = n; }));
  }
  if (holds(user, MAINTENANCE_COORDINATOR_ROLES)) {
    jobs.push(prisma.workOrder.count({ where: { status: { in: ["NEW", "TRIAGED"] }, assigneeId: null, vendorId: null } }).then((n) => { if (n) counts["/maintenance"] = n; }));
  }
  const [unread, sites] = await Promise.all([
    countUnreadNotifications(user.id),
    siteIds.length ? prisma.site.findMany({ where: { id: { in: siteIds } }, select: { name: true } }) : Promise.resolve([]),
    ...jobs,
  ]);
  return { unread, siteNames: sites.map((s) => s.name), navCounts: counts };
}
