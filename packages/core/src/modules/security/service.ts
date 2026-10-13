// Security and visitors (document sections 5.7, 6, 8): visitor policy, pre-registration, approval of overnight and
// restricted-area visitors, walk-ins confirmed by the host, gate check-in and out, resident verification, incidents,
// parcels, SOS, patrol rounds and the restricted entry list.
import { randomInt } from "node:crypto";
import type { IncidentSeverity, IncidentStatus, Prisma, VisitorKind } from "@prisma/client";
import { prisma } from "../../lib/db";
import { recordAudit } from "../../lib/audit";
import { enqueueNotification } from "../../lib/notifications";
import { actorAccess, actorCan, type ActorLike } from "../../lib/permissions/actor";
import { personLevel, viewPerson, type PersonRecord } from "../../lib/permissions/privacy";
import { OCCUPYING_STATUSES } from "../accommodation/occupancy";
import { stayStatus, STAY_LABEL } from "../people/service";
import { contractorAccessCheck } from "../maintenance/extras";
import { SecurityError } from "./errors";

type Tx = Prisma.TransactionClient;
const HOUR = 3600000;
const iso = (d: Date) => d.toISOString().slice(0, 10);

// ---------------------------------------------------------------------------
// Visitor policy per site (master item VISITOR_POLICY, data = policy)
// ---------------------------------------------------------------------------

export type VisitorPolicy = { dayVisitorsAllowed: boolean; overnightAllowed: boolean; maxNights: number; maxDayHours: number; maxActivePerHost: number; curfewHour: number | null; requireIdAtGate: boolean };
export const DEFAULT_POLICY: VisitorPolicy = { dayVisitorsAllowed: true, overnightAllowed: true, maxNights: 3, maxDayHours: 8, maxActivePerHost: 3, curfewHour: null, requireIdAtGate: true };

export async function visitorPolicy(siteId: string): Promise<VisitorPolicy> {
  const items = await prisma.masterItem.findMany({ where: { kind: "VISITOR_POLICY", status: "ACTIVE", archivedAt: null, OR: [{ siteId }, { siteId: null }] }, orderBy: { siteId: "asc" } });
  const site = items.find((i) => i.siteId === siteId) ?? items[0];
  return { ...DEFAULT_POLICY, ...((site?.data as Partial<VisitorPolicy> | null) ?? {}) };
}

export async function savePolicy(actor: ActorLike, organizationId: string, siteId: string, policy: Partial<VisitorPolicy>) {
  if (!actorCan(actor, "sec.visitor_policy", { siteId })) throw new SecurityError("FORBIDDEN", "Only an Admin can set the visitor policy.");
  const merged = { ...(await visitorPolicy(siteId)), ...policy };
  if (merged.maxNights < 0 || merged.maxActivePerHost < 1) throw new SecurityError("VALIDATION", "Check the policy limits.");
  await prisma.masterItem.upsert({ where: { organizationId_kind_code_siteId: { organizationId, kind: "VISITOR_POLICY", code: "POLICY", siteId } }, update: { data: merged as never }, create: { organizationId, siteId, kind: "VISITOR_POLICY", code: "POLICY", name: "Visitor policy", data: merged as never } });
  await recordAudit({ actorId: actor.id, action: "VISITOR_POLICY_SET", entityType: "Site", entityId: siteId, after: merged as never });
  return merged;
}

// ---------------------------------------------------------------------------
// Restricted entry list
// ---------------------------------------------------------------------------

const norm = (s: string | null | undefined) => (s ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");

export async function restrictedMatch(input: { name: string; idNumber?: string | null; siteId: string }) {
  const rows = await prisma.restrictedEntry.findMany({ where: { removedAt: null, OR: [{ siteId: null }, { siteId: input.siteId }] } });
  return rows.find((r) => (r.idNumber && input.idNumber && norm(r.idNumber) === norm(input.idNumber)) || (norm(r.name) === norm(input.name) && norm(input.name).length > 0)) ?? null;
}

export async function addRestricted(actor: ActorLike, input: { siteId?: string | null; name: string; idNumber?: string | null; reason: string }) {
  if (!actorCan(actor, "sec.restricted_edit", { siteId: input.siteId })) throw new SecurityError("FORBIDDEN", "Only an Admin can add to the restricted entry list.");
  if (!input.name?.trim() || !input.reason?.trim()) throw new SecurityError("VALIDATION", "Enter the name and the reason.", { reason: "Required." });
  const row = await prisma.restrictedEntry.create({ data: { siteId: input.siteId || null, name: input.name.trim(), idNumber: input.idNumber?.trim() || null, reason: input.reason.trim(), addedById: actor.id } });
  await recordAudit({ actorId: actor.id, action: "RESTRICTED_ADDED", entityType: "RestrictedEntry", entityId: row.id, after: { name: row.name } });
  return row;
}

/** Removal needs a second pair of eyes (also enforced by the database): one Admin requests, a different Admin or the Super Admin approves. */
export async function removeRestricted(actor: ActorLike, entryId: string, note: string) {
  const e = await prisma.restrictedEntry.findUnique({ where: { id: entryId } });
  if (!e || e.removedAt) throw new SecurityError("NOT_FOUND", "Entry not found.");
  if (!actorCan(actor, "sec.restricted_edit", { siteId: e.siteId })) throw new SecurityError("FORBIDDEN", "Only an Admin can remove entries.");
  if (!note?.trim()) throw new SecurityError("VALIDATION", "Give a reason for the removal.", { note: "Required." });
  if (e.removalRequestedById && e.removalRequestedById !== actor.id) {
    await prisma.restrictedEntry.update({ where: { id: entryId }, data: { removedAt: new Date(), removedById: actor.id, removalNote: note.trim() } });
    await recordAudit({ actorId: actor.id, action: "RESTRICTED_REMOVED", entityType: "RestrictedEntry", entityId: entryId, after: { requestedBy: e.removalRequestedById } });
    return "removed" as const;
  }
  if (e.removalRequestedById === actor.id) throw new SecurityError("INVALID_STATE", "You already asked for this removal: a second Admin must approve it.");
  await prisma.restrictedEntry.update({ where: { id: entryId }, data: { removalRequestedById: actor.id, removalRequestedAt: new Date(), removalNote: note.trim() } });
  await recordAudit({ actorId: actor.id, action: "RESTRICTED_REMOVAL_REQUESTED", entityType: "RestrictedEntry", entityId: entryId });
  return "requested" as const;
}

export const listRestricted = (siteIds?: string[] | null) => prisma.restrictedEntry.findMany({ where: { removedAt: null, ...(siteIds ? { OR: [{ siteId: null }, { siteId: { in: siteIds } }] } : {}) }, orderBy: { addedAt: "desc" }, take: 300 });

// ---------------------------------------------------------------------------
// Visitors
// ---------------------------------------------------------------------------

const passCode = () => String(randomInt(0, 1_000_000)).padStart(6, "0");

export type VisitorInput = { siteId: string; kind: Exclude<VisitorKind, "WALK_IN">; name: string; phone?: string | null; idType?: string | null; idNumber?: string | null; company?: string | null; purpose?: string | null; hostStaffId: string; expectedAt: string; expectedOutAt?: string | null; nights?: number | null; restrictedArea?: string | null; vehicle?: string | null };

function when(v: string | null | undefined, field: string): Date | null {
  if (!v) return null;
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) throw new SecurityError("VALIDATION", "Enter a valid date and time.", { [field]: "Invalid." });
  return d;
}

