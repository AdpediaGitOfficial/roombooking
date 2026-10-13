// Digital forms and multi-level approval workflow (SRS 5.4, 6.4, 8.2).
import type { DecisionAction, Prisma, PrismaClient, Role } from "@prisma/client";
import { prisma } from "@/lib/db";
import { recordAudit } from "@/lib/audit";
import { enqueueNotification } from "@/lib/notifications";
import { isoDate, todayInTimezone } from "@/modules/accommodation/occupancy";
import { RequestError } from "./errors";
import { REQUEST_ADMIN_ROLES } from "./access";
import { TYPE_RULES, parseSchema, toFormStrings, validateSubmission, visibleFields, type FormData, type FormField, type FormSchema } from "./forms";

type Tx = Prisma.TransactionClient;
type Db = Tx | PrismaClient;

export type Actor = { id: string; roles: Role[] };

export const requestInclude = {
  requestType: true,
  workflowVersion: { include: { steps: { orderBy: { order: "asc" } } } },
  requester: { select: { id: true, name: true, email: true, staffProfile: { select: { id: true, employeeId: true, firstName: true, lastName: true, department: true } } } },
  decisions: { include: { approver: { select: { id: true, name: true } }, step: true }, orderBy: { createdAt: "asc" } },
  submissions: { orderBy: { version: "asc" } },
  allocations: { include: { bed: true } },
} satisfies Prisma.RequestInclude;

export type RequestRecord = Prisma.RequestGetPayload<{ include: typeof requestInclude }>;

// ---------------------------------------------------------------------------
// Request types and form options
// ---------------------------------------------------------------------------

export async function listRequestTypes(organizationId: string, db: Db = prisma) {
  const types = await db.requestType.findMany({
    where: { organizationId, status: "ACTIVE" },
    include: { versions: { where: { isCurrent: true }, include: { steps: { orderBy: { order: "asc" } } } } },
    orderBy: { name: "asc" },
  });
  return types.filter((t) => t.versions.length > 0).map((t) => ({ ...t, current: t.versions[0] }));
}

export async function getCurrentWorkflow(organizationId: string, typeCode: string, db: Db = prisma) {
  const type = await db.requestType.findUnique({ where: { organizationId_code: { organizationId, code: typeCode } } });
  if (!type || type.status !== "ACTIVE") return null;
  const version = await db.workflowVersion.findFirst({ where: { requestTypeId: type.id, isCurrent: true }, include: { steps: { orderBy: { order: "asc" } } } });
  if (!version) return null;
  return { type, version, schema: parseSchema(version.formSchema) };
}

/** Resolves optionsSource fields (e.g. active buildings) for rendering and validation. */
export async function resolveFieldOptions(schema: FormSchema, db: Db = prisma): Promise<Record<string, string[]>> {
  const out: Record<string, string[]> = {};
  const needsBuildings = schema.fields.filter((f) => f.optionsSource === "buildings");
  if (needsBuildings.length > 0) {
    const buildings = await db.building.findMany({ where: { status: "ACTIVE" }, include: { site: true }, orderBy: [{ site: { name: "asc" } }, { code: "asc" }] });
    const labels = buildings.map((b) => `${b.site.name} · ${b.name}`);
    for (const f of needsBuildings) out[f.name] = labels;
  }
  return out;
}

export function fieldsWithOptions(schema: FormSchema, resolved: Record<string, string[]>): FormField[] {
  return schema.fields.map((f) => (f.optionsSource ? { ...f, options: resolved[f.name] ?? [] } : f));
}

async function validateForType(typeCode: string, schema: FormSchema, raw: Record<string, string | undefined>, db: Db) {
  const resolved = await resolveFieldOptions(schema, db);
  const { data, errors } = validateSubmission(schema, raw, resolved);
  const today = todayInTimezone("UTC");
  const extra = TYPE_RULES[typeCode]?.(data, today) ?? {};
  const all = { ...extra, ...errors };
  if (Object.keys(all).length > 0) throw new RequestError("VALIDATION", "Please correct the highlighted fields.", all);
  return data;
}

