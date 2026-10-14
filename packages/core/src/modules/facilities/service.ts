// Facility booking (SRS 5.5, 6.5, 8.4). Capacity is checked under a row lock
// on the facility so concurrent requests for the last place cannot both win.
import type { BookingStatus, Prisma, PrismaClient } from "@prisma/client";
import { prisma } from "../../lib/db";
import { recordAudit } from "../../lib/audit";
import { enqueueNotification } from "../../lib/notifications";
import { addDaysIso, addMinutes, minutesOfDay, zonedDateTime, zonedToUtc, type DayKey } from "../../lib/time";
import { FacilityError } from "./errors";
import { bookingInclude, facilityConfig, facilityInclude, validateHoursInput, validateRulesInput, type Actor, type BookingRules, type FacilityRecord, type OpeningHours, type Slot } from "./rules";

export * from "./rules";

type Tx = Prisma.TransactionClient;
type Db = Tx | PrismaClient;

/** Bookings that hold capacity (pending approvals hold their place until decided). */
export const HOLDING_STATUSES: BookingStatus[] = ["PENDING_APPROVAL", "CONFIRMED", "CHECKED_IN"];

// ---------------------------------------------------------------------------
// Availability (FAC-02, FAC-04)
// ---------------------------------------------------------------------------


/** Headcount already held during [start, end) including the buffer around each existing booking. */
export function heldDuring(bookings: Array<{ startsAt: Date; endsAt: Date; headcount: number; status: BookingStatus; id?: string }>, start: Date, end: Date, bufferMinutes: number, excludeId?: string | null): number {
  let total = 0;
  for (const b of bookings) {
    if (!HOLDING_STATUSES.includes(b.status) || (excludeId && b.id === excludeId)) continue;
    const bStart = addMinutes(b.startsAt, -bufferMinutes);
    const bEnd = addMinutes(b.endsAt, bufferMinutes);
    if (bStart < end && start < bEnd) total += b.headcount;
  }
  return total;
}