async function hostChecks(tx: Tx | typeof prisma, hostStaffId: string, siteId: string, policy: VisitorPolicy) {
  const host = await tx.staffProfile.findUnique({ where: { id: hostStaffId }, include: { allocations: { where: { status: { in: OCCUPYING_STATUSES } }, include: { bed: { include: { room: { include: { building: true } } } } } } } });
  if (!host || host.archivedAt) throw new SecurityError("NOT_FOUND", "Host not found.");
  const here = host.allocations.find((a) => a.bed.room.building.siteId === siteId);
  if (!here) throw new SecurityError("VALIDATION", "The host has no bed at this site, so cannot receive visitors here.", { hostStaffId: "No bed at this site." });
  const active = await tx.visitor.count({ where: { hostStaffId, status: { in: ["APPROVED", "PENDING_APPROVAL", "CHECKED_IN", "WALK_IN_PENDING", "PRE_REGISTERED"] } } });
  if (active >= policy.maxActivePerHost) throw new SecurityError("VALIDATION", `A resident can have at most ${policy.maxActivePerHost} visitors at a time.`, { hostStaffId: "Visitor limit reached." });
  return host;
}

/** Pre-register a visitor. Day visitors within policy are approved automatically; overnight and restricted-area visitors wait for approval. */
export async function preRegister(actor: ActorLike, input: VisitorInput) {
  const staff = await prisma.staffProfile.findFirst({ where: { userId: actor.id }, select: { id: true } });
  const own = !!staff && staff.id === input.hostStaffId;
  const access = actorAccess(actor, "sec.preregister", { siteId: input.siteId });
  if (!access) throw new SecurityError("FORBIDDEN", "Pre-registering visitors is not switched on for your account.");
  if (!own && access.role === "STAFF") throw new SecurityError("FORBIDDEN", "Residents can only register visitors for themselves.");
  const policy = await visitorPolicy(input.siteId);
  const errors: Record<string, string> = {};
  if (!input.name?.trim()) errors.name = "Enter the visitor's name.";
  const expectedAt = when(input.expectedAt, "expectedAt");
  if (!expectedAt) errors.expectedAt = "Enter when they arrive.";
  else if (expectedAt.getTime() < Date.now() - 2 * HOUR) errors.expectedAt = "That time has passed.";
  if (Object.keys(errors).length) throw new SecurityError("VALIDATION", "Please correct the highlighted fields.", errors);
  let expectedOutAt = when(input.expectedOutAt, "expectedOutAt");
  if (input.kind === "DAY") {
    if (!policy.dayVisitorsAllowed) throw new SecurityError("DENIED", "Day visitors are not allowed at this site.");
    expectedOutAt = expectedOutAt ?? new Date(expectedAt!.getTime() + policy.maxDayHours * HOUR);
    if (expectedOutAt.getTime() - expectedAt!.getTime() > policy.maxDayHours * HOUR) throw new SecurityError("VALIDATION", `Day visits are limited to ${policy.maxDayHours} hours.`, { expectedOutAt: "Too long." });
  } else if (input.kind === "OVERNIGHT") {
    if (!policy.overnightAllowed) throw new SecurityError("DENIED", "Overnight visitors are not allowed at this site.");
    const nights = input.nights ?? 1;
    if (nights < 1 || nights > policy.maxNights) throw new SecurityError("VALIDATION", `Overnight stays are limited to ${policy.maxNights} night${policy.maxNights === 1 ? "" : "s"}.`, { nights: "Over the limit." });
    expectedOutAt = expectedOutAt ?? new Date(expectedAt!.getTime() + nights * 24 * HOUR);
  } else if (!input.restrictedArea?.trim()) throw new SecurityError("VALIDATION", "Name the restricted area.", { restrictedArea: "Required." });
  const hit = await restrictedMatch({ name: input.name, idNumber: input.idNumber, siteId: input.siteId });
  if (hit) throw new SecurityError("DENIED", "This person cannot be admitted to the site. Please contact the accommodation office.");
  await hostChecks(prisma, input.hostStaffId, input.siteId, policy);
  const needsApproval = input.kind !== "DAY";
  const row = await prisma.visitor.create({ data: { siteId: input.siteId, kind: input.kind, status: needsApproval ? "PENDING_APPROVAL" : "APPROVED", name: input.name.trim(), phone: input.phone?.trim() || null, idType: input.idType?.trim() || null, idNumber: input.idNumber?.trim() || null, company: input.company?.trim() || null, purpose: input.purpose?.trim() || null, hostStaffId: input.hostStaffId, hostUserId: (await prisma.staffProfile.findUnique({ where: { id: input.hostStaffId }, select: { userId: true } }))?.userId ?? null, registeredById: actor.id, expectedAt, expectedOutAt, nights: input.kind === "OVERNIGHT" ? (input.nights ?? 1) : null, restrictedArea: input.restrictedArea?.trim() || null, vehicle: input.vehicle?.trim() || null, passCode: needsApproval ? null : passCode() } });
  await recordAudit({ actorId: actor.id, action: "VISITOR_REGISTERED", entityType: "Visitor", entityId: row.id, after: { kind: row.kind, status: row.status, hostStaffId: row.hostStaffId } });
  if (needsApproval) {
    const approvers = await prisma.user.findMany({ where: { status: "ACTIVE", roleAssignments: { some: { role: { in: ["ACCOMMODATION_ADMIN"] } } } }, select: { id: true } });
    await prisma.$transaction(async (tx) => { for (const a of approvers) await enqueueNotification(tx, { recipientId: a.id, event: "visitor.approval_needed", idempotencyKey: `visitor.approval:${row.id}:${a.id}`, payload: { visitorId: row.id, name: row.name, kind: row.kind } }); });
  }
  return row;
}

