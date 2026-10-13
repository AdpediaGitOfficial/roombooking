// Maintenance extras from the Roles, Permissions & Module Map (sections 5.4, 6.2, 8): cost approval against a
// threshold, accept / hold / verify, parts and labour, work permits, preventive schedules, vendor lifecycle and
// compliance, contractor workers and visit windows.
import type { Prisma, WorkOrderPriority } from "@prisma/client";
import { prisma } from "../../lib/db";
import { recordAudit } from "../../lib/audit";
import { enqueueNotification } from "../../lib/notifications";
import { actorCan, type ActorLike } from "../../lib/permissions/actor";
import { orgSetting } from "../../lib/settings";
import { MaintenanceError } from "./errors";
import { accessFor, createWorkOrder, slaDueAt, workOrderInclude, type WorkOrderRecord } from "./service";

type Tx = Prisma.TransactionClient;
const DAY = 86400000;
const iso = (d: Date | null | undefined) => (d ? d.toISOString().slice(0, 10) : null);
const dateOf = (v: string | null | undefined, field: string): Date | null => {
  if (!v) return null;
  const d = new Date(/^\d{4}-\d{2}-\d{2}$/.test(v) ? `${v}T00:00:00.000Z` : v);
  if (Number.isNaN(d.getTime())) throw new MaintenanceError("VALIDATION", "Enter a valid date.", { [field]: "Invalid date." });
  return d;
};

async function load(id: string): Promise<WorkOrderRecord> {
  const wo = await prisma.workOrder.findUnique({ where: { id }, include: workOrderInclude });
  if (!wo) throw new MaintenanceError("NOT_FOUND", "Work order not found.");
  return wo;
}
const ctxOf = (wo: { siteId: string; buildingId: string | null }) => ({ siteId: wo.siteId, buildingId: wo.buildingId });
async function note(tx: Tx, workOrderId: string, authorId: string, text: string, type: "COMMENT" | "STATUS" | "ASSIGNMENT" = "STATUS", internal = false) {
  await tx.workOrderNote.create({ data: { workOrderId, authorId, type, note: text, internal } });
}

// ---------------------------------------------------------------------------
// Cost approval (within threshold: Coordinator; above: Admin, or Coordinator with the grant)
// ---------------------------------------------------------------------------

export const costThreshold = () => orgSetting<number>("maintenance.costThreshold", 500);

/** Records the estimate and asks for approval. Work cannot start while the approval is pending. */
export async function submitEstimate(actor: ActorLike, workOrderId: string, input: { amount: number; note?: string | null; quoteRef?: string | null }) {
  const wo = await load(workOrderId);
  const access = accessFor(wo, actor);
  const mayQuote = access === "coordinator" || access === "assignee" || access === "vendor";
  if (!mayQuote || (access === "vendor" && !actorCan(actor, "maint.quote", ctxOf(wo)))) throw new MaintenanceError("FORBIDDEN", "You cannot submit a cost estimate for this work order.");
  if (!Number.isFinite(input.amount) || input.amount < 0) throw new MaintenanceError("VALIDATION", "Enter the estimated cost.", { amount: "Enter an amount." });
  const threshold = await costThreshold();
  return prisma.$transaction(async (tx) => {
    const updated = await tx.workOrder.update({ where: { id: wo.id }, data: { costEstimate: input.amount, costApprovalStatus: input.amount > 0 ? "PENDING" : "NONE", costNote: input.note?.trim() || null, quoteRef: input.quoteRef?.trim() || wo.quoteRef } });
    await note(tx, wo.id, actor.id, `Cost estimate ${input.amount.toFixed(2)} submitted${input.amount > threshold ? ` (above the ${threshold} threshold: Admin approval needed)` : ""}.`);
    await recordAudit({ actorId: actor.id, action: "WORK_ORDER_COST_SUBMITTED", entityType: "WorkOrder", entityId: wo.id, after: { amount: input.amount, threshold } }, tx);
    return updated;
  });
}

export async function decideCost(actor: ActorLike, workOrderId: string, approve: boolean, decisionNote?: string | null) {
  const wo = await load(workOrderId);
  if (wo.costApprovalStatus !== "PENDING" || wo.costEstimate == null) throw new MaintenanceError("INVALID_TRANSITION", "There is no cost waiting for approval.");
  const amount = Number(wo.costEstimate);
  const threshold = await costThreshold();
  const key = amount > threshold ? "maint.cost_above" : "maint.cost_within";
  if (!actorCan(actor, key, ctxOf(wo))) throw new MaintenanceError("FORBIDDEN", amount > threshold ? `Costs above ${threshold} need an Accommodation Admin (or a Coordinator with the grant).` : "You cannot approve costs.");
  if (!approve && !decisionNote?.trim()) throw new MaintenanceError("NOTE_REQUIRED", "Give a reason for rejecting the cost.");
  return prisma.$transaction(async (tx) => {
    const updated = await tx.workOrder.update({ where: { id: wo.id }, data: { costApprovalStatus: approve ? "APPROVED" : "REJECTED", costApprovedById: actor.id, costApprovedAt: new Date(), costNote: decisionNote?.trim() || wo.costNote } });
    await note(tx, wo.id, actor.id, `Cost ${approve ? "approved" : "rejected"}${decisionNote ? `: ${decisionNote.trim()}` : ""}.`);
    await recordAudit({ actorId: actor.id, action: approve ? "WORK_ORDER_COST_APPROVED" : "WORK_ORDER_COST_REJECTED", entityType: "WorkOrder", entityId: wo.id, after: { amount, threshold } }, tx);
    const target = wo.assigneeId ?? null;
    if (target) await enqueueNotification(tx, { recipientId: target, event: approve ? "maintenance.cost_approved" : "maintenance.cost_rejected", idempotencyKey: `maintenance.cost:${wo.id}:${Date.now()}`, payload: { workOrderId: wo.id, ticketNumber: wo.ticketNumber } });
    return updated;
  });
}

/** Estimates waiting for the actor's decision, by threshold. */
export async function costApprovalQueue(actor: ActorLike) {
  const threshold = await costThreshold();
  const rows = await prisma.workOrder.findMany({ where: { costApprovalStatus: "PENDING" }, include: { site: true, building: true, room: true, vendor: true }, orderBy: { createdAt: "asc" }, take: 200 });
  return rows.filter((w) => actorCan(actor, Number(w.costEstimate) > threshold ? "maint.cost_above" : "maint.cost_within", ctxOf(w))).map((w) => ({ ...w, aboveThreshold: Number(w.costEstimate) > threshold }));
}

