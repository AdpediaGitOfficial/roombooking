import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { allocate, checkIn, checkOut } from "@/modules/allocations/service";
import { defaultRange, facilityReport, keyCsv, keyReport, maintenanceCsv, maintenanceReport, movementCsv, movementReport, parseRange, person, scopeFor, siteFilter, type Scope } from "@/modules/reports/suite";

const stamp = Date.now().toString(36);
let orgId: string; let siteId: string; let otherSiteId: string; let buildingId: string; let actorId: string; let engineerId: string;
let staffA: string; let staffB: string;
const all: Scope = { siteIds: null, canSeeNames: true };
const masked: Scope = { siteIds: null, canSeeNames: false };
const plus = (n: number) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);
const range = { from: plus(-30), to: plus(1) };

beforeAll(async () => {
  const org = await prisma.organization.upsert({ where: { code: `RS-${stamp}` }, update: {}, create: { code: `RS-${stamp}`, name: "Report Suite Org" } });
  orgId = org.id;
  actorId = (await prisma.user.create({ data: { organizationId: orgId, email: `rs-${stamp}@example.com`, name: "Report Admin", status: "ACTIVE" } })).id;
  engineerId = (await prisma.user.create({ data: { organizationId: orgId, email: `rs-eng-${stamp}@example.com`, name: "Report Engineer", status: "ACTIVE" } })).id;
  siteId = (await prisma.site.create({ data: { organizationId: orgId, code: "RS1", name: "Suite Site", timezone: "Asia/Dubai" } })).id;
  otherSiteId = (await prisma.site.create({ data: { organizationId: orgId, code: "RS2", name: "Other Site", timezone: "UTC" } })).id;
  buildingId = (await prisma.building.create({ data: { siteId, code: "RSB", name: "Suite Block" } })).id;
  const room = await prisma.room.create({ data: { buildingId, code: "RS-R1" } });
  const bed1 = (await prisma.bed.create({ data: { roomId: room.id, code: "RS-1" } })).id;
  const bed2 = (await prisma.bed.create({ data: { roomId: room.id, code: "RS-2" } })).id;
  staffA = (await prisma.staffProfile.create({ data: { organizationId: orgId, employeeId: `RS-A-${stamp}`, firstName: "Ada", lastName: "Suite" } })).id;
  staffB = (await prisma.staffProfile.create({ data: { organizationId: orgId, employeeId: `RS-B-${stamp}`, firstName: "Bob", lastName: "Suite" } })).id;
  // A: arrived 10 days ago, left 2 days ago. B: arrived 5 days ago, still in.
  const a = await allocate({ staffId: staffA, bedId: bed1, startDate: plus(-10), endDate: plus(-2), actorId });
  await checkIn({ allocationId: a.id, actorId, today: plus(-10) });
  await checkOut({ allocationId: a.id, actorId, today: plus(-2) });
  const b = await allocate({ staffId: staffB, bedId: bed2, startDate: plus(-5), actorId });
  await checkIn({ allocationId: b.id, actorId, today: plus(-5) });
  // Tickets: one resolved within SLA, one resolved late, one open and overdue, one open and fine, one at the other site.
  const mk = (data: Partial<Parameters<typeof prisma.workOrder.create>[0]["data"]> & { ticketNumber: string }) => prisma.workOrder.create({ data: { siteId, buildingId, category: "Plumbing", description: "x", priority: "MEDIUM", requesterId: actorId, status: "NEW", ...data } as Parameters<typeof prisma.workOrder.create>[0]["data"] });
  const h = 3600000;
  await mk({ ticketNumber: `RS-${stamp}-1`, status: "RESOLVED", createdAt: new Date(Date.now() - 48 * h), slaDueAt: new Date(Date.now() - 24 * h), resolvedAt: new Date(Date.now() - 40 * h), assigneeId: engineerId });
  await mk({ ticketNumber: `RS-${stamp}-2`, status: "CLOSED", category: "Electrical", createdAt: new Date(Date.now() - 100 * h), slaDueAt: new Date(Date.now() - 80 * h), resolvedAt: new Date(Date.now() - 70 * h), closedAt: new Date(Date.now() - 60 * h), assigneeId: engineerId });
  await mk({ ticketNumber: `RS-${stamp}-3`, status: "ASSIGNED", priority: "URGENT", createdAt: new Date(Date.now() - 30 * h), slaDueAt: new Date(Date.now() - 20 * h), assigneeId: engineerId });
  await mk({ ticketNumber: `RS-${stamp}-4`, status: "NEW", category: "Electrical", createdAt: new Date(Date.now() - 2 * h), slaDueAt: new Date(Date.now() + 40 * h) });
  await mk({ ticketNumber: `RS-${stamp}-5`, siteId: otherSiteId, buildingId: null, status: "NEW", createdAt: new Date(Date.now() - 2 * h) });
  // Keys: one issued and overdue, one issued on time, one lost, one available.
  const key = (code: string, status: "AVAILABLE" | "ISSUED" | "LOST") => prisma.key.create({ data: { siteId, code: `${code}-${stamp}`, roomId: room.id, status } });
  const k1 = await key("RSK1", "ISSUED"); const k2 = await key("RSK2", "ISSUED"); await key("RSK3", "LOST"); await key("RSK4", "AVAILABLE");
  await prisma.keyTransaction.create({ data: { keyId: k1.id, type: "ISSUE", holderId: staffB, custodianId: actorId, expectedReturnAt: new Date(Date.now() - 24 * h), createdAt: new Date(Date.now() - 72 * h) } });
  await prisma.keyTransaction.create({ data: { keyId: k2.id, type: "ISSUE", holderName: "Contractor Jim", custodianId: actorId, expectedReturnAt: new Date(Date.now() + 72 * h) } });
  // Facility with two bookings (one attended, one no-show) this week.
  const fac = await prisma.facility.create({ data: { siteId, code: "RSF", name: "Suite Gym", capacity: 4, openingHours: { mon_sun: ["06:00", "22:00"] }, bookingRules: {} } });
  const startsAt = new Date(Date.now() - 24 * h);
  await prisma.facilityBooking.create({ data: { facilityId: fac.id, userId: actorId, startsAt, endsAt: new Date(startsAt.getTime() + h), headcount: 2, status: "COMPLETED", createdById: actorId } });
  await prisma.facilityBooking.create({ data: { facilityId: fac.id, userId: engineerId, startsAt: new Date(startsAt.getTime() + 2 * h), endsAt: new Date(startsAt.getTime() + 3 * h), headcount: 1, status: "NO_SHOW", createdById: engineerId } });
});

