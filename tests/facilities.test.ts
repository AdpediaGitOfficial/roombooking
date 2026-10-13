import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { addDaysIso, zonedDateTime, zonedToUtc } from "@/lib/time";
import { FacilityError } from "@/modules/facilities/errors";
import { describeHours, parseOpeningHours, parseRules, validateHoursInput, validateRulesInput } from "@/modules/facilities/rules";
import { amendBooking, availabilityForDay, cancelBooking, createBooking, decideBooking, facilityReports, getFacility, heldDuring, recordAttendance, sweepBookings, updateFacility, type Actor } from "@/modules/facilities/service";

const TZ = "Asia/Dubai";
let siteId: string;
let gymId: string;
let hallId: string;
const users: Record<string, string> = {};
const resident = (id: string): Actor => ({ id, isManager: false, isOperator: false });
const manager = (id: string): Actor => ({ id, isManager: true, isOperator: true });
// A fixed "now": Tuesday 2026-10-13 08:00 Dubai (04:00 UTC).
const NOW = new Date("2026-10-13T04:00:00.000Z");
const TODAY = "2026-10-13";

async function expectError<T>(p: Promise<T>, code: string) {
  try { await p; } catch (e) {
    expect(e).toBeInstanceOf(FacilityError);
    expect((e as FacilityError).code).toBe(code);
    return e as FacilityError;
  }
  throw new Error(`expected FacilityError ${code}`);
}

beforeAll(async () => {
  const org = await prisma.organization.upsert({ where: { code: "TEST" }, update: {}, create: { code: "TEST", name: "Test Org" } });
  const site = await prisma.site.upsert({ where: { organizationId_code: { organizationId: org.id, code: "FAC" } }, update: { timezone: TZ }, create: { organizationId: org.id, code: "FAC", name: "Facility Site", timezone: TZ } });
  siteId = site.id;
  for (const key of ["a", "b", "c", "m"]) {
    users[key] = (await prisma.user.upsert({ where: { email: `fac-${key}@example.com` }, update: { status: "ACTIVE" }, create: { organizationId: org.id, email: `fac-${key}@example.com`, name: `Fac ${key.toUpperCase()}`, status: "ACTIVE" } })).id;
  }
  const hours = Object.fromEntries(["mon", "tue", "wed", "thu", "fri", "sat", "sun"].map((d) => [d, d === "fri" ? null : { open: "06:00", close: "22:00" }]));
  const gym = await prisma.facility.upsert({ where: { siteId_code: { siteId, code: "FAC-GYM" } }, update: { capacity: 2, requiresApproval: false, status: "ACTIVE", openingHours: hours, bookingRules: { slotMinutes: 30, minDurationMinutes: 30, maxDurationMinutes: 90, advanceDays: 7, bufferMinutes: 15, cancellationCutoffMinutes: 120, maxActivePerUser: 2, maxPerDayPerUser: 1 } }, create: { siteId, code: "FAC-GYM", name: "Test Gym", capacity: 2, openingHours: hours, bookingRules: { slotMinutes: 30, minDurationMinutes: 30, maxDurationMinutes: 90, advanceDays: 7, bufferMinutes: 15, cancellationCutoffMinutes: 120, maxActivePerUser: 2, maxPerDayPerUser: 1 } } });
  gymId = gym.id;
  const hall = await prisma.facility.upsert({ where: { siteId_code: { siteId, code: "FAC-HALL" } }, update: { capacity: 1, requiresApproval: true, status: "ACTIVE", openingHours: hours, bookingRules: {} }, create: { siteId, code: "FAC-HALL", name: "Test Hall", capacity: 1, requiresApproval: true, openingHours: hours, bookingRules: {} } });
  hallId = hall.id;
  await prisma.facilityBooking.deleteMany({ where: { facilityId: { in: [gymId, hallId] } } });
});

afterAll(async () => { await prisma.$disconnect(); });

describe("time helpers", () => {
  it("converts local wall clock to UTC and back, including across DST", () => {
    expect(zonedToUtc("2026-10-13", "08:00", "Asia/Dubai").toISOString()).toBe("2026-10-13T04:00:00.000Z");
    expect(zonedDateTime(new Date("2026-10-13T04:00:00.000Z"), "Asia/Dubai")).toEqual({ date: "2026-10-13", time: "08:00", weekday: "tue" });
    // London: BST (+1) on 2026-10-20, GMT (+0) on 2026-10-27.
    expect(zonedToUtc("2026-10-20", "09:00", "Europe/London").toISOString()).toBe("2026-10-20T08:00:00.000Z");
    expect(zonedToUtc("2026-10-27", "09:00", "Europe/London").toISOString()).toBe("2026-10-27T09:00:00.000Z");
    expect(addDaysIso("2026-10-31", 1)).toBe("2026-11-01");
  });
});