// ---------------------------------------------------------------------------
// Accept, hold, verify and rate
// ---------------------------------------------------------------------------

export async function acceptWorkOrder(actor: ActorLike, workOrderId: string) {
  const wo = await load(workOrderId);
  const access = accessFor(wo, actor);
  if (access !== "assignee" && access !== "vendor") throw new MaintenanceError("FORBIDDEN", "Only the assigned engineer or vendor can accept a job.");
  if (wo.status !== "ASSIGNED" && wo.status !== "REOPENED") throw new MaintenanceError("INVALID_TRANSITION", "That job is not waiting to be accepted.");
  return prisma.$transaction(async (tx) => {
    const updated = await tx.workOrder.update({ where: { id: wo.id }, data: { status: "ACCEPTED", acceptedAt: new Date() } });
    await note(tx, wo.id, actor.id, "Accepted.");
    await recordAudit({ actorId: actor.id, action: "WORK_ORDER_ACCEPTED", entityType: "WorkOrder", entityId: wo.id }, tx);
    return updated;
  });
}

export const HOLD_REASONS = ["Parts", "Access", "Vendor", "Approval"] as const;
export async function putOnHold(actor: ActorLike, workOrderId: string, reason: (typeof HOLD_REASONS)[number], detail?: string | null) {
  const wo = await load(workOrderId);
  const access = accessFor(wo, actor);
  if (access !== "coordinator" && access !== "assignee" && access !== "vendor") throw new MaintenanceError("FORBIDDEN", "You cannot hold this work order.");
  if (!HOLD_REASONS.includes(reason)) throw new MaintenanceError("VALIDATION", "Choose a reason for the hold.", { reason: "Required." });
  if (!["ASSIGNED", "ACCEPTED", "IN_PROGRESS", "REOPENED", "TRIAGED"].includes(wo.status)) throw new MaintenanceError("INVALID_TRANSITION", "Only an active job can be put on hold.");
  return prisma.$transaction(async (tx) => {
    const updated = await tx.workOrder.update({ where: { id: wo.id }, data: { status: "ON_HOLD", holdReason: `${reason}${detail ? `: ${detail.trim()}` : ""}` } });
    await note(tx, wo.id, actor.id, `On hold (${reason.toLowerCase()})${detail ? `: ${detail.trim()}` : ""}`);
    await recordAudit({ actorId: actor.id, action: "WORK_ORDER_ON_HOLD", entityType: "WorkOrder", entityId: wo.id, after: { reason, detail: detail ?? null } }, tx);
    return updated;
  });
}

export async function resumeFromHold(actor: ActorLike, workOrderId: string) {
  const wo = await load(workOrderId);
  const access = accessFor(wo, actor);
  if (access !== "coordinator" && access !== "assignee" && access !== "vendor") throw new MaintenanceError("FORBIDDEN", "You cannot resume this work order.");
  if (wo.status !== "ON_HOLD") throw new MaintenanceError("INVALID_TRANSITION", "That job is not on hold.");
  return prisma.$transaction(async (tx) => {
    const updated = await tx.workOrder.update({ where: { id: wo.id }, data: { status: wo.acceptedAt ? "ACCEPTED" : "ASSIGNED", holdReason: null } });
    await note(tx, wo.id, actor.id, "Resumed.");
    return updated;
  });
}

export const AUTO_CLOSE_DAYS = 3;

/** Verify (and rate) a resolved job: the resident, an Admin, or an Officer for a vacant room. */
export async function verifyWorkOrder(actor: ActorLike, workOrderId: string, input: { rating: number; comment?: string | null }) {
  const wo = await load(workOrderId);
  if (wo.status !== "RESOLVED") throw new MaintenanceError("INVALID_TRANSITION", "Only a resolved job can be verified.");
  const isRequester = wo.requesterId === actor.id;
  let allowed = isRequester || actorCan(actor, "maint.verify", ctxOf(wo));
  if (allowed && !isRequester && actor.roles.includes("ACCOMMODATION_OFFICER") && !actor.roles.includes("ACCOMMODATION_ADMIN") && !actor.roles.includes("SYSTEM_ADMIN") && wo.roomId) {
    // An Officer may verify only for a vacant room (the resident is not there to do it).
    const occupied = await prisma.allocation.count({ where: { status: "CHECKED_IN", bed: { roomId: wo.roomId } } });
    allowed = occupied === 0;
  }
  if (!allowed) throw new MaintenanceError("FORBIDDEN", "You cannot verify this job.");
  if (!Number.isInteger(input.rating) || input.rating < 1 || input.rating > 5) throw new MaintenanceError("VALIDATION", "Rate the job from 1 to 5.", { rating: "1 to 5." });
  return prisma.$transaction(async (tx) => {
    const updated = await tx.workOrder.update({ where: { id: wo.id }, data: { status: "VERIFIED", verifiedAt: new Date(), verifiedById: actor.id, rating: input.rating, ratingNote: input.comment?.trim() || null, autoCloseAt: new Date(Date.now() + AUTO_CLOSE_DAYS * DAY) } });
    await note(tx, wo.id, actor.id, `Verified, rated ${input.rating}/5${input.comment ? `: ${input.comment.trim()}` : ""}`);
    await recordAudit({ actorId: actor.id, action: "WORK_ORDER_VERIFIED", entityType: "WorkOrder", entityId: wo.id, after: { rating: input.rating } }, tx);
    if (wo.vendorId) await refreshVendorRating(tx, wo.vendorId);
    return updated;
  });
}

async function refreshVendorRating(tx: Tx, vendorId: string) {
  const agg = await tx.workOrder.aggregate({ where: { vendorId, rating: { not: null } }, _avg: { rating: true } });
  await tx.vendor.update({ where: { id: vendorId }, data: { rating: agg._avg.rating ? Number(agg._avg.rating.toFixed(2)) : null } });
}

