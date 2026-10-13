import type { Role } from "@prisma/client";
import { prisma } from "../../lib/db";
import { ALLOCATION_VIEW_ROLES } from "../allocations/access";
import { ACCOMMODATION_VIEW_ROLES } from "../accommodation/access";
import { MAINTENANCE_AREA_ROLES } from "../maintenance/access";

const holds = (roles: readonly Role[], allowed: readonly Role[]) => roles.some((r) => allowed.includes(r));

/** People, beds and tickets matching the text, limited to what the caller's roles may see. */
export async function searchAll(roles: readonly Role[], query: string) {
  const q = query.trim();
  const contains = { contains: q, mode: "insensitive" as const };
  if (q.length < 2) return { query: q, staff: [], beds: [], tickets: [] };
  const [staff, beds, tickets] = await Promise.all([
    holds(roles, ALLOCATION_VIEW_ROLES)
      ? prisma.staffProfile.findMany({
          where: { OR: [{ firstName: contains }, { lastName: contains }, { employeeId: contains }] },
          take: 10,
          orderBy: { lastName: "asc" },
          include: { allocations: { where: { status: { in: ["CONFIRMED", "CHECKED_IN"] } }, include: { bed: true }, take: 1 } },
        })
      : Promise.resolve([]),
    holds(roles, ACCOMMODATION_VIEW_ROLES)
      ? prisma.bed.findMany({ where: { OR: [{ code: contains }, { room: { code: contains } }] }, take: 10, orderBy: { code: "asc" }, include: { room: { include: { building: true } } } })
      : Promise.resolve([]),
    holds(roles, MAINTENANCE_AREA_ROLES)
      ? prisma.workOrder.findMany({ where: { OR: [{ ticketNumber: contains }, { category: contains }, { description: contains }] }, take: 10, orderBy: { createdAt: "desc" } })
      : Promise.resolve([]),
  ]);
  return { query: q, staff, beds, tickets };
}
