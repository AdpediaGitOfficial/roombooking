import { z } from "zod";
import { MAINTENANCE_AREA_ROLES, MAINTENANCE_COORDINATOR_ROLES } from "@sam/core/modules/maintenance/access";
import type * as svc from "@sam/core/modules/maintenance/service";
import { cuid, fileInput, fileOp, op, out, type Ret } from "../define";

const priority = z.enum(["LOW", "MEDIUM", "HIGH", "URGENT"]);
const status = z.enum(["NEW", "TRIAGED", "ASSIGNED", "IN_PROGRESS", "WAITING_STAFF", "WAITING_PARTS", "WAITING_ACCESS", "RESOLVED", "CLOSED", "REOPENED", "CANCELLED"]);
const text = (max: number) => z.string().max(max).optional();

export const maintenance = {
  queue: op({
    id: "maintenance.queue",
    method: "GET",
    path: "/v1/maintenance/queue",
    summary: "Operations queue for the signed-in coordinator, engineer, vendor or auditor, with summary counts",
    tag: "Maintenance",
    access: MAINTENANCE_AREA_ROLES,
    input: z.object({ filter: z.enum(["open", "unassigned", "mine", "waiting", "resolved", "closed", "all"]).default("open") }),
    output: out<Ret<typeof svc.getQueue>>(),
  }),
  mine: op({
    id: "maintenance.mine",
    method: "GET",
    path: "/v1/maintenance/mine",
    summary: "Tickets the signed-in user reported",
    tag: "Maintenance",
    input: z.object({}),
    output: out<Ret<typeof svc.listMyWorkOrders>>(),
  }),
  get: op({
    id: "maintenance.get",
    method: "GET",
    path: "/v1/maintenance/orders/:id",
    summary: "One ticket as the operations team sees it",
    tag: "Maintenance",
    access: MAINTENANCE_AREA_ROLES,
    input: z.object({ id: cuid() }),
    output: out<Ret<typeof svc.getWorkOrderView>>(),
  }),
  getMine: op({
    id: "maintenance.getMine",
    method: "GET",
    path: "/v1/maintenance/mine/:id",
    summary: "One of the signed-in user's own tickets",
    tag: "Maintenance",
    input: z.object({ id: cuid() }),
    output: out<Ret<typeof svc.getWorkOrderView>>(),
  }),
  myRoomOptions: op({
    id: "maintenance.myRoomOptions",
    method: "GET",
    path: "/v1/maintenance/my-rooms",
    summary: "Rooms the resident can report a problem against",
    tag: "Maintenance",
    input: z.object({}),
    output: out<Ret<typeof svc.residentRoomOptions>>(),
  }),
  locationOptions: op({
    id: "maintenance.locationOptions",
    method: "GET",
    path: "/v1/maintenance/locations",
    summary: "Rooms and buildings a coordinator can raise a ticket against",
    tag: "Maintenance",
    access: MAINTENANCE_COORDINATOR_ROLES,
    input: z.object({}),
    output: out<Ret<typeof svc.opsLocationOptions>>(),
  }),
  create: op({
    id: "maintenance.create",
    method: "POST",
    path: "/v1/maintenance/orders",
    summary: "Report a maintenance problem, optionally with a photo",
    tag: "Maintenance",
    multipart: true,
    input: z.object({
      category: z.string().max(100),
      description: z.string().max(5000),
      priority: priority.default("MEDIUM"),
      roomId: cuid().optional(),
      buildingId: cuid().optional(),
      locationNote: text(500),
      preferredContact: text(200),
      photo: fileInput.optional(),
    }),
    output: out<Ret<typeof svc.createWorkOrder>>(),
  }),
  assign: op({
    id: "maintenance.assign",
    method: "POST",
    path: "/v1/maintenance/orders/:id/assign",
    summary: "Assign a ticket to an engineer or a vendor",
    tag: "Maintenance",
    access: MAINTENANCE_COORDINATOR_ROLES,
    input: z.object({ id: cuid(), assigneeId: cuid().optional(), vendorId: cuid().optional(), note: text(2000) }),
    output: out<Ret<typeof svc.assignWorkOrder>>(),
  }),
  changeStatus: op({
    id: "maintenance.changeStatus",
    method: "POST",
    path: "/v1/maintenance/orders/:id/status",
    summary: "Move a ticket to another status (allowed moves depend on the caller's relationship to it)",
    tag: "Maintenance",
    input: z.object({ id: cuid(), status, note: text(2000) }),
    output: out<Ret<typeof svc.changeStatus>>(),
  }),
  triage: op({
    id: "maintenance.triage",
    method: "POST",
    path: "/v1/maintenance/orders/:id/triage",
    summary: "Set category and priority and mark a ticket triaged",
    tag: "Maintenance",
    access: MAINTENANCE_COORDINATOR_ROLES,
    input: z.object({ id: cuid(), category: text(100), priority: priority.optional() }),
    output: out<Ret<typeof svc.triageWorkOrder>>(),
  }),
  addNote: op({
    id: "maintenance.addNote",
    method: "POST",
    path: "/v1/maintenance/orders/:id/notes",
    summary: "Add a comment, optionally internal and optionally with a photo",
    tag: "Maintenance",
    multipart: true,
    input: z.object({ id: cuid(), note: z.string().max(5000), internal: z.union([z.boolean(), z.stringbool()]).default(false), photo: fileInput.optional() }),
    output: out<Ret<typeof svc.addNote>>(),
  }),
};

export const files = {
  attachment: fileOp({
    id: "files.attachment",
    method: "GET",
    path: "/v1/files/attachments/:id",
    summary: "An uploaded photo, if the caller may see the record it belongs to",
    tag: "Files",
    input: z.object({ id: cuid() }),
  }),
};