/** Daily: resolved/verified jobs nobody closed after the grace period are closed automatically. */
export async function sweepWorkOrders(now: Date = new Date()) {
  const due = await prisma.workOrder.findMany({ where: { status: { in: ["RESOLVED", "VERIFIED"] }, OR: [{ autoCloseAt: { lte: now } }, { autoCloseAt: null, resolvedAt: { lte: new Date(now.getTime() - AUTO_CLOSE_DAYS * DAY) } }] }, select: { id: true, requesterId: true, ticketNumber: true } });
  for (const w of due) {
    await prisma.$transaction(async (tx) => {
      await tx.workOrder.update({ where: { id: w.id }, data: { status: "CLOSED", closedAt: now } });
      await note(tx, w.id, w.requesterId, `Closed automatically after ${AUTO_CLOSE_DAYS} days without objection.`);
      await recordAudit({ actorId: null, action: "WORK_ORDER_AUTO_CLOSED", entityType: "WorkOrder", entityId: w.id }, tx);
    });
  }
  return due.length;
}

// ---------------------------------------------------------------------------
// Parts, labour and root cause (technician / vendor)
// ---------------------------------------------------------------------------

export async function recordWork(actor: ActorLike, workOrderId: string, input: { laborHours?: number | null; rootCause?: string | null; costActual?: number | null }) {
  const wo = await load(workOrderId);
  const access = accessFor(wo, actor);
  if (!(access === "assignee" || access === "vendor" || access === "coordinator") || !actorCan(actor, access === "coordinator" ? "maint.triage" : "maint.record", ctxOf(wo))) throw new MaintenanceError("FORBIDDEN", "You cannot record work on this order.");
  if (input.laborHours != null && (!Number.isFinite(input.laborHours) || input.laborHours < 0 || input.laborHours > 999)) throw new MaintenanceError("VALIDATION", "Enter the hours worked.", { laborHours: "Invalid." });
  return prisma.$transaction(async (tx) => {
    const updated = await tx.workOrder.update({ where: { id: wo.id }, data: { laborHours: input.laborHours ?? undefined, rootCause: input.rootCause?.trim() || undefined, costActual: input.costActual ?? undefined } });
    await recordAudit({ actorId: actor.id, action: "WORK_ORDER_WORK_RECORDED", entityType: "WorkOrder", entityId: wo.id, after: { laborHours: input.laborHours ?? null, rootCause: input.rootCause ?? null } }, tx);
    return updated;
  });
}

/** Records a part used. With a stock item it is issued from inventory (a technician or vendor requests; a supervisor issues). */
export async function addPart(actor: ActorLike, workOrderId: string, input: { itemId?: string | null; name?: string | null; quantity: number; unitCost?: number | null }) {
  const wo = await load(workOrderId);
  const access = accessFor(wo, actor);
  if (!(access === "assignee" || access === "vendor" || access === "coordinator")) throw new MaintenanceError("FORBIDDEN", "You cannot record parts on this order.");
  if (!Number.isInteger(input.quantity) || input.quantity < 1) throw new MaintenanceError("VALIDATION", "Enter the quantity used.", { quantity: "Whole number." });
  let name = input.name?.trim() || "";
  let unitCost = input.unitCost ?? null;
  if (input.itemId) {
    const item = await prisma.inventoryItem.findUnique({ where: { id: input.itemId } });
    if (!item) throw new MaintenanceError("NOT_FOUND", "Stock item not found.");
    if (item.trackingType !== "STOCK") throw new MaintenanceError("VALIDATION", "Choose a stock item (assets are issued separately).");
    if (!actorCan(actor, "inv.parts", { siteId: item.siteId })) throw new MaintenanceError("FORBIDDEN", "Parts come out of stock through the inventory supervisor: ask them to issue it, or record a part by name.");
    if (item.quantity < input.quantity) throw new MaintenanceError("VALIDATION", `Only ${item.quantity} in stock.`, { quantity: "Not enough stock." });
    name = name || item.name;
    return prisma.$transaction(async (tx) => {
      await tx.inventoryItem.update({ where: { id: item.id }, data: { quantity: { decrement: input.quantity } } });
      await tx.inventoryTransaction.create({ data: { itemId: item.id, type: "ISSUE", quantity: -input.quantity, balanceAfter: item.quantity - input.quantity, actorId: actor.id, reference: wo.ticketNumber, notes: `Used on ${wo.ticketNumber}` } });
      const part = await tx.workOrderPart.create({ data: { workOrderId: wo.id, itemId: item.id, name, quantity: input.quantity, unitCost, recordedById: actor.id } });
      await recordAudit({ actorId: actor.id, action: "WORK_ORDER_PART_ISSUED", entityType: "WorkOrder", entityId: wo.id, after: { itemId: item.id, quantity: input.quantity } }, tx);
      return part;
    });
  }
  if (!name) throw new MaintenanceError("VALIDATION", "Name the part.", { name: "Required." });
  return prisma.$transaction(async (tx) => {
    const part = await tx.workOrderPart.create({ data: { workOrderId: wo.id, name, quantity: input.quantity, unitCost, recordedById: actor.id } });
    await recordAudit({ actorId: actor.id, action: "WORK_ORDER_PART_RECORDED", entityType: "WorkOrder", entityId: wo.id, after: { name, quantity: input.quantity } }, tx);
    return part;
  });
}

export const listParts = (workOrderId: string) => prisma.workOrderPart.findMany({ where: { workOrderId }, orderBy: { createdAt: "asc" } });

// ---------------------------------------------------------------------------
// Work permits (high-risk jobs): starting work is blocked until approved
// ---------------------------------------------------------------------------

export const PERMIT_TYPES = ["Hot work", "Work at height", "Electrical isolation", "Confined space", "Excavation", "Other high-risk"] as const;

export async function requestPermit(actor: ActorLike, workOrderId: string, input: { type: string; hazards?: string | null; controls?: string | null }) {
  const wo = await load(workOrderId);
  const access = accessFor(wo, actor);
  if (access !== "coordinator" && access !== "assignee" && access !== "vendor") throw new MaintenanceError("FORBIDDEN", "You cannot request a permit for this job.");
  if (!input.type?.trim()) throw new MaintenanceError("VALIDATION", "Choose the type of high-risk work.", { type: "Required." });
  if (await prisma.workPermit.findFirst({ where: { workOrderId, status: { in: ["REQUESTED", "APPROVED"] } } })) throw new MaintenanceError("INVALID_TRANSITION", "A permit is already requested or approved for this job.");
  return prisma.$transaction(async (tx) => {
    const permit = await tx.workPermit.create({ data: { workOrderId, type: input.type.trim(), hazards: input.hazards?.trim() || null, controls: input.controls?.trim() || null, requestedById: actor.id } });
    await tx.workOrder.update({ where: { id: wo.id }, data: { needsPermit: true } });
    await note(tx, wo.id, actor.id, `Work permit requested (${permit.type}).`);
    await recordAudit({ actorId: actor.id, action: "PERMIT_REQUESTED", entityType: "WorkPermit", entityId: permit.id, after: { workOrderId, type: permit.type } }, tx);
    return permit;
  });
}

