// Maintenance requests and work orders (SRS 5.3, 6.3, 8.3).
import type { Prisma, PrismaClient, WorkOrderPriority, WorkOrderStatus } from "@prisma/client";
import { prisma } from "../../lib/db";
import { recordAudit } from "../../lib/audit";
import { enqueueNotification } from "../../lib/notifications";
import { storeImage, UploadError } from "../../lib/uploads";
import { MaintenanceError } from "./errors";
import { MAINTENANCE_COORDINATOR_ROLES } from "./access";
import { CATEGORIES, PRIORITIES, REOPEN_WINDOW_DAYS, OPEN_STATUSES, WAITING_STATUSES, allowedTransitions, accessFor, isOverdue, reopenWindowOpen, slaDueAt, visibleNotes, workOrderInclude, type Actor, type QueueFilter, type WorkOrderAccess } from "./rules";

export * from "./rules";

type Tx = Prisma.TransactionClient;
type Db = Tx | PrismaClient;

export const TERMINAL_STATUSES: WorkOrderStatus[] = ["CLOSED", "CANCELLED"];
const TERMINAL = TERMINAL_STATUSES;

// ---------------------------------------------------------------------------
// Create (MNT-01, MNT-02)
// ---------------------------------------------------------------------------

export type CreateInput = {
  requesterId: string;
  siteId?: string | null;
  buildingId?: string | null;
  roomId?: string | null;
  locationNote?: string | null;
  category: string;
  description: string;
  priority: WorkOrderPriority;
  preferredContact?: string | null;
  photo?: { bytes: Uint8Array; fileName: string } | null;
};

async function nextTicketNumber(tx: Tx): Promise<string> {
  const [{ nextval }] = await tx.$queryRaw<[{ nextval: bigint }]>`SELECT nextval('"WorkOrder_ticket_seq"')`;
  return `MR-${new Date().getUTCFullYear()}-${String(nextval).padStart(6, "0")}`;
}

export async function createWorkOrder(input: CreateInput) {
  const errors: Record<string, string> = {};
  const description = input.description?.trim() ?? "";
  if (!CATEGORIES.includes(input.category as (typeof CATEGORIES)[number])) errors.category = "Choose a category.";
  if (description.length < 10) errors.description = "Describe the problem in at least 10 characters.";
  if (description.length > 2000) errors.description = "Keep the description under 2000 characters.";
  if (!PRIORITIES.includes(input.priority)) errors.priority = "Choose an urgency.";
  if (!input.roomId && !input.locationNote?.trim()) errors.locationNote = "Tell us where the problem is.";
  if (Object.keys(errors).length > 0) throw new MaintenanceError("VALIDATION", "Please correct the highlighted fields.", errors);

  // Resolve site/building from the room when given.
  let siteId = input.siteId ?? null;
  let buildingId = input.buildingId ?? null;
  if (input.roomId) {
    const room = await prisma.room.findUnique({ where: { id: input.roomId }, include: { building: true } });
    if (!room) throw new MaintenanceError("VALIDATION", "Unknown room.", { roomId: "Unknown room." });
    buildingId = room.buildingId;
    siteId = room.building.siteId;
  } else if (buildingId && !siteId) {
    const building = await prisma.building.findUnique({ where: { id: buildingId } });
    siteId = building?.siteId ?? null;
  }
  if (!siteId) {
    const site = await prisma.site.findFirst({ where: { status: "ACTIVE" }, orderBy: { createdAt: "asc" } });
    if (!site) throw new MaintenanceError("VALIDATION", "No site is configured.");
    siteId = site.id;
  }

  try {
    return await prisma.$transaction(async (tx) => {
      const now = new Date();
      const created = await tx.workOrder.create({
        data: {
          createdAt: now,
          ticketNumber: await nextTicketNumber(tx),
          siteId: siteId!,
          buildingId,
          roomId: input.roomId ?? null,
          locationNote: input.locationNote?.trim() || null,
          category: input.category,
          description,
          priority: input.priority,
          status: "NEW",
          requesterId: input.requesterId,
          preferredContact: input.preferredContact?.trim() || null,
          slaDueAt: slaDueAt(input.priority, now),
        },
      });
      if (input.photo) {
        await storeImage(tx, { bytes: input.photo.bytes, fileName: input.photo.fileName, entityType: "WorkOrder", entityId: created.id, uploadedById: input.requesterId });
      }
      await recordAudit({ actorId: input.requesterId, action: "WORK_ORDER_CREATED", entityType: "WorkOrder", entityId: created.id, after: { ticketNumber: created.ticketNumber, category: created.category, priority: created.priority, roomId: created.roomId, hasPhoto: !!input.photo } }, tx);
      await enqueueNotification(tx, {
        recipientId: input.requesterId,
        event: "maintenance.received",
        idempotencyKey: `maintenance.received:${created.id}`,
        payload: { workOrderId: created.id, ticketNumber: created.ticketNumber, category: created.category },
      });
      return created;
    });
  } catch (error) {
    if (error instanceof UploadError) throw new MaintenanceError("VALIDATION", error.message, { photo: error.message });
    throw error;
  }
}