export async function decideVisitor(actor: ActorLike, visitorId: string, approve: boolean, note?: string | null) {
  const v = await prisma.visitor.findUnique({ where: { id: visitorId } });
  if (!v) throw new SecurityError("NOT_FOUND", "Visitor not found.");
  if (!actorCan(actor, "sec.approve_overnight", { siteId: v.siteId })) throw new SecurityError("FORBIDDEN", "You cannot approve overnight or restricted-area visitors.");
  if (v.status !== "PENDING_APPROVAL") throw new SecurityError("INVALID_STATE", "That visitor is not waiting for approval.");
  if (v.registeredById === actor.id) throw new SecurityError("FORBIDDEN", "Someone else must approve a visitor you registered.");
  if (!approve && !note?.trim()) throw new SecurityError("VALIDATION", "Give a reason for refusing.", { note: "Required." });
  return prisma.$transaction(async (tx) => {
    const updated = await tx.visitor.update({ where: { id: v.id }, data: { status: approve ? "APPROVED" : "DENIED", approvedById: actor.id, decidedAt: new Date(), deniedReason: approve ? null : note!.trim(), passCode: approve ? passCode() : null } });
    await recordAudit({ actorId: actor.id, action: approve ? "VISITOR_APPROVED" : "VISITOR_REFUSED", entityType: "Visitor", entityId: v.id, after: { note: note ?? null } }, tx);
    if (v.hostUserId) await enqueueNotification(tx, { recipientId: v.hostUserId, event: approve ? "visitor.approved" : "visitor.refused", idempotencyKey: `visitor.decided:${v.id}`, payload: { visitorId: v.id, name: v.name, passCode: updated.passCode } });
    return updated;
  });
}

export async function cancelVisitor(actor: ActorLike, visitorId: string, reason?: string | null) {
  const v = await prisma.visitor.findUnique({ where: { id: visitorId } });
  if (!v) throw new SecurityError("NOT_FOUND", "Visitor not found.");
  const host = v.hostUserId === actor.id || v.registeredById === actor.id;
  if (!host && !actorCan(actor, "sec.approve_overnight", { siteId: v.siteId }) && !actorCan(actor, "sec.checkin_visitors", { siteId: v.siteId })) throw new SecurityError("FORBIDDEN", "You cannot cancel this visitor.");
  if (!["PRE_REGISTERED", "PENDING_APPROVAL", "APPROVED", "WALK_IN_PENDING"].includes(v.status)) throw new SecurityError("INVALID_STATE", "That visit can no longer be cancelled.");
  const updated = await prisma.visitor.update({ where: { id: v.id }, data: { status: "CANCELLED", deniedReason: reason?.trim() || null } });
  await recordAudit({ actorId: actor.id, action: "VISITOR_CANCELLED", entityType: "Visitor", entityId: v.id });
  return updated;
}

/** Security logs a walk-in; the host resident confirms or refuses before the visitor is let in. */
export async function registerWalkIn(actor: ActorLike, input: { siteId: string; name: string; hostStaffId: string; phone?: string | null; idType?: string | null; idNumber?: string | null; purpose?: string | null; vehicle?: string | null }) {
  if (!actorCan(actor, "sec.checkin_visitors", { siteId: input.siteId })) throw new SecurityError("FORBIDDEN", "Only Security can log a walk-in visitor.");
  if (!input.name?.trim()) throw new SecurityError("VALIDATION", "Enter the visitor's name.", { name: "Required." });
  const policy = await visitorPolicy(input.siteId);
  if (policy.requireIdAtGate && !input.idNumber?.trim()) throw new SecurityError("VALIDATION", "Record the visitor's ID.", { idNumber: "Required." });
  const hit = await restrictedMatch({ name: input.name, idNumber: input.idNumber, siteId: input.siteId });
  if (hit) {
    const denied = await prisma.visitor.create({ data: { siteId: input.siteId, kind: "WALK_IN", status: "DENIED", name: input.name.trim(), idNumber: input.idNumber?.trim() || null, hostStaffId: input.hostStaffId, registeredById: actor.id, deniedReason: "On the restricted entry list" } });
    await recordAudit({ actorId: actor.id, action: "VISITOR_DENIED_RESTRICTED", entityType: "Visitor", entityId: denied.id });
    throw new SecurityError("DENIED", "Entry refused: this person is on the restricted entry list.");
  }
  const host = await hostChecks(prisma, input.hostStaffId, input.siteId, policy);
  const row = await prisma.visitor.create({ data: { siteId: input.siteId, kind: "WALK_IN", status: "WALK_IN_PENDING", name: input.name.trim(), phone: input.phone?.trim() || null, idType: input.idType?.trim() || null, idNumber: input.idNumber?.trim() || null, purpose: input.purpose?.trim() || null, vehicle: input.vehicle?.trim() || null, hostStaffId: input.hostStaffId, hostUserId: host.userId, registeredById: actor.id, expectedAt: new Date(), expectedOutAt: new Date(Date.now() + policy.maxDayHours * HOUR) } });
  await prisma.$transaction(async (tx) => {
    if (host.userId) await enqueueNotification(tx, { recipientId: host.userId, event: "visitor.walkin_confirm", idempotencyKey: `visitor.walkin:${row.id}`, payload: { visitorId: row.id, name: row.name } });
    await recordAudit({ actorId: actor.id, action: "VISITOR_WALKIN", entityType: "Visitor", entityId: row.id, after: { hostStaffId: input.hostStaffId } }, tx);
  });
  return row;
}

export async function confirmWalkIn(actor: ActorLike, visitorId: string, confirm: boolean) {
  const v = await prisma.visitor.findUnique({ where: { id: visitorId } });
  if (!v) throw new SecurityError("NOT_FOUND", "Visitor not found.");
  if (v.status !== "WALK_IN_PENDING") throw new SecurityError("INVALID_STATE", "That visitor is not waiting for your confirmation.");
  if (v.hostUserId !== actor.id) throw new SecurityError("FORBIDDEN", "Only the resident being visited can confirm a walk-in.");
  const updated = await prisma.visitor.update({ where: { id: v.id }, data: confirm ? { status: "APPROVED", approvedById: actor.id, decidedAt: new Date(), passCode: passCode() } : { status: "DENIED", decidedAt: new Date(), deniedReason: "Host did not confirm" } });
  await recordAudit({ actorId: actor.id, action: confirm ? "VISITOR_WALKIN_CONFIRMED" : "VISITOR_WALKIN_REFUSED", entityType: "Visitor", entityId: v.id });
  return updated;
}