export async function decidePermit(actor: ActorLike, permitId: string, approve: boolean, input: { note?: string | null; validTo?: string | null } = {}) {
  const permit = await prisma.workPermit.findUnique({ where: { id: permitId } });
  if (!permit) throw new MaintenanceError("NOT_FOUND", "Permit not found.");
  const wo = await load(permit.workOrderId);
  if (!actorCan(actor, "maint.permit", ctxOf(wo))) throw new MaintenanceError("FORBIDDEN", "You cannot approve work permits.");
  if (permit.status !== "REQUESTED") throw new MaintenanceError("INVALID_TRANSITION", "That permit has already been decided.");
  if (permit.requestedById === actor.id) throw new MaintenanceError("FORBIDDEN", "Someone else must approve a permit you requested.");
  if (!approve && !input.note?.trim()) throw new MaintenanceError("NOTE_REQUIRED", "Give a reason for rejecting the permit.");
  const validTo = dateOf(input.validTo, "validTo") ?? new Date(Date.now() + DAY);
  return prisma.$transaction(async (tx) => {
    const updated = await tx.workPermit.update({ where: { id: permitId }, data: { status: approve ? "APPROVED" : "REJECTED", approvedById: actor.id, decidedAt: new Date(), decisionNote: input.note?.trim() || null, validFrom: approve ? new Date() : null, validTo: approve ? validTo : null } });
    await note(tx, wo.id, actor.id, `Work permit ${approve ? "approved" : "rejected"}${input.note ? `: ${input.note.trim()}` : ""}.`);
    await recordAudit({ actorId: actor.id, action: approve ? "PERMIT_APPROVED" : "PERMIT_REJECTED", entityType: "WorkPermit", entityId: permitId }, tx);
    const to = wo.assigneeId;
    if (to) await enqueueNotification(tx, { recipientId: to, event: approve ? "maintenance.permit_approved" : "maintenance.permit_rejected", idempotencyKey: `permit:${permitId}:${approve}`, payload: { workOrderId: wo.id, ticketNumber: wo.ticketNumber } });
    return updated;
  });
}

export async function closePermit(actor: ActorLike, permitId: string) {
  const permit = await prisma.workPermit.findUnique({ where: { id: permitId } });
  if (!permit) throw new MaintenanceError("NOT_FOUND", "Permit not found.");
  const wo = await load(permit.workOrderId);
  const access = accessFor(wo, actor);
  if (access !== "coordinator" && access !== "assignee" && access !== "vendor") throw new MaintenanceError("FORBIDDEN", "You cannot close this permit.");
  if (permit.status !== "APPROVED") throw new MaintenanceError("INVALID_TRANSITION", "Only an approved permit can be closed.");
  return prisma.workPermit.update({ where: { id: permitId }, data: { status: "CLOSED", closedAt: new Date() } });
}

export const permitsFor = (workOrderId: string) => prisma.workPermit.findMany({ where: { workOrderId }, orderBy: { createdAt: "desc" } });

export async function listPermitQueue(status: "REQUESTED" | "APPROVED" = "REQUESTED") {
  const permits = await prisma.workPermit.findMany({ where: { status }, orderBy: { createdAt: "asc" }, take: 200 });
  const wos = new Map((await prisma.workOrder.findMany({ where: { id: { in: permits.map((p) => p.workOrderId) } }, include: { site: true, building: true, room: true } })).map((w) => [w.id, w]));
  return permits.map((p) => ({ permit: p, workOrder: wos.get(p.workOrderId)! })).filter((r) => r.workOrder);
}

/** True when the job may start: no permit needed, or one approved and still valid. */
export async function permitClear(workOrderId: string, now: Date = new Date()): Promise<boolean> {
  const wo = await prisma.workOrder.findUnique({ where: { id: workOrderId }, select: { needsPermit: true } });
  if (!wo?.needsPermit) return true;
  return !!(await prisma.workPermit.findFirst({ where: { workOrderId, status: "APPROVED", OR: [{ validTo: null }, { validTo: { gte: now } }] } }));
}

// ---------------------------------------------------------------------------
// Preventive maintenance schedules
// ---------------------------------------------------------------------------

export type ScheduleInput = { title: string; category: string; priority?: WorkOrderPriority; description?: string | null; frequencyDays: number; firstDue: string; siteId: string; buildingId?: string | null; roomId?: string | null; assigneeId?: string | null; vendorId?: string | null };

export async function createSchedule(actor: ActorLike, organizationId: string, input: ScheduleInput) {
  if (!actorCan(actor, "maint.preventive", { siteId: input.siteId, buildingId: input.buildingId })) throw new MaintenanceError("FORBIDDEN", "Preventive schedules need the Coordinator or an Admin with the grant.");
  const errors: Record<string, string> = {};
  if (!input.title?.trim()) errors.title = "Enter a title.";
  if (!input.category?.trim()) errors.category = "Choose a category.";
  if (!Number.isInteger(input.frequencyDays) || input.frequencyDays < 1 || input.frequencyDays > 3650) errors.frequencyDays = "Enter a whole number of days.";
  if (!input.siteId) errors.siteId = "Choose a site.";
  const first = dateOf(input.firstDue, "firstDue");
  if (!first) errors.firstDue = "Enter the first due date.";
  if (Object.keys(errors).length) throw new MaintenanceError("VALIDATION", "Please correct the highlighted fields.", errors);
  const s = await prisma.preventiveSchedule.create({ data: { organizationId, siteId: input.siteId, buildingId: input.buildingId || null, roomId: input.roomId || null, title: input.title.trim(), category: input.category, priority: input.priority ?? "MEDIUM", description: input.description?.trim() || null, frequencyDays: input.frequencyDays, nextDueAt: first!, assigneeId: input.assigneeId || null, vendorId: input.vendorId || null, createdById: actor.id } });
  await recordAudit({ actorId: actor.id, action: "PREVENTIVE_SCHEDULE_CREATED", entityType: "PreventiveSchedule", entityId: s.id, after: { title: s.title, frequencyDays: s.frequencyDays } });
  return s;
}