// ---------------------------------------------------------------------------
// Assignment (MNT-03)
// ---------------------------------------------------------------------------

export async function assignWorkOrder(input: { workOrderId: string; actor: Actor; assigneeId?: string | null; vendorId?: string | null; note?: string | null }) {
  if (!input.assigneeId && !input.vendorId) throw new MaintenanceError("VALIDATION", "Choose an engineer or a vendor.");
  return prisma.$transaction(async (tx) => {
    const wo = await tx.workOrder.findUnique({ where: { id: input.workOrderId }, include: workOrderInclude });
    if (!wo) throw new MaintenanceError("NOT_FOUND", "Work order not found.");
    if (accessFor(wo, input.actor) !== "coordinator") throw new MaintenanceError("FORBIDDEN", "Only maintenance coordinators can assign work.");
    if (TERMINAL.includes(wo.status) || wo.status === "RESOLVED") throw new MaintenanceError("INVALID_TRANSITION", `A ${wo.status.toLowerCase()} ticket cannot be assigned.`);

    let label: string;
    if (input.assigneeId) {
      const assignee = await tx.user.findUnique({ where: { id: input.assigneeId }, include: { roleAssignments: true } });
      if (!assignee || assignee.status !== "ACTIVE" || !assignee.roleAssignments.some((r) => r.role === "MAINTENANCE")) {
        throw new MaintenanceError("VALIDATION", "The assignee must be an active maintenance team member.");
      }
      label = assignee.name;
    } else {
      const vendor = await tx.vendor.findUnique({ where: { id: input.vendorId! } });
      if (!vendor || vendor.status !== "ACTIVE") throw new MaintenanceError("VALIDATION", "Choose an active vendor.");
      label = `${vendor.name} (vendor)`;
    }

    const keepStatus = ["IN_PROGRESS", ...WAITING_STATUSES].includes(wo.status);
    const updated = await tx.workOrder.update({
      where: { id: wo.id },
      data: {
        assigneeId: input.assigneeId ?? null,
        vendorId: input.vendorId ?? null,
        status: keepStatus ? wo.status : "ASSIGNED",
        acknowledgedAt: wo.acknowledgedAt ?? new Date(),
      },
    });
    await tx.workOrderNote.create({ data: { workOrderId: wo.id, authorId: input.actor.id, type: "ASSIGNMENT", note: `Assigned to ${label}${input.note ? `: ${input.note.trim()}` : ""}` } });
    await recordAudit({ actorId: input.actor.id, action: "WORK_ORDER_ASSIGNED", entityType: "WorkOrder", entityId: wo.id, before: { assigneeId: wo.assigneeId, vendorId: wo.vendorId, status: wo.status }, after: { assigneeId: updated.assigneeId, vendorId: updated.vendorId, status: updated.status } }, tx);
    await enqueueNotification(tx, {
      recipientId: wo.requesterId,
      event: "maintenance.assigned",
      idempotencyKey: `maintenance.assigned:${wo.id}:${updated.assigneeId ?? updated.vendorId}`,
      payload: { workOrderId: wo.id, ticketNumber: wo.ticketNumber },
    });
    if (updated.assigneeId) {
      await enqueueNotification(tx, {
        recipientId: updated.assigneeId,
        event: "maintenance.assigned_to_you",
        idempotencyKey: `maintenance.assigned_to_you:${wo.id}:${updated.assigneeId}:${Date.now()}`,
        payload: { workOrderId: wo.id, ticketNumber: wo.ticketNumber, priority: wo.priority },
      });
    }
    return updated;
  });
}

// ---------------------------------------------------------------------------
// Status changes (MNT-02, MNT-04, MNT-05)
// ---------------------------------------------------------------------------

