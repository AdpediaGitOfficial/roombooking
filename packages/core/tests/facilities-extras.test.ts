import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Role } from "@prisma/client";
import { prisma } from "../src/lib/db";
import type { ActorLike } from "../src/lib/permissions/actor";
import { FacilityError } from "../src/modules/facilities/errors";
import { availabilityForDay, cancelBooking, createBooking, facilityInclude, recordAttendance, type Actor } from "../src/modules/facilities/service";
import { acceptWaitlistOffer, blockSlots, blockedResidents, closeFacility, joinWaitlist, liftNoShowBlock, reopenFacility, sweepWaitlist, updateFacilityPolicy, whoBooked } from "../src/modules/facilities/extras";

const stamp = Date.now().toString(36);
let orgId: string, siteId: string, facilityId: string;
const A: Record<string, ActorLike> = {};
const F: Record<string, Actor> = {};
const day = (n: number) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);
async function mk(key: string, roles: Role[], sets: string[] = [], profile?: { grade?: string }) {
  const u = await prisma.user.create({ data: { organizationId: orgId, email: `fx-${key}-${stamp}@example.com`, name: `${key} User`, status: "ACTIVE", username: `fx_${key}_${stamp}` } });
  for (const role of roles) await prisma.roleAssignment.create({ data: { userId: u.id, role } });
  if (profile || roles.includes("STAFF")) await prisma.staffProfile.create({ data: { organizationId: orgId, employeeId: `FX-${key}-${stamp}`, firstName: key, lastName: "Res", userId: u.id, grade: profile?.grade, verificationStatus: "VERIFIED" } });
  A[key] = { id: u.id, roles, grants: sets.map((capabilitySet) => ({ capabilitySet, userId: u.id })) };
  F[key] = { id: u.id, isManager: roles.includes("ACCOMMODATION_ADMIN"), isOperator: roles.some((r) => r === "ACCOMMODATION_ADMIN" || r === "ACCOMMODATION_OFFICER") };
  return u;
}
async function expectRule<T>(p: Promise<T>, text?: RegExp) {
  try { await p; } catch (e) { expect(e).toBeInstanceOf(FacilityError); if (text) expect((e as Error).message).toMatch(text); return; }
  throw new Error("expected FacilityError");
}
const book = (who: string, date: string, time = "10:00", mins = 60) => createBooking({ facilityId, userId: A[who].id, actor: F[who], date, startTime: time, durationMinutes: mins, headcount: 1 });

beforeAll(async () => {
  const org = await prisma.organization.upsert({ where: { code: "TEST" }, update: {}, create: { code: "TEST", name: "Test Org" } });
  orgId = org.id;
  siteId = (await prisma.site.create({ data: { organizationId: orgId, code: `FX${stamp}`.slice(0, 12), name: "FX Site", timezone: "UTC" } })).id;
  const open = Object.fromEntries(["mon", "tue", "wed", "thu", "fri", "sat", "sun"].map((d) => [d, { open: "08:00", close: "20:00" }]));
  facilityId = (await prisma.facility.create({ data: { siteId, code: `GYM${stamp}`.slice(0, 20), name: "FX Gym", capacity: 1, openingHours: open, bookingRules: { advanceDays: 30, maxActivePerUser: 10, maxPerDayPerUser: 5, cancellationCutoffMinutes: 0 } } })).id;
  await mk("admin", ["ACCOMMODATION_ADMIN"]);
  await mk("coord", ["MAINTENANCE_COORDINATOR"]);
  await mk("officer", ["ACCOMMODATION_OFFICER"]);
  await mk("fm", ["ACCOMMODATION_OFFICER"], ["FACILITY_MANAGER"]);
  await mk("r1", ["STAFF"], [], { grade: "G1" });
  await mk("r2", ["STAFF"], [], { grade: "G2" });
  await mk("r3", ["STAFF"], [], { grade: "G1" });
});
afterAll(async () => { await prisma.$disconnect(); });

describe("closures and blocks", () => {
  it("stops booking in a closure, cancels what was booked and shows the slot as shut", async () => {
    const date = day(3);
    const b = (await book("r1", date, "10:00")).booking;
    await expectRule(closeFacility(A.officer, { facilityId, startsAt: `${date}T09:00:00Z`, endsAt: `${date}T12:00:00Z`, reason: "AC repair" }));
    const { closure, cancelled } = await closeFacility(A.coord, { facilityId, startsAt: `${date}T09:00:00Z`, endsAt: `${date}T12:00:00Z`, reason: "AC repair" });
    expect(cancelled).toBe(1);
    expect((await prisma.facilityBooking.findUniqueOrThrow({ where: { id: b.id } })).status).toBe("CANCELLED");
    await expectRule(book("r2", date, "11:00"), /not available/);
    const f = await prisma.facility.findUniqueOrThrow({ where: { id: facilityId }, include: facilityInclude });
    const slots = await availabilityForDay(f, date);
    expect(slots.find((s) => s.label === "10:00")!.open).toBe(false);
    expect(slots.find((s) => s.label === "13:00")!.open).toBe(true);
    await reopenFacility(A.coord, closure.id);
    await book("r2", date, "11:00");
  });

  it("blocks single slots, events and recurring reservations for a facility manager", async () => {
    await expectRule(blockSlots(A.officer, { facilityId, type: "BLOCK", title: "x", startsAt: `${day(4)}T08:00:00Z`, endsAt: `${day(4)}T09:00:00Z` }));
    await blockSlots(A.fm, { facilityId, type: "EVENT", title: "Cricket night", startsAt: `${day(4)}T15:00:00Z`, endsAt: `${day(4)}T17:00:00Z` });
    await expectRule(book("r1", day(4), "16:00"), /Cricket night/);
    const wd = ((new Date(`${day(6)}T12:00:00Z`).getUTCDay() + 6) % 7) + 1;
    await blockSlots(A.admin, { facilityId, type: "RECURRING", title: "Coaching", weekdays: [wd], from: "18:00", to: "19:00", until: day(40) });
    await expectRule(book("r1", day(6), "18:00"), /Coaching/);
    await book("r1", day(6), "17:00");
  });
});