afterAll(async () => { await prisma.$disconnect(); });

describe("access and ranges", () => {
  it("derives site scope and name visibility from role assignments", async () => {
    const global = await scopeFor({ roleAssignments: [{ role: "AUDITOR", siteId: null, buildingId: null } as never] });
    expect(global).toEqual({ siteIds: null, canSeeNames: false });
    const scoped = await scopeFor({ roleAssignments: [{ role: "ACCOMMODATION_OFFICER", siteId: siteId, buildingId: null } as never, { role: "STAFF", siteId: null, buildingId: null } as never] });
    expect(scoped).toEqual({ siteIds: [siteId], canSeeNames: true });
    const viaBuilding = await scopeFor({ roleAssignments: [{ role: "ACCOMMODATION_OFFICER", siteId: null, buildingId } as never] });
    expect(viaBuilding.siteIds).toEqual([siteId]);
    expect(siteFilter(scoped, otherSiteId)).toEqual({ siteId: { in: [] } });
    expect(siteFilter(scoped, null)).toEqual({ siteId: { in: [siteId] } });
    expect(siteFilter(global, null)).toEqual({});
    expect(person(masked, { firstName: "Ada", lastName: "Suite", employeeId: "E1" })).toBe("E1");
    expect(person(all, { firstName: "Ada", lastName: "Suite", employeeId: "E1" })).toBe("Ada Suite (E1)");
  });
  it("parses and defaults date ranges", () => {
    const now = new Date("2026-10-13T10:00:00.000Z");
    expect(defaultRange(now)).toEqual({ from: "2026-09-14", to: "2026-10-13" });
    expect(parseRange("2026-10-01", "2026-09-01", now)).toEqual({ from: "2026-10-01", to: "2026-10-01" });
    expect(parseRange("bad", undefined, now)).toEqual({ from: "2026-09-14", to: "2026-10-13" });
  });
});

