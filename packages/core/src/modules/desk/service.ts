// Desk and gate shift log (document modules Front desk and Security: "Shift log", L3 desk / shift reports).
// A shift summary is computed from what the person actually did during the shift (the audit trail),
// plus the notes they add, so handover does not depend on memory.
import type { Role } from "@prisma/client";
import { prisma } from "../../lib/db";
import { recordAudit } from "../../lib/audit";

export class ShiftError extends Error {
  constructor(public readonly code: "INVALID_STATE" | "NOT_FOUND" | "FORBIDDEN", message: string) {
    super(message);
    this.name = "ShiftError";
  }
}

export async function currentShift(userId: string) {
  return prisma.shiftLog.findFirst({ where: { userId, endedAt: null }, orderBy: { startedAt: "desc" } });
}

export async function startShift(input: { userId: string; role: Role; siteId?: string | null }) {
  if (await currentShift(input.userId)) throw new ShiftError("INVALID_STATE", "You already have a shift open. End it first.");
  return prisma.$transaction(async (tx) => {
    const shift = await tx.shiftLog.create({ data: { userId: input.userId, role: input.role, siteId: input.siteId ?? null } });
    await recordAudit({ actorId: input.userId, action: "SHIFT_STARTED", entityType: "ShiftLog", entityId: shift.id, after: { role: input.role, siteId: input.siteId ?? null } }, tx);
    return shift;
  });
}

const GROUPS: Array<[label: string, actions: string[]]> = [
  ["Check-ins", ["ALLOCATION_CHECKED_IN", "EMERGENCY_CHECKIN"]],
  ["Check-outs", ["ALLOCATION_CHECKED_OUT"]],
  ["Transfers and swaps", ["ALLOCATION_TRANSFERRED", "BED_SWAP"]],
  ["Keys issued", ["KEY_ISSUED"]],
  ["Keys returned", ["KEY_RETURNED"]],
  ["Tickets raised", ["WORK_ORDER_CREATED"]],
  ["Visitors checked in", ["VISITOR_CHECKED_IN"]],
  ["Visitors checked out", ["VISITOR_CHECKED_OUT"]],
  ["Parcels logged", ["PARCEL_LOGGED"]],
  ["Incidents reported", ["INCIDENT_REPORTED"]],
  ["Patrol checkpoints", ["PATROL_SCANNED"]],
];

/** Counts of what the person did between two instants, from the audit trail. */
export async function shiftActivity(userId: string, from: Date, to: Date = new Date()) {
  const events = await prisma.auditEvent.groupBy({ by: ["action"], where: { actorId: userId, createdAt: { gte: from, lte: to } }, _count: true });
  const byAction = new Map(events.map((e) => [e.action, e._count]));
  return GROUPS.map(([label, actions]) => ({ label, count: actions.reduce((n, a) => n + (byAction.get(a) ?? 0), 0) })).filter((g) => g.count > 0);
}

export async function endShift(input: { userId: string; notes?: string | null }) {
  const shift = await currentShift(input.userId);
  if (!shift) throw new ShiftError("NOT_FOUND", "You have no open shift.");
  const now = new Date();
  const activity = await shiftActivity(input.userId, shift.startedAt, now);
  return prisma.$transaction(async (tx) => {
    const ended = await tx.shiftLog.update({ where: { id: shift.id }, data: { endedAt: now, notes: input.notes?.trim() || null, summary: { activity } } });
    await recordAudit({ actorId: input.userId, action: "SHIFT_ENDED", entityType: "ShiftLog", entityId: shift.id, after: { minutes: Math.round((now.getTime() - shift.startedAt.getTime()) / 60000), activity } }, tx);
    return ended;
  });
}

export async function recentShifts(opts: { userId?: string; siteIds?: string[] | null; take?: number } = {}) {
  return prisma.shiftLog.findMany({
    where: { ...(opts.userId ? { userId: opts.userId } : {}), ...(opts.siteIds ? { OR: [{ siteId: null }, { siteId: { in: opts.siteIds } }] } : {}) },
    orderBy: { startedAt: "desc" },
    take: opts.take ?? 30,
  });
}
