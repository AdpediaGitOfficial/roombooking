// Facility management extras (document 5.6): closing for maintenance, blocking slots and events, recurring blocks,
// lifting a no-show block, the waitlist, and who booked. Permissions come from the matrix (fac.*).
import { prisma } from "../../lib/db";
import { recordAudit } from "../../lib/audit";
import { enqueueNotification } from "../../lib/notifications";
import { actorAccess, actorCan, type ActorLike } from "../../lib/permissions/actor";
import { addMinutes, zonedDateTime, zonedToUtc } from "../../lib/time";
import { assertCapacity, facilityInclude, lockFacility, bookingInclude, HOLDING_STATUSES } from "./service";
import { OFFER_MINUTES, assertEligible, assertNotBlocked, assertNotStruckOut, unavailableWindows, type BlockRecurrence } from "./constraints";
import { FacilityError } from "./errors";

const parse = (v: string, field: string): Date => {
  const d = new Date(v);
  if (!v || Number.isNaN(d.getTime())) throw new FacilityError("VALIDATION", "Enter a valid date and time.", { [field]: "Invalid." });
  return d;
};

async function load(facilityId: string) {
  const f = await prisma.facility.findUnique({ where: { id: facilityId }, include: facilityInclude });
  if (!f) throw new FacilityError("NOT_FOUND", "Facility not found.");
  return f;
}

async function cancelAffected(actorId: string, facilityId: string, from: Date, to: Date, why: string) {
  const f = await load(facilityId);
  const affected = await prisma.facilityBooking.findMany({ where: { facilityId, status: { in: ["CONFIRMED", "PENDING_APPROVAL"] }, startsAt: { lt: to }, endsAt: { gt: from } } });
  for (const b of affected) {
    await prisma.$transaction(async (tx) => {
      await tx.facilityBooking.update({ where: { id: b.id }, data: { status: "CANCELLED", cancelledAt: new Date(), cancelReason: why, decidedById: actorId } });
      const local = zonedDateTime(b.startsAt, f.site.timezone);
      await enqueueNotification(tx, { recipientId: b.userId, event: "booking.cancelled", idempotencyKey: `booking.cancelled:${b.id}`, payload: { bookingId: b.id, facility: f.name, date: local.date, startTime: local.time, reason: why } });
      await recordAudit({ actorId, action: "BOOKING_CANCELLED", entityType: "FacilityBooking", entityId: b.id, after: { reason: why, byClosure: true } }, tx);
    });
  }
  return affected.length;
}

/** Close a facility for maintenance (Coordinator / Admin). Bookings in the window are cancelled and the people told. */
export async function closeFacility(actor: ActorLike, input: { facilityId: string; startsAt: string; endsAt: string; reason: string; workOrderId?: string | null }) {
  const f = await load(input.facilityId);
  if (!actorCan(actor, "fac.close", { siteId: f.siteId })) throw new FacilityError("FORBIDDEN", "Only a Coordinator or Admin can close a facility.");
  const startsAt = parse(input.startsAt, "startsAt"), endsAt = parse(input.endsAt, "endsAt");
  if (endsAt <= startsAt) throw new FacilityError("VALIDATION", "The closure must end after it starts.", { endsAt: "Before the start." });
  if (!input.reason?.trim()) throw new FacilityError("VALIDATION", "Give a reason.", { reason: "Required." });
  const c = await prisma.facilityClosure.create({ data: { facilityId: f.id, startsAt, endsAt, reason: input.reason.trim(), workOrderId: input.workOrderId || null, createdById: actor.id } });
  const cancelled = await cancelAffected(actor.id, f.id, startsAt, endsAt, `Closed for maintenance: ${input.reason.trim()}`);
  await recordAudit({ actorId: actor.id, action: "FACILITY_CLOSED", entityType: "Facility", entityId: f.id, after: { startsAt: startsAt.toISOString(), endsAt: endsAt.toISOString(), reason: input.reason, cancelled }, siteId: f.siteId });
  return { closure: c, cancelled };
}

export async function reopenFacility(actor: ActorLike, closureId: string) {
  const c = await prisma.facilityClosure.findUnique({ where: { id: closureId } });
  if (!c || c.cancelledAt) throw new FacilityError("NOT_FOUND", "Closure not found.");
  const f = await load(c.facilityId);
  if (!actorCan(actor, "fac.close", { siteId: f.siteId })) throw new FacilityError("FORBIDDEN", "Only a Coordinator or Admin can reopen a facility.");
  await prisma.facilityClosure.update({ where: { id: closureId }, data: { cancelledAt: new Date() } });
  await recordAudit({ actorId: actor.id, action: "FACILITY_REOPENED", entityType: "Facility", entityId: f.id, siteId: f.siteId });
}