export async function checkInVisitor(actor: ActorLike, visitorId: string, opts: { passCode?: string | null; now?: Date } = {}) {
  const now = opts.now ?? new Date();
  const v = await prisma.visitor.findUnique({ where: { id: visitorId } });
  if (!v) throw new SecurityError("NOT_FOUND", "Visitor not found.");
  if (!actorCan(actor, "sec.checkin_visitors", { siteId: v.siteId })) throw new SecurityError("FORBIDDEN", "Only Security can check visitors in.");
  if (v.status === "CHECKED_IN") throw new SecurityError("INVALID_STATE", "That visitor is already inside.");
  if (v.status !== "APPROVED") throw new SecurityError("DENIED", v.status === "PENDING_APPROVAL" ? "This visitor has not been approved yet." : v.status === "WALK_IN_PENDING" ? "Waiting for the resident to confirm." : `This visit is ${v.status.toLowerCase().replace(/_/g, " ")}.`);
  if (opts.passCode && v.passCode && opts.passCode.trim() !== v.passCode) throw new SecurityError("DENIED", "The pass code does not match.");
  if (v.expectedAt && now.getTime() < v.expectedAt.getTime() - 2 * HOUR) throw new SecurityError("DENIED", "This visitor is not expected yet.");
  if (v.expectedOutAt && now.getTime() > v.expectedOutAt.getTime()) throw new SecurityError("DENIED", "The visit window has passed.");
  const hit = await restrictedMatch({ name: v.name, idNumber: v.idNumber, siteId: v.siteId });
  if (hit) {
    await prisma.visitor.update({ where: { id: v.id }, data: { status: "DENIED", deniedReason: "On the restricted entry list" } });
    throw new SecurityError("DENIED", "Entry refused: this person is on the restricted entry list.");
  }
  const policy = await visitorPolicy(v.siteId);
  const late = policy.curfewHour != null && now.getUTCHours() >= policy.curfewHour;
  const updated = await prisma.visitor.update({ where: { id: v.id }, data: { status: "CHECKED_IN", checkedInAt: now, checkedInById: actor.id } });
  await recordAudit({ actorId: actor.id, action: late ? "VISITOR_CHECKED_IN_LATE" : "VISITOR_CHECKED_IN", entityType: "Visitor", entityId: v.id });
  return { visitor: updated, lateEntry: late };
}

export async function checkOutVisitor(actor: ActorLike, visitorId: string, now: Date = new Date()) {
  const v = await prisma.visitor.findUnique({ where: { id: visitorId } });
  if (!v) throw new SecurityError("NOT_FOUND", "Visitor not found.");
  if (!actorCan(actor, "sec.checkin_visitors", { siteId: v.siteId })) throw new SecurityError("FORBIDDEN", "Only Security can check visitors out.");
  if (v.status !== "CHECKED_IN") throw new SecurityError("INVALID_STATE", "That visitor is not inside.");
  const updated = await prisma.visitor.update({ where: { id: v.id }, data: { status: "CHECKED_OUT", checkedOutAt: now, checkedOutById: actor.id } });
  await recordAudit({ actorId: actor.id, action: "VISITOR_CHECKED_OUT", entityType: "Visitor", entityId: v.id, after: { overstay: !!v.expectedOutAt && v.expectedOutAt < now } });
  return updated;
}

export type VisitorFilter = "today" | "expected" | "inside" | "overstay" | "denied" | "pending" | "all" | "mine";
export async function listVisitors(opts: { filter?: VisitorFilter; siteIds?: string[] | null; userId?: string | null; now?: Date } = {}) {
  const now = opts.now ?? new Date();
  const start = new Date(`${iso(now)}T00:00:00.000Z`), end = new Date(start.getTime() + 24 * HOUR);
  const f = opts.filter ?? "today";
  const where: Prisma.VisitorWhereInput = { ...(opts.siteIds ? { siteId: { in: opts.siteIds } } : {}) };
  if (f === "mine") where.OR = [{ hostUserId: opts.userId ?? "" }, { registeredById: opts.userId ?? "" }];
  else if (f === "today") where.OR = [{ expectedAt: { gte: start, lt: end } }, { status: "CHECKED_IN" }];
  else if (f === "expected") { where.status = "APPROVED"; where.expectedAt = { gte: start }; }
  else if (f === "inside") where.status = "CHECKED_IN";
  else if (f === "overstay") { where.status = "CHECKED_IN"; where.expectedOutAt = { lt: now }; }
  else if (f === "denied") { where.status = "DENIED"; where.updatedAt = { gte: start }; }
  else if (f === "pending") where.status = { in: ["PENDING_APPROVAL", "WALK_IN_PENDING"] };
  const rows = await prisma.visitor.findMany({ where, orderBy: [{ expectedAt: "asc" }, { createdAt: "desc" }], take: 300 });
  const hosts = new Map((await prisma.staffProfile.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.hostStaffId).filter((x): x is string => !!x))] } }, select: { id: true, firstName: true, lastName: true } })).map((h) => [h.id, `${h.firstName} ${h.lastName}`]));
  return rows.map((r) => ({ ...r, hostName: r.hostStaffId ? hosts.get(r.hostStaffId) ?? "—" : "—", overstay: r.status === "CHECKED_IN" && !!r.expectedOutAt && r.expectedOutAt < now }));
}

export async function getVisitor(id: string) {
  const v = await prisma.visitor.findUnique({ where: { id } });
  if (!v) throw new SecurityError("NOT_FOUND", "Visitor not found.");
  const host = v.hostStaffId ? await prisma.staffProfile.findUnique({ where: { id: v.hostStaffId }, select: { firstName: true, lastName: true, employeeId: true } }) : null;
  return { visitor: v, host };
}

// ---------------------------------------------------------------------------
// People inside (visitors and contractors) and contractor gate checks
// ---------------------------------------------------------------------------

export async function peopleInside(siteIds?: string[] | null, now: Date = new Date()) {
  const site = siteIds ? { siteId: { in: siteIds } } : {};
  const [visitors, visits] = await Promise.all([
    prisma.visitor.findMany({ where: { ...site, status: "CHECKED_IN" }, orderBy: { checkedInAt: "asc" } }),
    prisma.contractorVisit.findMany({ where: { ...site, status: "CHECKED_IN" }, orderBy: { checkedInAt: "asc" } }),
  ]);
  const vendors = new Map((await prisma.vendor.findMany({ where: { id: { in: visits.map((v) => v.vendorId) } }, select: { id: true, name: true } })).map((v) => [v.id, v.name]));
  return {
    visitors: visitors.map((v) => ({ id: v.id, name: v.name, kind: v.kind, since: v.checkedInAt, due: v.expectedOutAt, overstay: !!v.expectedOutAt && v.expectedOutAt < now })),
    contractors: visits.map((v) => ({ id: v.id, vendor: vendors.get(v.vendorId) ?? "—", workers: v.workerIds.length, since: v.checkedInAt, until: v.scheduledEnd, overstay: v.scheduledEnd < now })),
  };
}

