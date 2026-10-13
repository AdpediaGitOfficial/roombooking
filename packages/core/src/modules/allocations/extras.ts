// Allocation extras from the Roles, Permissions & Module Map (section 5.3 and 6.1):
// emergency (provisional) check-in, extensions, bed swaps, bulk allocation, waitlist and room readiness.
import type { BedReadiness, Prisma } from "@prisma/client";
import { prisma } from "../../lib/db";
import { recordAudit } from "../../lib/audit";
import { enqueueNotification } from "../../lib/notifications";
import { actorCan, type ActorLike } from "../../lib/permissions/actor";
import { OCCUPYING_STATUSES, isoDate, todayInTimezone } from "../accommodation/occupancy";
import { checkEligibility } from "./eligibility";
import { effectivePolicy } from "../structure/service";
import { AllocationError } from "./errors";
import { orgSetting } from "../../lib/settings";
import { allocate, checkIn, findAvailableBeds, isIsoDate, toDate } from "./service";

type Tx = Prisma.TransactionClient;

const bedCtx = { include: { room: { include: { building: { include: { site: true } } } } } } as const;


// ---------------------------------------------------------------------------
// Emergency check-in (provisional until an Admin approves within 24 hours)
// ---------------------------------------------------------------------------

export async function emergencyCheckIn(actor: ActorLike, input: { staffId: string; bedId: string; reason: string; endDate?: string | null }) {
  const bed = await prisma.bed.findUnique({ where: { id: input.bedId }, ...bedCtx });
  if (!bed) throw new AllocationError("NOT_FOUND", "Bed not found.");
  if (!actorCan(actor, "accom.emergency_checkin", { siteId: bed.room.building.siteId, buildingId: bed.room.buildingId })) throw new AllocationError("FORBIDDEN", "Emergency check-in needs the Emergency check-in grant.");
  if (!input.reason?.trim()) throw new AllocationError("INVALID_STATE", "Give the reason for the emergency check-in.");
  const today = todayInTimezone(bed.room.building.site.timezone);
  const allocation = await allocate({ staffId: input.staffId, bedId: input.bedId, startDate: today, endDate: input.endDate ?? null, actorId: actor.id, reason: `Emergency: ${input.reason.trim()}`, provisional: true });
  await checkIn({ allocationId: allocation.id, actorId: actor.id, notes: `Emergency check-in: ${input.reason.trim()}`, today, acceptNotReady: true });
  await prisma.$transaction(async (tx) => {
    await recordAudit({ actorId: actor.id, action: "EMERGENCY_CHECKIN", entityType: "Allocation", entityId: allocation.id, after: { reason: input.reason.trim(), approveBy: allocation.provisionalApproveBy?.toISOString() ?? null, bedCode: bed.code } }, tx);
    const admins = await tx.user.findMany({ where: { status: "ACTIVE", roleAssignments: { some: { role: "ACCOMMODATION_ADMIN" } } }, select: { id: true } });
    for (const a of admins) await enqueueNotification(tx, { recipientId: a.id, event: "checkin.provisional", idempotencyKey: `provisional:${allocation.id}:${a.id}`, payload: { allocationId: allocation.id, bed: bed.code, reason: input.reason.trim() } });
  });
  return prisma.allocation.findUniqueOrThrow({ where: { id: allocation.id } });
}

