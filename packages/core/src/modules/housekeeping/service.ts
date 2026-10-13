// Housekeeping and inspections (document 5.9, 8): the cleaning task board, periodic room inspections from checklist
// templates, and issues found becoming work orders. Housekeeping staff are Technicians with the Housekeeping category.
import type { Prisma } from "@prisma/client";
import { prisma } from "../../lib/db";
import { recordAudit } from "../../lib/audit";
import { actorAccess, actorCan, type ActorLike } from "../../lib/permissions/actor";
import { createWorkOrder } from "../maintenance/service";

export class HousekeepingError extends Error {
  constructor(public readonly code: "NOT_FOUND" | "FORBIDDEN" | "VALIDATION" | "INVALID_STATE", message: string, public readonly fieldErrors: Record<string, string> = {}) {
    super(message);
    this.name = "HousekeepingError";
  }
}
type Tx = Prisma.TransactionClient;
const DAY = 86400000;
const dateOnly = (v: string, field: string) => {
  const d = new Date(`${v}T00:00:00.000Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v) || Number.isNaN(d.getTime())) throw new HousekeepingError("VALIDATION", "Enter a valid date.", { [field]: "Invalid date." });
  return d;
};

// ---------------------------------------------------------------------------
// Cleaning tasks
// ---------------------------------------------------------------------------

export async function listCleaningTasks(actor: ActorLike, opts: { siteIds?: string[] | null; status?: "open" | "done" | "all" } = {}) {
  const manage = actorCan(actor, "house.tasks");
  const tasks = await prisma.cleaningTask.findMany({
    where: { ...(opts.siteIds ? { siteId: { in: opts.siteIds } } : {}), ...(opts.status === "done" ? { status: "DONE" } : opts.status === "all" ? {} : { status: { in: ["OPEN", "IN_PROGRESS"] } }), ...(manage ? {} : { OR: [{ assignedToId: actor.id }, { assignedToId: null }] }) },
    orderBy: [{ dueAt: "asc" }, { createdAt: "asc" }], take: 300,
  });
  const rooms = new Map((await prisma.room.findMany({ where: { id: { in: tasks.map((t) => t.roomId).filter((x): x is string => !!x) } }, include: { building: true } })).map((r) => [r.id, `${r.building.name} · room ${r.code}`]));
  const beds = new Map((await prisma.bed.findMany({ where: { id: { in: tasks.map((t) => t.bedId).filter((x): x is string => !!x) } }, select: { id: true, code: true } })).map((b) => [b.id, b.code]));
  const users = new Map((await prisma.user.findMany({ where: { id: { in: tasks.map((t) => t.assignedToId).filter((x): x is string => !!x) } }, select: { id: true, name: true } })).map((u) => [u.id, u.name]));
  return tasks.map((t) => ({ ...t, roomLabel: t.roomId ? rooms.get(t.roomId) ?? "—" : "—", bedCode: t.bedId ? beds.get(t.bedId) ?? null : null, assignee: t.assignedToId ? users.get(t.assignedToId) ?? "—" : null }));
}

export async function housekeepingStaff() {
  return prisma.user.findMany({ where: { status: "ACTIVE", roleAssignments: { some: { role: "TECHNICIAN" } } }, orderBy: { name: "asc" }, select: { id: true, name: true } });
}

export async function assignTask(actor: ActorLike, taskId: string, assigneeId: string | null) {
  const t = await prisma.cleaningTask.findUnique({ where: { id: taskId } });
  if (!t) throw new HousekeepingError("NOT_FOUND", "Task not found.");
  if (!actorCan(actor, "house.tasks", { siteId: t.siteId })) throw new HousekeepingError("FORBIDDEN", "Only the front desk or an Admin can assign cleaning tasks.");
  if (t.status === "DONE") throw new HousekeepingError("INVALID_STATE", "That task is done.");
  const updated = await prisma.cleaningTask.update({ where: { id: taskId }, data: { assignedToId: assigneeId } });
  await recordAudit({ actorId: actor.id, action: "CLEANING_ASSIGNED", entityType: "CleaningTask", entityId: taskId, after: { assigneeId } });
  return updated;
}

export async function startTask(actor: ActorLike, taskId: string) {
  const t = await prisma.cleaningTask.findUnique({ where: { id: taskId } });
  if (!t) throw new HousekeepingError("NOT_FOUND", "Task not found.");
  if (!actorAccess(actor, "house.tasks", { siteId: t.siteId })) throw new HousekeepingError("FORBIDDEN", "You cannot work on cleaning tasks.");
  if (t.assignedToId && t.assignedToId !== actor.id && !actorCan(actor, "house.tasks", { siteId: t.siteId })) throw new HousekeepingError("FORBIDDEN", "That task is assigned to someone else.");
  if (t.status !== "OPEN") throw new HousekeepingError("INVALID_STATE", "That task has already been started.");
  return prisma.cleaningTask.update({ where: { id: taskId }, data: { status: "IN_PROGRESS", assignedToId: t.assignedToId ?? actor.id } });
}

/** Completing a task marks the bed (or every bed in the room) ready for the next resident. */
export async function completeTask(actor: ActorLike, taskId: string, notes?: string | null) {
  const t = await prisma.cleaningTask.findUnique({ where: { id: taskId } });
  if (!t) throw new HousekeepingError("NOT_FOUND", "Task not found.");
  if (!actorAccess(actor, "house.tasks", { siteId: t.siteId })) throw new HousekeepingError("FORBIDDEN", "You cannot complete cleaning tasks.");
  if (t.assignedToId && t.assignedToId !== actor.id && !actorCan(actor, "house.tasks", { siteId: t.siteId })) throw new HousekeepingError("FORBIDDEN", "That task is assigned to someone else.");
  if (t.status === "DONE" || t.status === "SKIPPED") throw new HousekeepingError("INVALID_STATE", "That task is already finished.");
  return prisma.$transaction(async (tx) => {
    const done = await tx.cleaningTask.update({ where: { id: taskId }, data: { status: "DONE", completedAt: new Date(), completedById: actor.id, notes: notes?.trim() || t.notes } });
    if (t.bedId) await tx.bed.update({ where: { id: t.bedId }, data: { readiness: "READY" } });
    else if (t.roomId) await tx.bed.updateMany({ where: { roomId: t.roomId, readiness: "NEEDS_CLEANING" }, data: { readiness: "READY" } });
    await recordAudit({ actorId: actor.id, action: "CLEANING_DONE", entityType: "CleaningTask", entityId: taskId, after: { bedId: t.bedId, roomId: t.roomId } }, tx);
    return done;
  });
}

export async function createAdhocTask(actor: ActorLike, input: { siteId: string; roomId: string; notes?: string | null; dueHours?: number }) {
  if (!actorCan(actor, "house.tasks", { siteId: input.siteId })) throw new HousekeepingError("FORBIDDEN", "Only the front desk or an Admin can create cleaning tasks.");
  const t = await prisma.cleaningTask.create({ data: { siteId: input.siteId, roomId: input.roomId, reason: "ADHOC", notes: input.notes?.trim() || null, dueAt: new Date(Date.now() + (input.dueHours ?? 24) * 3600000) } });
  await recordAudit({ actorId: actor.id, action: "CLEANING_CREATED", entityType: "CleaningTask", entityId: t.id });
  return t;
}

// ---------------------------------------------------------------------------
// Inspections
// ---------------------------------------------------------------------------

export type ChecklistItem = { id: string; label: string };
const DEFAULT_INSPECTION: ChecklistItem[] = [
  { id: "clean", label: "Room is clean" }, { id: "furniture", label: "Furniture in good condition" }, { id: "electrical", label: "Lights and sockets work" }, { id: "plumbing", label: "Taps, shower and toilet work" }, { id: "ac", label: "Air conditioning works" }, { id: "safety", label: "Smoke detector and fire safety in place" },
];

export async function inspectionChecklist(organizationId: string, templateId?: string | null, siteId?: string | null): Promise<{ id: string | null; items: ChecklistItem[] }> {
  const t = templateId ? await prisma.checklistTemplate.findUnique({ where: { id: templateId } }) : await prisma.checklistTemplate.findFirst({ where: { organizationId, kind: "INSPECTION", active: true, OR: [{ siteId: null }, ...(siteId ? [{ siteId }] : [])] }, orderBy: [{ siteId: "desc" }, { version: "desc" }] });
  const items = Array.isArray(t?.items) ? (t!.items as Array<{ id?: string; label?: string }>).filter((i) => i.id && i.label).map((i) => ({ id: String(i.id), label: String(i.label) })) : [];
  return { id: t?.id ?? null, items: items.length ? items : DEFAULT_INSPECTION };
}

export async function scheduleInspections(actor: ActorLike, input: { siteId: string; buildingId?: string | null; roomId?: string | null; title: string; frequencyDays: number; firstDue: string; templateId?: string | null }) {
  if (!actorCan(actor, "house.schedule", { siteId: input.siteId, buildingId: input.buildingId })) throw new HousekeepingError("FORBIDDEN", "Scheduling inspections needs the Maintenance coordinator grant or an Admin.");
  if (!input.title?.trim()) throw new HousekeepingError("VALIDATION", "Enter a title.", { title: "Required." });
  if (!Number.isInteger(input.frequencyDays) || input.frequencyDays < 1) throw new HousekeepingError("VALIDATION", "Enter the number of days between inspections.", { frequencyDays: "Whole number." });
  const s = await prisma.inspectionSchedule.create({ data: { siteId: input.siteId, buildingId: input.buildingId || null, roomId: input.roomId || null, templateId: input.templateId || null, title: input.title.trim(), frequencyDays: input.frequencyDays, nextDueAt: dateOnly(input.firstDue, "firstDue"), createdById: actor.id } });
  await recordAudit({ actorId: actor.id, action: "INSPECTION_SCHEDULED", entityType: "InspectionSchedule", entityId: s.id, after: { title: s.title, frequencyDays: s.frequencyDays } });
  return s;
}

export async function setInspectionScheduleActive(actor: ActorLike, scheduleId: string, active: boolean) {
  const s = await prisma.inspectionSchedule.findUnique({ where: { id: scheduleId } });
  if (!s) throw new HousekeepingError("NOT_FOUND", "Schedule not found.");
  if (!actorCan(actor, "house.schedule", { siteId: s.siteId, buildingId: s.buildingId })) throw new HousekeepingError("FORBIDDEN", "You cannot change inspection schedules.");
  return prisma.inspectionSchedule.update({ where: { id: scheduleId }, data: { active } });
}

export const listInspectionSchedules = () => prisma.inspectionSchedule.findMany({ orderBy: [{ active: "desc" }, { nextDueAt: "asc" }] });

/** Daily: creates an inspection for each room covered by a due schedule (occupied rooms first), then rolls the schedule forward. */
export async function runInspectionSchedules(now: Date = new Date()) {
  const due = await prisma.inspectionSchedule.findMany({ where: { active: true, nextDueAt: { lte: new Date(now.getTime() + 3 * DAY) } } });
  let created = 0;
  for (const s of due) {
    const rooms = await prisma.room.findMany({ where: { archivedAt: null, status: "ACTIVE", building: { siteId: s.siteId, ...(s.buildingId ? { id: s.buildingId } : {}) }, ...(s.roomId ? { id: s.roomId } : {}) }, select: { id: true }, take: 500 });
    for (const r of rooms) {
      const exists = await prisma.inspection.findFirst({ where: { scheduleId: s.id, roomId: r.id, scheduledFor: s.nextDueAt } });
      if (exists) continue;
      await prisma.inspection.create({ data: { siteId: s.siteId, roomId: r.id, templateId: s.templateId, scheduleId: s.id, scheduledFor: s.nextDueAt } });
      created++;
    }
    await prisma.inspectionSchedule.update({ where: { id: s.id }, data: { nextDueAt: new Date(s.nextDueAt.getTime() + s.frequencyDays * DAY) } });
  }
  return created;
}

export async function listInspections(opts: { siteIds?: string[] | null; status?: "todo" | "done" | "issues" | "all" } = {}) {
  const rows = await prisma.inspection.findMany({ where: { ...(opts.siteIds ? { siteId: { in: opts.siteIds } } : {}), ...(opts.status === "done" ? { status: "DONE" } : opts.status === "issues" ? { status: "ISSUES_FOUND" } : opts.status === "all" ? {} : { status: "SCHEDULED" }) }, orderBy: { scheduledFor: "asc" }, take: 300 });
  const rooms = new Map((await prisma.room.findMany({ where: { id: { in: rows.map((r) => r.roomId) } }, include: { building: true } })).map((r) => [r.id, `${r.building.name} · room ${r.code}`]));
  return rows.map((r) => ({ ...r, roomLabel: rooms.get(r.roomId) ?? "—" }));
}

export type InspectionResult = { id: string; label: string; ok: boolean; note?: string };

/** Performs an inspection against the checklist. Every failed item becomes a work order; the inspection is marked "issues found". */
export async function performInspection(actor: ActorLike, inspectionId: string, results: Array<{ id: string; ok: boolean; note?: string | null }>, notes?: string | null) {
  const insp = await prisma.inspection.findUnique({ where: { id: inspectionId } });
  if (!insp) throw new HousekeepingError("NOT_FOUND", "Inspection not found.");
  if (!actorCan(actor, "house.inspect", { siteId: insp.siteId }) && !actorAccess(actor, "house.inspect", { siteId: insp.siteId })) throw new HousekeepingError("FORBIDDEN", "You cannot perform inspections.");
  if (insp.status !== "SCHEDULED") throw new HousekeepingError("INVALID_STATE", "That inspection has already been done.");
  const org = await prisma.site.findUniqueOrThrow({ where: { id: insp.siteId }, select: { organizationId: true } });
  const list = await inspectionChecklist(org.organizationId, insp.templateId, insp.siteId);
  const byId = new Map(results.map((r) => [r.id, r]));
  const out: InspectionResult[] = list.items.map((i) => ({ id: i.id, label: i.label, ok: byId.get(i.id)?.ok ?? false, note: byId.get(i.id)?.note?.trim() || undefined }));
  if (results.length < list.items.length) throw new HousekeepingError("VALIDATION", "Answer every checklist item.");
  const failed = out.filter((r) => !r.ok);
  if (failed.some((f) => !f.note)) throw new HousekeepingError("VALIDATION", "Add a note to every failed item.");
  const room = await prisma.room.findUniqueOrThrow({ where: { id: insp.roomId }, include: { building: true } });
  const orderIds: string[] = [];
  for (const f of failed) {
    const wo = await createWorkOrder({ requesterId: actor.id, siteId: insp.siteId, buildingId: room.buildingId, roomId: room.id, category: /clean/i.test(f.label) ? "Cleaning" : /plumb|tap|toilet/i.test(f.label) ? "Plumbing" : /electr|light|socket/i.test(f.label) ? "Electrical" : /air/i.test(f.label) ? "Air conditioning" : /furnit/i.test(f.label) ? "Furniture" : "Other", description: `Inspection finding: ${f.label}. ${f.note}`, priority: /safety|fire/i.test(f.label) ? "HIGH" : "MEDIUM" });
    await prisma.workOrder.update({ where: { id: wo.id }, data: { source: "INSPECTION", inspectionId: insp.id } });
    orderIds.push(wo.id);
  }
  const done = await prisma.inspection.update({ where: { id: insp.id }, data: { status: failed.length ? "ISSUES_FOUND" : "DONE", performedById: actor.id, performedAt: new Date(), results: { items: out, workOrderIds: orderIds } as never, notes: notes?.trim() || null } });
  await recordAudit({ actorId: actor.id, action: "INSPECTION_DONE", entityType: "Inspection", entityId: insp.id, after: { failed: failed.length, workOrders: orderIds.length } });
  return { inspection: done, workOrderIds: orderIds };
}

export type { Tx };