describe("eligibility, no-shows and fees", () => {
  it("limits a facility to eligible grades", async () => {
    await expectRule(updateFacilityPolicy(A.officer, facilityId, { grades: ["G1"] }));
    await updateFacilityPolicy(A.fm, facilityId, { grades: ["G1"], feePerHour: 20, noShowLimit: 2 });
    await expectRule(book("r2", day(8), "10:00"), /not eligible/);
    await book("r1", day(8), "10:00");
  });

  it("pauses booking after the no-show limit until a manager lifts the block, and charges a fee for attended bookings", async () => {
    const past = async (who: string, hoursAgo: number) => {
      const start = new Date(Date.now() - hoursAgo * 3600000); start.setUTCMinutes(0, 0, 0);
      return prisma.facilityBooking.create({ data: { facilityId, userId: A[who].id, startsAt: start, endsAt: new Date(start.getTime() + 3600000), headcount: 1, status: "CONFIRMED" } });
    };
    const b1 = await past("r3", 5), b2 = await past("r3", 3);
    await recordAttendance({ bookingId: b1.id, actor: F.officer, attended: false });
    expect(await prisma.notification.count({ where: { recipientId: A.r3.id, event: "booking.no_show", channel: "IN_APP" } })).toBe(1);
    await recordAttendance({ bookingId: b2.id, actor: F.officer, attended: false });
    await expectRule(book("r3", day(9), "10:00"), /paused/);
    expect((await blockedResidents([siteId])).some((x) => x.userId === A.r3.id && x.blocked)).toBe(true);
    await expect(liftNoShowBlock(A.officer, A.r3.id, facilityId)).rejects.toBeInstanceOf(FacilityError);
    expect(await liftNoShowBlock(A.fm, A.r3.id, facilityId)).toBe(2);
    await book("r3", day(9), "10:00");
    // Attended booking at a facility with a fee raises a charge for approval.
    const used = await past("r3", 1);
    await recordAttendance({ bookingId: used.id, actor: F.officer, attended: true });
    const charge = await prisma.charge.findFirstOrThrow({ where: { sourceType: "FacilityBooking", sourceId: used.id } });
    expect(charge.kind).toBe("FACILITY_FEE");
    expect(Number(charge.amount)).toBe(20);
    expect(charge.status).toBe("PENDING_APPROVAL");
  });
});

describe("waitlist and who booked", () => {
  it("offers a cancelled slot to the first person waiting and lets them accept it", async () => {
    await prisma.facility.update({ where: { id: facilityId }, data: { eligibility: {}, noShowLimit: 0 } });
    const date = day(12);
    const held = (await book("r1", date, "14:00")).booking;
    await expectRule(book("r3", date, "14:00"), /fully booked/);
    const w = await joinWaitlist(A.r3.id, { facilityId, date, startTime: "14:00", durationMinutes: 60, headcount: 1 });
    await expectRule(joinWaitlist(A.r3.id, { facilityId, date, startTime: "14:00", durationMinutes: 60, headcount: 1 }), /already on the waitlist/);
    await cancelBooking({ bookingId: held.id, actor: F.r1 });
    expect((await prisma.bookingWaitlist.findUniqueOrThrow({ where: { id: w.id } })).status).toBe("OFFERED");
    const taken = await acceptWaitlistOffer(A.r3.id, w.id);
    expect(taken.status).toBe("CONFIRMED");
    expect((await prisma.bookingWaitlist.findUniqueOrThrow({ where: { id: w.id } })).bookingId).toBe(taken.id);
    // An offer nobody answers expires.
    const w2 = await prisma.bookingWaitlist.create({ data: { facilityId, userId: A.r2.id, startsAt: new Date(Date.now() + 86400000), endsAt: new Date(Date.now() + 90000000), status: "OFFERED", offeredAt: new Date(Date.now() - 3 * 3600000) } });
    await sweepWaitlist();
    expect((await prisma.bookingWaitlist.findUniqueOrThrow({ where: { id: w2.id } })).status).toBe("EXPIRED");
  });

  it("shows names to staff and only 'Booked' to residents", async () => {
    const date = day(12);
    expect((await whoBooked(A.officer, facilityId, date)).some((b) => b.who.includes("r3"))).toBe(true);
    expect((await whoBooked(A.r1, facilityId, date)).every((b) => b.who === "Booked")).toBe(true);
  });
});