// ---------------------------------------------------------------------------
// Submit / resubmit / withdraw (SS-04, SS-06)
// ---------------------------------------------------------------------------

export type SubmitInput = { requesterId: string; organizationId: string; typeCode: string; raw: Record<string, string | undefined>; idempotencyKey: string };

export async function submitRequest(input: SubmitInput) {
  if (!input.idempotencyKey) throw new RequestError("VALIDATION", "Missing submission token. Reload the form and try again.");
  const existing = await prisma.request.findUnique({ where: { idempotencyKey: input.idempotencyKey } });
  if (existing) return { request: existing, duplicate: true };

  const workflow = await getCurrentWorkflow(input.organizationId, input.typeCode);
  if (!workflow) throw new RequestError("NOT_FOUND", "This request type is not available.");
  const data = await validateForType(input.typeCode, workflow.schema, input.raw, prisma);

  const steps = workflow.version.steps;
  const request = await prisma.$transaction(async (tx) => {
    try {
      const created = await tx.request.create({
        data: {
          requestTypeId: workflow.type.id,
          workflowVersionId: workflow.version.id,
          requesterId: input.requesterId,
          idempotencyKey: input.idempotencyKey,
          data: data as Prisma.InputJsonObject,
          status: steps.length > 0 ? "PENDING_APPROVAL" : "APPROVED",
          currentStepOrder: steps.length > 0 ? steps[0].order : null,
          submissionVersion: 1,
          decidedAt: steps.length > 0 ? null : new Date(),
          submissions: { create: { version: 1, data: data as Prisma.InputJsonObject } },
        },
      });
      await recordAudit({ actorId: input.requesterId, action: "REQUEST_SUBMITTED", entityType: "Request", entityId: created.id, after: { type: workflow.type.code, data: data as Prisma.InputJsonObject } }, tx);
      if (steps.length === 0) return fulfilTx(tx, created.id, input.requesterId);
      return created;
    } catch (error) {
      // Two submissions with the same token raced: hand back the one that won.
      if ((error as { code?: string }).code === "P2002") {
        const winner = await tx.request.findUnique({ where: { idempotencyKey: input.idempotencyKey } });
        if (winner) return winner;
      }
      throw error;
    }
  });
  return { request, duplicate: false };
}

export async function resubmitRequest(input: { requestId: string; requesterId: string; raw: Record<string, string | undefined> }) {
  const request = await prisma.request.findUnique({ where: { id: input.requestId }, include: { requestType: true, workflowVersion: { include: { steps: { orderBy: { order: "asc" } } } } } });
  if (!request) throw new RequestError("NOT_FOUND", "Request not found.");
  if (request.requesterId !== input.requesterId) throw new RequestError("FORBIDDEN", "You can only edit your own requests.");
  if (request.status !== "CHANGES_REQUESTED") throw new RequestError("INVALID_STATE", "Only requests returned for changes can be resubmitted.");

  const schema = parseSchema(request.workflowVersion.formSchema);
  const data = await validateForType(request.requestType.code, schema, input.raw, prisma);
  const version = request.submissionVersion + 1;
  const firstStep = request.workflowVersion.steps[0];

  return prisma.$transaction(async (tx) => {
    const updated = await tx.request.update({
      where: { id: request.id },
      data: {
        data: data as Prisma.InputJsonObject,
        status: "PENDING_APPROVAL",
        currentStepOrder: firstStep?.order ?? null,
        submissionVersion: version,
        submissions: { create: { version, data: data as Prisma.InputJsonObject } },
      },
    });
    await recordAudit({ actorId: input.requesterId, action: "REQUEST_RESUBMITTED", entityType: "Request", entityId: request.id, after: { version, data: data as Prisma.InputJsonObject } }, tx);
    return updated;
  });
}

