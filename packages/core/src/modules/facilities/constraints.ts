// Facility constraints beyond hours and capacity (document 5.6): closures for maintenance, blocked slots and events,
// eligibility, no-show strikes that suspend booking, the waitlist and fees. Used by the booking service.
import type { Prisma, PrismaClient } from "@prisma/client";
import { prisma } from "../../lib/db";
import { enqueueNotification } from "../../lib/notifications";
import { orgSetting } from "../../lib/settings";
import { addDaysIso, addMinutes, zonedDateTime, zonedToUtc } from "../../lib/time";
import { checkEligibility } from "../allocations/eligibility";
import { FacilityError } from "./errors";

type Db = Prisma.TransactionClient | PrismaClient;
export type Win = { startsAt: Date; endsAt: Date };
export type BlockRecurrence = { weekdays: number[]; from: string; to: string; until: string } | null;
type FacilityLike = { id: string; name: string; eligibility?: unknown; noShowLimit?: number | null; feePerHour?: unknown; site: { timezone: string } };

/** Windows during which the facility cannot be booked, within [from, to): closures, blocked slots, events and recurring blocks. */
export async function unavailableWindows(db: Db, facility: { id: string; site: { timezone: string } }, from: Date, to: Date): Promise<Array<Win & { reason: string; kind: "CLOSURE" | "BLOCK" | "EVENT" | "RECURRING" }>> {
  const out: Array<Win & { reason: string; kind: "CLOSURE" | "BLOCK" | "EVENT" | "RECURRING" }> = [];
  const closures = await db.facilityClosure.findMany({ where: { facilityId: facility.id, cancelledAt: null, startsAt: { lt: to }, endsAt: { gt: from } } });
  for (const c of closures) out.push({ startsAt: c.startsAt, endsAt: c.endsAt, reason: `Closed for maintenance: ${c.reason}`, kind: "CLOSURE" });
  const blocks = await db.facilityBlock.findMany({ where: { facilityId: facility.id, cancelledAt: null, startsAt: { lt: to }, endsAt: { gt: from } } });
  for (const b of blocks) {
    if (b.type !== "RECURRING") { out.push({ startsAt: b.startsAt, endsAt: b.endsAt, reason: b.type === "EVENT" ? `Event: ${b.title}` : `Blocked: ${b.title}`, kind: b.type === "EVENT" ? "EVENT" : "BLOCK" }); continue; }
    const r = b.recurrence as BlockRecurrence;
    if (!r || !Array.isArray(r.weekdays)) continue;
    const tz = facility.site.timezone;
    let day = zonedDateTime(from, tz).date;
    const last = zonedDateTime(to, tz).date;
    for (let i = 0; i < 400 && day <= last && day <= r.until; i++, day = addDaysIso(day, 1)) {
      if (!r.weekdays.includes(zonedDateTime(zonedToUtc(day, "12:00", tz), tz).weekday as unknown as number) && !r.weekdays.includes(isoWeekday(day))) continue;
      const s = zonedToUtc(day, r.from, tz), e = zonedToUtc(day, r.to, tz);
      if (s < to && e > from && s >= b.startsAt) out.push({ startsAt: s, endsAt: e, reason: `Reserved: ${b.title}`, kind: "RECURRING" });
    }
  }
  return out;
}

/** ISO weekday of a YYYY-MM-DD date: Monday = 1 ... Sunday = 7. */
export const isoWeekday = (date: string) => ((new Date(`${date}T12:00:00.000Z`).getUTCDay() + 6) % 7) + 1;

export async function assertNotBlocked(db: Db, facility: FacilityLike, w: Win) {
  const hit = (await unavailableWindows(db, facility, w.startsAt, w.endsAt)).find((u) => u.startsAt < w.endsAt && w.startsAt < u.endsAt);
  if (hit) throw new FacilityError("RULE", `${facility.name} is not available then. ${hit.reason}.`);
}