/** Issues the gate pass for a scheduled contractor visit after re-checking contract, documents, workers, job and window. */
export async function issueContractorPass(actor: ActorLike, visitId: string, now: Date = new Date()) {
  const v = await prisma.contractorVisit.findUnique({ where: { id: visitId } });
  if (!v) throw new SecurityError("NOT_FOUND", "Visit not found.");
  if (!actorCan(actor, "sec.checkin_visitors", { siteId: v.siteId })) throw new SecurityError("FORBIDDEN", "Only Security can issue contractor passes.");
  if (v.status !== "SCHEDULED") throw new SecurityError("INVALID_STATE", `That visit is ${v.status.toLowerCase().replace(/_/g, " ")}.`);
  const check = await contractorAccessCheck({ vendorId: v.vendorId, workerIds: v.workerIds, workOrderId: v.workOrderId, start: v.scheduledStart, end: v.scheduledEnd }, now);
  if (!check.ok) {
    await prisma.contractorVisit.update({ where: { id: v.id }, data: { status: "DENIED", deniedReason: check.reasons.join(" ") } });
    await recordAudit({ actorId: actor.id, action: "CONTRACTOR_ACCESS_DENIED", entityType: "ContractorVisit", entityId: v.id, after: { reasons: check.reasons } });
    throw new SecurityError("DENIED", `Access denied: ${check.reasons.join(" ")}`);
  }
  if (now.getTime() < v.scheduledStart.getTime() - HOUR) throw new SecurityError("DENIED", "This visit has not started: the window opens an hour before.");
  return prisma.contractorVisit.update({ where: { id: v.id }, data: { status: "PASS_ISSUED", passCode: passCode() } });
}

export async function checkInContractor(actor: ActorLike, visitId: string, now: Date = new Date()) {
  const v = await prisma.contractorVisit.findUnique({ where: { id: visitId } });
  if (!v) throw new SecurityError("NOT_FOUND", "Visit not found.");
  if (!actorCan(actor, "sec.checkin_visitors", { siteId: v.siteId })) throw new SecurityError("FORBIDDEN", "Only Security can check contractors in.");
  const pass = v.status === "PASS_ISSUED" ? v : await issueContractorPass(actor, visitId, now);
  // Access is re-validated at the door: a suspension or expired document after the pass was issued still stops entry.
  const check = await contractorAccessCheck({ vendorId: pass.vendorId, workerIds: pass.workerIds, workOrderId: pass.workOrderId, start: pass.scheduledStart, end: pass.scheduledEnd }, now);
  if (!check.ok) {
    await prisma.contractorVisit.update({ where: { id: v.id }, data: { status: "DENIED", deniedReason: check.reasons.join(" ") } });
    throw new SecurityError("DENIED", `Access denied: ${check.reasons.join(" ")}`);
  }
  const updated = await prisma.contractorVisit.update({ where: { id: v.id }, data: { status: "CHECKED_IN", checkedInAt: now, checkedInById: actor.id } });
  await recordAudit({ actorId: actor.id, action: "CONTRACTOR_CHECKED_IN", entityType: "ContractorVisit", entityId: v.id, after: { escort: v.escortRequired } });
  return updated;
}

export async function checkOutContractor(actor: ActorLike, visitId: string, now: Date = new Date()) {
  const v = await prisma.contractorVisit.findUnique({ where: { id: visitId } });
  if (!v) throw new SecurityError("NOT_FOUND", "Visit not found.");
  if (!actorCan(actor, "sec.checkin_visitors", { siteId: v.siteId })) throw new SecurityError("FORBIDDEN", "Only Security can check contractors out.");
  if (v.status !== "CHECKED_IN") throw new SecurityError("INVALID_STATE", "That visit is not inside.");
  const keys = v.workOrderId ? await prisma.keyTransaction.count({ where: { holderVendorId: v.vendorId, type: "ISSUE", returnedAt: null } }) : 0;
  const updated = await prisma.contractorVisit.update({ where: { id: v.id }, data: { status: "CHECKED_OUT", checkedOutAt: now, checkedOutById: actor.id } });
  await recordAudit({ actorId: actor.id, action: "CONTRACTOR_CHECKED_OUT", entityType: "ContractorVisit", entityId: v.id, after: { keysStillOut: keys } });
  return { visit: updated, keysStillOut: keys };
}

/** Run after a vendor or worker is suspended: anyone from that vendor already inside raises a Security alert. */
export async function contractorsInsideAlert(vendorId: string) {
  const inside = await prisma.contractorVisit.findMany({ where: { vendorId, status: "CHECKED_IN" } });
  if (inside.length === 0) return 0;
  const guards = await prisma.user.findMany({ where: { status: "ACTIVE", roleAssignments: { some: { role: "SECURITY" } } }, select: { id: true } });
  await prisma.$transaction(async (tx) => { for (const v of inside) for (const g of guards) await enqueueNotification(tx, { recipientId: g.id, event: "contractor.access_revoked", idempotencyKey: `contractor.revoked:${v.id}:${g.id}`, payload: { visitId: v.id, siteId: v.siteId } }); });
  return inside.length;
}

// ---------------------------------------------------------------------------
// Resident verification at the gate
// ---------------------------------------------------------------------------

export async function verifyResident(actor: ActorLike, query: string) {
  const q = query.trim();
  if (!q) throw new SecurityError("VALIDATION", "Enter an employee ID, name or phone number.");
  const digits = q.replace(/\D/g, "");
  const people = await prisma.staffProfile.findMany({
    where: { archivedAt: null, mergedIntoId: null, OR: [{ employeeId: { equals: q, mode: "insensitive" } }, ...(digits.length >= 6 ? [{ phone: { contains: digits.slice(-8) } }] : []), { firstName: { contains: q, mode: "insensitive" } }, { lastName: { contains: q, mode: "insensitive" } }] },
    include: { allocations: { where: { status: { in: [...OCCUPYING_STATUSES, "CHECKED_OUT"] } }, orderBy: { startDate: "desc" }, take: 3, include: { bed: { include: { room: { include: { building: { include: { site: true } } } } } } } }, waitlistEntries: { where: { status: { in: ["WAITING", "OFFERED"] } }, select: { status: true } }, exitCases: { orderBy: { createdAt: "desc" }, take: 2, select: { status: true, lastDay: true } }, joiners: { where: { status: "EXPECTED" }, select: { status: true } } },
    take: 10,
  });
  const today = iso(new Date());
  return people.flatMap((p) => {
    const level = personLevel(actor);
    const view = viewPerson(level, p as unknown as PersonRecord);
    if (!view) return [];
    const stay = stayStatus({ verificationStatus: p.verificationStatus, archivedAt: p.archivedAt, allocations: p.allocations.map((a) => ({ status: a.status, startDate: a.startDate, endDate: a.endDate, provisional: a.provisional })), waitlist: p.waitlistEntries, exits: p.exitCases, joiners: p.joiners }, today);
    const bed = p.allocations.find((a) => a.status === "CHECKED_IN");
    return [{ id: p.id, name: view.name, employeeId: p.employeeId, hasPhoto: view.hasPhoto, photoAttachmentId: view.photoAttachmentId, idType: view.idType, stay, stayLabel: STAY_LABEL[stay], inside: stay === "CHECKED_IN" || stay === "CHECKOUT_DUE" || stay === "OVERSTAY" || stay === "PROVISIONAL", site: bed?.bed.room.building.site.name ?? null, room: level === "FULL" || level === "DESK" ? (bed ? `${bed.bed.room.building.name} ${bed.bed.room.code}` : null) : null }];
  });
}