export async function setScheduleActive(actor: ActorLike, scheduleId: string, active: boolean) {
  const s = await prisma.preventiveSchedule.findUnique({ where: { id: scheduleId } });
  if (!s) throw new MaintenanceError("NOT_FOUND", "Schedule not found.");
  if (!actorCan(actor, "maint.preventive", { siteId: s.siteId, buildingId: s.buildingId })) throw new MaintenanceError("FORBIDDEN", "You cannot change preventive schedules.");
  const updated = await prisma.preventiveSchedule.update({ where: { id: scheduleId }, data: { active } });
  await recordAudit({ actorId: actor.id, action: active ? "PREVENTIVE_SCHEDULE_RESUMED" : "PREVENTIVE_SCHEDULE_PAUSED", entityType: "PreventiveSchedule", entityId: scheduleId });
  return updated;
}

export const listSchedules = () => prisma.preventiveSchedule.findMany({ orderBy: [{ active: "desc" }, { nextDueAt: "asc" }] });

/** Daily: raises a work order for every schedule that is due (within 7 days) and rolls it forward. */
export async function runPreventive(now: Date = new Date()) {
  const due = await prisma.preventiveSchedule.findMany({ where: { active: true, nextDueAt: { lte: new Date(now.getTime() + 7 * DAY) } } });
  let created = 0;
  for (const s of due) {
    const requesterId = s.createdById ?? (await prisma.user.findFirst({ where: { status: "ACTIVE", roleAssignments: { some: { role: { in: ["SYSTEM_ADMIN", "ACCOMMODATION_ADMIN"] } } } }, select: { id: true } }))?.id;
    if (!requesterId) continue;
    const wo = await createWorkOrder({ requesterId, siteId: s.siteId, buildingId: s.buildingId, roomId: s.roomId, locationNote: s.roomId ? null : s.title, category: s.category, description: `Preventive maintenance: ${s.title}${s.description ? `. ${s.description}` : ""}`, priority: s.priority });
    await prisma.workOrder.update({ where: { id: wo.id }, data: { source: "PREVENTIVE", preventiveScheduleId: s.id, slaDueAt: slaDueAt(s.priority, s.nextDueAt > now ? s.nextDueAt : now), assigneeId: s.assigneeId, vendorId: s.vendorId, status: s.assigneeId || s.vendorId ? "ASSIGNED" : "NEW" } });
    await prisma.preventiveSchedule.update({ where: { id: s.id }, data: { nextDueAt: new Date(s.nextDueAt.getTime() + s.frequencyDays * DAY), lastGeneratedAt: now } });
    created++;
  }
  return created;
}

// ---------------------------------------------------------------------------
// Vendors: lifecycle, documents, rate card, compliance
// ---------------------------------------------------------------------------

export type VendorInput = { name: string; contactName?: string | null; contactPhone?: string | null; contactEmail?: string | null; contractStart?: string | null; contractEnd?: string | null; tradeCategories?: string[] };

/** A Coordinator (with the grant) or Admin creates a vendor; it stays Pending until an Admin approves it. */
export async function createVendor(actor: ActorLike, organizationId: string, input: VendorInput) {
  if (!actorCan(actor, "maint.vendor_create")) throw new MaintenanceError("FORBIDDEN", "You cannot create vendors.");
  if (!input.name?.trim()) throw new MaintenanceError("VALIDATION", "Enter the vendor name.", { name: "Required." });
  const start = dateOf(input.contractStart, "contractStart"), end = dateOf(input.contractEnd, "contractEnd");
  if (start && end && end < start) throw new MaintenanceError("VALIDATION", "The contract cannot end before it starts.", { contractEnd: "Before start." });
  const adminMade = actorCan(actor, "maint.vendor_manage");
  const v = await prisma.vendor.create({ data: { organizationId, name: input.name.trim(), contactName: input.contactName?.trim() || null, contactPhone: input.contactPhone?.trim() || null, contactEmail: input.contactEmail?.trim() || null, contractStart: start, contractEnd: end, tradeCategories: input.tradeCategories ?? [], state: adminMade ? "ACTIVE" : "PENDING_APPROVAL", approvedById: adminMade ? actor.id : null, approvedAt: adminMade ? new Date() : null } });
  await recordAudit({ actorId: actor.id, action: "VENDOR_CREATED", entityType: "Vendor", entityId: v.id, after: { name: v.name, state: v.state } });
  return v;
}

export async function updateVendor(actor: ActorLike, vendorId: string, input: Partial<VendorInput>) {
  if (!actorCan(actor, "maint.vendor_create")) throw new MaintenanceError("FORBIDDEN", "You cannot edit vendors.");
  const v = await prisma.vendor.findUnique({ where: { id: vendorId } });
  if (!v) throw new MaintenanceError("NOT_FOUND", "Vendor not found.");
  const data: Prisma.VendorUpdateInput = {};
  if (input.name !== undefined) { if (!input.name.trim()) throw new MaintenanceError("VALIDATION", "Enter the vendor name.", { name: "Required." }); data.name = input.name.trim(); }
  if (input.contactName !== undefined) data.contactName = input.contactName?.trim() || null;
  if (input.contactPhone !== undefined) data.contactPhone = input.contactPhone?.trim() || null;
  if (input.contactEmail !== undefined) data.contactEmail = input.contactEmail?.trim() || null;
  if (input.contractStart !== undefined) data.contractStart = dateOf(input.contractStart, "contractStart");
  if (input.contractEnd !== undefined) { data.contractEnd = dateOf(input.contractEnd, "contractEnd"); if (v.state === "EXPIRED" && data.contractEnd && (data.contractEnd as Date) >= new Date()) data.state = "ACTIVE"; }
  if (input.tradeCategories) data.tradeCategories = input.tradeCategories;
  const updated = await prisma.vendor.update({ where: { id: vendorId }, data });
  await recordAudit({ actorId: actor.id, action: "VENDOR_UPDATED", entityType: "Vendor", entityId: vendorId, after: { name: updated.name, state: updated.state } });
  return updated;
}

