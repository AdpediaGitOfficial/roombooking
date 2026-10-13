// Joiners, exits and clearances (document 4, People). HRMS sync is the preferred source; the Accommodation Admin
// can raise either by hand. A joiner gets a bed reserved with an arrival date; an exit sets the checkout due date
// and stays open until keys and assets are back and the stay is closed.
import type { Prisma, StaffSource, StayType } from "@prisma/client";
import { prisma } from "../../lib/db";
import { recordAudit } from "../../lib/audit";
import { enqueueNotification } from "../../lib/notifications";
import { actorCan, type ActorLike } from "../../lib/permissions/actor";
import { OCCUPYING_STATUSES, isoDate } from "../accommodation/occupancy";
import { allocate, cancel as cancelAllocation, clearanceBlockers, isIsoDate, toDate } from "../allocations/service";
import { PeopleError } from "./errors";

const CHECKOUT_DUE_DAYS = Number(process.env.CHECKOUT_DUE_DAYS ?? 3);

// ---------------------------------------------------------------------------
// Joiners
// ---------------------------------------------------------------------------

export type JoinerInput = { staffId: string; siteId?: string | null; expectedArrival: string; stayType?: StayType; notes?: string | null; bedId?: string | null; endDate?: string | null; source?: StaffSource };

/** Raises a joiner or transferee request. With a bed it reserves the bed straight away; otherwise the Admin allocates later. */
export async function createJoiner(actor: ActorLike, input: JoinerInput) {
  if (!actorCan(actor, "people.joiner")) throw new PeopleError("FORBIDDEN", "Only an Accommodation Admin can raise joiner requests.");
  if (!isIsoDate(input.expectedArrival)) throw new PeopleError("VALIDATION", "Enter the expected arrival date.", { expectedArrival: "Required." });
  const staff = await prisma.staffProfile.findUnique({ where: { id: input.staffId } });
  if (!staff) throw new PeopleError("NOT_FOUND", "Staff record not found.");
  if (staff.archivedAt) throw new PeopleError("INVALID_STATE", "That profile is archived; rehire them first.");
  if (await prisma.joiner.findFirst({ where: { staffId: staff.id, status: { in: ["EXPECTED", "ALLOCATED"] } } })) throw new PeopleError("CONFLICT", "That person already has an open joiner request.");
  let allocationId: string | null = null;
  if (input.bedId) {
    const a = await allocate({ staffId: staff.id, bedId: input.bedId, startDate: input.expectedArrival, endDate: input.endDate ?? null, actorId: actor.id, actor, stayType: input.stayType, reason: "New joiner" });
    allocationId = a.id;
  }
  return prisma.$transaction(async (tx) => {
    const joiner = await tx.joiner.create({ data: { staffId: staff.id, siteId: input.siteId || null, expectedArrival: toDate(input.expectedArrival), stayType: input.stayType ?? "PERMANENT", status: allocationId ? "ALLOCATED" : "EXPECTED", allocationId, notes: input.notes || null, source: input.source ?? "MANUAL", raisedById: actor.id } });
    await recordAudit({ actorId: actor.id, action: "JOINER_RAISED", entityType: "Joiner", entityId: joiner.id, after: { staffId: staff.id, expectedArrival: input.expectedArrival, allocationId, source: joiner.source } }, tx);
    return joiner;
  });
}

export async function cancelJoiner(actor: ActorLike, joinerId: string, reason: string) {
  if (!actorCan(actor, "people.joiner")) throw new PeopleError("FORBIDDEN", "Only an Accommodation Admin can cancel joiner requests.");
  if (!reason?.trim()) throw new PeopleError("VALIDATION", "Give a reason.", { reason: "Required." });
  const joiner = await prisma.joiner.findUnique({ where: { id: joinerId } });
  if (!joiner) throw new PeopleError("NOT_FOUND", "Joiner not found.");
  if (joiner.status === "ARRIVED" || joiner.status === "CANCELLED") throw new PeopleError("INVALID_STATE", `That joiner is already ${joiner.status.toLowerCase()}.`);
  if (joiner.allocationId) await cancelAllocation({ allocationId: joiner.allocationId, actorId: actor.id, reason: reason.trim() }).catch(() => undefined);
  await prisma.$transaction(async (tx) => {
    await tx.joiner.update({ where: { id: joinerId }, data: { status: "CANCELLED", notes: [joiner.notes, `Cancelled: ${reason.trim()}`].filter(Boolean).join(" | ") } });
    await recordAudit({ actorId: actor.id, action: "JOINER_CANCELLED", entityType: "Joiner", entityId: joinerId, after: { reason: reason.trim() } }, tx);
  });
}