describe("rules and hours", () => {
  it("parses legacy and per-day hours, applies rule defaults and validates inputs", () => {
    const legacy = parseOpeningHours({ mon_sun: ["07:00", "21:00"] });
    expect(legacy.mon).toEqual({ open: "07:00", close: "21:00" });
    const perDay = parseOpeningHours({ fri: null, sat: { open: "08:00", close: "12:00" } });
    expect(perDay.fri).toBeNull();
    expect(perDay.sat).toEqual({ open: "08:00", close: "12:00" });
    expect(perDay.mon).toEqual({ open: "06:00", close: "22:00" });
    expect(describeHours(perDay)).toBe("Mon–Thu 06:00–22:00, Fri closed, Sat 08:00–12:00, Sun 06:00–22:00");
    expect(parseRules({ slotMinutes: "15", maxActivePerUser: -1 })).toMatchObject({ slotMinutes: 15, maxActivePerUser: 3 });
    expect(validateRulesInput({ slotMinutes: "3" }).errors.slotMinutes).toBeDefined();
    expect(validateRulesInput({ minDurationMinutes: "90", maxDurationMinutes: "60" }).errors.maxDurationMinutes).toBeDefined();
    expect(validateHoursInput({ mon_open: "09:00", mon_close: "08:00" }).errors.mon).toBeDefined();
    expect(validateHoursInput({ mon_closed: "on" }).hours.mon).toBeNull();
  });

  it("counts held headcount with the buffer applied", () => {
    const bookings = [{ id: "x", startsAt: new Date("2026-10-13T06:00:00Z"), endsAt: new Date("2026-10-13T07:00:00Z"), headcount: 1, status: "CONFIRMED" as const }];
    expect(heldDuring(bookings, new Date("2026-10-13T07:00:00Z"), new Date("2026-10-13T07:30:00Z"), 0)).toBe(0);
    expect(heldDuring(bookings, new Date("2026-10-13T07:00:00Z"), new Date("2026-10-13T07:30:00Z"), 15)).toBe(1);
    expect(heldDuring(bookings, new Date("2026-10-13T07:00:00Z"), new Date("2026-10-13T07:30:00Z"), 15, "x")).toBe(0);
  });
});

