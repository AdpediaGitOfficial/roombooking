// Bed-level occupancy queries. The rules these load data for live in
// occupancy-rules.ts (pure, safe to import anywhere); they are re-exported here
// so existing imports keep working.
import { prisma } from "../../lib/db";
import { OCCUPYING_STATUSES, classifyBed, mergeSummaries, summarize, todayInTimezone } from "./occupancy-rules";

export * from "./occupancy-rules";

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
  const beds = room.beds.map((b) => classifyBed(b, today, room.status));
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
    const beds = room.beds.map((b) => classifyBed(b, today, room.status));
    return { room, beds, summary: summarize(beds) };
  });
  return { building, today, rooms, summary: mergeSummaries(rooms.map((r) => r.summary)) };
}

export async function getSitesOverview() {
  const sites = await prisma.site.findMany({
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
        summarize(room.beds.map((b) => classifyBed(b, today, room.status))),
      );
      // Only what the overview lists: the room and bed detail was needed to count, not to send.
      return { building: { id: building.id, code: building.code, name: building.name, type: building.type, status: building.status }, roomCount: building.rooms.length, summary: mergeSummaries(roomSummaries) };
    });
    const { buildings: _nested, ...siteFields } = site;
    void _nested;
    return { site: siteFields, today, buildings, summary: mergeSummaries(buildings.map((b) => b.summary)) };
  });
}