/** Marks joiners whose reserved bed has been checked in as arrived; run with the daily sweep. */
export async function sweepJoiners() {
  const open = await prisma.joiner.findMany({ where: { status: "ALLOCATED", allocationId: { not: null } }, include: { staff: false } });
  let arrived = 0;
  for (const j of open) {
    const a = await prisma.allocation.findUnique({ where: { id: j.allocationId! }, select: { status: true } });
    if (a?.status === "CHECKED_IN" || a?.status === "CHECKED_OUT") { await prisma.joiner.update({ where: { id: j.id }, data: { status: "ARRIVED" } }); arrived++; }
  }
  return arrived;
}

export async function listJoiners(opts: { status?: "OPEN" | "ALL"; take?: number } = {}) {
  return prisma.joiner.findMany({
    where: opts.status === "ALL" ? {} : { status: { in: ["EXPECTED", "ALLOCATED"] } },
    include: { staff: true },
    orderBy: { expectedArrival: "asc" },
    take: opts.take ?? 200,
  });
}

// ---------------------------------------------------------------------------
// Exits and clearances
// ---------------------------------------------------------------------------

export async function triggerExit(actor: ActorLike, input: { staffId: string; lastDay: string; reason?: string | null; source?: StaffSource }) {
  if (!actorCan(actor, "people.exit")) throw new PeopleError("FORBIDDEN", "Only an Accommodation Admin can trigger an exit.");
  if (!isIsoDate(input.lastDay)) throw new PeopleError("VALIDATION", "Enter the last day.", { lastDay: "Required." });
  const staff = await prisma.staffProfile.findUnique({ where: { id: input.staffId } });
  if (!staff) throw new PeopleError("NOT_FOUND", "Staff record not found.");
  if (await prisma.exitCase.findFirst({ where: { staffId: staff.id, status: { in: ["OPEN", "CHECKOUT_DUE", "CLEARING"] } } })) throw new PeopleError("CONFLICT", "An exit is already open for that person.");
  return prisma.$transaction(async (tx) => {
    const ec = await tx.exitCase.create({ data: { staffId: staff.id, triggeredById: actor.id, lastDay: toDate(input.lastDay), reason: input.reason?.trim() || null, source: input.source ?? "MANUAL" } });
    // The stay ends on the last day: shorten the current allocation, or cancel one that has not started.
    const live = await tx.allocation.findMany({ where: { staffId: staff.id, status: { in: OCCUPYING_STATUSES } } });
    for (const a of live) {
      if (a.status === "CONFIRMED" && isoDate(a.startDate) >= input.lastDay) {
        await tx.allocation.update({ where: { id: a.id }, data: { status: "CANCELLED", reason: "Exit before arrival" } });
      } else if (!a.endDate || isoDate(a.endDate) > input.lastDay) {
        await tx.allocation.update({ where: { id: a.id }, data: { endDate: toDate(input.lastDay) > toDate(isoDate(a.startDate)) ? toDate(input.lastDay) : toDate(isoDate(a.startDate)) } });
      }
    }
    await tx.staffProfile.updateMany({ where: { id: staff.id, employmentStatus: "ACTIVE" }, data: { employmentStatus: "ACTIVE" } });
    await recordAudit({ actorId: actor.id, action: "EXIT_TRIGGERED", entityType: "ExitCase", entityId: ec.id, after: { staffId: staff.id, lastDay: input.lastDay, allocations: live.length, source: ec.source } }, tx);
    if (staff.userId) await enqueueNotification(tx, { recipientId: staff.userId, event: "exit.triggered", idempotencyKey: `exit:${ec.id}`, payload: { lastDay: input.lastDay } });
    return ec;
  });
}

export type Clearance = { exit: { id: string; status: string; lastDay: string }; blockers: Array<{ type: string; label: string }>; stay: { status: string; endDate: string | null } | null; pendingCharges: number; ready: boolean };

/** What still stands between a leaving resident and clearance: keys, assets, charges, and the stay itself. */
export async function clearanceStatus(exitId: string): Promise<Clearance> {
  const ec = await prisma.exitCase.findUnique({ where: { id: exitId } });
  if (!ec) throw new PeopleError("NOT_FOUND", "Exit case not found.");
  const [blockers, stay, charges] = await Promise.all([
    clearanceBlockers(ec.staffId),
    prisma.allocation.findFirst({ where: { staffId: ec.staffId, status: { in: ["CHECKED_IN", "CONFIRMED"] } }, orderBy: { startDate: "desc" } }),
    prisma.charge.count({ where: { staffId: ec.staffId, status: { in: ["PENDING_APPROVAL", "APPROVED"] } } }),
  ]);
  return {
    exit: { id: ec.id, status: ec.status, lastDay: isoDate(ec.lastDay) },
    blockers,
    stay: stay ? { status: stay.status, endDate: stay.endDate ? isoDate(stay.endDate) : null } : null,
    pendingCharges: charges,
    ready: blockers.length === 0 && !stay && charges === 0,
  };
}