async function vendorTransition(actor: ActorLike, vendorId: string, to: "ACTIVE" | "SUSPENDED" | "TERMINATED", reason: string | null) {
  if (!actorCan(actor, "maint.vendor_manage")) throw new MaintenanceError("FORBIDDEN", "Only an Accommodation Admin can approve, suspend or terminate vendors.");
  const v = await prisma.vendor.findUnique({ where: { id: vendorId } });
  if (!v) throw new MaintenanceError("NOT_FOUND", "Vendor not found.");
  if (v.state === "TERMINATED") throw new MaintenanceError("INVALID_TRANSITION", "A terminated vendor cannot be changed.");
  if (to !== "ACTIVE" && !reason?.trim()) throw new MaintenanceError("NOTE_REQUIRED", "Give a reason.");
  if (to === "ACTIVE" && v.state === "ACTIVE") throw new MaintenanceError("INVALID_TRANSITION", "That vendor is already active.");
  if (to === "ACTIVE" && v.contractEnd && v.contractEnd < new Date()) throw new MaintenanceError("INVALID_TRANSITION", "The contract has expired: extend it first.");
  if (to === "TERMINATED") {
    const open = await prisma.workOrder.count({ where: { vendorId, status: { notIn: ["CLOSED", "CANCELLED", "RESOLVED", "VERIFIED"] } } });
    if (open) throw new MaintenanceError("INVALID_TRANSITION", `${open} open work order${open === 1 ? " is" : "s are"} still assigned to this vendor: reassign or close them first.`);
  }
  const result = await prisma.$transaction(async (tx) => {
    const updated = await tx.vendor.update({ where: { id: vendorId }, data: { state: to, stateReason: reason?.trim() || null, ...(to === "ACTIVE" ? { approvedById: actor.id, approvedAt: new Date(), status: "ACTIVE" } : {}), ...(to === "TERMINATED" ? { status: "INACTIVE" } : {}) } });
    if (to !== "ACTIVE") {
      // Access ends with the relationship: suspend the vendor's workers and cancel visits not yet started.
      await tx.contractorWorker.updateMany({ where: { vendorId, status: { in: ["VERIFIED", "PENDING"] } }, data: { status: "SUSPENDED" } });
      await tx.contractorVisit.updateMany({ where: { vendorId, status: { in: ["SCHEDULED", "PASS_ISSUED"] } }, data: { status: "CANCELLED", deniedReason: `Vendor ${to.toLowerCase()}` } });
    }
    await recordAudit({ actorId: actor.id, action: `VENDOR_${to === "ACTIVE" ? "APPROVED" : to}`, entityType: "Vendor", entityId: vendorId, after: { reason: reason ?? null } }, tx);
    return updated;
  });
  // Contractors already inside when access is withdrawn raise a Security alert (document 11).
  if (to !== "ACTIVE") { const { contractorsInsideAlert } = await import("../security/service"); await contractorsInsideAlert(vendorId); }
  return result;
}
export const approveVendor = (actor: ActorLike, vendorId: string) => vendorTransition(actor, vendorId, "ACTIVE", null);
export const suspendVendor = (actor: ActorLike, vendorId: string, reason: string) => vendorTransition(actor, vendorId, "SUSPENDED", reason);
export const terminateVendor = (actor: ActorLike, vendorId: string, reason: string) => vendorTransition(actor, vendorId, "TERMINATED", reason);

export async function addVendorDocument(actor: ActorLike, vendorId: string, input: { kind: "TRADE_LICENCE" | "INSURANCE" | "CONTRACT" | "ID_VERIFICATION" | "OTHER"; reference?: string | null; issuedAt?: string | null; expiresAt?: string | null }) {
  const v = await prisma.vendor.findUnique({ where: { id: vendorId } });
  if (!v) throw new MaintenanceError("NOT_FOUND", "Vendor not found.");
  const own = !!actor.vendorId && actor.vendorId === vendorId && actorCan(actor, "maint.workers");
  if (!own && !actorCan(actor, "maint.vendor_create")) throw new MaintenanceError("FORBIDDEN", "You cannot add vendor documents.");
  const doc = await prisma.vendorDocument.create({ data: { vendorId, kind: input.kind, reference: input.reference?.trim() || null, issuedAt: dateOf(input.issuedAt, "issuedAt"), expiresAt: dateOf(input.expiresAt, "expiresAt") } });
  await recordAudit({ actorId: actor.id, action: "VENDOR_DOCUMENT_ADDED", entityType: "Vendor", entityId: vendorId, after: { kind: input.kind, expiresAt: input.expiresAt ?? null } });
  return doc;
}

export async function verifyVendorDocument(actor: ActorLike, documentId: string) {
  if (!actorCan(actor, "maint.vendor_manage")) throw new MaintenanceError("FORBIDDEN", "Only an Accommodation Admin can verify vendor documents.");
  return prisma.vendorDocument.update({ where: { id: documentId }, data: { verifiedAt: new Date(), verifiedById: actor.id } });
}

export async function setRate(actor: ActorLike, vendorId: string, input: { category: string; unit?: string; rate: number; currency?: string }) {
  const own = !!actor.vendorId && actor.vendorId === vendorId && actorCan(actor, "maint.rate_card");
  if (!own && !actorCan(actor, "maint.rate_card")) throw new MaintenanceError("FORBIDDEN", "You cannot change the rate card.");
  if (!input.category?.trim() || !Number.isFinite(input.rate) || input.rate < 0) throw new MaintenanceError("VALIDATION", "Enter the category and a rate.", { rate: "Required." });
  await prisma.vendorRate.updateMany({ where: { vendorId, category: input.category.trim(), active: true }, data: { active: false } });
  const r = await prisma.vendorRate.create({ data: { vendorId, category: input.category.trim(), unit: input.unit?.trim() || "hour", rate: input.rate, currency: input.currency || "AED" } });
  await recordAudit({ actorId: actor.id, action: "VENDOR_RATE_SET", entityType: "Vendor", entityId: vendorId, after: { category: r.category, rate: input.rate } });
  return r;
}

export async function getVendor(id: string) {
  const v = await prisma.vendor.findUnique({ where: { id }, include: { workOrders: { orderBy: { createdAt: "desc" }, take: 20, select: { id: true, ticketNumber: true, status: true, category: true, rating: true, slaDueAt: true, resolvedAt: true, createdAt: true } } } });
  if (!v) throw new MaintenanceError("NOT_FOUND", "Vendor not found.");
  const [documents, rates, workers] = await Promise.all([
    prisma.vendorDocument.findMany({ where: { vendorId: id }, orderBy: { expiresAt: "asc" } }),
    prisma.vendorRate.findMany({ where: { vendorId: id, active: true }, orderBy: { category: "asc" } }),
    prisma.contractorWorker.findMany({ where: { vendorId: id, archivedAt: null }, orderBy: { name: "asc" } }),
  ]);
  return { vendor: v, documents, rates, workers };
}