describe("booking", () => {
  it("shows availability by slot in the site's local day and respects closed days", async () => {
    const gym = (await getFacility(gymId))!;
    const slots = await availabilityForDay(gym, TODAY, NOW);
    expect(slots[0].label).toBe("06:00");
    expect(slots[slots.length - 1].label).toBe("21:30");
    expect(slots.find((s) => s.label === "07:30")?.past).toBe(true);
    expect(slots.find((s) => s.label === "08:00")?.past).toBe(false);
    expect(slots.every((s) => s.remaining === 2)).toBe(true);
    expect(await availabilityForDay(gym, "2026-10-16", NOW)).toEqual([]); // Friday closed
  });

  it("enforces hours, duration, advance window, slot alignment and the past", async () => {
    const base = { facilityId: gymId, userId: users.a, actor: resident(users.a), headcount: 1, now: NOW };
    await expectError(createBooking({ ...base, date: TODAY, startTime: "05:00", durationMinutes: 30 }), "RULE");
    await expectError(createBooking({ ...base, date: TODAY, startTime: "21:45", durationMinutes: 30 }), "RULE");
    await expectError(createBooking({ ...base, date: TODAY, startTime: "09:10", durationMinutes: 30 }), "RULE");
    await expectError(createBooking({ ...base, date: TODAY, startTime: "09:00", durationMinutes: 120 }), "RULE");
    await expectError(createBooking({ ...base, date: TODAY, startTime: "07:00", durationMinutes: 30 }), "RULE");
    await expectError(createBooking({ ...base, date: addDaysIso(TODAY, 8), startTime: "09:00", durationMinutes: 30 }), "RULE");
    await expectError(createBooking({ ...base, date: "2026-10-16", startTime: "09:00", durationMinutes: 30 }), "RULE");
    await expectError(createBooking({ ...base, date: TODAY, startTime: "09:00", durationMinutes: 30, headcount: 3 }), "RULE");
  });

  it("confirms a valid booking, is idempotent, and enforces per-user limits", async () => {
    const { booking, duplicate } = await createBooking({ facilityId: gymId, userId: users.a, actor: resident(users.a), date: TODAY, startTime: "09:00", durationMinutes: 60, headcount: 1, idempotencyKey: "fac-a-1", now: NOW });
    expect(duplicate).toBe(false);
    expect(booking.status).toBe("CONFIRMED");
    expect(booking.startsAt.toISOString()).toBe("2026-10-13T05:00:00.000Z");
    const again = await createBooking({ facilityId: gymId, userId: users.a, actor: resident(users.a), date: TODAY, startTime: "09:00", durationMinutes: 60, headcount: 1, idempotencyKey: "fac-a-1", now: NOW });
    expect(again.duplicate).toBe(true);
    expect(again.booking.id).toBe(booking.id);
    // One per day
    await expectError(createBooking({ facilityId: gymId, userId: users.a, actor: resident(users.a), date: TODAY, startTime: "15:00", durationMinutes: 30, headcount: 1, now: NOW }), "RULE");
    // Second active on another day is fine; a third active is not
    await createBooking({ facilityId: gymId, userId: users.a, actor: resident(users.a), date: addDaysIso(TODAY, 1), startTime: "09:00", durationMinutes: 30, headcount: 1, now: NOW });
    await expectError(createBooking({ facilityId: gymId, userId: users.a, actor: resident(users.a), date: addDaysIso(TODAY, 2), startTime: "09:00", durationMinutes: 30, headcount: 1, now: NOW }), "RULE");
    expect(await prisma.notification.findFirst({ where: { recipientId: users.a, event: "booking.confirmed", idempotencyKey: `booking.created:${booking.id}` } })).not.toBeNull();
  });

  it("checks capacity by headcount including the buffer, and lets only one of two concurrent bookings take the last place", async () => {
    // Gym holds 2; A holds 1 at 09:00-10:00 (buffer 15 min → blocks until 10:15)
    await expectError(createBooking({ facilityId: gymId, userId: users.b, actor: resident(users.b), date: TODAY, startTime: "09:30", durationMinutes: 30, headcount: 2, now: NOW }), "CAPACITY");
    await expectError(createBooking({ facilityId: gymId, userId: users.b, actor: resident(users.b), date: TODAY, startTime: "10:00", durationMinutes: 30, headcount: 2, now: NOW }), "CAPACITY");
    const gym = (await getFacility(gymId))!;
    const slots = await availabilityForDay(gym, TODAY, NOW);
    expect(slots.find((s) => s.label === "09:30")?.remaining).toBe(1);
    expect(slots.find((s) => s.label === "10:00")?.remaining).toBe(1);
    expect(slots.find((s) => s.label === "10:30")?.remaining).toBe(2);
    const results = await Promise.allSettled([
      createBooking({ facilityId: gymId, userId: users.b, actor: resident(users.b), date: TODAY, startTime: "09:30", durationMinutes: 30, headcount: 1, now: NOW }),
      createBooking({ facilityId: gymId, userId: users.c, actor: resident(users.c), date: TODAY, startTime: "09:30", durationMinutes: 30, headcount: 1, now: NOW }),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const rejected = results.find((r) => r.status === "rejected") as PromiseRejectedResult;
    expect((rejected.reason as FacilityError).code).toBe("CAPACITY");
  });

  it("applies the cancellation cut-off to bookers but not managers, who must give a reason", async () => {
    const b = await prisma.facilityBooking.findFirstOrThrow({ where: { facilityId: gymId, userId: users.a, startsAt: new Date("2026-10-13T05:00:00.000Z") } });
    // 09:00 booking, cutoff 120 min: at 07:30 local it is too late
    await expectError(cancelBooking({ bookingId: b.id, actor: resident(users.a), now: new Date("2026-10-13T03:30:00.000Z") }), "RULE");
    await expectError(cancelBooking({ bookingId: b.id, actor: resident(users.b), now: NOW }), "FORBIDDEN");
    await expectError(cancelBooking({ bookingId: b.id, actor: manager(users.m), now: NOW }), "VALIDATION");
    const cancelled = await cancelBooking({ bookingId: b.id, actor: manager(users.m), reason: "Maintenance of the equipment", now: NOW });
    expect(cancelled.status).toBe("CANCELLED");
    expect(await prisma.notification.findFirst({ where: { recipientId: users.a, event: "booking.cancelled" } })).not.toBeNull();
    // Booker cancelling early is fine
    const tomorrow = await prisma.facilityBooking.findFirstOrThrow({ where: { facilityId: gymId, userId: users.a, status: "CONFIRMED" } });
    expect((await cancelBooking({ bookingId: tomorrow.id, actor: resident(users.a), now: NOW })).cancelReason).toBe("Cancelled by booker");
  });

  it("amends a booking under the same rules without counting itself against capacity", async () => {
    // Thursday (Friday is closed)
    const day = addDaysIso(TODAY, 2);
    const { booking } = await createBooking({ facilityId: gymId, userId: users.a, actor: resident(users.a), date: day, startTime: "09:00", durationMinutes: 60, headcount: 2, now: NOW });
    const moved = await amendBooking({ bookingId: booking.id, actor: resident(users.a), date: day, startTime: "09:30", durationMinutes: 60, headcount: 2, now: NOW });
    expect(moved.startsAt.toISOString()).toBe(`${day}T05:30:00.000Z`);
    await expectError(amendBooking({ bookingId: booking.id, actor: resident(users.b), date: day, startTime: "10:00", durationMinutes: 60, headcount: 1, now: NOW }), "FORBIDDEN");
  });

  it("routes approval-required facilities through pending, approve/reject, and expires stale requests", async () => {
    const { booking } = await createBooking({ facilityId: hallId, userId: users.b, actor: resident(users.b), date: addDaysIso(TODAY, 1), startTime: "10:00", durationMinutes: 60, headcount: 1, now: NOW });
    expect(booking.status).toBe("PENDING_APPROVAL");
    await expectError(decideBooking({ bookingId: booking.id, actor: resident(users.b), approve: true, now: NOW }), "FORBIDDEN");
    await expectError(decideBooking({ bookingId: booking.id, actor: manager(users.m), approve: false, now: NOW }), "VALIDATION");
    // Pending holds the single place: another request for the same slot is refused
    await expectError(createBooking({ facilityId: hallId, userId: users.c, actor: resident(users.c), date: addDaysIso(TODAY, 1), startTime: "10:30", durationMinutes: 30, headcount: 1, now: NOW }), "CAPACITY");
    const approved = await decideBooking({ bookingId: booking.id, actor: manager(users.m), approve: true, now: NOW });
    expect(approved.status).toBe("CONFIRMED");
    const late = await createBooking({ facilityId: hallId, userId: users.c, actor: resident(users.c), date: TODAY, startTime: "09:00", durationMinutes: 30, headcount: 1, now: NOW });
    const swept = await sweepBookings(new Date("2026-10-13T05:30:00.000Z"));
    expect(swept.expired).toBeGreaterThanOrEqual(1);
    expect((await prisma.facilityBooking.findUniqueOrThrow({ where: { id: late.booking.id } })).status).toBe("EXPIRED");
  });

  it("records attendance only after the start, and the sweep completes used bookings", async () => {
    const b = await prisma.facilityBooking.findFirstOrThrow({ where: { facilityId: gymId, status: "CONFIRMED", startsAt: new Date("2026-10-13T05:30:00.000Z") } });
    await expectError(recordAttendance({ bookingId: b.id, actor: manager(users.m), attended: true, now: NOW }), "INVALID_STATE");
    await expectError(recordAttendance({ bookingId: b.id, actor: resident(users.b), attended: true, now: new Date("2026-10-13T05:35:00.000Z") }), "FORBIDDEN");
    const used = await recordAttendance({ bookingId: b.id, actor: manager(users.m), attended: true, now: new Date("2026-10-13T05:35:00.000Z") });
    expect(used.status).toBe("CHECKED_IN");
    const swept = await sweepBookings(new Date("2026-10-13T06:30:00.000Z"));
    expect(swept.completed).toBeGreaterThanOrEqual(1);
    expect((await prisma.facilityBooking.findUniqueOrThrow({ where: { id: b.id } })).status).toBe("COMPLETED");
  });

  it("updates configuration with audit and reports utilisation, cancellations and no-shows", async () => {
    const gym = (await getFacility(gymId))!;
    const { hours, rules } = { hours: parseOpeningHours(gym.openingHours), rules: parseRules(gym.bookingRules) };
    await expectError(updateFacility({ facilityId: gymId, actorId: users.m, name: "", location: null, description: null, capacity: 2, requiresApproval: false, status: "ACTIVE", hours, rules }), "VALIDATION");
    await updateFacility({ facilityId: gymId, actorId: users.m, name: "Test Gym", location: "Block A ground floor", description: "Cardio and weights", capacity: 2, requiresApproval: false, status: "ACTIVE", hours, rules: { ...rules, maxActivePerUser: 5 } });
    expect(parseRules((await getFacility(gymId))!.bookingRules).maxActivePerUser).toBe(5);
    const reports = await facilityReports(30, new Date("2026-10-20T00:00:00.000Z"), siteId);
    const gymReport = reports.find((r) => r.facilityId === gymId)!;
    expect(gymReport.bookings).toBeGreaterThanOrEqual(3);
    expect(gymReport.cancelled).toBeGreaterThanOrEqual(2);
    expect(gymReport.attended).toBeGreaterThanOrEqual(1);
    expect(gymReport.openHours).toBeGreaterThan(0);
    expect(gymReport.utilisation).toBeGreaterThanOrEqual(0);
  });
});