export async function assertEligible(db: Db, facility: FacilityLike, userId: string) {
  const rule = facility.eligibility;
  if (!rule || typeof rule !== "object" || Object.values(rule as Record<string, unknown>).every((v) => !Array.isArray(v) || v.length === 0)) return;
  const staff = await db.staffProfile.findUnique({ where: { userId }, select: { grade: true, department: true, eligibilityCategory: true, profileType: true } });
  if (!staff) return; // accounts without a staff profile (administrators) are not restricted
  const r = checkEligibility(staff, {}, rule, { startDate: new Date().toISOString().slice(0, 10), endDate: "9999-12-31" });
  if (!r.ok) throw new FacilityError("RULE", `You are not eligible to book ${facility.name}. ${r.reasons[0] ?? ""}`.trim());
}

export const strikeWindowDays = () => orgSetting<number>("facility.strikeDays", 30);
export const defaultNoShowLimit = () => orgSetting<number>("facility.noShowLimit", 3);

export async function activeStrikes(db: Db, userId: string, facilityId: string, now: Date = new Date()) {
  const since = new Date(now.getTime() - (await strikeWindowDays()) * 86400000);
  return db.facilityStrike.count({ where: { userId, facilityId, active: true, createdAt: { gte: since } } });
}

/** A resident with too many recent no-shows at a facility cannot book it until a manager lifts the block. */
export async function assertNotStruckOut(db: Db, facility: FacilityLike, userId: string, now: Date = new Date()) {
  const limit = facility.noShowLimit ?? (await defaultNoShowLimit());
  if (limit <= 0) return;
  const n = await activeStrikes(db, userId, facility.id, now);
  if (n >= limit) throw new FacilityError("RULE", `Booking ${facility.name} is paused after ${n} no-shows. Ask the facility manager to lift the block.`);
}

export async function recordStrike(tx: Prisma.TransactionClient, booking: { id: string; userId: string; facilityId: string }, facility: FacilityLike) {
  await tx.facilityStrike.create({ data: { userId: booking.userId, facilityId: booking.facilityId, bookingId: booking.id } });
  const limit = facility.noShowLimit ?? (await defaultNoShowLimit());
  const n = await activeStrikes(tx, booking.userId, booking.facilityId);
  await enqueueNotification(tx, { recipientId: booking.userId, event: n >= limit ? "booking.blocked" : "booking.no_show", idempotencyKey: `strike:${booking.id}`, payload: { bookingId: booking.id, facility: facility.name, strikes: n, limit } });
}

/** A used booking at a facility with a fee becomes a facility-fee charge awaiting approval (never approved by the person who recorded it). */
export async function createFeeCharge(tx: Prisma.TransactionClient, booking: { id: string; userId: string; startsAt: Date; endsAt: Date }, facility: FacilityLike & { siteId?: string }, recordedById: string) {
  const fee = facility.feePerHour == null ? 0 : Number(facility.feePerHour);
  if (!(fee > 0)) return null;
  const staff = await tx.staffProfile.findUnique({ where: { userId: booking.userId }, select: { id: true } });
  if (!staff) return null;
  const hours = (booking.endsAt.getTime() - booking.startsAt.getTime()) / 3600000;
  return tx.charge.create({ data: { staffId: staff.id, siteId: facility.siteId ?? null, kind: "FACILITY_FEE", description: `${facility.name} on ${booking.startsAt.toISOString().slice(0, 10)} (${hours.toFixed(1)} h)`, quantity: hours, amount: Math.round(fee * hours * 100) / 100, raisedById: recordedById, sourceType: "FacilityBooking", sourceId: booking.id } });
}

/** When a booking frees capacity, the first compatible waiting person is offered it for two hours. */
export async function offerNextOnWaitlist(tx: Prisma.TransactionClient, facility: FacilityLike, freed: Win) {
  const next = await tx.bookingWaitlist.findFirst({ where: { facilityId: facility.id, status: "WAITING", startsAt: { lt: freed.endsAt }, endsAt: { gt: freed.startsAt } }, orderBy: { createdAt: "asc" } });
  if (!next) return null;
  await tx.bookingWaitlist.update({ where: { id: next.id }, data: { status: "OFFERED", offeredAt: new Date() } });
  const tz = facility.site.timezone;
  await enqueueNotification(tx, { recipientId: next.userId, event: "booking.waitlist_offer", idempotencyKey: `waitlist.offer:${next.id}`, payload: { facility: facility.name, date: zonedDateTime(next.startsAt, tz).date, startTime: zonedDateTime(next.startsAt, tz).time, waitlistId: next.id } });
  return next;
}

export const OFFER_MINUTES = 120;
export { addMinutes };