export async function availabilityForDay(facility: FacilityRecord, date: string, now: Date = new Date(), db: Db = prisma): Promise<Slot[]> {
  const { hours, rules } = facilityConfig(facility);
  const tz = facility.site.timezone;
  const weekday = zonedDateTime(zonedToUtc(date, "12:00", tz), tz).weekday;
  const dayHours = hours[weekday];
  const dayStart = zonedToUtc(date, "00:00", tz);
  const dayEnd = zonedToUtc(addDaysIso(date, 1), "00:00", tz);
  const bookings = await db.facilityBooking.findMany({
    where: { facilityId: facility.id, status: { in: HOLDING_STATUSES }, startsAt: { lt: addMinutes(dayEnd, rules.bufferMinutes) }, endsAt: { gt: addMinutes(dayStart, -rules.bufferMinutes) } },
    select: { id: true, startsAt: true, endsAt: true, headcount: true, status: true },
  });
  const slots: Slot[] = [];
  if (!dayHours) return slots;
  for (let m = minutesOfDay(dayHours.open); m + rules.slotMinutes <= minutesOfDay(dayHours.close); m += rules.slotMinutes) {
    const time = `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
    const start = zonedToUtc(date, time, tz);
    const end = addMinutes(start, rules.slotMinutes);
    const booked = heldDuring(bookings, start, end, rules.bufferMinutes);
    slots.push({ start, end, label: time, open: true, booked, remaining: Math.max(0, facility.capacity - booked), past: end <= now });
  }
  return slots;
}

// ---------------------------------------------------------------------------
// Validation of a requested booking against hours and rules (FAC-05)
// ---------------------------------------------------------------------------

type Window = { startsAt: Date; endsAt: Date };

function assertWithinRules(facility: FacilityRecord, w: Window, headcount: number, now: Date) {
  const { hours, rules } = facilityConfig(facility);
  const tz = facility.site.timezone;
  const duration = (w.endsAt.getTime() - w.startsAt.getTime()) / 60000;
  const errors: Record<string, string> = {};
  if (!Number.isInteger(headcount) || headcount < 1) errors.headcount = "Headcount must be at least 1.";
  if (headcount > facility.capacity) errors.headcount = `This facility holds at most ${facility.capacity}.`;
  if (w.startsAt < now) errors.startTime = "That time has already passed.";
  if (duration < rules.minDurationMinutes) errors.durationMinutes = `Minimum booking is ${rules.minDurationMinutes} minutes.`;
  if (duration > rules.maxDurationMinutes) errors.durationMinutes = `Maximum booking is ${rules.maxDurationMinutes} minutes.`;
  const latest = addMinutes(now, rules.advanceDays * 24 * 60);
  if (w.startsAt > latest) errors.date = `Bookings can be made up to ${rules.advanceDays} days ahead.`;
  const local = zonedDateTime(w.startsAt, tz);
  const localEnd = zonedDateTime(addMinutes(w.endsAt, -1), tz);
  const dayHours = hours[local.weekday as DayKey];
  if (!dayHours) errors.date = `${facility.name} is closed on that day.`;
  else if (local.date !== localEnd.date || local.time < dayHours.open || zonedDateTime(w.endsAt, tz).time > dayHours.close && localEnd.date === local.date && zonedDateTime(w.endsAt, tz).time !== "00:00") {
    errors.startTime = `Open ${dayHours.open}–${dayHours.close} on that day.`;
  }
  if (minutesOfDay(local.time) % rules.slotMinutes !== 0) errors.startTime = `Start times are every ${rules.slotMinutes} minutes.`;
  if (Object.keys(errors).length) throw new FacilityError("RULE", Object.values(errors)[0], errors);
}

async function assertUserLimits(tx: Tx, facility: FacilityRecord, userId: string, w: Window, now: Date, excludeId?: string | null) {
  const { rules } = facilityConfig(facility);
  const tz = facility.site.timezone;
  const active = await tx.facilityBooking.count({ where: { facilityId: facility.id, userId, status: { in: HOLDING_STATUSES }, endsAt: { gt: now }, ...(excludeId ? { id: { not: excludeId } } : {}) } });
  if (rules.maxActivePerUser > 0 && active >= rules.maxActivePerUser) throw new FacilityError("RULE", `You already have ${active} upcoming booking${active === 1 ? "" : "s"} for ${facility.name} (limit ${rules.maxActivePerUser}).`);
  const date = zonedDateTime(w.startsAt, tz).date;
  const dayStart = zonedToUtc(date, "00:00", tz);
  const dayEnd = zonedToUtc(addDaysIso(date, 1), "00:00", tz);
  const sameDay = await tx.facilityBooking.count({ where: { facilityId: facility.id, userId, status: { in: HOLDING_STATUSES }, startsAt: { gte: dayStart, lt: dayEnd }, ...(excludeId ? { id: { not: excludeId } } : {}) } });
  if (rules.maxPerDayPerUser > 0 && sameDay >= rules.maxPerDayPerUser) throw new FacilityError("RULE", `Limit of ${rules.maxPerDayPerUser} booking${rules.maxPerDayPerUser === 1 ? "" : "s"} per day for ${facility.name}.`);
}

/** Locks the facility row for the rest of the transaction (FAC-04 atomic capacity check). */
async function lockFacility(tx: Tx, facilityId: string) {
  await tx.$queryRaw`SELECT id FROM "Facility" WHERE id = ${facilityId} FOR UPDATE`;
}

async function assertCapacity(tx: Tx, facility: FacilityRecord, w: Window, headcount: number, excludeId?: string | null) {
  const { rules } = facilityConfig(facility);
  const existing = await tx.facilityBooking.findMany({
    where: { facilityId: facility.id, status: { in: HOLDING_STATUSES }, startsAt: { lt: addMinutes(w.endsAt, rules.bufferMinutes) }, endsAt: { gt: addMinutes(w.startsAt, -rules.bufferMinutes) } },
    select: { id: true, startsAt: true, endsAt: true, headcount: true, status: true },
  });
  const held = heldDuring(existing, w.startsAt, w.endsAt, rules.bufferMinutes, excludeId);
  if (held + headcount > facility.capacity) {
    const remaining = Math.max(0, facility.capacity - held);
    throw new FacilityError("CAPACITY", remaining === 0 ? `${facility.name} is fully booked for that time.` : `Only ${remaining} place${remaining === 1 ? "" : "s"} left for that time.`);
  }
}

// ---------------------------------------------------------------------------
// Create / amend / cancel / decide / use (FAC-03, FAC-06)
// ---------------------------------------------------------------------------

export type CreateInput = { facilityId: string; userId: string; actor: Actor; date: string; startTime: string; durationMinutes: number; headcount: number; purpose?: string | null; idempotencyKey?: string | null; now?: Date };

export async function createBooking(input: CreateInput) {
  const now = input.now ?? new Date();
  if (input.idempotencyKey) {
    const existing = await prisma.facilityBooking.findUnique({ where: { idempotencyKey: input.idempotencyKey } });
    if (existing) return { booking: existing, duplicate: true };
  }
  const facility = await prisma.facility.findUnique({ where: { id: input.facilityId }, include: facilityInclude });
  if (!facility || facility.status !== "ACTIVE") throw new FacilityError("NOT_FOUND", "Facility not available.");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.date) || !/^\d{2}:\d{2}$/.test(input.startTime)) throw new FacilityError("VALIDATION", "Choose a date and start time.", { date: "Required." });
  const startsAt = zonedToUtc(input.date, input.startTime, facility.site.timezone);
  const endsAt = addMinutes(startsAt, input.durationMinutes);
  assertWithinRules(facility, { startsAt, endsAt }, input.headcount, now);
  if (input.userId !== input.actor.id && !input.actor.isOperator) throw new FacilityError("FORBIDDEN", "You can only book for yourself.");

  const booking = await prisma.$transaction(async (tx) => {
    await lockFacility(tx, facility.id);
    await assertUserLimits(tx, facility, input.userId, { startsAt, endsAt }, now);
    await assertCapacity(tx, facility, { startsAt, endsAt }, input.headcount);
    const created = await tx.facilityBooking.create({
      data: { facilityId: facility.id, userId: input.userId, startsAt, endsAt, headcount: input.headcount, purpose: input.purpose?.trim() || null, status: facility.requiresApproval ? "PENDING_APPROVAL" : "CONFIRMED", idempotencyKey: input.idempotencyKey || null, createdById: input.actor.id },
    });
    await recordAudit({ actorId: input.actor.id, action: "BOOKING_CREATED", entityType: "FacilityBooking", entityId: created.id, after: { facility: facility.code, userId: input.userId, startsAt: startsAt.toISOString(), endsAt: endsAt.toISOString(), headcount: input.headcount, status: created.status } }, tx);
    await enqueueNotification(tx, { recipientId: input.userId, event: created.status === "CONFIRMED" ? "booking.confirmed" : "booking.pending", idempotencyKey: `booking.created:${created.id}`, payload: { bookingId: created.id, facility: facility.name, date: input.date, startTime: input.startTime, endTime: zonedDateTime(endsAt, facility.site.timezone).time } });
    return created;
  });
  return { booking, duplicate: false };
}

export async function amendBooking(input: { bookingId: string; actor: Actor; date: string; startTime: string; durationMinutes: number; headcount: number; now?: Date }) {
  const now = input.now ?? new Date();
  return prisma.$transaction(async (tx) => {
    const b = await tx.facilityBooking.findUnique({ where: { id: input.bookingId }, include: bookingInclude });
    if (!b) throw new FacilityError("NOT_FOUND", "Booking not found.");
    if (b.userId !== input.actor.id && !input.actor.isOperator) throw new FacilityError("FORBIDDEN", "You can only change your own bookings.");
    if (!["CONFIRMED", "PENDING_APPROVAL"].includes(b.status)) throw new FacilityError("INVALID_STATE", "Only upcoming bookings can be changed.");
    if (b.startsAt <= now) throw new FacilityError("INVALID_STATE", "This booking has already started.");
    const startsAt = zonedToUtc(input.date, input.startTime, b.facility.site.timezone);
    const endsAt = addMinutes(startsAt, input.durationMinutes);
    assertWithinRules(b.facility, { startsAt, endsAt }, input.headcount, now);
    await lockFacility(tx, b.facilityId);
    await assertUserLimits(tx, b.facility, b.userId, { startsAt, endsAt }, now, b.id);
    await assertCapacity(tx, b.facility, { startsAt, endsAt }, input.headcount, b.id);
    const updated = await tx.facilityBooking.update({ where: { id: b.id }, data: { startsAt, endsAt, headcount: input.headcount, status: b.facility.requiresApproval ? "PENDING_APPROVAL" : b.status } });
    await recordAudit({ actorId: input.actor.id, action: "BOOKING_AMENDED", entityType: "FacilityBooking", entityId: b.id, before: { startsAt: b.startsAt.toISOString(), endsAt: b.endsAt.toISOString(), headcount: b.headcount }, after: { startsAt: startsAt.toISOString(), endsAt: endsAt.toISOString(), headcount: input.headcount } }, tx);
    return updated;
  });
}

export async function cancelBooking(input: { bookingId: string; actor: Actor; reason?: string | null; now?: Date }) {
  const now = input.now ?? new Date();
  return prisma.$transaction(async (tx) => {
    const b = await tx.facilityBooking.findUnique({ where: { id: input.bookingId }, include: bookingInclude });
    if (!b) throw new FacilityError("NOT_FOUND", "Booking not found.");
    const own = b.userId === input.actor.id;
    if (!own && !input.actor.isManager) throw new FacilityError("FORBIDDEN", "You can only cancel your own bookings.");
    if (!["CONFIRMED", "PENDING_APPROVAL"].includes(b.status)) throw new FacilityError("INVALID_STATE", `A ${b.status.toLowerCase().replace("_", " ")} booking cannot be cancelled.`);
    const { rules } = facilityConfig(b.facility);
    if (own && !input.actor.isManager) {
      const cutoff = addMinutes(b.startsAt, -rules.cancellationCutoffMinutes);
      if (now > cutoff) throw new FacilityError("RULE", `Bookings must be cancelled at least ${rules.cancellationCutoffMinutes} minutes before they start. Contact the facility manager.`);
    } else if (!input.reason?.trim()) {
      throw new FacilityError("VALIDATION", "Give the booker a reason.", { reason: "Required." });
    }
    const updated = await tx.facilityBooking.update({ where: { id: b.id }, data: { status: "CANCELLED", cancelledAt: now, cancelReason: input.reason?.trim() || (own ? "Cancelled by booker" : null), decidedById: own ? null : input.actor.id } });
    await recordAudit({ actorId: input.actor.id, action: "BOOKING_CANCELLED", entityType: "FacilityBooking", entityId: b.id, before: { status: b.status }, after: { status: "CANCELLED", reason: updated.cancelReason, byManager: !own } }, tx);
    if (!own) await enqueueNotification(tx, { recipientId: b.userId, event: "booking.cancelled", idempotencyKey: `booking.cancelled:${b.id}`, payload: { bookingId: b.id, facility: b.facility.name, date: zonedDateTime(b.startsAt, b.facility.site.timezone).date, startTime: zonedDateTime(b.startsAt, b.facility.site.timezone).time, reason: updated.cancelReason } });
    return updated;
  });
}

export async function decideBooking(input: { bookingId: string; actor: Actor; approve: boolean; note?: string | null; now?: Date }) {
  const now = input.now ?? new Date();
  if (!input.actor.isManager) throw new FacilityError("FORBIDDEN", "Only facility managers can approve bookings.");
  return prisma.$transaction(async (tx) => {
    const b = await tx.facilityBooking.findUnique({ where: { id: input.bookingId }, include: bookingInclude });
    if (!b) throw new FacilityError("NOT_FOUND", "Booking not found.");
    if (b.status !== "PENDING_APPROVAL") throw new FacilityError("INVALID_STATE", "This booking is not awaiting approval.");
    if (!input.approve && !input.note?.trim()) throw new FacilityError("VALIDATION", "Give the booker a reason.", { note: "Required." });
    if (input.approve) {
      if (b.startsAt <= now) throw new FacilityError("INVALID_STATE", "The requested time has passed; the booking will expire.");
      await lockFacility(tx, b.facilityId);
      await assertCapacity(tx, b.facility, { startsAt: b.startsAt, endsAt: b.endsAt }, b.headcount, b.id);
    }
    const status: BookingStatus = input.approve ? "CONFIRMED" : "REJECTED";
    const updated = await tx.facilityBooking.update({ where: { id: b.id }, data: { status, decidedById: input.actor.id, decisionNote: input.note?.trim() || null } });
    await recordAudit({ actorId: input.actor.id, action: "BOOKING_DECIDED", entityType: "FacilityBooking", entityId: b.id, after: { status, note: input.note ?? null } }, tx);
    const local = zonedDateTime(b.startsAt, b.facility.site.timezone);
    await enqueueNotification(tx, { recipientId: b.userId, event: input.approve ? "booking.confirmed" : "booking.rejected", idempotencyKey: `booking.decided:${b.id}`, payload: { bookingId: b.id, facility: b.facility.name, date: local.date, startTime: local.time, endTime: zonedDateTime(b.endsAt, b.facility.site.timezone).time, reason: input.note ?? null } });
    return updated;
  });
}

/** Operator records attendance: used (check-in) or no-show, once the booking has started (FAC-06). */
export async function recordAttendance(input: { bookingId: string; actor: Actor; attended: boolean; now?: Date }) {
  const now = input.now ?? new Date();
  if (!input.actor.isOperator) throw new FacilityError("FORBIDDEN", "Only facility staff can record attendance.");
  return prisma.$transaction(async (tx) => {
    const b = await tx.facilityBooking.findUnique({ where: { id: input.bookingId } });
    if (!b) throw new FacilityError("NOT_FOUND", "Booking not found.");
    if (b.status !== "CONFIRMED") throw new FacilityError("INVALID_STATE", `Attendance can only be recorded for confirmed bookings (this one is ${b.status.toLowerCase().replace("_", " ")}).`);
    if (b.startsAt > now) throw new FacilityError("INVALID_STATE", "The booking has not started yet.");
    const status: BookingStatus = input.attended ? "CHECKED_IN" : "NO_SHOW";
    const updated = await tx.facilityBooking.update({ where: { id: b.id }, data: { status, checkedInAt: input.attended ? now : null, decidedById: input.actor.id } });
    await recordAudit({ actorId: input.actor.id, action: "BOOKING_ATTENDANCE", entityType: "FacilityBooking", entityId: b.id, after: { status } }, tx);
    return updated;
  });
}

/** Pending bookings whose start has passed expire; checked-in bookings whose end has passed complete. */
export async function sweepBookings(now: Date = new Date()) {
  const expired = await prisma.facilityBooking.updateMany({ where: { status: "PENDING_APPROVAL", startsAt: { lte: now } }, data: { status: "EXPIRED" } });
  const completed = await prisma.facilityBooking.updateMany({ where: { status: "CHECKED_IN", endsAt: { lte: now } }, data: { status: "COMPLETED" } });
  return { expired: expired.count, completed: completed.count };
}

// ---------------------------------------------------------------------------
// Facility configuration (FAC-01, FAC-05)
// ---------------------------------------------------------------------------

export async function updateFacility(input: { facilityId: string; actorId: string; name: string; location: string | null; description: string | null; capacity: number; requiresApproval: boolean; status: "ACTIVE" | "INACTIVE"; hours: OpeningHours; rules: BookingRules }) {
  const errors: Record<string, string> = {};
  if (!input.name.trim()) errors.name = "Enter a name.";
  if (!Number.isInteger(input.capacity) || input.capacity < 1) errors.capacity = "Capacity must be at least 1.";
  if (Object.keys(errors).length) throw new FacilityError("VALIDATION", "Please correct the highlighted fields.", errors);
  return prisma.$transaction(async (tx) => {
    const before = await tx.facility.findUnique({ where: { id: input.facilityId } });
    if (!before) throw new FacilityError("NOT_FOUND", "Facility not found.");
    const updated = await tx.facility.update({ where: { id: input.facilityId }, data: { name: input.name.trim(), location: input.location?.trim() || null, description: input.description?.trim() || null, capacity: input.capacity, requiresApproval: input.requiresApproval, status: input.status, openingHours: input.hours as unknown as Prisma.InputJsonObject, bookingRules: input.rules as unknown as Prisma.InputJsonObject } });
    await recordAudit({ actorId: input.actorId, action: "FACILITY_UPDATED", entityType: "Facility", entityId: input.facilityId, before: { name: before.name, capacity: before.capacity, requiresApproval: before.requiresApproval, status: before.status, openingHours: before.openingHours ?? undefined, bookingRules: before.bookingRules ?? undefined }, after: { name: updated.name, capacity: updated.capacity, requiresApproval: updated.requiresApproval, status: updated.status, openingHours: input.hours as unknown as Prisma.InputJsonObject, bookingRules: input.rules as unknown as Prisma.InputJsonObject } }, tx);
    return updated;
  });
}

export async function createFacility(input: { siteId: string; actorId: string; code: string; name: string; capacity: number }) {
  const code = input.code.trim();
  if (!code || !input.name.trim() || !Number.isInteger(input.capacity) || input.capacity < 1) throw new FacilityError("VALIDATION", "Code, name and a capacity of at least 1 are required.");
  try {
    const f = await prisma.facility.create({ data: { siteId: input.siteId, code, name: input.name.trim(), capacity: input.capacity } });
    await recordAudit({ actorId: input.actorId, action: "FACILITY_CREATED", entityType: "Facility", entityId: f.id, after: { code, name: f.name, capacity: f.capacity } });
    return f;
  } catch (e) {
    if ((e as { code?: string }).code === "P2002") throw new FacilityError("VALIDATION", "A facility with that code already exists at this site.", { code: "Already used." });
    throw e;
  }
}

// ---------------------------------------------------------------------------
// Queries and reports (FAC-07)
// ---------------------------------------------------------------------------

export async function listFacilities(opts: { siteId?: string | null; includeInactive?: boolean } = {}) {
  return prisma.facility.findMany({ where: { ...(opts.siteId ? { siteId: opts.siteId } : {}), ...(opts.includeInactive ? {} : { status: "ACTIVE" }) }, include: facilityInclude, orderBy: [{ site: { name: "asc" } }, { name: "asc" }] });
}

export async function getFacility(id: string) {
  return prisma.facility.findUnique({ where: { id }, include: facilityInclude });
}

export async function bookingsForDay(facility: FacilityRecord, date: string) {
  const tz = facility.site.timezone;
  return prisma.facilityBooking.findMany({ where: { facilityId: facility.id, startsAt: { gte: zonedToUtc(date, "00:00", tz), lt: zonedToUtc(addDaysIso(date, 1), "00:00", tz) } }, include: bookingInclude, orderBy: { startsAt: "asc" } });
}

export async function myBookings(userId: string, now: Date = new Date()) {
  const [upcoming, past] = await Promise.all([
    prisma.facilityBooking.findMany({ where: { userId, status: { in: HOLDING_STATUSES }, endsAt: { gt: now } }, include: bookingInclude, orderBy: { startsAt: "asc" } }),
    prisma.facilityBooking.findMany({ where: { userId, OR: [{ endsAt: { lte: now } }, { status: { notIn: HOLDING_STATUSES } }] }, include: bookingInclude, orderBy: { startsAt: "desc" }, take: 20 }),
  ]);
  return { upcoming, past };
}

export async function getBooking(id: string) {
  return prisma.facilityBooking.findUnique({ where: { id }, include: bookingInclude });
}

export type FacilityReport = { facilityId: string; name: string; bookings: number; cancelled: number; noShows: number; attended: number; pending: number; bookedHours: number; openHours: number; utilisation: number };

/** Last `days` days per facility: counts and utilisation = booked hours (held or used) / open hours (FAC-07). */
export async function facilityReports(days = 30, now: Date = new Date(), siteId?: string | null): Promise<FacilityReport[]> {
  const from = addMinutes(now, -days * 24 * 60);
  const facilities = await listFacilities({ siteId, includeInactive: true });
  const out: FacilityReport[] = [];
  for (const f of facilities) {
    const rows = await prisma.facilityBooking.findMany({ where: { facilityId: f.id, startsAt: { gte: from, lt: now } }, select: { status: true, startsAt: true, endsAt: true, headcount: true } });
    const { hours } = facilityConfig(f);
    let openHours = 0;
    for (let i = 0; i < days; i++) {
      const date = zonedDateTime(addMinutes(now, -i * 24 * 60), f.site.timezone).date;
      const weekday = zonedDateTime(zonedToUtc(date, "12:00", f.site.timezone), f.site.timezone).weekday;
      const h = hours[weekday];
      if (h) openHours += (minutesOfDay(h.close) - minutesOfDay(h.open)) / 60;
    }
    const used = rows.filter((r) => ["CONFIRMED", "CHECKED_IN", "COMPLETED"].includes(r.status));
    const bookedHours = used.reduce((sum, r) => sum + ((r.endsAt.getTime() - r.startsAt.getTime()) / 3600000) * r.headcount, 0);
    const capacityHours = openHours * f.capacity;
    out.push({
      facilityId: f.id, name: f.name,
      bookings: rows.length,
      cancelled: rows.filter((r) => r.status === "CANCELLED").length,
      noShows: rows.filter((r) => r.status === "NO_SHOW").length,
      attended: rows.filter((r) => r.status === "CHECKED_IN" || r.status === "COMPLETED").length,
      pending: rows.filter((r) => r.status === "PENDING_APPROVAL").length,
      bookedHours: Math.round(bookedHours * 10) / 10,
      openHours: Math.round(openHours),
      utilisation: capacityHours > 0 ? Math.round((bookedHours / capacityHours) * 100) : 0,
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Views and actions for the API
// ---------------------------------------------------------------------------

const isDate = (s?: string | null): s is string => !!s && /^\d{4}-\d{2}-\d{2}$/.test(s);

/** Users who can be booked on behalf of: active staff with an account. */
export async function bookableUsers() {
  const staff = await prisma.staffProfile.findMany({ where: { employmentStatus: "ACTIVE", userId: { not: null } }, orderBy: [{ lastName: "asc" }, { firstName: "asc" }] });
  return staff.filter((s) => s.userId).map((s) => ({ id: s.userId as string, label: `${s.lastName}, ${s.firstName} (${s.employeeId})` }));
}

/** The operations overview: every facility, 30-day utilisation, bookings awaiting approval and next-24-hour load. */
export async function getOverview(now: Date = new Date()) {
  const [facilities, reports, pending, sites] = await Promise.all([
    listFacilities({ includeInactive: true }),
    facilityReports(30, now),
    prisma.facilityBooking.findMany({ where: { status: "PENDING_APPROVAL", startsAt: { gt: now } }, include: { facility: { include: { site: true } }, user: { select: { name: true } } }, orderBy: { startsAt: "asc" } }),
    prisma.site.findMany({ where: { status: "ACTIVE" }, orderBy: { name: "asc" } }),
  ]);
  const counts = await prisma.facilityBooking.groupBy({
    by: ["facilityId"],
    where: { status: { in: ["CONFIRMED", "CHECKED_IN", "PENDING_APPROVAL"] }, endsAt: { gt: now }, startsAt: { lt: new Date(now.getTime() + 24 * 3600000) } },
    _count: { _all: true },
  });
  const next24h: Record<string, number> = Object.fromEntries(counts.map((c) => [c.facilityId, c._count._all]));
  return { facilities, reports, pending, sites: sites.map((s) => ({ id: s.id, label: s.name })), next24h, now };
}

/** One facility's schedule for a day, as operations staff see it. */
export async function getFacilityView(id: string, rawDate: string | null | undefined, includeUsers: boolean, now: Date = new Date()) {
  const facility = await getFacility(id);
  if (!facility) throw new FacilityError("NOT_FOUND", "Facility not found.");
  const today = zonedDateTime(now, facility.site.timezone).date;
  const date = isDate(rawDate) ? rawDate : today;
  const [slots, bookings, users] = await Promise.all([availabilityForDay(facility, date, now), bookingsForDay(facility, date), includeUsers ? bookableUsers() : Promise.resolve(null)]);
  return { facility, today, date, slots, bookings, users, now };
}

/** A resident's booking home: facilities open for booking plus their own bookings. */
export async function getMyOverview(userId: string, now: Date = new Date()) {
  const [facilities, mine] = await Promise.all([listFacilities(), myBookings(userId, now)]);
  return { facilities, mine, now };
}

/** A facility's availability for a resident, optionally with one of their bookings loaded for amendment. */
export async function getMyFacilityView(userId: string, id: string, rawDate: string | null | undefined, amendId: string | null | undefined, now: Date = new Date()) {
  const facility = await getFacility(id);
  if (!facility || facility.status !== "ACTIVE") throw new FacilityError("NOT_FOUND", "Facility not found.");
  const today = zonedDateTime(now, facility.site.timezone).date;
  const date = isDate(rawDate) && rawDate >= today ? rawDate : today;
  const slots = await availabilityForDay(facility, date, now);
  const booking = amendId ? await getBooking(amendId) : null;
  const amending = booking && booking.userId === userId && ["CONFIRMED", "PENDING_APPROVAL"].includes(booking.status) && booking.facilityId === facility.id ? booking : null;
  return { facility, today, date, slots, amending, now };
}

/** Saves the facility settings form: validates opening hours and booking rules from the raw fields, then updates. */
export async function saveFacilitySettings(actorId: string, facilityId: string, raw: Record<string, string>) {
  const { hours, errors: hourErrors } = validateHoursInput(raw);
  const { rules, errors: ruleErrors } = validateRulesInput(raw);
  const fieldErrors = { ...hourErrors, ...ruleErrors };
  if (Object.keys(fieldErrors).length) throw new FacilityError("VALIDATION", "Please correct the highlighted fields.", fieldErrors);
  const capacity = Number(raw.capacity);
  return updateFacility({
    facilityId, actorId, name: raw.name ?? "", location: raw.location || null, description: raw.description || null,
    capacity: Number.isFinite(capacity) ? Math.trunc(capacity) : NaN, requiresApproval: raw.requiresApproval === "on",
    status: raw.status === "INACTIVE" ? "INACTIVE" : "ACTIVE", hours, rules,
  });
}