export async function withdrawRequest(input: { requestId: string; requesterId: string; reason?: string | null }) {
  return prisma.$transaction(async (tx) => {
    const request = await tx.request.findUnique({ where: { id: input.requestId } });
    if (!request) throw new RequestError("NOT_FOUND", "Request not found.");
    if (request.requesterId !== input.requesterId) throw new RequestError("FORBIDDEN", "You can only withdraw your own requests.");
    if (request.status !== "PENDING_APPROVAL" && request.status !== "CHANGES_REQUESTED") {
      throw new RequestError("INVALID_STATE", "This request can no longer be withdrawn.");
    }
    const updated = await tx.request.update({ where: { id: request.id }, data: { status: "CANCELLED", currentStepOrder: null, decidedAt: new Date() } });
    await recordAudit({ actorId: input.requesterId, action: "REQUEST_WITHDRAWN", entityType: "Request", entityId: request.id, before: { status: request.status }, after: { status: "CANCELLED", reason: input.reason ?? null } }, tx);
    return updated;
  });
}

// ---------------------------------------------------------------------------
// Decisions (WF-03, WF-04, 6.4)
// ---------------------------------------------------------------------------

export function currentStep(request: { currentStepOrder: number | null; workflowVersion: { steps: Array<{ order: number; name: string; approverRole: Role; requireComment: boolean; id: string }> } }) {
  if (request.currentStepOrder === null) return null;
  return request.workflowVersion.steps.find((s) => s.order === request.currentStepOrder) ?? null;
}

/** Whether the actor may decide the request at its current step. */
export function canDecide(request: Pick<RequestRecord, "status" | "requesterId" | "currentStepOrder" | "workflowVersion">, actor: Actor): { ok: true } | { ok: false; reason: string } {
  if (request.status !== "PENDING_APPROVAL") return { ok: false, reason: "This request is not awaiting approval." };
  const step = currentStep(request);
  if (!step) return { ok: false, reason: "No approval step is pending." };
  if (request.requesterId === actor.id) return { ok: false, reason: "You cannot approve your own request." };
  if (!actor.roles.includes(step.approverRole)) return { ok: false, reason: `This step needs a ${step.approverRole.toLowerCase().replace(/_/g, " ")}.` };
  return { ok: true };
}

export type DecideInput = { requestId: string; actor: Actor; action: DecisionAction; comment?: string | null };

export async function decideRequest(input: DecideInput) {
  const comment = input.comment?.trim() || null;
  return prisma.$transaction(async (tx) => {
    const request = await tx.request.findUnique({ where: { id: input.requestId }, include: requestInclude });
    if (!request) throw new RequestError("NOT_FOUND", "Request not found.");
    const permission = canDecide(request, input.actor);
    if (!permission.ok) {
      if (request.requesterId === input.actor.id && request.status === "PENDING_APPROVAL") throw new RequestError("SELF_APPROVAL", permission.reason);
      throw new RequestError(request.status === "PENDING_APPROVAL" ? "FORBIDDEN" : "INVALID_STATE", permission.reason);
    }
    const step = currentStep(request)!;
    if ((step.requireComment || input.action !== "APPROVE") && !comment) {
      throw new RequestError("COMMENT_REQUIRED", input.action === "APPROVE" ? "This step requires a comment." : "Give the requester a reason.");
    }

    const steps = request.workflowVersion.steps;
    const nextStep = input.action === "APPROVE" ? steps.find((s) => s.order > step.order) ?? null : null;
    const nextStatus = input.action === "APPROVE" ? (nextStep ? "PENDING_APPROVAL" : "APPROVED") : input.action === "REJECT" ? "REJECTED" : "CHANGES_REQUESTED";

    // Guard against two approvers deciding the same step at once.
    const moved = await tx.request.updateMany({
      where: { id: request.id, status: "PENDING_APPROVAL", currentStepOrder: step.order },
      data: { status: nextStatus, currentStepOrder: nextStep?.order ?? null, decidedAt: nextStep ? null : new Date() },
    });
    if (moved.count !== 1) throw new RequestError("CONFLICT", "Another approver has just decided this step. Refresh to see the result.");

    await tx.approvalDecision.create({
      data: { requestId: request.id, stepId: step.id, approverId: input.actor.id, action: input.action, comment, submissionVersion: request.submissionVersion },
    });
    await recordAudit(
      { actorId: input.actor.id, action: "REQUEST_DECIDED", entityType: "Request", entityId: request.id, before: { status: request.status, step: step.order }, after: { action: input.action, status: nextStatus, nextStep: nextStep?.order ?? null, comment } },
      tx,
    );

    const event = nextStatus === "APPROVED" ? "request.approved" : nextStatus === "REJECTED" ? "request.rejected" : nextStatus === "CHANGES_REQUESTED" ? "request.changes_requested" : null;
    if (event) {
      await enqueueNotification(tx, {
        recipientId: request.requesterId,
        event,
        idempotencyKey: `${event}:${request.id}:${request.submissionVersion}`,
        payload: { requestId: request.id, type: request.requestType.name, comment },
      });
    }

    if (nextStatus === "APPROVED") return fulfilTx(tx, request.id, input.actor.id);
    return tx.request.findUniqueOrThrow({ where: { id: request.id } });
  });
}