/** An Accommodation Admin approves the provisional stay, or rejects it, which creates a move task for the desk. */
export async function decideProvisional(actor: ActorLike, allocationId: string, approve: boolean, note?: string | null) {
  const a = await prisma.allocation.findUnique({ where: { id: allocationId }, include: { staff: true, bed: bedCtx } });
  if (!a) throw new AllocationError("NOT_FOUND", "Allocation not found.");
  if (!actorCan(actor, "accom.approve", { siteId: a.bed.room.building.siteId, buildingId: a.bed.room.buildingId })) throw new AllocationError("FORBIDDEN", "Only an Accommodation Admin can decide a provisional check-in.");
  if (!a.provisional || a.provisionalApprovedAt) throw new AllocationError("INVALID_STATE", "That stay is not waiting for approval.");
  if (a.createdById === actor.id) throw new AllocationError("FORBIDDEN", "You raised this emergency check-in, so someone else must decide it.");
  if (!approve && !note?.trim()) throw new AllocationError("INVALID_STATE", "Give a reason for rejecting.");
  return prisma.$transaction(async (tx) => {
    if (approve) {
      await tx.allocation.update({ where: { id: a.id }, data: { provisional: false, provisionalApprovedAt: new Date(), provisionalApprovedById: actor.id } });
    } else {
      await tx.allocation.update({ where: { id: a.id }, data: { provisionalApprovedAt: new Date(), provisionalApprovedById: actor.id, notes: [a.notes, `Provisional stay rejected: ${note!.trim()}`].filter(Boolean).join(" | ") } });
      await tx.moveTask.create({ data: { allocationId: a.id, reason: note!.trim() } });
    }
    await recordAudit({ actorId: actor.id, action: approve ? "PROVISIONAL_APPROVED" : "PROVISIONAL_REJECTED", entityType: "Allocation", entityId: a.id, after: { note: note ?? null } }, tx);
    if (a.createdById) await enqueueNotification(tx, { recipientId: a.createdById, event: approve ? "checkin.approved" : "checkin.rejected", idempotencyKey: `provisional.decided:${a.id}`, payload: { allocationId: a.id, bed: a.bed.code, note: note ?? null } });
    return { approved: approve };
  });
}

/** Flags provisional stays that were not decided within 24 hours (daily or hourly sweep). */
export async function sweepProvisional(now: Date = new Date()) {
  const overdue = await prisma.allocation.findMany({ where: { provisional: true, provisionalApprovedAt: null, provisionalApproveBy: { lt: now }, status: "CHECKED_IN" }, include: { bed: true } });
  const admins = await prisma.user.findMany({ where: { status: "ACTIVE", roleAssignments: { some: { role: { in: ["ACCOMMODATION_ADMIN", "SYSTEM_ADMIN"] } } } }, select: { id: true } });
  for (const a of overdue) {
    await prisma.$transaction(async (tx) => {
      for (const u of admins) await enqueueNotification(tx, { recipientId: u.id, event: "checkin.provisional_overdue", idempotencyKey: `provisional.overdue:${a.id}:${u.id}:${now.toISOString().slice(0, 10)}`, payload: { allocationId: a.id, bed: a.bed.code } });
    });
  }
  return overdue.length;
}

export async function openMoveTasks() {
  return prisma.moveTask.findMany({ where: { status: "OPEN" }, orderBy: { createdAt: "asc" } });
}

// ---------------------------------------------------------------------------
// Extension up to X days (Officer by grant, Admin by default)
// ---------------------------------------------------------------------------

