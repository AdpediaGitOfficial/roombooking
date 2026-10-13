// Bed-level occupancy. Pure functions so the rules are unit-testable; the
// query helpers at the bottom load the data shape these functions expect.
import type { AllocationStatus, BedReadiness, BedStatus, RecordStatus, RoomStatus } from "@prisma/client";
import { prisma } from "../../lib/db";

/** Allocation statuses that occupy or reserve a bed. */
export const OCCUPYING_STATUSES: AllocationStatus[] = ["CONFIRMED", "CHECKED_IN"];

export type OccupantInfo = {
  staffId: string;
  employeeId: string;
  name: string;
};

export type AllocationLike = {
  id: string;
  status: AllocationStatus;
  startDate: Date;
  endDate: Date | null;
  staff: { id: string; employeeId: string; firstName: string; lastName: string };
};

export type BedLike = {
  id: string;
  code: string;
  status: BedStatus;
  blockReason: string | null;
  readiness?: BedReadiness;
  allocations: AllocationLike[];
};

// Document 7 bed states: Available (VACANT), Reserved (ALLOCATED), Occupied, Needs cleaning, Blocked,
// Under maintenance, plus Draft and Archived (RETIRED) which are outside capacity.
export type BedState = "OCCUPIED" | "ALLOCATED" | "VACANT" | "NEEDS_CLEANING" | "BLOCKED" | "MAINTENANCE" | "DRAFT" | "RETIRED";

/**
 * The status that governs a bed from above (document 7): blocking a building or site blocks everything
 * inside it. The most restrictive of site, building and room wins; ACTIVE only when all three are.
 */
export function containerStatus(room: RoomStatus, building?: RecordStatus | null, site?: RecordStatus | null): RoomStatus {
  const rank: Record<string, number> = { ACTIVE: 0, DRAFT: 1, MAINTENANCE: 2, BLOCKED: 3, INACTIVE: 4, ARCHIVED: 5 };
  const parts = [room, building, site].filter((x): x is RoomStatus => !!x);
  return parts.reduce((worst, x) => ((rank[x] ?? 0) > (rank[worst] ?? 0) ? x : worst), "ACTIVE" as RoomStatus);
}

export type BedView = {
  id: string;
  code: string;
  status: BedStatus;
  blockReason: string | null;
  state: BedState;
  occupant: OccupantInfo | null;
  allocationId: string | null;
  since: string | null; // ISO date
  until: string | null; // ISO date
  upcoming: { occupant: OccupantInfo; startDate: string; allocationId: string } | null;
};

export type OccupancySummary = {
  capacity: number; // beds in service (not retired)
  occupied: number; // checked in + allocated awaiting check-in
  checkedIn: number;
  awaitingCheckIn: number;
  vacant: number;
  blocked: number;
  retired: number;
  upcomingArrivals: number;
  /** Subsets reported alongside the counts above. */
  maintenance: number;
  needsCleaning: number;
  draft: number;
};

/** Calendar date (YYYY-MM-DD) in the given IANA timezone. */
export function todayInTimezone(timezone: string, now: Date = new Date()): string {
  try {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(now);
  } catch {
    return now.toISOString().slice(0, 10);
  }
}

export function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function occupantOf(a: AllocationLike): OccupantInfo {
  return {
    staffId: a.staff.id,
    employeeId: a.staff.employeeId,
    name: `${a.staff.firstName} ${a.staff.lastName}`.trim(),
  };
}

/**
 * Classifies one bed as of a calendar date.
 * - OCCUPIED: a CHECKED_IN allocation exists.
 * - ALLOCATED: a CONFIRMED allocation has started but nobody has checked in.
 * - BLOCKED / RETIRED: configuration state when nobody currently holds the bed.
 * - VACANT: otherwise. A future-dated CONFIRMED allocation is reported as
 *   `upcoming` and does not change today's count (SRS edge case
 *   "Future-dated transfer").
 */
export function classifyBed(bed: BedLike, today: string, roomStatus: RoomStatus = "ACTIVE"): BedView {
  const live = bed.allocations.filter((a) => OCCUPYING_STATUSES.includes(a.status));

  const checkedIn = live.find((a) => a.status === "CHECKED_IN");
  const started = live
    .filter((a) => a.status === "CONFIRMED" && isoDate(a.startDate) <= today && (!a.endDate || isoDate(a.endDate) > today))
    .sort((a, b) => isoDate(a.startDate).localeCompare(isoDate(b.startDate)))[0];
  const future = live
    .filter((a) => a.status === "CONFIRMED" && isoDate(a.startDate) > today)
    .sort((a, b) => isoDate(a.startDate).localeCompare(isoDate(b.startDate)))[0];

  const current = checkedIn ?? started ?? null;
  let state: BedState;
  if (current) state = checkedIn ? "OCCUPIED" : "ALLOCATED";
  else if (bed.status === "RETIRED" || bed.status === "ARCHIVED" || roomStatus === "ARCHIVED" || roomStatus === "INACTIVE") state = roomStatus === "INACTIVE" && bed.status !== "RETIRED" && bed.status !== "ARCHIVED" ? "BLOCKED" : "RETIRED";
  else if (bed.status === "DRAFT" || roomStatus === "DRAFT") state = "DRAFT";
  else if (bed.status === "MAINTENANCE" || roomStatus === "MAINTENANCE") state = "MAINTENANCE";
  else if (bed.status === "BLOCKED" || roomStatus !== "ACTIVE") state = "BLOCKED";
  else if (bed.readiness && bed.readiness !== "READY") state = "NEEDS_CLEANING";
  else state = "VACANT";

  return {
    id: bed.id,
    code: bed.code,
    status: bed.status,
    blockReason: bed.blockReason ?? (roomStatus !== "ACTIVE" && bed.status !== "BLOCKED" ? "Room not in service" : null),
    state,
    occupant: current ? occupantOf(current) : null,
    allocationId: current?.id ?? null,
    since: current ? isoDate(current.startDate) : null,
    until: current?.endDate ? isoDate(current.endDate) : null,
    upcoming: future ? { occupant: occupantOf(future), startDate: isoDate(future.startDate), allocationId: future.id } : null,
  };
}