/** Closes the clearance. Keys and assets must be back and the stay checked out; open charges are flagged, not blocking. */
export async function closeClearance(actor: ActorLike, exitId: string, note?: string | null) {
  if (!actorCan(actor, "people.clearance")) throw new PeopleError("FORBIDDEN", "Only an Accommodation Admin can close a clearance.");
  const c = await clearanceStatus(exitId);
  if (c.exit.status === "CLEARED" || c.exit.status === "CANCELLED") throw new PeopleError("INVALID_STATE", `That exit is already ${c.exit.status.toLowerCase()}.`);
  if (c.stay) throw new PeopleError("INVALID_STATE", "The resident still holds a bed: check them out first.");
  if (c.blockers.length) throw new PeopleError("INVALID_STATE", `Keys and assets are still out: ${c.blockers.map((b) => b.label).join(", ")}. Record their return, or record a loss, first.`);
  const ec = await prisma.exitCase.findUniqueOrThrow({ where: { id: exitId } });
  return prisma.$transaction(async (tx) => {
    const updated = await tx.exitCase.update({ where: { id: exitId }, data: { status: "CLEARED", clearedAt: new Date(), clearedById: actor.id, clearanceNote: note?.trim() || null } });
    await tx.staffProfile.update({ where: { id: ec.staffId }, data: { employmentStatus: "TERMINATED", archivedAt: new Date(), archivedById: actor.id, archiveReason: "Exit cleared" } });
    await recordAudit({ actorId: actor.id, action: "CLEARANCE_CLOSED", entityType: "ExitCase", entityId: exitId, after: { staffId: ec.staffId, pendingCharges: c.pendingCharges, note: note ?? null } }, tx);
    return updated;
  });
}

export async function cancelExit(actor: ActorLike, exitId: string, reason: string) {
  if (!actorCan(actor, "people.exit")) throw new PeopleError("FORBIDDEN", "Only an Accommodation Admin can cancel an exit.");
  if (!reason?.trim()) throw new PeopleError("VALIDATION", "Give a reason.", { reason: "Required." });
  const ec = await prisma.exitCase.findUnique({ where: { id: exitId } });
  if (!ec) throw new PeopleError("NOT_FOUND", "Exit case not found.");
  if (ec.status === "CLEARED" || ec.status === "CANCELLED") throw new PeopleError("INVALID_STATE", `That exit is already ${ec.status.toLowerCase()}.`);
  await prisma.$transaction(async (tx) => {
    await tx.exitCase.update({ where: { id: exitId }, data: { status: "CANCELLED", clearanceNote: reason.trim() } });
    await recordAudit({ actorId: actor.id, action: "EXIT_CANCELLED", entityType: "ExitCase", entityId: exitId, after: { reason: reason.trim() } }, tx);
  });
}

export async function listExits(opts: { status?: "OPEN" | "ALL"; take?: number } = {}) {
  return prisma.exitCase.findMany({
    where: opts.status === "ALL" ? {} : { status: { in: ["OPEN", "CHECKOUT_DUE", "CLEARING"] } },
    include: { staff: { include: { allocations: { where: { status: { in: ["CHECKED_IN", "CONFIRMED"] } }, include: { bed: { include: { room: { include: { building: true } } } } }, take: 1 } } } },
    orderBy: { lastDay: "asc" },
    take: opts.take ?? 200,
  });
}

/** Daily: exits whose last day is near become "Checkout due"; those with the stay already closed move to "Clearing". */
export async function sweepExits(now: Date = new Date()) {
  const today = now.toISOString().slice(0, 10);
  const horizon = new Date(now.getTime() + CHECKOUT_DUE_DAYS * 86400000).toISOString().slice(0, 10);
  const open = await prisma.exitCase.findMany({ where: { status: { in: ["OPEN", "CHECKOUT_DUE"] } }, include: { staff: { select: { userId: true } } } });
  let due = 0, clearing = 0;
  for (const ec of open) {
    const stay = await prisma.allocation.count({ where: { staffId: ec.staffId, status: { in: ["CHECKED_IN", "CONFIRMED"] } } });
    if (!stay && ec.status !== "OPEN" ? true : !stay) {
      await prisma.exitCase.update({ where: { id: ec.id }, data: { status: "CLEARING" } }); clearing++; continue;
    }
    if (ec.status === "OPEN" && isoDate(ec.lastDay) <= horizon) {
      await prisma.$transaction(async (tx) => {
        await tx.exitCase.update({ where: { id: ec.id }, data: { status: "CHECKOUT_DUE" } });
        if (ec.staff.userId) await enqueueNotification(tx, { recipientId: ec.staff.userId, event: "exit.checkout_due", idempotencyKey: `exit.due:${ec.id}`, payload: { lastDay: isoDate(ec.lastDay), overdue: isoDate(ec.lastDay) < today } });
      });
      due++;
    }
  }
  return { due, clearing };
}

export type { Prisma };
