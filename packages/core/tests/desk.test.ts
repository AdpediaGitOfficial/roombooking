import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "../src/lib/db";
import { recordAudit } from "../src/lib/audit";
import { currentShift, endShift, recentShifts, shiftActivity, ShiftError, startShift } from "../src/modules/desk/service";
import { deskBoard, emergencyBeds } from "../src/modules/desk/board";

const stamp = Date.now().toString(36);
const day = 86400000;
const midnight = (offset = 0) => new Date(`${new Date(Date.now() + offset * day).toISOString().slice(0, 10)}T00:00:00.000Z`);
let orgId: string;
let siteId: string;
let otherSiteId: string;
let userA: string;
let userB: string;
const beds: string[] = [];
let roomId: string;

const mkStaff = (id: string) => prisma.staffProfile.create({ data: { organizationId: orgId, employeeId: `${id}-${stamp}`, firstName: id, lastName: "Desk" } });
const alloc = async (id: string, bedId: string, status: "CONFIRMED" | "CHECKED_IN", startDate: Date, endDate: Date | null, extra: Record<string, unknown> = {}) =>
  prisma.allocation.create({ data: { staffId: (await mkStaff(id)).id, bedId, status, startDate, endDate, ...extra } });

beforeAll(async () => {
  orgId = (await prisma.organization.create({ data: { code: `DK-${stamp}`, name: "Desk Org" } })).id;
  siteId = (await prisma.site.create({ data: { organizationId: orgId, code: "DKS", name: "Desk Site", timezone: "UTC" } })).id;
  otherSiteId = (await prisma.site.create({ data: { organizationId: orgId, code: "DKO", name: "Other Site", timezone: "UTC" } })).id;
  const b = await prisma.building.create({ data: { siteId, code: "DK", name: "Desk Block" } });
  const room = await prisma.room.create({ data: { buildingId: b.id, code: "DK-1", type: "DOUBLE" } });
  roomId = room.id;
  for (let n = 1; n <= 8; n++) beds.push((await prisma.bed.create({ data: { roomId: room.id, code: `DK-1-${n}` } })).id);
  const ob = await prisma.building.create({ data: { siteId: otherSiteId, code: "DO", name: "Other Block" } });
  const or = await prisma.room.create({ data: { buildingId: ob.id, code: "DO-1", type: "DOUBLE" } });
  beds.push((await prisma.bed.create({ data: { roomId: or.id, code: "DO-1-1" } })).id); // index 8
  userA = (await prisma.user.create({ data: { organizationId: orgId, username: `dk-a-${stamp}`, name: "Desk A", status: "ACTIVE" } })).id;
  userB = (await prisma.user.create({ data: { organizationId: orgId, username: `dk-b-${stamp}`, name: "Desk B", status: "ACTIVE" } })).id;
});
afterAll(async () => { await prisma.$disconnect(); });

describe("shift log", () => {
  it("allows one open shift per person and audits the start", async () => {
    expect(await currentShift(userA)).toBeNull();
    const s = await startShift({ userId: userA, role: "ACCOMMODATION_OFFICER", siteId });
    expect((await currentShift(userA))?.id).toBe(s.id);
    await expect(startShift({ userId: userA, role: "ACCOMMODATION_OFFICER" })).rejects.toBeInstanceOf(ShiftError);
    expect(await prisma.auditEvent.count({ where: { action: "SHIFT_STARTED", entityId: s.id } })).toBe(1);
    // a different person is unaffected
    await startShift({ userId: userB, role: "SECURITY", siteId: otherSiteId });
    expect(await currentShift(userB)).not.toBeNull();
  });

  it("summarises what the person did from the audit trail, grouped, ignoring other people and zero rows", async () => {
    const shift = (await currentShift(userA))!;
    const log = (actorId: string, action: string, n = 1) => Promise.all(Array.from({ length: n }, () => recordAudit({ actorId, action, entityType: "Allocation", entityId: `x-${stamp}` })));
    await log(userA, "ALLOCATION_CHECKED_IN", 2);
    await log(userA, "EMERGENCY_CHECKIN");
    await log(userA, "KEY_ISSUED", 3);
    await log(userA, "PARCEL_LOGGED");
    await log(userA, "SOMETHING_UNGROUPED");
    await log(userB, "ALLOCATION_CHECKED_IN", 5);
    const activity = await shiftActivity(userA, shift.startedAt);
    expect(activity).toEqual([
      { label: "Check-ins", count: 3 },
      { label: "Keys issued", count: 3 },
      { label: "Parcels logged", count: 1 },
    ]);
    // events before the window are excluded
    expect(await shiftActivity(userA, new Date(Date.now() + 60000))).toEqual([]);
  });

  it("ends the shift with the computed summary, trimmed notes and an audit event", async () => {
    const ended = await endShift({ userId: userA, notes: "  Keys returned to safe  " });
    expect(ended.endedAt).not.toBeNull();
    expect(ended.notes).toBe("Keys returned to safe");
    expect(ended.summary).toEqual({ activity: [{ label: "Check-ins", count: 3 }, { label: "Keys issued", count: 3 }, { label: "Parcels logged", count: 1 }] });
    expect(await currentShift(userA)).toBeNull();
    expect(await prisma.auditEvent.count({ where: { action: "SHIFT_ENDED", entityId: ended.id } })).toBe(1);
    await expect(endShift({ userId: userA })).rejects.toMatchObject({ code: "NOT_FOUND" });
    // a new shift can start afterwards, and blank notes become null
    await startShift({ userId: userA, role: "ACCOMMODATION_OFFICER", siteId });
    expect((await endShift({ userId: userA, notes: "   " })).notes).toBeNull();
  });

  it("lists recent shifts newest first, filtered by user and visible sites", async () => {
    const mine = await recentShifts({ userId: userA });
    expect(mine.length).toBe(2);
    expect(mine[0]!.startedAt.getTime()).toBeGreaterThanOrEqual(mine[1]!.startedAt.getTime());
    const siteOnly = await recentShifts({ siteIds: [siteId], take: 100 });
    expect(siteOnly.every((s) => s.siteId === null || s.siteId === siteId)).toBe(true);
    expect(siteOnly.some((s) => s.userId === userB)).toBe(false);
    expect((await recentShifts({ userId: userA, take: 1 })).length).toBe(1);
  });
});