// ---------------------------------------------------------------------------
// Incidents
// ---------------------------------------------------------------------------

export const INCIDENT_CATEGORIES = ["Theft", "Fire / safety", "Medical", "Disturbance", "Policy breach", "Damage", "Trespass", "Other"] as const;

async function incidentRef(tx: Tx) {
  const n = await tx.incident.count();
  return `INC-${new Date().getUTCFullYear()}-${String(n + 1).padStart(5, "0")}-${randomInt(100, 999)}`;
}

export async function reportIncident(actor: ActorLike, input: { siteId: string; category: string; severity: IncidentSeverity; description: string; location?: string | null; involvedStaffId?: string | null; occurredAt?: string | null }) {
  if (!actorCan(actor, "sec.incident_report", { siteId: input.siteId })) throw new SecurityError("FORBIDDEN", "Your role cannot report incidents.");
  const errors: Record<string, string> = {};
  if (!input.category?.trim()) errors.category = "Choose a category.";
  if ((input.description?.trim().length ?? 0) < 10) errors.description = "Describe what happened (at least 10 characters).";
  if (Object.keys(errors).length) throw new SecurityError("VALIDATION", "Please correct the highlighted fields.", errors);
  return prisma.$transaction(async (tx) => {
    const inc = await tx.incident.create({ data: { siteId: input.siteId, reference: await incidentRef(tx), category: input.category, severity: input.severity, description: input.description.trim(), location: input.location?.trim() || null, involvedStaffId: input.involvedStaffId || null, reportedById: actor.id, occurredAt: input.occurredAt ? new Date(input.occurredAt) : new Date() } });
    await tx.incidentUpdate.create({ data: { incidentId: inc.id, authorId: actor.id, status: "REPORTED", note: "Reported." } });
    await recordAudit({ actorId: actor.id, action: "INCIDENT_REPORTED", entityType: "Incident", entityId: inc.id, after: { reference: inc.reference, category: inc.category, severity: inc.severity } }, tx);
    if (inc.severity === "HIGH" || inc.severity === "CRITICAL") {
      const admins = await tx.user.findMany({ where: { status: "ACTIVE", roleAssignments: { some: { role: { in: ["ACCOMMODATION_ADMIN"] } } } }, select: { id: true } });
      for (const a of admins) await enqueueNotification(tx, { recipientId: a.id, event: "incident.serious", idempotencyKey: `incident.serious:${inc.id}:${a.id}`, payload: { incidentId: inc.id, reference: inc.reference, severity: inc.severity } });
    }
    return inc;
  });
}

/** Security / Officers add notes and move an incident to review or action taken; only an Admin closes it (not the reporter). */
export async function updateIncident(actor: ActorLike, incidentId: string, input: { status: IncidentStatus; note: string; actionTaken?: string | null }) {
  const inc = await prisma.incident.findUnique({ where: { id: incidentId } });
  if (!inc) throw new SecurityError("NOT_FOUND", "Incident not found.");
  const manage = actorCan(actor, "sec.incident_manage", { siteId: inc.siteId });
  const ownReport = inc.reportedById === actor.id;
  if (!manage && !(ownReport || actorCan(actor, "sec.incident_report", { siteId: inc.siteId}))) throw new SecurityError("FORBIDDEN", "You cannot update this incident.");
  if (inc.status === "CLOSED") throw new SecurityError("INVALID_STATE", "That incident is closed.");
  if (!input.note?.trim()) throw new SecurityError("VALIDATION", "Add a note.", { note: "Required." });
  if (input.status === "CLOSED") {
    if (!manage) throw new SecurityError("FORBIDDEN", "Only an Accommodation Admin can close an incident.");
    if (ownReport) throw new SecurityError("FORBIDDEN", "Someone else must close an incident you reported.");
  }
  if ((input.status === "UNDER_REVIEW" || input.status === "ESCALATED") && !manage) throw new SecurityError("FORBIDDEN", "Only an Admin can review or escalate an incident.");
  if (!manage && input.status !== inc.status && input.status !== "ACTION_TAKEN") throw new SecurityError("FORBIDDEN", "You can add notes or record the action taken.");
  return prisma.$transaction(async (tx) => {
    const updated = await tx.incident.update({ where: { id: incidentId }, data: { status: input.status, actionTaken: input.actionTaken?.trim() || inc.actionTaken, ...(input.status === "CLOSED" ? { closedAt: new Date(), closedById: actor.id, closureNote: input.note.trim() } : {}) } });
    await tx.incidentUpdate.create({ data: { incidentId, authorId: actor.id, status: input.status, note: input.note.trim() } });
    await recordAudit({ actorId: actor.id, action: `INCIDENT_${input.status}`, entityType: "Incident", entityId: incidentId, after: { note: input.note } }, tx);
    return updated;
  });
}

export async function listIncidents(actor: ActorLike, opts: { siteIds?: string[] | null; open?: boolean } = {}) {
  const manage = actorAccess(actor, "sec.incident_manage") !== null;
  const rows = await prisma.incident.findMany({ where: { ...(opts.siteIds ? { siteId: { in: opts.siteIds } } : {}), ...(opts.open ? { status: { not: "CLOSED" } } : {}), ...(manage ? {} : { reportedById: actor.id }) }, orderBy: { createdAt: "desc" }, take: 200 });
  return rows;
}

export async function getIncident(actor: ActorLike, id: string) {
  const inc = await prisma.incident.findUnique({ where: { id }, include: { updates: { orderBy: { createdAt: "asc" } } } });
  if (!inc) throw new SecurityError("NOT_FOUND", "Incident not found.");
  if (actorAccess(actor, "sec.incident_manage") === null && inc.reportedById !== actor.id) throw new SecurityError("FORBIDDEN", "You can only see incidents you reported.");
  return inc;
}