export async function extendStay(actor: ActorLike, allocationId: string, newEndDate: string, reason: string) {
  const a = await prisma.allocation.findUnique({ where: { id: allocationId }, include: { bed: bedCtx, staff: true } });
  if (!a) throw new AllocationError("NOT_FOUND", "Allocation not found.");
  const ctx = { siteId: a.bed.room.building.siteId, buildingId: a.bed.room.buildingId };
  if (!actorCan(actor, "accom.extend", ctx)) throw new AllocationError("FORBIDDEN", "Your role does not allow extending a stay.");
  if (!isIsoDate(newEndDate)) throw new AllocationError("INVALID_DATES", "Enter a valid end date.");
  if (!reason?.trim()) throw new AllocationError("INVALID_STATE", "Give a reason for the extension.");
  if (!OCCUPYING_STATUSES.includes(a.status)) throw new AllocationError("INVALID_STATE", "Only current or upcoming stays can be extended.");
  if (!a.endDate) throw new AllocationError("INVALID_STATE", "This stay has no end date; there is nothing to extend.");
  const current = isoDate(a.endDate);
  if (newEndDate <= current) throw new AllocationError("INVALID_DATES", `The new end date must be after ${current}.`);
  const maxDays = Number(await orgSetting("stay.extendMaxDays", 14));
  const extra = Math.round((Date.parse(newEndDate) - Date.parse(current)) / 86400000);
  if (extra > maxDays) throw new AllocationError("INVALID_STATE", `Extensions beyond ${maxDays} days are outside policy. Raise an "extension beyond policy" request for a second approver.`, { maxDays, extra });
  if (a.staff.profileEndDate && newEndDate > isoDate(a.staff.profileEndDate)) throw new AllocationError("NOT_ELIGIBLE", `Their profile ends on ${isoDate(a.staff.profileEndDate)}; the stay cannot go past it.`);
  try {
    return await prisma.$transaction(async (tx) => {
      const updated = await tx.allocation.update({ where: { id: a.id }, data: { endDate: toDate(newEndDate), notes: [a.notes, `Extended to ${newEndDate}: ${reason.trim()}`].filter(Boolean).join(" | ") } });
      await recordAudit({ actorId: actor.id, action: "STAY_EXTENDED", entityType: "Allocation", entityId: a.id, before: { endDate: current }, after: { endDate: newEndDate, extraDays: extra, reason: reason.trim() } }, tx);
      if (a.staff.userId) await enqueueNotification(tx, { recipientId: a.staff.userId, event: "allocation.extended", idempotencyKey: `extended:${a.id}:${newEndDate}`, payload: { allocationId: a.id, bed: a.bed.code, endDate: newEndDate } });
      return updated;
    });
  } catch (error) {
    if (error instanceof Error && error.message.includes("Allocation_no_overlap")) throw new AllocationError("BED_OCCUPIED", "Someone else is booked into this bed straight after; the stay cannot be extended in place. Move the resident instead.");
    throw error;
  }
}

// ---------------------------------------------------------------------------
// Bed swap between two residents (Officer executes, Resident requests)
// ---------------------------------------------------------------------------

export async function swapBeds(actor: ActorLike, allocationAId: string, allocationBId: string, reason: string) {
  if (allocationAId === allocationBId) throw new AllocationError("INVALID_STATE", "Choose two different stays.");
  if (!reason?.trim()) throw new AllocationError("INVALID_STATE", "Give a reason for the swap.");
  return prisma.$transaction(async (tx) => {
    const [a, b] = await Promise.all([
      tx.allocation.findUnique({ where: { id: allocationAId }, include: { staff: true, bed: bedCtx } }),
      tx.allocation.findUnique({ where: { id: allocationBId }, include: { staff: true, bed: bedCtx } }),
    ]);
    if (!a || !b) throw new AllocationError("NOT_FOUND", "Allocation not found.");
    for (const x of [a, b]) {
      const cx = { siteId: x.bed.room.building.siteId, buildingId: x.bed.room.buildingId };
      if (!actorCan(actor, "accom.bed_swap", cx) && !actorAccessExecute(actor, cx)) throw new AllocationError("FORBIDDEN", "Your role does not allow swapping beds here.");
      if (!OCCUPYING_STATUSES.includes(x.status)) throw new AllocationError("INVALID_STATE", "Both stays must be current or upcoming.");
    }
    // Each resident must be allowed in the other's room: gender policy and eligibility.
    for (const [person, target] of [[a, b], [b, a]] as const) {
      const room = target.bed.room;
      const policy = effectivePolicy(room, room.building, room.building.site);
      if (policy.genderPolicy !== "ANY" && person.staff.gender !== "ANY" && person.staff.gender !== policy.genderPolicy) throw new AllocationError("GENDER_POLICY", `${person.staff.firstName} cannot move to room ${room.code}: it is reserved for ${policy.genderPolicy.toLowerCase()} residents.`);
      const check = checkEligibility(person.staff, room, policy.eligibility, { startDate: isoDate(person.startDate), endDate: person.endDate ? isoDate(person.endDate) : null });
      if (!check.ok) throw new AllocationError("NOT_ELIGIBLE", `${person.staff.firstName} ${person.staff.lastName} is not eligible for room ${room.code}: ${check.reasons.join(" ")}`);
    }
    // The overlap guard is checked at the end of the transaction so both rows can change places.
    await tx.$executeRawUnsafe('SET CONSTRAINTS "Allocation_no_overlap" DEFERRED');
    await tx.allocation.update({ where: { id: a.id }, data: { bedId: b.bedId, notes: [a.notes, `Swapped beds with ${b.staff.firstName} ${b.staff.lastName}: ${reason.trim()}`].filter(Boolean).join(" | ") } });
    await tx.allocation.update({ where: { id: b.id }, data: { bedId: a.bedId, notes: [b.notes, `Swapped beds with ${a.staff.firstName} ${a.staff.lastName}: ${reason.trim()}`].filter(Boolean).join(" | ") } });
    await tx.$executeRawUnsafe('SET CONSTRAINTS "Allocation_no_overlap" IMMEDIATE');
    await recordAudit({ actorId: actor.id, action: "BED_SWAP", entityType: "Allocation", entityId: a.id, after: { with: b.id, from: a.bed.code, to: b.bed.code, reason: reason.trim() } }, tx);
    for (const [p, from, to] of [[a, a.bed, b.bed], [b, b.bed, a.bed]] as const) {
      if (p.staff.userId) await enqueueNotification(tx, { recipientId: p.staff.userId, event: "allocation.swapped", idempotencyKey: `swap:${a.id}:${b.id}:${p.id}`, payload: { allocationId: p.id, from: from.code, to: to.code } });
    }
    return { a: { allocationId: a.id, bed: b.bed.code }, b: { allocationId: b.id, bed: a.bed.code } };
  });
}