export async function changeStatus(input: { workOrderId: string; actor: Actor; status: WorkOrderStatus; note?: string | null; now?: Date }) {
  const note = input.note?.trim() || null;
  const now = input.now ?? new Date();
  return prisma.$transaction(async (tx) => {
    const wo = await tx.workOrder.findUnique({ where: { id: input.workOrderId }, include: workOrderInclude });
    if (!wo) throw new MaintenanceError("NOT_FOUND", "Work order not found.");
    const access = accessFor(wo, input.actor);
    if (!access) throw new MaintenanceError("FORBIDDEN", "You cannot change this work order.");
    const allowed = allowedTransitions(wo.status, access, { reopenWindowOpen: reopenWindowOpen(wo, now) });
    if (!allowed.includes(input.status)) {
      throw new MaintenanceError("INVALID_TRANSITION", `Cannot move a ${wo.status.toLowerCase().replace(/_/g, " ")} ticket to ${input.status.toLowerCase().replace(/_/g, " ")}${wo.status === "RESOLVED" && input.status === "REOPENED" ? ` (reopening is only possible within ${REOPEN_WINDOW_DAYS} days of resolution)` : ""}.`);
    }
    if ((input.status === "RESOLVED" || input.status === "REOPENED" || input.status === "CANCELLED") && !note) {
      throw new MaintenanceError("NOTE_REQUIRED", input.status === "RESOLVED" ? "Describe what was done to resolve the issue." : input.status === "REOPENED" ? "Explain why the issue is not resolved." : "Give a reason for cancelling.");
    }

    const data: Prisma.WorkOrderUpdateInput = { status: input.status };
    if (input.status === "IN_PROGRESS" && !wo.startedAt) data.startedAt = now;
    if (input.status === "RESOLVED") { data.resolvedAt = now; data.resolutionNote = note; }
    if (input.status === "CLOSED") data.closedAt = now;
    if (input.status === "CANCELLED") data.closedAt = now;
    if (input.status === "REOPENED") { data.reopenCount = { increment: 1 }; data.resolvedAt = null; data.closedAt = null; }
    const updated = await tx.workOrder.update({ where: { id: wo.id }, data });

    const label = input.status.toLowerCase().replace(/_/g, " ");
    await tx.workOrderNote.create({ data: { workOrderId: wo.id, authorId: input.actor.id, type: "STATUS", note: note ? `${capitalize(label)}: ${note}` : capitalize(label) } });
    await recordAudit({ actorId: input.actor.id, action: "WORK_ORDER_STATUS_CHANGED", entityType: "WorkOrder", entityId: wo.id, before: { status: wo.status }, after: { status: input.status, note } }, tx);

    const notify: Record<string, string> = { WAITING_STAFF: "maintenance.waiting_on_you", RESOLVED: "maintenance.resolved", CLOSED: "maintenance.closed", CANCELLED: "maintenance.cancelled" };
    const event = notify[input.status];
    if (event && input.actor.id !== wo.requesterId) {
      await enqueueNotification(tx, { recipientId: wo.requesterId, event, idempotencyKey: `${event}:${wo.id}:${now.getTime()}`, payload: { workOrderId: wo.id, ticketNumber: wo.ticketNumber, note } });
    }
    if (input.status === "REOPENED" && wo.assigneeId && input.actor.id !== wo.assigneeId) {
      await enqueueNotification(tx, { recipientId: wo.assigneeId, event: "maintenance.reopened", idempotencyKey: `maintenance.reopened:${wo.id}:${now.getTime()}`, payload: { workOrderId: wo.id, ticketNumber: wo.ticketNumber, note } });
    }
    return updated;
  });
}

function capitalize(s: string) { return s.charAt(0).toUpperCase() + s.slice(1); }

/** Coordinators may correct category and priority during triage; the SLA target follows the priority. */
export async function triageWorkOrder(input: { workOrderId: string; actor: Actor; category?: string | null; priority?: WorkOrderPriority | null; markTriaged?: boolean }) {
  return prisma.$transaction(async (tx) => {
    const wo = await tx.workOrder.findUnique({ where: { id: input.workOrderId }, include: workOrderInclude });
    if (!wo) throw new MaintenanceError("NOT_FOUND", "Work order not found.");
    if (accessFor(wo, input.actor) !== "coordinator") throw new MaintenanceError("FORBIDDEN", "Only maintenance coordinators can triage.");
    if (TERMINAL.includes(wo.status)) throw new MaintenanceError("INVALID_TRANSITION", "This ticket is closed.");
    const data: Prisma.WorkOrderUpdateInput = {};
    if (input.category && input.category !== wo.category) {
      if (!CATEGORIES.includes(input.category as (typeof CATEGORIES)[number])) throw new MaintenanceError("VALIDATION", "Unknown category.");
      data.category = input.category;
    }
    if (input.priority && input.priority !== wo.priority) {
      data.priority = input.priority;
      data.slaDueAt = slaDueAt(input.priority, wo.createdAt);
    }
    if (input.markTriaged && wo.status === "NEW") data.status = "TRIAGED";
    if (Object.keys(data).length === 0) return wo;
    const updated = await tx.workOrder.update({ where: { id: wo.id }, data });
    await tx.workOrderNote.create({ data: { workOrderId: wo.id, authorId: input.actor.id, type: "STATUS", internal: true, note: `Triaged: ${[data.category ? `category ${data.category}` : null, data.priority ? `priority ${data.priority}` : null].filter(Boolean).join(", ") || "reviewed"}` } });
    await recordAudit({ actorId: input.actor.id, action: "WORK_ORDER_TRIAGED", entityType: "WorkOrder", entityId: wo.id, before: { category: wo.category, priority: wo.priority, status: wo.status }, after: { category: updated.category, priority: updated.priority, status: updated.status } }, tx);
    return updated;
  });
}

