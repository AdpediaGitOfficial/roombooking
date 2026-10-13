// The front desk "Today" board (document: Front desk). Everything the desk acts on, scoped to the sites it covers.
import { prisma } from "../../lib/db";
import { siteWhere, type SiteScope } from "../../lib/permissions/scope";
import { isoDate } from "../accommodation/occupancy";

const loc = { bed: { include: { room: { include: { building: true } } } }, staff: true } as const;

export async function deskBoard(sites: SiteScope, now: Date = new Date()) {
  const today = new Date(`${now.toISOString().slice(0, 10)}T00:00:00.000Z`);
  const tomorrow = new Date(today.getTime() + 86400000);
  const inSite = { bed: { room: { building: siteWhere(sites) } } };
  const [arrivals, overdueArrivals, departures, overstays, transfers, notReady, provisional, moveTasks, bookings] = await Promise.all([
    prisma.allocation.findMany({ where: { status: "CONFIRMED", startDate: { gte: today, lt: tomorrow }, ...inSite }, include: loc, orderBy: { createdAt: "asc" } }),
    prisma.allocation.findMany({ where: { status: "CONFIRMED", startDate: { lt: today }, ...inSite }, include: loc, orderBy: { startDate: "asc" }, take: 30 }),
    prisma.allocation.findMany({ where: { status: "CHECKED_IN", endDate: { gte: today, lt: tomorrow }, ...inSite }, include: loc, orderBy: { createdAt: "asc" } }),
    prisma.allocation.findMany({ where: { status: "CHECKED_IN", endDate: { lt: today }, ...inSite }, include: loc, orderBy: { endDate: "asc" }, take: 30 }),
    prisma.allocation.findMany({ where: { previousAllocationId: { not: null }, startDate: { gte: today, lt: tomorrow }, status: { in: ["CONFIRMED", "CHECKED_IN"] }, ...inSite }, include: { ...loc, previous: { include: { bed: true } } } }),
    prisma.bed.findMany({ where: { readiness: { not: "READY" }, status: "ACTIVE", room: { building: siteWhere(sites) } }, include: { room: { include: { building: true } } }, orderBy: [{ room: { building: { code: "asc" } } }, { code: "asc" }], take: 100 }),
    prisma.allocation.findMany({ where: { provisional: true, status: "CHECKED_IN", ...inSite }, include: loc, orderBy: { provisionalApproveBy: "asc" } }),
    prisma.moveTask.findMany({ where: { status: "OPEN" }, orderBy: { createdAt: "asc" } }),
    prisma.facilityBooking.findMany({ where: { startsAt: { gte: today, lt: tomorrow }, status: { in: ["CONFIRMED", "PENDING_APPROVAL", "CHECKED_IN"] }, facility: siteWhere(sites) }, include: { facility: { select: { name: true } }, user: { select: { name: true } } }, orderBy: { startsAt: "asc" } }),
  ]);
  return { today: isoDate(today), arrivals, overdueArrivals, departures, overstays, transfers, notReady, provisional, moveTasks, bookings };
}

export type DeskBoard = Awaited<ReturnType<typeof deskBoard>>;

/** Beds that could take an emergency check-in tonight: in service, vacant, with no booking in the next day. */
export async function emergencyBeds(sites: SiteScope, now: Date = new Date()) {
  const start = new Date(`${now.toISOString().slice(0, 10)}T00:00:00.000Z`);
  return prisma.bed.findMany({
    where: { status: "ACTIVE", room: { status: "ACTIVE", building: { status: "ACTIVE", ...siteWhere(sites) } }, allocations: { none: { status: { in: ["CONFIRMED", "CHECKED_IN"] }, OR: [{ endDate: null }, { endDate: { gt: start } }], startDate: { lte: new Date(start.getTime() + 86400000) } } } },
    include: { room: { include: { building: true } } },
    orderBy: [{ room: { building: { code: "asc" } } }, { code: "asc" }],
    take: 60,
  });
}