/** The matrix gives Officers "Execute" (limited) on swaps and transfers; this recognises that tag. */
function actorAccessExecute(actor: ActorLike, ctx: { siteId?: string | null; buildingId?: string | null }) {
  const assignments: Array<{ role: string; siteId?: string | null; buildingId?: string | null }> = actor.roleAssignments ?? actor.roles.map((role) => ({ role }));
  return assignments.some((r) => r.role === "ACCOMMODATION_OFFICER" && ((!r.siteId && !r.buildingId) || (r.buildingId ? r.buildingId === ctx.buildingId : r.siteId === ctx.siteId)));
}

// ---------------------------------------------------------------------------
// Bulk allocation (Admin with the Bulk allocation grant)
// ---------------------------------------------------------------------------

export type BulkAllocateInput = { staffIds: string[]; startDate: string; endDate?: string | null; siteId?: string | null; buildingId?: string | null; reason?: string | null; eligibilityOverrideReason?: string | null };
export type BulkResult = { staffId: string; name: string; ok: boolean; bed?: string; allocationId?: string; error?: string };

/** Places many people in one go: the first eligible bed for each, best fit by building and room order. Each placement stands alone. */
export async function bulkAllocate(actor: ActorLike, input: BulkAllocateInput): Promise<{ results: BulkResult[]; placed: number }> {
  if (!actorCan(actor, "accom.bulk_allocate", { siteId: input.siteId })) throw new AllocationError("FORBIDDEN", "Bulk allocation needs the Bulk allocation grant.");
  if (input.staffIds.length === 0 || input.staffIds.length > 200) throw new AllocationError("INVALID_STATE", "Choose between 1 and 200 people.");
  const results: BulkResult[] = [];
  const taken = new Set<string>();
  for (const staffId of input.staffIds) {
    const staff = await prisma.staffProfile.findUnique({ where: { id: staffId } });
    const name = staff ? `${staff.firstName} ${staff.lastName}` : staffId;
    if (!staff) { results.push({ staffId, name, ok: false, error: "Staff member not found." }); continue; }
    const beds = (await findAvailableBeds({ startDate: input.startDate, endDate: input.endDate ?? null, siteId: input.siteId ?? null, buildingId: input.buildingId ?? null, gender: staff.gender })).filter((b) => !taken.has(b.id));
    let done: BulkResult | null = null;
    let lastError = "No bed is available for those dates.";
    for (const bed of beds) {
      const room = bed.room;
      const policy = effectivePolicy(room, room.building, room.building.site);
      const check = checkEligibility(staff, room, policy.eligibility, { startDate: input.startDate, endDate: input.endDate ?? null });
      if (!check.ok && !input.eligibilityOverrideReason) { lastError = check.reasons[0] ?? lastError; continue; }
      try {
        const a = await allocate({ staffId, bedId: bed.id, startDate: input.startDate, endDate: input.endDate ?? null, actorId: actor.id, actor, reason: input.reason ?? "Bulk allocation", eligibilityOverrideReason: check.ok ? null : input.eligibilityOverrideReason });
        taken.add(bed.id);
        done = { staffId, name, ok: true, bed: bed.code, allocationId: a.id };
        break;
      } catch (e) { lastError = e instanceof Error ? e.message : String(e); }
    }
    results.push(done ?? { staffId, name, ok: false, error: lastError });
  }
  const placed = results.filter((r) => r.ok).length;
  await recordAudit({ actorId: actor.id, action: "BULK_ALLOCATION", entityType: "Allocation", entityId: input.siteId ?? "all", after: { requested: input.staffIds.length, placed, startDate: input.startDate } });
  return { results, placed };
}