// ---------------------------------------------------------------------------
// Parcels
// ---------------------------------------------------------------------------

export async function logParcel(actor: ActorLike, input: { siteId: string; staffId?: string | null; recipientName?: string | null; carrier?: string | null; reference?: string | null; notes?: string | null }) {
  if (!actorCan(actor, "sec.parcels", { siteId: input.siteId })) throw new SecurityError("FORBIDDEN", "Only Security or the front desk can log parcels.");
  if (!input.staffId && !input.recipientName?.trim()) throw new SecurityError("VALIDATION", "Choose the resident or enter a recipient name.", { staffId: "Required." });
  const staff = input.staffId ? await prisma.staffProfile.findUnique({ where: { id: input.staffId }, select: { userId: true } }) : null;
  return prisma.$transaction(async (tx) => {
    const p = await tx.parcel.create({ data: { siteId: input.siteId, staffId: input.staffId || null, recipientName: input.recipientName?.trim() || null, carrier: input.carrier?.trim() || null, reference: input.reference?.trim() || null, notes: input.notes?.trim() || null, receivedById: actor.id, status: staff?.userId ? "NOTIFIED" : "RECEIVED", notifiedAt: staff?.userId ? new Date() : null } });
    if (staff?.userId) await enqueueNotification(tx, { recipientId: staff.userId, event: "parcel.arrived", idempotencyKey: `parcel:${p.id}`, payload: { parcelId: p.id, carrier: p.carrier } });
    await recordAudit({ actorId: actor.id, action: "PARCEL_LOGGED", entityType: "Parcel", entityId: p.id }, tx);
    return p;
  });
}

export async function collectParcel(actor: ActorLike, parcelId: string, collectedByName?: string | null) {
  const p = await prisma.parcel.findUnique({ where: { id: parcelId } });
  if (!p) throw new SecurityError("NOT_FOUND", "Parcel not found.");
  if (!actorCan(actor, "sec.parcels", { siteId: p.siteId })) throw new SecurityError("FORBIDDEN", "Only Security or the front desk can hand over parcels.");
  if (p.status === "COLLECTED") throw new SecurityError("INVALID_STATE", "Already collected.");
  const updated = await prisma.parcel.update({ where: { id: p.id }, data: { status: "COLLECTED", collectedAt: new Date(), collectedByName: collectedByName?.trim() || null, collectedById: actor.id } });
  await recordAudit({ actorId: actor.id, action: "PARCEL_COLLECTED", entityType: "Parcel", entityId: p.id });
  return updated;
}

export async function listParcels(opts: { siteIds?: string[] | null; open?: boolean; staffId?: string | null } = {}) {
  const rows = await prisma.parcel.findMany({ where: { ...(opts.siteIds ? { siteId: { in: opts.siteIds } } : {}), ...(opts.open ? { status: { in: ["RECEIVED", "NOTIFIED"] } } : {}), ...(opts.staffId ? { staffId: opts.staffId } : {}) }, orderBy: { receivedAt: "desc" }, take: 200 });
  const staff = new Map((await prisma.staffProfile.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.staffId).filter((x): x is string => !!x))] } }, select: { id: true, firstName: true, lastName: true, employeeId: true } })).map((s) => [s.id, `${s.firstName} ${s.lastName} (${s.employeeId})`]));
  return rows.map((r) => ({ ...r, recipient: r.staffId ? staff.get(r.staffId) ?? "—" : r.recipientName ?? "—" }));
}

// ---------------------------------------------------------------------------
// SOS
// ---------------------------------------------------------------------------

export async function raiseSos(actor: ActorLike, input: { siteId: string; location?: string | null; note?: string | null }) {
  if (!actorCan(actor, "sec.sos_raise", { siteId: input.siteId })) throw new SecurityError("FORBIDDEN", "Your role cannot raise an SOS.");
  const open = await prisma.sosAlert.findFirst({ where: { siteId: input.siteId, raisedById: actor.id, status: { in: ["ACTIVE", "ACKNOWLEDGED"] } } });
  if (open) return open; // pressing it twice does not raise two alerts
  const role = actor.roles.includes("SECURITY") ? "SECURITY" : actor.roles[0];
  return prisma.$transaction(async (tx) => {
    const sos = await tx.sosAlert.create({ data: { siteId: input.siteId, raisedById: actor.id, raisedByRole: role, location: input.location?.trim() || null, note: input.note?.trim() || null } });
    const responders = await tx.user.findMany({ where: { status: "ACTIVE", id: { not: actor.id }, roleAssignments: { some: { role: { in: ["SECURITY", "ACCOMMODATION_OFFICER", "ACCOMMODATION_ADMIN", "SYSTEM_ADMIN"] } } } }, select: { id: true } });
    for (const r of responders) await enqueueNotification(tx, { recipientId: r.id, event: "sos.raised", idempotencyKey: `sos:${sos.id}:${r.id}`, payload: { sosId: sos.id, location: sos.location }, fanout: { email: false } });
    await recordAudit({ actorId: actor.id, action: "SOS_RAISED", entityType: "SosAlert", entityId: sos.id, after: { siteId: input.siteId, location: sos.location } }, tx);
    return sos;
  });
}

export async function acknowledgeSos(actor: ActorLike, sosId: string) {
  const s = await prisma.sosAlert.findUnique({ where: { id: sosId } });
  if (!s) throw new SecurityError("NOT_FOUND", "SOS not found.");
  if (!actorCan(actor, "sec.sos_respond", { siteId: s.siteId })) throw new SecurityError("FORBIDDEN", "You cannot respond to SOS alerts.");
  if (s.status !== "ACTIVE") throw new SecurityError("INVALID_STATE", "That alert has already been acknowledged.");
  const updated = await prisma.sosAlert.update({ where: { id: s.id }, data: { status: "ACKNOWLEDGED", acknowledgedById: actor.id, acknowledgedAt: new Date() } });
  await recordAudit({ actorId: actor.id, action: "SOS_ACKNOWLEDGED", entityType: "SosAlert", entityId: s.id });
  await prisma.$transaction((tx) => enqueueNotification(tx, { recipientId: s.raisedById, event: "sos.acknowledged", idempotencyKey: `sos.ack:${s.id}`, payload: { sosId: s.id }, fanout: { email: false } }));
  return updated;
}