export async function listVendors(opts: { state?: string | null } = {}) {
  const vendors = await prisma.vendor.findMany({ where: { archivedAt: null, ...(opts.state ? { state: opts.state as never } : {}) }, orderBy: [{ state: "asc" }, { name: "asc" }], include: { _count: { select: { workOrders: true } } } });
  const open = await prisma.workOrder.groupBy({ by: ["vendorId"], where: { vendorId: { in: vendors.map((v) => v.id) }, status: { notIn: ["CLOSED", "CANCELLED", "RESOLVED", "VERIFIED"] } }, _count: true });
  const openBy = new Map(open.map((o) => [o.vendorId, o._count]));
  return vendors.map((v) => ({ ...v, open: openBy.get(v.id) ?? 0 }));
}

export type ComplianceItem = { vendorId: string; vendor: string; what: string; expiresOn: string; daysLeft: number };

/** Contracts and documents expiring within 30 days, or already expired. */
export async function vendorCompliance(now: Date = new Date(), horizonDays = 30): Promise<ComplianceItem[]> {
  const until = new Date(now.getTime() + horizonDays * DAY);
  const live = await prisma.vendor.findMany({ where: { archivedAt: null, state: { in: ["ACTIVE", "EXPIRED"] } }, select: { id: true, name: true, contractEnd: true } });
  const names = new Map(live.map((v) => [v.id, v.name]));
  const vendors = live.filter((v) => v.contractEnd && v.contractEnd <= until);
  const docs = await prisma.vendorDocument.findMany({ where: { vendorId: { in: live.map((v) => v.id) }, expiresAt: { lte: until } } });
  const days = (d: Date) => Math.ceil((d.getTime() - now.getTime()) / DAY);
  return [
    ...vendors.map((v) => ({ vendorId: v.id, vendor: v.name, what: "Contract", expiresOn: iso(v.contractEnd)!, daysLeft: days(v.contractEnd!) })),
    ...docs.map((d) => ({ vendorId: d.vendorId, vendor: names.get(d.vendorId) ?? "—", what: d.kind.replace(/_/g, " ").toLowerCase(), expiresOn: iso(d.expiresAt)!, daysLeft: days(d.expiresAt!) })),
  ].sort((a, b) => a.daysLeft - b.daysLeft);
}

/** Daily: marks vendors with an expired contract as Expired and alerts at 30 / 7 / 1 days before expiry. */
export async function sweepVendors(now: Date = new Date()) {
  const expired = await prisma.vendor.updateMany({ where: { state: "ACTIVE", contractEnd: { lt: new Date(now.toISOString().slice(0, 10)) } }, data: { state: "EXPIRED", stateReason: "Contract expired" } });
  const items = await vendorCompliance(now, 30);
  const admins = await prisma.user.findMany({ where: { status: "ACTIVE", roleAssignments: { some: { role: { in: ["ACCOMMODATION_ADMIN", "MAINTENANCE_COORDINATOR"] } } } }, select: { id: true } });
  const due = items.filter((it) => [30, 7, 1].includes(it.daysLeft));
  let alerts = 0;
  if (due.length && admins.length) {
    await prisma.$transaction(async (tx) => {
      for (const it of due) for (const a of admins) {
        await enqueueNotification(tx, { recipientId: a.id, event: "vendor.expiring", idempotencyKey: `vendor.expiring:${it.vendorId}:${it.what}:${it.expiresOn}:${it.daysLeft}:${a.id}`, payload: { vendor: it.vendor, what: it.what, expiresOn: it.expiresOn, daysLeft: it.daysLeft }, fanout: { whatsapp: false } });
        alerts++;
      }
    }, { timeout: 60_000 });
  }
  return { expired: expired.count, alerts };
}

// ---------------------------------------------------------------------------
// Contractor workers and visit windows
// ---------------------------------------------------------------------------

export async function addWorker(actor: ActorLike, vendorId: string, input: { name: string; idType?: string | null; idNumber?: string | null; phone?: string | null; isSupervisor?: boolean }) {
  const own = !!actor.vendorId && actor.vendorId === vendorId;
  if (actor.roles.includes("VENDOR") && !own) throw new MaintenanceError("FORBIDDEN", "You can only add workers to your own vendor.");
  if (!actorCan(actor, "maint.workers")) throw new MaintenanceError("FORBIDDEN", "You cannot add contractor workers.");
  if (!input.name?.trim()) throw new MaintenanceError("VALIDATION", "Enter the worker's name.", { name: "Required." });
  const v = await prisma.vendor.findUnique({ where: { id: vendorId } });
  if (!v || v.state === "TERMINATED") throw new MaintenanceError("NOT_FOUND", "Vendor not found or terminated.");
  const w = await prisma.contractorWorker.create({ data: { vendorId, name: input.name.trim(), idType: input.idType?.trim() || null, idNumber: input.idNumber?.trim() || null, phone: input.phone?.trim() || null, isSupervisor: !!input.isSupervisor } });
  await recordAudit({ actorId: actor.id, action: "CONTRACTOR_WORKER_ADDED", entityType: "ContractorWorker", entityId: w.id, after: { vendorId, name: w.name } });
  return w;
}

/** An Admin or Coordinator verifies a worker's identity (and police clearance) before the worker can be given access. */
export async function verifyWorker(actor: ActorLike, workerId: string, policeVerified: boolean) {
  if (!actorCan(actor, "maint.vendor_manage") && !actorCan(actor, "maint.triage")) throw new MaintenanceError("FORBIDDEN", "Only a Coordinator or Admin can verify workers.");
  const w = await prisma.contractorWorker.findUnique({ where: { id: workerId } });
  if (!w) throw new MaintenanceError("NOT_FOUND", "Worker not found.");
  if (!w.idNumber) throw new MaintenanceError("VALIDATION", "Record the worker's ID number before verifying.");
  const updated = await prisma.contractorWorker.update({ where: { id: workerId }, data: { status: "VERIFIED", policeVerified, verifiedAt: new Date(), verifiedById: actor.id } });
  await recordAudit({ actorId: actor.id, action: "CONTRACTOR_WORKER_VERIFIED", entityType: "ContractorWorker", entityId: workerId, after: { policeVerified } });
  return updated;
}

