import "server-only";
import { prisma } from "@sam/core/lib/db";
import { OCCUPYING_STATUSES } from "@sam/core/modules/accommodation/occupancy";

/** Residents who currently hold a bed, as hosts for visitors and recipients of parcels. */
export async function hostOptions(siteIds: string[] | null) {
  const rows = await prisma.allocation.findMany({ where: { status: { in: OCCUPYING_STATUSES }, bed: { room: { building: siteIds ? { siteId: { in: siteIds } } : {} } } }, include: { staff: { select: { id: true, firstName: true, lastName: true, employeeId: true } }, bed: { include: { room: true } } }, take: 800, orderBy: { staff: { lastName: "asc" } } });
  const seen = new Set<string>();
  return rows.flatMap((r) => (seen.has(r.staffId) ? [] : (seen.add(r.staffId), [{ id: r.staffId, label: `${r.staff.firstName} ${r.staff.lastName} (${r.staff.employeeId}) · room ${r.bed.room.code}` }])));
}

export async function siteOptions(siteIds: string[] | null) {
  return prisma.site.findMany({ where: { archivedAt: null, ...(siteIds ? { id: { in: siteIds } } : {}) }, select: { id: true, name: true }, orderBy: { name: "asc" } });
}