/** Block a slot, hold an event or set a recurring reservation (Facility manager). */
export async function blockSlots(actor: ActorLike, input: { facilityId: string; type: "BLOCK" | "EVENT" | "RECURRING"; title: string; startsAt?: string; endsAt?: string; weekdays?: number[]; from?: string; to?: string; until?: string }) {
  const f = await load(input.facilityId);
  if (!actorCan(actor, "fac.block_slots", { siteId: f.siteId })) throw new FacilityError("FORBIDDEN", "Blocking slots needs the Facility manager grant or an Admin.");
  if (!input.title?.trim()) throw new FacilityError("VALIDATION", "Give it a title.", { title: "Required." });
  let startsAt: Date, endsAt: Date, recurrence: BlockRecurrence = null;
  if (input.type === "RECURRING") {
    if (!input.weekdays?.length || !input.from || !input.to || !input.until) throw new FacilityError("VALIDATION", "Choose the weekdays, the times and the end date.", { weekdays: "Required." });
    if (input.to <= input.from) throw new FacilityError("VALIDATION", "The end time must be after the start time.", { to: "Before the start." });
    recurrence = { weekdays: input.weekdays, from: input.from, to: input.to, until: input.until };
    startsAt = new Date(); endsAt = zonedToUtc(input.until, "23:59", f.site.timezone);
    if (endsAt < startsAt) throw new FacilityError("VALIDATION", "The end date has passed.", { until: "Past." });
  } else {
    startsAt = parse(input.startsAt ?? "", "startsAt"); endsAt = parse(input.endsAt ?? "", "endsAt");
    if (endsAt <= startsAt) throw new FacilityError("VALIDATION", "It must end after it starts.", { endsAt: "Before the start." });
  }
  const b = await prisma.facilityBlock.create({ data: { facilityId: f.id, type: input.type, title: input.title.trim(), startsAt, endsAt, recurrence: (recurrence ?? undefined) as never, createdById: actor.id } });
  // Existing bookings under a new block are cancelled with a reason (the manager chose to block that time).
  const windows = (await unavailableWindows(prisma, f, startsAt, endsAt)).filter((w) => w.reason.includes(input.title.trim()));
  let cancelled = 0;
  for (const w of windows) cancelled += await cancelAffected(actor.id, f.id, w.startsAt, w.endsAt, `${input.type === "EVENT" ? "Event" : "Slot blocked"}: ${input.title.trim()}`);
  await recordAudit({ actorId: actor.id, action: "FACILITY_BLOCKED", entityType: "Facility", entityId: f.id, after: { type: input.type, title: input.title, cancelled }, siteId: f.siteId });
  return { block: b, cancelled };
}

export async function removeBlock(actor: ActorLike, blockId: string) {
  const b = await prisma.facilityBlock.findUnique({ where: { id: blockId } });
  if (!b || b.cancelledAt) throw new FacilityError("NOT_FOUND", "Block not found.");
  const f = await load(b.facilityId);
  if (!actorCan(actor, "fac.block_slots", { siteId: f.siteId })) throw new FacilityError("FORBIDDEN", "You cannot remove blocks.");
  await prisma.facilityBlock.update({ where: { id: blockId }, data: { cancelledAt: new Date() } });
  await recordAudit({ actorId: actor.id, action: "FACILITY_BLOCK_REMOVED", entityType: "Facility", entityId: f.id, siteId: f.siteId });
}

export async function listClosuresAndBlocks(facilityId: string) {
  const now = new Date();
  const [closures, blocks] = await Promise.all([
    prisma.facilityClosure.findMany({ where: { facilityId, cancelledAt: null, endsAt: { gt: now } }, orderBy: { startsAt: "asc" } }),
    prisma.facilityBlock.findMany({ where: { facilityId, cancelledAt: null, endsAt: { gt: now } }, orderBy: { startsAt: "asc" } }),
  ]);
  return { closures, blocks };
}

/** A manager lifts a resident's no-show block at a facility (or all facilities). */
export async function liftNoShowBlock(actor: ActorLike, userId: string, facilityId?: string | null) {
  const f = facilityId ? await load(facilityId) : null;
  if (!actorCan(actor, "fac.lift_noshow", f ? { siteId: f.siteId } : {})) throw new FacilityError("FORBIDDEN", "Lifting a no-show block needs the Facility manager grant or an Admin.");
  const r = await prisma.facilityStrike.updateMany({ where: { userId, active: true, ...(facilityId ? { facilityId } : {}) }, data: { active: false, liftedById: actor.id, liftedAt: new Date() } });
  await recordAudit({ actorId: actor.id, action: "NOSHOW_BLOCK_LIFTED", entityType: "User", entityId: userId, after: { facilityId: facilityId ?? null, strikes: r.count }, siteId: f?.siteId });
  return r.count;
}