// ---------------------------------------------------------------------------
// Fulfilment (WF-08): the business action runs once, inside the approval
// transaction, guarded by the APPROVED -> FULFILLED transition.
// ---------------------------------------------------------------------------

async function fulfilTx(tx: Tx, requestId: string, actorId: string) {
  const request = await tx.request.findUniqueOrThrow({ where: { id: requestId }, include: { requestType: true, requester: { include: { staffProfile: true } } } });
  if (request.status !== "APPROVED") return request;
  const data = (request.data ?? {}) as FormData;
  let note: string | null = null;
  let complete = true;

  switch (request.requestType.code) {
    case "ROOM_CHANGE":
      // Completed by the officer's transfer, which references this request.
      complete = false;
      note = "Approved. The accommodation office will complete the move.";
      break;
    case "EXIT_CLEARANCE": {
      const staff = request.requester.staffProfile;
      const lastDay = typeof data.lastWorkingDay === "string" ? data.lastWorkingDay : null;
      const current = staff ? await tx.allocation.findFirst({ where: { staffId: staff.id, status: { in: ["CONFIRMED", "CHECKED_IN"] } }, orderBy: { startDate: "desc" } }) : null;
      if (current && lastDay && lastDay > isoDate(current.startDate) && (!current.endDate || isoDate(current.endDate) > lastDay)) {
        await tx.allocation.update({ where: { id: current.id }, data: { endDate: new Date(`${lastDay}T00:00:00.000Z`), requestId: request.id } });
        await recordAudit({ actorId, action: "ALLOCATION_END_DATE_SET", entityType: "Allocation", entityId: current.id, after: { endDate: lastDay, requestId: request.id } }, tx);
        note = `Stay end date set to ${lastDay}. Check out and key return are due by then.`;
      } else {
        note = current ? "Approved; the current allocation already ends on or before the last working day." : "Approved; no active accommodation allocation to close.";
      }
      break;
    }
    default:
      note = "Approved.";
  }

  const updated = await tx.request.update({
    where: { id: request.id },
    data: complete ? { status: "FULFILLED", fulfilledAt: new Date(), fulfilmentNote: note } : { fulfilmentNote: note },
  });
  if (complete) {
    await recordAudit({ actorId, action: "REQUEST_FULFILLED", entityType: "Request", entityId: request.id, after: { note } }, tx);
  }
  return updated;
}

/**
 * Called by the allocation transfer when it carries a request reference:
 * closes an APPROVED room-change request exactly once.
 */
