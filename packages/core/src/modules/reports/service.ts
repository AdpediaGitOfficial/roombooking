// Occupancy dashboard and reports (SRS RPT-01, ACM-03, ACM-11, RPT-02, RPT-07).
import { prisma } from "../../lib/db";
import { siteWhere, type SiteScope } from "../../lib/permissions/scope";
import { recordAudit } from "../../lib/audit";
import { OCCUPYING_STATUSES, classifyBed, containerStatus, isoDate, mergeSummaries, summarize, todayInTimezone, type OccupancySummary } from "../accommodation/occupancy";

export const ARRIVAL_WINDOW_DAYS = 14;

const bedInclude = {
  allocations: {
    where: { status: { in: OCCUPYING_STATUSES } },
    include: { staff: { select: { id: true, employeeId: true, firstName: true, lastName: true } } },
  },
} as const;

function addDays(iso: string, n: number): string {
  return new Date(Date.parse(`${iso}T00:00:00.000Z`) + n * 86400000).toISOString().slice(0, 10);
}

export type BuildingRow = { id: string; name: string; siteName: string; summary: OccupancySummary };
export type MovementRow = { allocationId: string; staff: string; employeeId: string; bed: string; building: string; status: string; date: string; kind: "ARRIVAL" | "DEPARTURE" | "OVERDUE_ARRIVAL" | "OVERSTAY" };

export async function getDashboard(siteId: SiteScope, now: Date = new Date()) {
  const sites = await prisma.site.findMany({
    where: { status: "ACTIVE", ...siteWhere(siteId, "id") },
    orderBy: { name: "asc" },
    include: { buildings: { where: { status: { in: ["ACTIVE", "BLOCKED", "MAINTENANCE"] } }, orderBy: { code: "asc" }, include: { rooms: { include: { beds: { include: bedInclude } } } } } },
  });
  const allSites = await prisma.site.findMany({ where: { status: "ACTIVE", ...siteWhere(siteId && !Array.isArray(siteId) ? null : siteId, "id") }, orderBy: { name: "asc" }, select: { id: true, name: true, timezone: true } });
  const timezone = sites[0]?.timezone ?? "UTC";
  const today = todayInTimezone(timezone, now);
  const horizon = addDays(today, ARRIVAL_WINDOW_DAYS);

  const buildings: BuildingRow[] = [];
  const arrivals: MovementRow[] = [];
  const departures: MovementRow[] = [];
  for (const site of sites) {
    for (const building of site.buildings) {
      const roomSummaries = building.rooms.map((room) => summarize(room.beds.map((b) => classifyBed(b, today, containerStatus(room.status, building.status, site.status)))));
      buildings.push({ id: building.id, name: building.name, siteName: site.name, summary: mergeSummaries(roomSummaries) });
      for (const room of building.rooms) {
        for (const bed of room.beds) {
          for (const a of bed.allocations) {
            const start = isoDate(a.startDate);
            const end = a.endDate ? isoDate(a.endDate) : null;
            const base = { allocationId: a.id, staff: `${a.staff.firstName} ${a.staff.lastName}`, employeeId: a.staff.employeeId, bed: bed.code, building: building.name };
            if (a.status === "CONFIRMED" && start <= horizon) {
              arrivals.push({ ...base, status: a.status, date: start, kind: start < today ? "OVERDUE_ARRIVAL" : "ARRIVAL" });
            }
            if (end && end <= horizon && (a.status === "CHECKED_IN" || (a.status === "CONFIRMED" && start <= today))) {
              departures.push({ ...base, status: a.status, date: end, kind: end < today ? "OVERSTAY" : "DEPARTURE" });
            }
          }
        }
      }
    }
  }
  arrivals.sort((a, b) => a.date.localeCompare(b.date));
  departures.sort((a, b) => a.date.localeCompare(b.date));

  const [pendingRequests, approvedRoomChanges, overdueKeys, unassignedTickets] = await Promise.all([
    prisma.request.count({ where: { status: "PENDING_APPROVAL" } }),
    prisma.request.count({ where: { status: "APPROVED", requestType: { code: "ROOM_CHANGE" } } }),
    prisma.keyTransaction.count({ where: { type: "ISSUE", returnedAt: null, expectedReturnAt: { lt: now }, ...(siteId ? { key: siteWhere(siteId) } : {}) } }),
    prisma.workOrder.count({ where: { status: { in: ["NEW", "TRIAGED", "REOPENED"] }, assigneeId: null, vendorId: null, ...siteWhere(siteId) } }),
  ]);

  const summary = mergeSummaries(buildings.map((b) => b.summary));
  return {
    today,
    timezone,
    sites: allSites,
    summary,
    occupancyRate: summary.capacity > 0 ? Math.round((summary.occupied / summary.capacity) * 100) : 0,
    buildings,
    arrivals,
    departures,
    pending: {
      overdueArrivals: arrivals.filter((a) => a.kind === "OVERDUE_ARRIVAL").length,
      overstays: departures.filter((d) => d.kind === "OVERSTAY").length,
      approvedRoomChanges,
      pendingRequests,
      overdueKeys,
      unassignedTickets,
    },
  };
}

