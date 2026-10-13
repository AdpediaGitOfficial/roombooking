import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "../src/lib/db";
import { allocate, checkIn } from "../src/modules/allocations/service";
import { csvEscape, getDashboard, getOccupancyTrend, occupancyCsv, occupiedAtEndOfDay, toCsv } from "../src/modules/reports/service";

let siteId: string;
let actorId: string;
let staffA: string;
let staffB: string;
let bed1: string;
let bed2: string;
const plus = (n: number) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);

beforeAll(async () => {
  const org = await prisma.organization.upsert({ where: { code: "TEST" }, update: {}, create: { code: "TEST", name: "Test Org" } });
  actorId = (await prisma.user.upsert({ where: { email: "alloc-test@example.com" }, update: {}, create: { organizationId: org.id, email: "alloc-test@example.com", name: "Alloc Tester", status: "ACTIVE" } })).id;
  const site = await prisma.site.upsert({ where: { organizationId_code: { organizationId: org.id, code: "RPT" } }, update: {}, create: { organizationId: org.id, code: "RPT", name: "Report Site", timezone: "UTC" } });
  siteId = site.id;
  const building = await prisma.building.upsert({ where: { siteId_code: { siteId, code: "RPT-B" } }, update: {}, create: { siteId, code: "RPT-B", name: "Report Block" } });
  const room = await prisma.room.upsert({ where: { buildingId_code: { buildingId: building.id, code: "RPT-R1" } }, update: { status: "ACTIVE" }, create: { buildingId: building.id, code: "RPT-R1" } });
  const bed = async (code: string, status: "ACTIVE" | "BLOCKED" = "ACTIVE") => (await prisma.bed.upsert({ where: { roomId_code: { roomId: room.id, code } }, update: { status }, create: { roomId: room.id, code, status } })).id;
  bed1 = await bed("RPT-R1-1"); bed2 = await bed("RPT-R1-2"); await bed("RPT-R1-3", "BLOCKED");
  const staff = async (id: string) => (await prisma.staffProfile.upsert({ where: { organizationId_employeeId: { organizationId: org.id, employeeId: id } }, update: {}, create: { organizationId: org.id, employeeId: id, firstName: "Rep", lastName: id } })).id;
  staffA = await staff("RPT-A"); staffB = await staff("RPT-B");
  await prisma.allocation.deleteMany({ where: { staffId: { in: [staffA, staffB] } } });
  // A: checked in 5 days ago, stay ends in 3 days (departure due). B: confirmed arrival overdue by 2 days.
  const a = await allocate({ staffId: staffA, bedId: bed1, startDate: plus(-5), endDate: plus(3), actorId });
  await checkIn({ allocationId: a.id, actorId, today: plus(-5) });
  await prisma.allocation.update({ where: { id: a.id }, data: { checkedInAt: new Date(Date.now() - 5 * 86400000) } });
  await allocate({ staffId: staffB, bedId: bed2, startDate: plus(-2), actorId });
});

afterAll(async () => { await prisma.$disconnect(); });

describe("dashboard", () => {
  it("summarises capacity, lists arrivals and departures with overdue flags, and counts pending actions", async () => {
    const d = await getDashboard(siteId);
    expect(d.summary).toMatchObject({ capacity: 3, occupied: 2, checkedIn: 1, awaitingCheckIn: 1, vacant: 0, blocked: 1 });
    expect(d.occupancyRate).toBe(67);
    expect(d.buildings.map((b) => b.name)).toEqual(["Report Block"]);
    const overdue = d.arrivals.find((r) => r.employeeId === "RPT-B");
    expect(overdue?.kind).toBe("OVERDUE_ARRIVAL");
    const departure = d.departures.find((r) => r.employeeId === "RPT-A");
    expect(departure).toMatchObject({ kind: "DEPARTURE", date: plus(3) });
    expect(d.pending.overdueArrivals).toBe(1);
    expect(d.pending.overstays).toBe(0);
    expect(d.pending.unassignedTickets).toBe(0);
  });

  it("reports an overstay once the end date has passed", async () => {
    const future = new Date(Date.now() + 4 * 86400000);
    const d = await getDashboard(siteId, future);
    expect(d.departures.find((r) => r.employeeId === "RPT-A")?.kind).toBe("OVERSTAY");
    expect(d.pending.overstays).toBe(1);
  });
});

describe("trend", () => {
  it("counts beds occupied at the end of each day from check-in and check-out times", () => {
    const stays = [
      { checkedInAt: new Date("2026-10-01T08:00:00Z"), checkedOutAt: new Date("2026-10-05T10:00:00Z"), status: "CHECKED_OUT" },
      { checkedInAt: new Date("2026-10-03T20:00:00Z"), checkedOutAt: null, status: "CHECKED_IN" },
      { checkedInAt: null, checkedOutAt: null, status: "CONFIRMED" },
    ];
    expect(occupiedAtEndOfDay(stays, "2026-09-30")).toBe(0);
    expect(occupiedAtEndOfDay(stays, "2026-10-01")).toBe(1);
    expect(occupiedAtEndOfDay(stays, "2026-10-03")).toBe(2);
    expect(occupiedAtEndOfDay(stays, "2026-10-05")).toBe(1);
  });

  it("produces one point per day with today's capacity", async () => {
    const points = await getOccupancyTrend(siteId, 7);
    expect(points).toHaveLength(7);
    expect(points[6].date).toBe(plus(0));
    expect(points[6].capacity).toBe(3);
    expect(points[6].occupied).toBe(1);
    expect(points[0].occupied).toBe(0);
  });
});

describe("csv export", () => {
  it("escapes commas, quotes and newlines", () => {
    expect(csvEscape('a,b')).toBe('"a,b"');
    expect(csvEscape('say "hi"')).toBe('"say ""hi"""');
    expect(csvEscape("line\nbreak")).toBe('"line\nbreak"');
    expect(toCsv(["A", "B"], [[1, "x"]])).toBe("A,B\r\n1,x\r\n");
  });

  it("lists every bed with state and occupant, and audits the export", async () => {
    const csv = await occupancyCsv(siteId, actorId);
    const lines = csv.trim().split("\r\n");
    expect(lines[0]).toBe("Site,Building,Room,Bed,State,Employee ID,Occupant,From,To,Next arrival,Block reason");
    expect(lines).toHaveLength(4);
    expect(lines.find((l) => l.includes("RPT-R1-1"))).toContain("OCCUPIED,RPT-A,Rep RPT-A");
    expect(lines.find((l) => l.includes("RPT-R1-2"))).toContain("ALLOCATED,RPT-B");
    expect(lines.find((l) => l.includes("RPT-R1-3"))).toContain("BLOCKED");
    const audit = await prisma.auditEvent.findFirst({ where: { actorId, action: "REPORT_EXPORTED", entityId: "occupancy" }, orderBy: { createdAt: "desc" } });
    expect((audit?.after as { rows: number }).rows).toBe(3);
  });
});