export function summarize(views: BedView[]): OccupancySummary {
  const s: OccupancySummary = {
    capacity: 0,
    occupied: 0,
    checkedIn: 0,
    awaitingCheckIn: 0,
    vacant: 0,
    blocked: 0,
    retired: 0,
    upcomingArrivals: 0,
    maintenance: 0,
    needsCleaning: 0,
    draft: 0,
  };
  for (const v of views) {
    if (v.state === "RETIRED") {
      s.retired++;
      continue;
    }
    if (v.state === "DRAFT") {
      s.draft++;
      continue;
    }
    s.capacity++;
    if (v.state === "OCCUPIED") {
      s.occupied++;
      s.checkedIn++;
    } else if (v.state === "ALLOCATED") {
      s.occupied++;
      s.awaitingCheckIn++;
    } else if (v.state === "BLOCKED") s.blocked++;
    else if (v.state === "MAINTENANCE") {
      s.blocked++;
      s.maintenance++;
    } else if (v.state === "NEEDS_CLEANING") {
      s.vacant++;
      s.needsCleaning++;
    } else s.vacant++;
    if (v.upcoming) s.upcomingArrivals++;
  }
  return s;
}

export function mergeSummaries(items: OccupancySummary[]): OccupancySummary {
  return items.reduce(
    (acc, s) => ({
      capacity: acc.capacity + s.capacity,
      occupied: acc.occupied + s.occupied,
      checkedIn: acc.checkedIn + s.checkedIn,
      awaitingCheckIn: acc.awaitingCheckIn + s.awaitingCheckIn,
      vacant: acc.vacant + s.vacant,
      blocked: acc.blocked + s.blocked,
      retired: acc.retired + s.retired,
      upcomingArrivals: acc.upcomingArrivals + s.upcomingArrivals,
      maintenance: acc.maintenance + s.maintenance,
      needsCleaning: acc.needsCleaning + s.needsCleaning,
      draft: acc.draft + s.draft,
    }),
    { capacity: 0, occupied: 0, checkedIn: 0, awaitingCheckIn: 0, vacant: 0, blocked: 0, retired: 0, upcomingArrivals: 0, maintenance: 0, needsCleaning: 0, draft: 0 },
  );
}

// ---------------------------------------------------------------------------
// Query helpers
// ---------------------------------------------------------------------------

const bedInclude = {
  allocations: {
    where: { status: { in: OCCUPYING_STATUSES } },
    include: { staff: { select: { id: true, employeeId: true, firstName: true, lastName: true } } },
  },
} as const;

export async function getRoomOccupancy(roomId: string) {
  const room = await prisma.room.findUnique({
    where: { id: roomId },
    include: {
      building: { include: { site: true } },
      beds: { include: bedInclude, orderBy: { code: "asc" } },
    },
  });
  if (!room) return null;
  const today = todayInTimezone(room.building.site.timezone);
  const beds = room.beds.map((b) => classifyBed(b, today, containerStatus(room.status, room.building.status, room.building.site.status)));
  return { room, today, beds, summary: summarize(beds) };
}

export async function getBuildingOccupancy(buildingId: string) {
  const building = await prisma.building.findUnique({
    where: { id: buildingId },
    include: {
      site: true,
      rooms: { include: { beds: { include: bedInclude } }, orderBy: { code: "asc" } },
    },
  });
  if (!building) return null;
  const today = todayInTimezone(building.site.timezone);
  const rooms = building.rooms.map((room) => {
    const beds = room.beds.map((b) => classifyBed(b, today, containerStatus(room.status, building.status, building.site.status)));
    return { room, beds, summary: summarize(beds) };
  });
  return { building, today, rooms, summary: mergeSummaries(rooms.map((r) => r.summary)) };
}

export async function getSitesOverview(siteIds?: string[] | null) {
  const sites = await prisma.site.findMany({
    where: siteIds ? { id: { in: siteIds } } : {},
    orderBy: { name: "asc" },
    include: {
      buildings: {
        orderBy: { code: "asc" },
        include: { rooms: { include: { beds: { include: bedInclude } } } },
      },
    },
  });
  return sites.map((site) => {
    const today = todayInTimezone(site.timezone);
    const buildings = site.buildings.map((building) => {
      const roomSummaries = building.rooms.map((room) =>
        summarize(room.beds.map((b) => classifyBed(b, today, containerStatus(room.status, building.status, site.status)))),
      );
      return { building, roomCount: building.rooms.length, summary: mergeSummaries(roomSummaries) };
    });
    return { site, today, buildings, summary: mergeSummaries(buildings.map((b) => b.summary)) };
  });
}