export async function resolveSos(actor: ActorLike, sosId: string, note: string, falseAlarm = false) {
  const s = await prisma.sosAlert.findUnique({ where: { id: sosId } });
  if (!s) throw new SecurityError("NOT_FOUND", "SOS not found.");
  if (!actorCan(actor, "sec.sos_respond", { siteId: s.siteId })) throw new SecurityError("FORBIDDEN", "You cannot respond to SOS alerts.");
  if (s.status === "RESOLVED" || s.status === "FALSE_ALARM") throw new SecurityError("INVALID_STATE", "That alert is already closed.");
  if (!note?.trim()) throw new SecurityError("VALIDATION", "Record what happened.", { note: "Required." });
  const updated = await prisma.sosAlert.update({ where: { id: s.id }, data: { status: falseAlarm ? "FALSE_ALARM" : "RESOLVED", resolvedById: actor.id, resolvedAt: new Date(), resolutionNote: note.trim(), acknowledgedAt: s.acknowledgedAt ?? new Date(), acknowledgedById: s.acknowledgedById ?? actor.id } });
  await recordAudit({ actorId: actor.id, action: "SOS_RESOLVED", entityType: "SosAlert", entityId: s.id, after: { falseAlarm } });
  return updated;
}

export async function listSos(opts: { siteIds?: string[] | null; open?: boolean; userId?: string | null } = {}) {
  const rows = await prisma.sosAlert.findMany({ where: { ...(opts.siteIds ? { siteId: { in: opts.siteIds } } : {}), ...(opts.open ? { status: { in: ["ACTIVE", "ACKNOWLEDGED"] } } : {}), ...(opts.userId ? { raisedById: opts.userId } : {}) }, orderBy: { createdAt: "desc" }, take: 100 });
  const users = new Map((await prisma.user.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.raisedById))] } }, select: { id: true, name: true } })).map((u) => [u.id, u.name]));
  return rows.map((r) => ({ ...r, raisedBy: users.get(r.raisedById) ?? "—", responseMinutes: r.acknowledgedAt ? Math.round((r.acknowledgedAt.getTime() - r.createdAt.getTime()) / 60000) : null }));
}

// ---------------------------------------------------------------------------
// Patrol rounds
// ---------------------------------------------------------------------------

export async function checkpoints(siteId: string) {
  return prisma.masterItem.findMany({ where: { kind: "PATROL_CHECKPOINT", status: "ACTIVE", archivedAt: null, OR: [{ siteId }, { siteId: null }] }, orderBy: [{ sortOrder: "asc" }, { code: "asc" }] });
}

export async function startRound(actor: ActorLike, siteId: string) {
  if (!actorCan(actor, "sec.patrol", { siteId })) throw new SecurityError("FORBIDDEN", "Patrol rounds are not switched on for you.");
  const open = await prisma.patrolRound.findFirst({ where: { userId: actor.id, completedAt: null } });
  if (open) throw new SecurityError("INVALID_STATE", "Finish your current round first.");
  return prisma.patrolRound.create({ data: { siteId, userId: actor.id } });
}

export async function scanCheckpoint(actor: ActorLike, roundId: string, code: string, note?: string | null) {
  const round = await prisma.patrolRound.findUnique({ where: { id: roundId } });
  if (!round || round.userId !== actor.id) throw new SecurityError("NOT_FOUND", "Round not found.");
  if (round.completedAt) throw new SecurityError("INVALID_STATE", "That round is finished.");
  const cps = await checkpoints(round.siteId);
  const cp = cps.find((c) => c.code.toLowerCase() === code.trim().toLowerCase());
  if (!cp) throw new SecurityError("VALIDATION", "That is not a checkpoint on this site.", { code: "Unknown checkpoint." });
  return prisma.patrolScan.create({ data: { roundId, checkpointCode: cp.code, note: note?.trim() || null } });
}

export async function completeRound(actor: ActorLike, roundId: string, notes?: string | null) {
  const round = await prisma.patrolRound.findUnique({ where: { id: roundId }, include: { scans: true } });
  if (!round || round.userId !== actor.id) throw new SecurityError("NOT_FOUND", "Round not found.");
  if (round.completedAt) throw new SecurityError("INVALID_STATE", "That round is finished.");
  const cps = await checkpoints(round.siteId);
  const scanned = new Set(round.scans.map((s) => s.checkpointCode));
  const missed = cps.filter((c) => !scanned.has(c.code)).map((c) => c.code);
  const updated = await prisma.patrolRound.update({ where: { id: roundId }, data: { completedAt: new Date(), notes: [notes?.trim(), missed.length ? `Missed: ${missed.join(", ")}` : null].filter(Boolean).join(" | ") || null } });
  await recordAudit({ actorId: actor.id, action: "PATROL_COMPLETED", entityType: "PatrolRound", entityId: roundId, after: { scanned: scanned.size, missed } });
  return { round: updated, missed };
}

export const listRounds = (siteIds?: string[] | null) => prisma.patrolRound.findMany({ where: siteIds ? { siteId: { in: siteIds } } : {}, orderBy: { startedAt: "desc" }, take: 50, include: { scans: true } });
export const openRound = (userId: string) => prisma.patrolRound.findFirst({ where: { userId, completedAt: null }, include: { scans: true } });

// ---------------------------------------------------------------------------
// Daily: visitors that never showed up are expired; overstays alert Security
// ---------------------------------------------------------------------------

export async function sweepVisitors(now: Date = new Date()) {
  const stale = await prisma.visitor.updateMany({ where: { status: { in: ["PRE_REGISTERED", "APPROVED", "PENDING_APPROVAL", "WALK_IN_PENDING"] }, expectedOutAt: { lt: now } }, data: { status: "CANCELLED", deniedReason: "Expired without arriving" } });
  const over = await prisma.visitor.findMany({ where: { status: "CHECKED_IN", expectedOutAt: { lt: now } }, select: { id: true, name: true, siteId: true } });
  const guards = await prisma.user.findMany({ where: { status: "ACTIVE", roleAssignments: { some: { role: "SECURITY" } } }, select: { id: true } });
  await prisma.$transaction(async (tx) => { for (const v of over) for (const g of guards) await enqueueNotification(tx, { recipientId: g.id, event: "visitor.overstay", idempotencyKey: `visitor.overstay:${v.id}:${g.id}:${iso(now)}`, payload: { visitorId: v.id, name: v.name } }); });
  // Contractor visits whose window has closed without a check-in lapse.
  const lapsed = await prisma.contractorVisit.updateMany({ where: { status: { in: ["SCHEDULED", "PASS_ISSUED"] }, scheduledEnd: { lt: now } }, data: { status: "CANCELLED", deniedReason: "Window passed" } });
  return { expired: stale.count, overstays: over.length, contractorLapsed: lapsed.count };
}