export async function setWorkerStatus(actor: ActorLike, workerId: string, status: "SUSPENDED" | "REMOVED") {
  if (!actorCan(actor, "maint.vendor_manage") && !actorCan(actor, "maint.workers")) throw new MaintenanceError("FORBIDDEN", "You cannot change contractor workers.");
  const w = await prisma.contractorWorker.findUnique({ where: { id: workerId } });
  if (!w) throw new MaintenanceError("NOT_FOUND", "Worker not found.");
  if (actor.roles.includes("VENDOR") && actor.vendorId !== w.vendorId) throw new MaintenanceError("FORBIDDEN", "You can only manage your own workers.");
  return prisma.$transaction(async (tx) => {
    const updated = await tx.contractorWorker.update({ where: { id: workerId }, data: { status, ...(status === "REMOVED" ? { archivedAt: new Date() } : {}) } });
    await recordAudit({ actorId: actor.id, action: `CONTRACTOR_WORKER_${status}`, entityType: "ContractorWorker", entityId: workerId }, tx);
    return updated;
  });
}

export type AccessCheck = { ok: boolean; reasons: string[] };

/**
 * Contractor access is valid only when the vendor contract, the worker documents, the job assignment and the
 * visit window are all valid (document section 9).
 */
export async function contractorAccessCheck(input: { vendorId: string; workerIds: string[]; workOrderId?: string | null; start: Date; end: Date }, now: Date = new Date()): Promise<AccessCheck> {
  const reasons: string[] = [];
  const vendor = await prisma.vendor.findUnique({ where: { id: input.vendorId } });
  if (!vendor) return { ok: false, reasons: ["Vendor not found."] };
  if (vendor.state !== "ACTIVE") reasons.push(`The vendor is ${vendor.state.toLowerCase().replace(/_/g, " ")}.`);
  if (vendor.contractEnd && vendor.contractEnd < input.end) reasons.push(`The contract ends ${iso(vendor.contractEnd)}, before the visit finishes.`);
  const badDocs = await prisma.vendorDocument.count({ where: { vendorId: vendor.id, kind: { in: ["TRADE_LICENCE", "INSURANCE"] }, expiresAt: { lt: input.end } } });
  if (badDocs) reasons.push("A vendor licence or insurance document expires before the visit finishes.");
  if (input.workerIds.length === 0) reasons.push("Name at least one worker.");
  const workers = await prisma.contractorWorker.findMany({ where: { id: { in: input.workerIds } } });
  for (const id of input.workerIds) {
    const w = workers.find((x) => x.id === id);
    if (!w || w.vendorId !== vendor.id) reasons.push("A worker does not belong to this vendor.");
    else if (w.status !== "VERIFIED" || w.archivedAt) reasons.push(`${w.name} is ${w.archivedAt ? "removed" : w.status.toLowerCase()}: only verified workers can enter.`);
  }
  if (input.workOrderId) {
    const wo = await prisma.workOrder.findUnique({ where: { id: input.workOrderId } });
    if (!wo || wo.vendorId !== vendor.id) reasons.push("The job is not assigned to this vendor.");
    else if (["CLOSED", "CANCELLED", "RESOLVED", "VERIFIED"].includes(wo.status)) reasons.push("The job is already finished.");
    else if (wo.needsPermit && !(await permitClear(wo.id, input.start))) reasons.push("The job needs an approved work permit.");
  }
  if (input.end <= input.start) reasons.push("The visit must end after it starts.");
  if (input.end < now) reasons.push("The visit window has already passed.");
  return { ok: reasons.length === 0, reasons: [...new Set(reasons)] };
}

/** Schedules a visit window for a vendor's workers. Access ends automatically when the window does. */
export async function scheduleVisit(actor: ActorLike, input: { workOrderId?: string | null; vendorId: string; workerIds: string[]; start: string; end: string; escortRequired?: boolean }) {
  const wo = input.workOrderId ? await prisma.workOrder.findUnique({ where: { id: input.workOrderId } }) : null;
  const siteId = wo?.siteId ?? (await prisma.site.findFirst({ where: { status: "ACTIVE" }, select: { id: true } }))?.id;
  if (!siteId) throw new MaintenanceError("VALIDATION", "No site is configured.");
  const own = !!actor.vendorId && actor.vendorId === input.vendorId;
  if (!own && !actorCan(actor, "maint.triage", { siteId }) && !actorCan(actor, "maint.workers", { siteId })) throw new MaintenanceError("FORBIDDEN", "You cannot schedule contractor visits.");
  const start = dateOf(input.start, "start"), end = dateOf(input.end, "end");
  if (!start || !end) throw new MaintenanceError("VALIDATION", "Enter the visit window.", { start: "Required." });
  const check = await contractorAccessCheck({ vendorId: input.vendorId, workerIds: input.workerIds, workOrderId: input.workOrderId, start, end });
  if (!check.ok) throw new MaintenanceError("VALIDATION", check.reasons.join(" "));
  const visit = await prisma.contractorVisit.create({ data: { siteId, workOrderId: input.workOrderId || null, vendorId: input.vendorId, workerIds: input.workerIds, scheduledStart: start, scheduledEnd: end, escortRequired: !!input.escortRequired } });
  await prisma.workOrder.updateMany({ where: { id: input.workOrderId ?? "" }, data: { visitStart: start, visitEnd: end } });
  await recordAudit({ actorId: actor.id, action: "CONTRACTOR_VISIT_SCHEDULED", entityType: "ContractorVisit", entityId: visit.id, after: { vendorId: input.vendorId, start: start.toISOString(), end: end.toISOString() } });
  return visit;
}

export async function listVisits(opts: { siteIds?: string[] | null; upcomingOnly?: boolean } = {}) {
  const rows = await prisma.contractorVisit.findMany({ where: { ...(opts.siteIds ? { siteId: { in: opts.siteIds } } : {}), ...(opts.upcomingOnly ? { scheduledEnd: { gte: new Date() }, status: { in: ["SCHEDULED", "PASS_ISSUED", "CHECKED_IN"] } } : {}) }, orderBy: { scheduledStart: "asc" }, take: 200 });
  const vendors = new Map((await prisma.vendor.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.vendorId))] } }, select: { id: true, name: true } })).map((v) => [v.id, v.name]));
  const workers = new Map((await prisma.contractorWorker.findMany({ where: { id: { in: [...new Set(rows.flatMap((r) => r.workerIds))] } }, select: { id: true, name: true } })).map((w) => [w.id, w.name]));
  return rows.map((r) => ({ ...r, vendorName: vendors.get(r.vendorId) ?? "—", workerNames: r.workerIds.map((id) => workers.get(id) ?? "—") }));
}