// ---------------------------------------------------------------------------
// Waitlist
// ---------------------------------------------------------------------------

export async function addToWaitlist(actor: ActorLike, input: { staffId: string; siteId?: string | null; roomType?: string | null; neededFrom: string; priority?: number; notes?: string | null }) {
  if (!actorCan(actor, "accom.allocate")) throw new AllocationError("FORBIDDEN", "Only an Accommodation Admin manages the waitlist.");
  if (!isIsoDate(input.neededFrom)) throw new AllocationError("INVALID_DATES", "Enter the date a bed is needed from.");
  const staff = await prisma.staffProfile.findUnique({ where: { id: input.staffId } });
  if (!staff || staff.archivedAt) throw new AllocationError("NOT_FOUND", "Staff member not found.");
  if (await prisma.waitlistEntry.findFirst({ where: { staffId: staff.id, status: { in: ["WAITING", "OFFERED"] } } })) throw new AllocationError("STAFF_ALREADY_ALLOCATED", "That person is already on the waitlist.");
  return prisma.$transaction(async (tx) => {
    const e = await tx.waitlistEntry.create({ data: { staffId: staff.id, siteId: input.siteId || null, roomType: input.roomType || null, neededFrom: toDate(input.neededFrom), priority: input.priority ?? 0, notes: input.notes || null, createdById: actor.id } });
    await recordAudit({ actorId: actor.id, action: "WAITLIST_ADDED", entityType: "WaitlistEntry", entityId: e.id, after: { staffId: staff.id, neededFrom: input.neededFrom } }, tx);
    return e;
  });
}

export async function listWaitlist() {
  return prisma.waitlistEntry.findMany({ where: { status: { in: ["WAITING", "OFFERED"] } }, include: { staff: true }, orderBy: [{ priority: "desc" }, { neededFrom: "asc" }, { createdAt: "asc" }] });
}

/** Beds that could be offered to a waitlisted person right now (available, allowed, matching the wanted room type). */
export async function suggestForWaitlist(entryId: string, days = 90) {
  const e = await prisma.waitlistEntry.findUnique({ where: { id: entryId }, include: { staff: true } });
  if (!e) throw new AllocationError("NOT_FOUND", "Waitlist entry not found.");
  const start = isoDate(e.neededFrom) < new Date().toISOString().slice(0, 10) ? new Date().toISOString().slice(0, 10) : isoDate(e.neededFrom);
  const beds = await findAvailableBeds({ startDate: start, endDate: null, siteId: e.siteId, gender: e.staff.gender });
  return beds.filter((b) => {
    if (e.roomType && b.room.type !== e.roomType) return false;
    const policy = effectivePolicy(b.room, b.room.building, b.room.building.site);
    return checkEligibility(e.staff, b.room, policy.eligibility, { startDate: start, endDate: null }).ok;
  }).slice(0, 20).map((b) => ({ bedId: b.id, label: `${b.room.building.name} · room ${b.room.code} · bed ${b.code}`, startDate: start, days }));
}