describe("front desk board", () => {
  it("buckets today's arrivals, overdue arrivals, departures, overstays, provisional stays and not-ready beds for the site only", async () => {
    const today = midnight(0);
    const arrival = await alloc("ARR", beds[0]!, "CONFIRMED", today, midnight(30));
    const late = await alloc("LATE", beds[1]!, "CONFIRMED", midnight(-3), midnight(30));
    const leaving = await alloc("LEAV", beds[2]!, "CHECKED_IN", midnight(-20), today);
    const over = await alloc("OVER", beds[3]!, "CHECKED_IN", midnight(-20), midnight(-2));
    const prov = await alloc("PROV", beds[4]!, "CHECKED_IN", midnight(-1), null, { provisional: true, provisionalApproveBy: midnight(1) });
    const future = await alloc("FUT", beds[5]!, "CONFIRMED", midnight(5), null);
    const elsewhere = await alloc("ELSE", beds[8]!, "CONFIRMED", today, null);
    await prisma.bed.update({ where: { id: beds[6]! }, data: { readiness: "NEEDS_CLEANING" } });

    const board = await deskBoard(siteId);
    const ids = (rows: { id: string }[]) => rows.map((r) => r.id);
    expect(ids(board.arrivals)).toContain(arrival.id);
    expect(ids(board.arrivals)).not.toContain(late.id);
    expect(ids(board.arrivals)).not.toContain(future.id);
    expect(ids(board.arrivals)).not.toContain(elsewhere.id);
    expect(ids(board.overdueArrivals)).toContain(late.id);
    expect(ids(board.departures)).toContain(leaving.id);
    expect(ids(board.overstays)).toContain(over.id);
    expect(ids(board.overstays)).not.toContain(leaving.id);
    expect(ids(board.provisional)).toContain(prov.id);
    expect(board.notReady.map((b) => b.id)).toContain(beds[6]);
    expect(board.today).toBe(today.toISOString().slice(0, 10));

    // the other site sees only its own arrival; an empty scope sees nothing; null sees all
    expect(ids((await deskBoard(otherSiteId)).arrivals)).toEqual([elsewhere.id]);
    expect((await deskBoard([])).arrivals).toEqual([]);
    const all = ids((await deskBoard(null)).arrivals);
    expect(all).toEqual(expect.arrayContaining([arrival.id, elsewhere.id]));
  });

  it("lists today's transfers and facility bookings", async () => {
    const today = midnight(0);
    const from = await alloc("TFROM", beds[7]!, "CHECKED_IN", midnight(-10), today);
    const to = await alloc("TTO", beds[7]!, "CONFIRMED", today, null, { previousAllocationId: from.id });
    const board = await deskBoard(siteId);
    expect(board.transfers.map((t) => t.id)).toContain(to.id);

    const fac = await prisma.facility.create({ data: { siteId, code: `GYM-${stamp}`, name: `Gym ${stamp}`, capacity: 5 } });
    const bk = await prisma.facilityBooking.create({ data: { facilityId: fac.id, userId: userA, startsAt: new Date(today.getTime() + 3600000 * 3), endsAt: new Date(today.getTime() + 3600000 * 4), status: "CONFIRMED" } });
    expect((await deskBoard(siteId)).bookings.map((b) => b.id)).toContain(bk.id);
    expect((await deskBoard(otherSiteId)).bookings.map((b) => b.id)).not.toContain(bk.id);
  });
});

describe("emergency beds", () => {
  it("offers only in-service vacant beds with no booking tonight or tomorrow, within the site", async () => {
    const free = await emergencyBeds(siteId);
    const freeIds = free.map((b) => b.id);
    expect(freeIds).not.toContain(beds[0]); // arriving today
    expect(freeIds).not.toContain(beds[1]); // overdue arrival still holds the bed
    expect(freeIds).not.toContain(beds[8]); // other site
    expect(freeIds).toContain(beds[5]); // booked 5 days out only

    await prisma.bed.update({ where: { id: beds[5]! }, data: { status: "BLOCKED" } });
    expect((await emergencyBeds(siteId)).map((b) => b.id)).not.toContain(beds[5]);
    expect((await emergencyBeds(otherSiteId)).map((b) => b.id)).not.toContain(beds[0]);
  });
});