describe("movements", () => {
  it("lists overlapping allocations with arrivals, departures and masking, and exports with audit", async () => {
    const r = await movementReport(all, { siteId, range });
    expect(r.rows.map((x) => x.bed).sort()).toEqual(["RS-1", "RS-2"]);
    expect(r.summary).toMatchObject({ allocations: 2, arrivals: 2, departures: 1, transfers: 0 });
    expect(r.rows.find((x) => x.bed === "RS-1")?.person).toContain("Ada Suite");
    const m = await movementReport(masked, { siteId, range, status: "CHECKED_IN" });
    expect(m.rows).toHaveLength(1);
    expect(m.rows[0].person).toBe(`RS-B-${stamp}`);
    expect((await movementReport(all, { siteId, range: { from: plus(-1), to: plus(1) } })).rows.map((x) => x.bed)).toEqual(["RS-2"]);
    expect((await movementReport(all, { siteId, buildingId: "nope", range })).rows).toHaveLength(0);
    expect((await movementReport({ siteIds: [otherSiteId], canSeeNames: true }, { range })).rows).toHaveLength(0);
    const csv = await movementCsv(masked, { siteId, range }, actorId);
    expect(csv.split("\r\n")[0]).toContain("Checked in (UTC)");
    expect(csv).not.toContain("Ada");
    expect(await prisma.auditEvent.findFirst({ where: { action: "REPORT_EXPORTED", entityId: "movements", actorId } })).not.toBeNull();
  });
});

describe("maintenance", () => {
  it("reports backlog, overdue, resolution times, SLA and workload, with category and site filters", async () => {
    const r = await maintenanceReport(all, { siteId, range: { from: plus(-7), to: plus(0) } });
    expect(r.backlogByStatus).toEqual(expect.arrayContaining([{ status: "NEW", count: 1 }, { status: "ASSIGNED", count: 1 }]));
    expect(r.overdue).toBe(1);
    expect(r.backlogByPriority.find((p) => p.priority === "URGENT")).toEqual({ priority: "URGENT", count: 1, overdue: 1 });
    expect(r.resolution.resolved).toBe(2);
    expect(r.resolution.meanHours).toBe(19);
    expect(r.resolution.medianHours).toBe(19);
    expect(r.resolution.slaMet).toBe(1);
    expect(r.resolution.slaMetPercent).toBe(50);
    const eng = r.workload.find((w) => w.who === "Report Engineer")!;
    expect(eng).toMatchObject({ kind: "assignee", open: 1, overdue: 1, resolvedInRange: 2 });
    expect(r.categories.find((c) => c.category === "Electrical")).toEqual({ category: "Electrical", created: 2, open: 1 });
    expect(r.rows.map((x) => x.ticketNumber)).not.toContain(`RS-${stamp}-5`);
    const el = await maintenanceReport(all, { siteId, category: "Electrical", range: { from: plus(-7), to: plus(0) } });
    expect(el.rows).toHaveLength(2);
    expect(el.overdue).toBe(0);
    const scoped = await maintenanceReport({ siteIds: [otherSiteId], canSeeNames: true }, { range: { from: plus(-7), to: plus(0) } });
    expect(scoped.rows.map((x) => x.ticketNumber)).toEqual([`RS-${stamp}-5`]);
    const csv = await maintenanceCsv(all, { siteId, range: { from: plus(-7), to: plus(0) } }, actorId);
    expect(csv).toContain(`RS-${stamp}-1,`);
    expect(csv.split("\r\n")[0]).toContain("SLA met");
  });
});

describe("facilities and keys", () => {
  it("reports facility bookings, no-shows and utilisation over the facility's calendar days", async () => {
    const [row] = await facilityReport(all, { siteId, range: { from: plus(-3), to: plus(0) } });
    expect(row).toMatchObject({ name: "Suite Gym", bookings: 2, attended: 1, noShows: 1, people: 2, bookedHours: 2, openHours: 64 });
    expect(row.utilisation).toBe(Math.round((2 / (64 * 4)) * 100));
    expect(await facilityReport(all, { siteId, range: { from: plus(-30), to: plus(-10) } })).toEqual([expect.objectContaining({ bookings: 0, utilisation: 0 })]);
  });
  it("reports the key register, outstanding and overdue keys with masked holders, and transactions in range", async () => {
    const r = await keyReport(all, { siteId, range });
    expect(r.register).toEqual([expect.objectContaining({ site: "Suite Site", total: 4, available: 1, issued: 2, overdue: 1, lost: 1 })]);
    expect(r.outstanding.map((o) => o.overdue)).toEqual([true, false]);
    expect(r.outstanding[0].holder).toContain("Bob Suite");
    expect(r.outstanding[1].holder).toBe("Contractor Jim");
    expect(r.transactions.ISSUE).toBe(2);
    const m = await keyReport(masked, { siteId, range, status: "ISSUED" });
    expect(m.outstanding[0].holder).toBe(`RS-B-${stamp}`);
    expect((await keyReport(all, { siteId, range: { from: plus(-1), to: plus(0) } })).transactions.ISSUE).toBe(1);
    const csv = await keyCsv(masked, { siteId, range }, actorId);
    expect(csv).toContain(`RSK1-${stamp}`);
    expect(csv).not.toContain("Bob");
  });
});