export async function addNote(input: { workOrderId: string; actor: Actor; note: string; internal?: boolean; photo?: { bytes: Uint8Array; fileName: string } | null }) {
  const note = input.note?.trim() ?? "";
  if (!note && !input.photo) throw new MaintenanceError("VALIDATION", "Write a note or attach a photo.");
  try {
    return await prisma.$transaction(async (tx) => {
      const wo = await tx.workOrder.findUnique({ where: { id: input.workOrderId }, include: workOrderInclude });
      if (!wo) throw new MaintenanceError("NOT_FOUND", "Work order not found.");
      const access = accessFor(wo, input.actor);
      if (!access || access === "auditor") throw new MaintenanceError("FORBIDDEN", "You cannot comment on this work order.");
      if (TERMINAL.includes(wo.status)) throw new MaintenanceError("INVALID_TRANSITION", "This ticket is closed.");
      const internal = !!input.internal && (access === "coordinator" || access === "assignee");
      const created = await tx.workOrderNote.create({ data: { workOrderId: wo.id, authorId: input.actor.id, type: "COMMENT", internal, note: note || "Photo attached" } });
      if (input.photo) {
        await storeImage(tx, { bytes: input.photo.bytes, fileName: input.photo.fileName, entityType: "WorkOrder", entityId: wo.id, uploadedById: input.actor.id });
      }
      if (!internal && input.actor.id !== wo.requesterId && access !== "requester") {
        await enqueueNotification(tx, { recipientId: wo.requesterId, event: "maintenance.update", idempotencyKey: `maintenance.update:${created.id}`, payload: { workOrderId: wo.id, ticketNumber: wo.ticketNumber, note } });
      }
      return created;
    });
  } catch (error) {
    if (error instanceof UploadError) throw new MaintenanceError("VALIDATION", error.message, { photo: error.message });
    throw error;
  }
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

export async function getWorkOrder(id: string, db: Db = prisma) {
  return db.workOrder.findUnique({ where: { id }, include: workOrderInclude });
}

export async function listAttachments(workOrderId: string, db: Db = prisma) {
  return db.attachment.findMany({ where: { entityType: "WorkOrder", entityId: workOrderId }, orderBy: { createdAt: "asc" } });
}


/** Operations queue, scoped by what the actor may see. */
export async function listWorkOrders(actor: Actor, filter: QueueFilter) {
  const isCoordinator = actor.roles.some((r) => MAINTENANCE_COORDINATOR_ROLES.includes(r)) || actor.roles.includes("AUDITOR");
  const scope: Prisma.WorkOrderWhereInput = isCoordinator
    ? {}
    : actor.vendorId && actor.roles.includes("VENDOR")
      ? { vendorId: actor.vendorId }
      : { OR: [{ assigneeId: actor.id }, { requesterId: actor.id }] };
  const byFilter: Prisma.WorkOrderWhereInput =
    filter === "open" ? { status: { in: OPEN_STATUSES } }
    : filter === "unassigned" ? { status: { in: ["NEW", "TRIAGED", "REOPENED"] }, assigneeId: null, vendorId: null }
    : filter === "mine" ? { assigneeId: actor.id, status: { in: OPEN_STATUSES } }
    : filter === "waiting" ? { status: { in: WAITING_STATUSES } }
    : filter === "resolved" ? { status: "RESOLVED" }
    : filter === "closed" ? { status: { in: TERMINAL } }
    : {};
  return prisma.workOrder.findMany({
    where: { AND: [scope, byFilter] },
    include: workOrderInclude,
    orderBy: [{ status: "asc" }, { slaDueAt: "asc" }, { createdAt: "desc" }],
    take: 300,
  });
}

export async function listMyWorkOrders(requesterId: string) {
  return prisma.workOrder.findMany({ where: { requesterId }, include: workOrderInclude, orderBy: { createdAt: "desc" } });
}

export async function queueSummary(actor: Actor, now: Date = new Date()) {
  const open = await listWorkOrders(actor, "open");
  return {
    open: open.length,
    unassigned: open.filter((w) => !w.assigneeId && !w.vendorId).length,
    overdue: open.filter((w) => isOverdue(w, now)).length,
    waiting: open.filter((w) => WAITING_STATUSES.includes(w.status)).length,
    awaitingClose: (await listWorkOrders(actor, "resolved")).length,
  };
}

export async function listAssignees(db: Db = prisma) {
  const [engineers, vendors] = await Promise.all([
    db.user.findMany({ where: { status: "ACTIVE", roleAssignments: { some: { role: "MAINTENANCE" } } }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
    db.vendor.findMany({ where: { status: "ACTIVE" }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
  ]);
  return { engineers, vendors };
}

// ---------------------------------------------------------------------------
// Views for the API: everything a page needs in one call
// ---------------------------------------------------------------------------

export type WorkOrderPerspective = "ops" | "mine";

/**
 * One ticket as the actor may see it: the record, the relationship that grants
 * access, the notes they may read, photos, and the status changes open to them.
 * "mine" is the resident's own view: only their tickets, even for coordinators.
 */
export async function getWorkOrderView(actor: Actor, id: string, perspective: WorkOrderPerspective, now: Date = new Date()) {
  const workOrder = await getWorkOrder(id);
  if (!workOrder) throw new MaintenanceError("NOT_FOUND", "Work order not found.");
  let access = accessFor(workOrder, actor);
  if (perspective === "mine") {
    if (workOrder.requesterId !== actor.id) throw new MaintenanceError("NOT_FOUND", "Work order not found.");
    if (access === "coordinator") access = "requester";
  } else if (!access) {
    throw new MaintenanceError("NOT_FOUND", "Work order not found.");
  }
  const transitionAccess: WorkOrderAccess = perspective === "mine" ? "requester" : access;
  const [photos, assignees] = await Promise.all([listAttachments(id), perspective === "ops" && access === "coordinator" ? listAssignees() : Promise.resolve(null)]);
  return {
    workOrder,
    access,
    notes: visibleNotes(workOrder, access),
    photos,
    transitions: allowedTransitions(workOrder.status, transitionAccess, { reopenWindowOpen: reopenWindowOpen(workOrder, now) }),
    assignees,
    now,
  };
}

/** The operations queue with its summary counts. */
export async function getQueue(actor: Actor, filter: QueueFilter, now: Date = new Date()) {
  const [orders, summary] = await Promise.all([listWorkOrders(actor, filter), queueSummary(actor, now)]);
  return { orders, summary, now };
}

/** Rooms a resident can report against: the room of each current or upcoming bed. */
export async function residentRoomOptions(userId: string) {
  const staff = await prisma.staffProfile.findUnique({ where: { userId }, select: { id: true } });
  if (!staff) return [];
  const allocations = await prisma.allocation.findMany({
    where: { staffId: staff.id, status: { in: ["CONFIRMED", "CHECKED_IN"] } },
    include: { bed: { include: { room: { include: { building: true } } } } },
    orderBy: { startDate: "desc" },
  });
  const seen = new Set<string>();
  return allocations.flatMap((a) => {
    const room = a.bed.room;
    if (seen.has(room.id)) return [];
    seen.add(room.id);
    return [{ id: room.id, label: `My room · ${room.building.name} room ${room.code}` }];
  });
}

/** Locations a coordinator can raise a ticket against. */
export async function opsLocationOptions() {
  const [rooms, buildings] = await Promise.all([
    prisma.room.findMany({ where: { status: { not: "INACTIVE" } }, include: { building: true }, orderBy: [{ building: { code: "asc" } }, { code: "asc" }] }),
    prisma.building.findMany({ where: { status: "ACTIVE" }, include: { site: true }, orderBy: [{ site: { name: "asc" } }, { code: "asc" }] }),
  ]);
  return {
    rooms: rooms.map((r) => ({ id: r.id, label: `${r.building.name} · Room ${r.code}` })),
    buildings: buildings.map((b) => ({ id: b.id, label: `${b.site.name} · ${b.name}` })),
  };
}