export async function allocateFromWaitlist(actor: ActorLike, entryId: string, bedId: string, startDate?: string | null) {
  if (!actorCan(actor, "accom.allocate")) throw new AllocationError("FORBIDDEN", "Only an Accommodation Admin manages the waitlist.");
  const e = await prisma.waitlistEntry.findUnique({ where: { id: entryId } });
  if (!e || (e.status !== "WAITING" && e.status !== "OFFERED")) throw new AllocationError("INVALID_STATE", "That waitlist entry is not open.");
  const start = startDate && isIsoDate(startDate) ? startDate : (isoDate(e.neededFrom) < new Date().toISOString().slice(0, 10) ? new Date().toISOString().slice(0, 10) : isoDate(e.neededFrom));
  const a = await allocate({ staffId: e.staffId, bedId, startDate: start, actorId: actor.id, actor, reason: "From waitlist" });
  await prisma.$transaction(async (tx) => {
    await tx.waitlistEntry.update({ where: { id: e.id }, data: { status: "ALLOCATED", allocationId: a.id, offeredBedId: bedId } });
    await recordAudit({ actorId: actor.id, action: "WAITLIST_ALLOCATED", entityType: "WaitlistEntry", entityId: e.id, after: { allocationId: a.id } }, tx);
  });
  return a;
}

export async function cancelWaitlist(actor: ActorLike, entryId: string, reason: string) {
  if (!actorCan(actor, "accom.allocate")) throw new AllocationError("FORBIDDEN", "Only an Accommodation Admin manages the waitlist.");
  if (!reason?.trim()) throw new AllocationError("INVALID_STATE", "Give a reason.");
  const e = await prisma.waitlistEntry.findUnique({ where: { id: entryId } });
  if (!e || (e.status !== "WAITING" && e.status !== "OFFERED")) throw new AllocationError("INVALID_STATE", "That waitlist entry is not open.");
  await prisma.$transaction(async (tx) => {
    await tx.waitlistEntry.update({ where: { id: entryId }, data: { status: "CANCELLED", notes: [e.notes, `Cancelled: ${reason.trim()}`].filter(Boolean).join(" | ") } });
    await recordAudit({ actorId: actor.id, action: "WAITLIST_CANCELLED", entityType: "WaitlistEntry", entityId: entryId, after: { reason: reason.trim() } }, tx);
  });
}

// ---------------------------------------------------------------------------
// Room readiness (Officer and Admin)
// ---------------------------------------------------------------------------

export async function setReadiness(actor: ActorLike, target: { bedId?: string; roomId?: string }, readiness: BedReadiness) {
  const beds = await prisma.bed.findMany({ where: target.bedId ? { id: target.bedId } : { roomId: target.roomId, status: { in: ["ACTIVE", "DRAFT", "MAINTENANCE"] } }, include: { room: { include: { building: true } } } });
  if (beds.length === 0) throw new AllocationError("NOT_FOUND", "Bed or room not found.");
  for (const b of beds) if (!actorCan(actor, "accom.readiness", { siteId: b.room.building.siteId, buildingId: b.room.buildingId })) throw new AllocationError("FORBIDDEN", "Your role does not allow updating room readiness here.");
  await prisma.$transaction(async (tx) => {
    await tx.bed.updateMany({ where: { id: { in: beds.map((b) => b.id) } }, data: { readiness, readinessUpdatedAt: new Date() } });
    // A bed marked ready closes its open cleaning task.
    if (readiness === "READY") await tx.cleaningTask.updateMany({ where: { OR: [{ bedId: { in: beds.map((b) => b.id) } }, { roomId: { in: [...new Set(beds.map((b) => b.roomId))] } }], status: { in: ["OPEN", "IN_PROGRESS"] } }, data: { status: "DONE", completedAt: new Date(), completedById: actor.id } });
    await recordAudit({ actorId: actor.id, action: "READINESS_SET", entityType: target.bedId ? "Bed" : "Room", entityId: target.bedId ?? target.roomId!, after: { readiness, beds: beds.length } }, tx);
  });
  return beds.length;
}

export type { Tx };