export async function blockedResidents(siteIds: string[] | null) {
  const strikes = await prisma.facilityStrike.findMany({ where: { active: true, ...(siteIds ? { facility: undefined } : {}) }, orderBy: { createdAt: "desc" }, take: 500 });
  const facilities = new Map((await prisma.facility.findMany({ where: { id: { in: [...new Set(strikes.map((s) => s.facilityId).filter((x): x is string => !!x))] }, ...(siteIds ? { siteId: { in: siteIds } } : {}) }, select: { id: true, name: true, noShowLimit: true } })).map((f) => [f.id, f]));
  const users = new Map((await prisma.user.findMany({ where: { id: { in: [...new Set(strikes.map((s) => s.userId))] } }, select: { id: true, name: true } })).map((u) => [u.id, u.name]));
  const groups = new Map<string, { userId: string; facilityId: string; count: number }>();
  for (const s of strikes) { if (!s.facilityId || !facilities.has(s.facilityId)) continue; const k = `${s.userId}|${s.facilityId}`; const g = groups.get(k) ?? { userId: s.userId, facilityId: s.facilityId, count: 0 }; g.count++; groups.set(k, g); }
  const limit = await (await import("./constraints")).defaultNoShowLimit();
  return [...groups.values()].map((g) => ({ ...g, user: users.get(g.userId) ?? "—", facility: facilities.get(g.facilityId)!.name, limit: facilities.get(g.facilityId)!.noShowLimit ?? limit })).map((g) => ({ ...g, blocked: g.count >= g.limit }));
}

// ---------------------------------------------------------------------------
// Waitlist
// ---------------------------------------------------------------------------

/** Join the waitlist for a full time. The first person is offered the slot (for two hours) when a booking is cancelled. */
export async function joinWaitlist(userId: string, input: { facilityId: string; date: string; startTime: string; durationMinutes: number; headcount: number }) {
  const f = await load(input.facilityId);
  if (f.status !== "ACTIVE") throw new FacilityError("NOT_FOUND", "Facility not available.");
  const startsAt = zonedToUtc(input.date, input.startTime, f.site.timezone), endsAt = addMinutes(startsAt, input.durationMinutes);
  if (startsAt < new Date()) throw new FacilityError("RULE", "That time has already passed.");
  if (await prisma.bookingWaitlist.findFirst({ where: { facilityId: f.id, userId, status: { in: ["WAITING", "OFFERED"] }, startsAt: { lt: endsAt }, endsAt: { gt: startsAt } } })) throw new FacilityError("RULE", "You are already on the waitlist for that time.");
  await assertEligible(prisma, f, userId);
  await assertNotStruckOut(prisma, f, userId);
  const w = await prisma.bookingWaitlist.create({ data: { facilityId: f.id, userId, startsAt, endsAt, headcount: input.headcount } });
  await recordAudit({ actorId: userId, action: "BOOKING_WAITLIST_JOINED", entityType: "BookingWaitlist", entityId: w.id });
  return w;
}

/** Accept an offer: books the slot if it is still free, within the two-hour offer window. */
export async function acceptWaitlistOffer(userId: string, waitlistId: string, now: Date = new Date()) {
  const w = await prisma.bookingWaitlist.findUnique({ where: { id: waitlistId } });
  if (!w || w.userId !== userId) throw new FacilityError("NOT_FOUND", "Offer not found.");
  if (w.status !== "OFFERED" || !w.offeredAt) throw new FacilityError("INVALID_STATE", "That offer is no longer open.");
  if (now.getTime() - w.offeredAt.getTime() > OFFER_MINUTES * 60000) { await prisma.bookingWaitlist.update({ where: { id: w.id }, data: { status: "EXPIRED" } }); throw new FacilityError("INVALID_STATE", "The offer expired."); }
  const f = await load(w.facilityId);
  return prisma.$transaction(async (tx) => {
    await lockFacility(tx, f.id);
    await assertNotBlocked(tx, f, w);
    await assertCapacity(tx, f, { startsAt: w.startsAt, endsAt: w.endsAt }, w.headcount);
    const b = await tx.facilityBooking.create({ data: { facilityId: f.id, userId, startsAt: w.startsAt, endsAt: w.endsAt, headcount: w.headcount, status: "CONFIRMED", purpose: "From waitlist", createdById: userId } });
    await tx.bookingWaitlist.update({ where: { id: w.id }, data: { status: "CONFIRMED", bookingId: b.id } });
    await recordAudit({ actorId: userId, action: "BOOKING_CREATED", entityType: "FacilityBooking", entityId: b.id, after: { fromWaitlist: w.id } }, tx);
    return b;
  });
}

