// Pure maintenance rules: access, transitions, SLA and labels. No database access,
// so the web app and the API can both import this file.
import type { Prisma, Role, WorkOrderPriority, WorkOrderStatus } from "@prisma/client";
import { MAINTENANCE_COORDINATOR_ROLES } from "./access";

export type Actor = { id: string; roles: Role[]; vendorId?: string | null };

export const CATEGORIES = ["Electrical", "Plumbing", "Air conditioning", "Furniture", "Doors and locks", "Cleaning", "Pest control", "Internet / TV", "Other"] as const;
export const PRIORITIES: WorkOrderPriority[] = ["LOW", "MEDIUM", "HIGH", "URGENT"];

/** Hours to resolve by priority (MNT-06). Configurable per client later. */
export const SLA_HOURS: Record<WorkOrderPriority, number> = { URGENT: 4, HIGH: 24, MEDIUM: 72, LOW: 168 };
export const REOPEN_WINDOW_DAYS = Number(process.env.MAINTENANCE_REOPEN_WINDOW_DAYS ?? 7);

export const OPEN_STATUSES: WorkOrderStatus[] = ["NEW", "TRIAGED", "ASSIGNED", "IN_PROGRESS", "WAITING_STAFF", "WAITING_PARTS", "WAITING_ACCESS", "REOPENED"];
export const WAITING_STATUSES: WorkOrderStatus[] = ["WAITING_STAFF", "WAITING_PARTS", "WAITING_ACCESS"];

export function slaDueAt(priority: WorkOrderPriority, from: Date = new Date()): Date {
  return new Date(from.getTime() + SLA_HOURS[priority] * 3600 * 1000);
}

export function isOverdue(wo: { status: WorkOrderStatus; slaDueAt: Date | null }, now: Date = new Date()): boolean {
  return OPEN_STATUSES.includes(wo.status) && !!wo.slaDueAt && wo.slaDueAt < now;
}

export const workOrderInclude = {
  site: true,
  building: true,
  room: true,
  requester: { select: { id: true, name: true, email: true, vendorId: true, staffProfile: { select: { employeeId: true, firstName: true, lastName: true, phone: true } } } },
  assignee: { select: { id: true, name: true } },
  vendor: true,
  notes: { include: { author: { select: { id: true, name: true, vendorId: true } } }, orderBy: { createdAt: "asc" } },
} satisfies Prisma.WorkOrderInclude;

export type WorkOrderRecord = Prisma.WorkOrderGetPayload<{ include: typeof workOrderInclude }>;

/** What a list row shows: no notes, no requester details. */
export const workOrderListInclude = {
  site: { select: { id: true, name: true } },
  building: { select: { id: true, name: true } },
  room: { select: { id: true, code: true } },
  assignee: { select: { id: true, name: true } },
  vendor: { select: { id: true, name: true } },
} satisfies Prisma.WorkOrderInclude;
export type WorkOrderListItem = Prisma.WorkOrderGetPayload<{ include: typeof workOrderListInclude }>;

// ---------------------------------------------------------------------------
// Access
// ---------------------------------------------------------------------------

export type WorkOrderAccess = "coordinator" | "assignee" | "vendor" | "requester" | "auditor" | null;

export function accessFor(wo: Pick<WorkOrderRecord, "requesterId" | "assigneeId" | "vendorId">, actor: Actor): WorkOrderAccess {
  if (actor.roles.some((r) => MAINTENANCE_COORDINATOR_ROLES.includes(r))) return "coordinator";
  if (wo.assigneeId === actor.id) return "assignee";
  if (actor.vendorId && wo.vendorId === actor.vendorId && actor.roles.includes("VENDOR")) return "vendor";
  if (wo.requesterId === actor.id) return "requester";
  if (actor.roles.includes("AUDITOR")) return "auditor";
  return null;
}

/** Notes the actor may see: internal notes are for coordinators and internal assignees only. */
export function visibleNotes(wo: WorkOrderRecord, access: WorkOrderAccess) {
  const seesInternal = access === "coordinator" || access === "assignee" || access === "auditor";
  return seesInternal ? wo.notes : wo.notes.filter((n) => !n.internal);
}

// ---------------------------------------------------------------------------
// Transitions (8.3)
// ---------------------------------------------------------------------------

const WORKER_TARGETS: WorkOrderStatus[] = ["IN_PROGRESS", "WAITING_STAFF", "WAITING_PARTS", "WAITING_ACCESS", "RESOLVED"];

/** Statuses the actor may move the ticket to, by its current status and the actor's relationship to it. */
export function allowedTransitions(status: WorkOrderStatus, access: WorkOrderAccess, opts: { reopenWindowOpen: boolean }): WorkOrderStatus[] {
  const isWorker = access === "assignee" || access === "vendor";
  const isCoordinator = access === "coordinator";
  switch (status) {
    case "NEW":
      return isCoordinator ? ["TRIAGED", "CANCELLED"] : access === "requester" ? ["CANCELLED"] : [];
    case "TRIAGED":
      return isCoordinator ? ["CANCELLED"] : [];
    case "ASSIGNED":
    case "IN_PROGRESS":
    case "WAITING_STAFF":
    case "WAITING_PARTS":
    case "WAITING_ACCESS":
    case "REOPENED":
      if (isCoordinator) return [...WORKER_TARGETS.filter((s) => s !== status), "CANCELLED"];
      if (isWorker) return WORKER_TARGETS.filter((s) => s !== status);
      return [];
    case "RESOLVED":
      if (isCoordinator) return ["CLOSED", "REOPENED"];
      if (access === "requester") return opts.reopenWindowOpen ? ["CLOSED", "REOPENED"] : ["CLOSED"];
      return [];
    default:
      return [];
  }
}

export function reopenWindowOpen(wo: { resolvedAt: Date | null }, now: Date = new Date()): boolean {
  return !!wo.resolvedAt && now.getTime() - wo.resolvedAt.getTime() <= REOPEN_WINDOW_DAYS * 86400000;
}

export function describeStatus(status: WorkOrderStatus): string {
  const map: Record<WorkOrderStatus, string> = {
    NEW: "New", TRIAGED: "Triaged", ASSIGNED: "Assigned", IN_PROGRESS: "In progress",
    WAITING_STAFF: "Waiting for you", WAITING_PARTS: "Waiting for parts", WAITING_ACCESS: "Waiting for access",
    RESOLVED: "Resolved · please confirm", CLOSED: "Closed", REOPENED: "Reopened", CANCELLED: "Cancelled",
  };
  return map[status];
}

export function locationLabel(wo: { site: { name: string }; building: { name: string } | null; room: { code: string } | null; locationNote: string | null }): string {
  const parts = [wo.building?.name, wo.room ? `Room ${wo.room.code}` : null, wo.locationNote].filter(Boolean);
  return parts.length ? parts.join(" · ") : wo.site.name;
}

export type QueueFilter = "open" | "unassigned" | "mine" | "waiting" | "resolved" | "closed" | "all";