// ---------------------------------------------------------------------------
// Trend (ACM-11): occupied beds per day from actual check-in/out timestamps
// ---------------------------------------------------------------------------

export type TrendPoint = { date: string; occupied: number; capacity: number };

type Stay = { checkedInAt: Date | null; checkedOutAt: Date | null; status: string };

/** Beds occupied at the end of a calendar day: checked in by then and not yet checked out. */
export function occupiedAtEndOfDay(stays: Stay[], dayIso: string): number {
  const endOfDay = new Date(`${dayIso}T23:59:59.999Z`);
  return stays.filter((s) => s.checkedInAt && s.checkedInAt <= endOfDay && (!s.checkedOutAt || s.checkedOutAt > endOfDay)).length;
}

export async function getOccupancyTrend(siteId: SiteScope, days = 30, now: Date = new Date()): Promise<TrendPoint[]> {
  const today = now.toISOString().slice(0, 10);
  const from = new Date(Date.parse(`${addDays(today, -(days - 1))}T00:00:00.000Z`));
  const [stays, capacity] = await Promise.all([
    prisma.allocation.findMany({
      where: { checkedInAt: { not: null }, OR: [{ checkedOutAt: null }, { checkedOutAt: { gte: from } }], ...(siteId !== null && siteId !== undefined && siteId !== "" ? { bed: { room: { building: siteWhere(siteId) } } } : {}) },
      select: { checkedInAt: true, checkedOutAt: true, status: true },
    }),
    // Same definition as the dashboard tiles: every non-retired bed in an active building (blocked rooms still count as capacity).
    prisma.bed.count({ where: { status: { not: "RETIRED" }, room: { building: { status: { in: ["ACTIVE", "BLOCKED", "MAINTENANCE"] }, ...siteWhere(siteId) } } } }),
  ]);
  const points: TrendPoint[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const date = addDays(today, -i);
    points.push({ date, occupied: occupiedAtEndOfDay(stays, date), capacity });
  }
  return points;
}

// ---------------------------------------------------------------------------
// Exports (RPT-07): bed-level occupancy and movements as CSV; every export audited
// ---------------------------------------------------------------------------

export function csvEscape(value: unknown): string {
  const s = value === null || value === undefined ? "" : String(value);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/**
 * Exports are watermarked with the user and time (document section 9). The marks are trailing rows so the
 * header line stays machine-readable.
 */
export function watermarkCsv(csv: string, who: { name: string; username: string }, at: Date = new Date()): string {
  const body = csv.endsWith("\r\n") ? csv : `${csv}\r\n`;
  return `${body}${csvEscape(`Exported by ${who.name} (${who.username}) on ${at.toISOString()}`)}\r\n${csvEscape("Confidential: personal data. Do not share or store outside approved systems.")}\r\n`;
}

export function toCsv(headers: string[], rows: unknown[][]): string {
  return [headers, ...rows].map((r) => r.map(csvEscape).join(",")).join("\r\n") + "\r\n";
}

export async function occupancyCsv(siteId: SiteScope, actorId: string, now: Date = new Date()): Promise<string> {
  const sites = await prisma.site.findMany({
    where: { status: "ACTIVE", ...siteWhere(siteId, "id") },
    orderBy: { name: "asc" },
    include: { buildings: { orderBy: { code: "asc" }, include: { rooms: { orderBy: { code: "asc" }, include: { beds: { orderBy: { code: "asc" }, include: bedInclude } } } } } },
  });
  const rows: unknown[][] = [];
  for (const site of sites) {
    const today = todayInTimezone(site.timezone, now);
    for (const building of site.buildings) {
      for (const room of building.rooms) {
        for (const bed of room.beds) {
          const v = classifyBed(bed, today, containerStatus(room.status, building.status, site.status));
          rows.push([site.name, building.name, room.code, bed.code, v.state, v.occupant?.employeeId ?? "", v.occupant?.name ?? "", v.since ?? "", v.until ?? "", v.upcoming ? `${v.upcoming.occupant.employeeId} from ${v.upcoming.startDate}` : "", v.blockReason ?? ""]);
        }
      }
    }
  }
  await recordAudit({ actorId, action: "REPORT_EXPORTED", entityType: "Report", entityId: "occupancy", after: { siteId, rows: rows.length } });
  return toCsv(["Site", "Building", "Room", "Bed", "State", "Employee ID", "Occupant", "From", "To", "Next arrival", "Block reason"], rows);
}