export async function cancelWaitlist(userId: string, waitlistId: string) {
  const r = await prisma.bookingWaitlist.updateMany({ where: { id: waitlistId, userId, status: { in: ["WAITING", "OFFERED"] } }, data: { status: "CANCELLED" } });
  if (r.count !== 1) throw new FacilityError("NOT_FOUND", "Waitlist entry not found.");
}

/** Daily / hourly: offers that went unanswered expire and the next person is offered the slot. */
export async function sweepWaitlist(now: Date = new Date()) {
  const stale = await prisma.bookingWaitlist.findMany({ where: { status: "OFFERED", offeredAt: { lt: new Date(now.getTime() - OFFER_MINUTES * 60000) } } });
  let passed = 0;
  for (const w of stale) {
    await prisma.$transaction(async (tx) => {
      await tx.bookingWaitlist.update({ where: { id: w.id }, data: { status: "EXPIRED" } });
      const f = await tx.facility.findUniqueOrThrow({ where: { id: w.facilityId }, include: facilityInclude });
      const { offerNextOnWaitlist } = await import("./constraints");
      await offerNextOnWaitlist(tx, f, { startsAt: w.startsAt, endsAt: w.endsAt });
    });
    passed++;
  }
  await prisma.bookingWaitlist.updateMany({ where: { status: "WAITING", endsAt: { lt: now } }, data: { status: "EXPIRED" } });
  return passed;
}

export const myWaitlist = (userId: string) => prisma.bookingWaitlist.findMany({ where: { userId, status: { in: ["WAITING", "OFFERED"] } }, orderBy: { startsAt: "asc" } });

/** "See who booked": managers and the front desk see names, residents see only that a slot is booked (document 9). */
export async function whoBooked(actor: ActorLike, facilityId: string, date: string) {
  const f = await load(facilityId);
  const names = !!actorAccess(actor, "fac.see_who", { siteId: f.siteId }) && !actor.roles.every((r) => r === "STAFF");
  const dayStart = zonedToUtc(date, "00:00", f.site.timezone), dayEnd = zonedToUtc(date, "23:59", f.site.timezone);
  const rows = await prisma.facilityBooking.findMany({ where: { facilityId, status: { in: HOLDING_STATUSES }, startsAt: { gte: dayStart, lte: dayEnd } }, include: bookingInclude, orderBy: { startsAt: "asc" } });
  return rows.map((b) => ({ id: b.id, start: zonedDateTime(b.startsAt, f.site.timezone).time, end: zonedDateTime(b.endsAt, f.site.timezone).time, headcount: b.headcount, who: names ? b.user.name : "Booked", status: b.status }));
}


/** Eligibility, fee and no-show limit for a facility (Facility manager for their facilities, Admin). */
export async function updateFacilityPolicy(actor: ActorLike, facilityId: string, input: { grades?: string[]; departments?: string[]; categories?: string[]; feePerHour?: number | null; noShowLimit?: number | null }) {
  const f = await load(facilityId);
  if (!actorCan(actor, "fac.configure", { siteId: f.siteId })) throw new FacilityError("FORBIDDEN", "Configuring facilities needs the Facility manager grant or an Admin.");
  if (input.feePerHour != null && (!Number.isFinite(input.feePerHour) || input.feePerHour < 0)) throw new FacilityError("VALIDATION", "Enter a fee of zero or more.", { feePerHour: "Invalid." });
  if (input.noShowLimit != null && (!Number.isInteger(input.noShowLimit) || input.noShowLimit < 0)) throw new FacilityError("VALIDATION", "Enter a whole number (0 turns the block off).", { noShowLimit: "Invalid." });
  const clean = (xs?: string[]) => (xs ?? []).map((x) => x.trim()).filter(Boolean);
  const eligibility = { grades: clean(input.grades), departments: clean(input.departments), categories: clean(input.categories) };
  const updated = await prisma.facility.update({ where: { id: facilityId }, data: { eligibility, feePerHour: input.feePerHour ?? null, noShowLimit: input.noShowLimit ?? null } });
  await recordAudit({ actorId: actor.id, action: "FACILITY_POLICY_SET", entityType: "Facility", entityId: facilityId, before: { fee: f.feePerHour ? Number(f.feePerHour) : null, noShowLimit: f.noShowLimit }, after: { fee: input.feePerHour ?? null, noShowLimit: input.noShowLimit ?? null, eligibility }, siteId: f.siteId });
  return updated;
}