export async function fulfilRoomChangeTx(tx: Tx, input: { requestId: string; staffId: string; allocationId: string; actorId: string }) {
  const request = await tx.request.findUnique({ where: { id: input.requestId }, include: { requestType: true, requester: { include: { staffProfile: { select: { id: true } } } } } });
  if (!request) throw new RequestError("NOT_FOUND", "Room change request not found.");
  if (request.requestType.code !== "ROOM_CHANGE") throw new RequestError("INVALID_STATE", "That request is not a room change.");
  if (request.requester.staffProfile?.id !== input.staffId) throw new RequestError("FORBIDDEN", "That request belongs to a different resident.");
  const moved = await tx.request.updateMany({
    where: { id: request.id, status: "APPROVED" },
    data: { status: "FULFILLED", fulfilledAt: new Date(), fulfilmentNote: "Move completed by the accommodation office." },
  });
  if (moved.count !== 1) throw new RequestError("INVALID_STATE", `Room change request is ${request.status.toLowerCase().replace("_", " ")}; it must be approved and not yet fulfilled.`);
  await tx.allocation.update({ where: { id: input.allocationId }, data: { requestId: request.id } });
  await recordAudit({ actorId: input.actorId, action: "REQUEST_FULFILLED", entityType: "Request", entityId: request.id, after: { allocationId: input.allocationId } }, tx);
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

export type RequestAccess = "requester" | "admin" | "approver" | null;

export function requestAccessFor(request: Pick<RequestRecord, "requesterId" | "workflowVersion">, actor: Actor): RequestAccess {
  if (request.requesterId === actor.id) return "requester";
  if (actor.roles.some((r) => REQUEST_ADMIN_ROLES.includes(r))) return "admin";
  if (request.workflowVersion.steps.some((s) => actor.roles.includes(s.approverRole))) return "approver";
  return null;
}

export async function getRequest(id: string) {
  return prisma.request.findUnique({ where: { id }, include: requestInclude });
}

export async function listMyRequests(requesterId: string) {
  return prisma.request.findMany({
    where: { requesterId },
    include: { requestType: true, workflowVersion: { include: { steps: { orderBy: { order: "asc" } } } } },
    orderBy: { createdAt: "desc" },
  });
}

/** Requests waiting on a step whose role the actor holds, excluding their own. */
export async function listInbox(actor: Actor) {
  const requests = await prisma.request.findMany({
    where: { status: "PENDING_APPROVAL", requesterId: { not: actor.id } },
    include: requestInclude,
    orderBy: { createdAt: "asc" },
  });
  return requests.filter((r) => {
    const step = currentStep(r);
    return step !== null && actor.roles.includes(step.approverRole);
  });
}

export type RequestListFilter = "pending" | "approved" | "closed" | "all";

export async function listAllRequests(filter: RequestListFilter) {
  const where: Prisma.RequestWhereInput =
    filter === "pending"
      ? { status: { in: ["PENDING_APPROVAL", "CHANGES_REQUESTED"] } }
      : filter === "approved"
        ? { status: "APPROVED" }
        : filter === "closed"
          ? { status: { in: ["FULFILLED", "REJECTED", "CANCELLED", "CLOSED", "EXPIRED"] } }
          : {};
  return prisma.request.findMany({ where, include: requestInclude, orderBy: { createdAt: "desc" }, take: 200 });
}

export function summarizeRequest(request: { data: Prisma.JsonValue; workflowVersion: { formSchema: Prisma.JsonValue } }) {
  const schema = parseSchema(request.workflowVersion.formSchema);
  const data = toFormStrings((request.data ?? {}) as FormData);
  return visibleFields(schema.fields, data).map((f) => ({ label: f.label, value: f.type === "checkbox" ? (data[f.name] === "on" ? "Yes" : "No") : data[f.name] || "—" }));
}

export function describeStatus(request: { status: string; currentStepOrder: number | null; workflowVersion: { steps: Array<{ order: number; name: string }> } }): string {
  switch (request.status) {
    case "PENDING_APPROVAL": {
      const step = request.workflowVersion.steps.find((s) => s.order === request.currentStepOrder);
      return step ? `Awaiting: ${step.name}` : "Awaiting approval";
    }
    case "CHANGES_REQUESTED": return "Returned for changes";
    case "APPROVED": return "Approved, being actioned";
    case "FULFILLED": return "Completed";
    case "REJECTED": return "Rejected";
    case "CANCELLED": return "Withdrawn";
    default: return request.status.toLowerCase().replace(/_/g, " ");
  }
}
