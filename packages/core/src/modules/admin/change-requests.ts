// Maker-checker (document 6.3): role and permission changes, workflow publishing
// and bulk changes raised by a Super Admin take effect only when a second
// Super Admin approves. With fewer than two active Super Admins the change is
// applied at once and the audit trail records that the check was waived.
import type { ChangeRequestKind, Prisma, Role } from "@prisma/client";
import { prisma } from "../../lib/db";
import { recordAudit } from "../../lib/audit";
import { enqueueNotification } from "../../lib/notifications";
import { AdminError } from "./errors";
import { addRole, removeRole, type RoleGrant } from "./users-service";
import { createGrant, revokeGrant } from "./grants";
import { publishVersion } from "../requests/builder";

type Db = Prisma.TransactionClient;

export type ChangePayload =
  | { op: "role.add"; userId: string; grant: RoleGrant }
  | { op: "role.remove"; userId: string; assignmentId: string }
  | { op: "grant.create"; grant: Omit<Parameters<typeof createGrant>[0], "actorId" | "organizationId"> & { expiresAt?: string | null } }
  | { op: "grant.revoke"; grantId: string; reason: string }
  | { op: "workflow.publish"; versionId: string; changeNote: string }
  | { op: "bulk"; description: string; ids: string[]; action: string };

/** Hooks other modules register to apply the changes they own (avoids import cycles). */
type Applier = (payload: ChangePayload, ctx: { organizationId: string; requestedById: string; approvedById: string | null }) => Promise<void>;
const appliers = new Map<string, Applier>();
export function registerChangeApplier(op: ChangePayload["op"], fn: Applier) {
  appliers.set(op, fn);
}

const KIND_OF: Record<ChangePayload["op"], ChangeRequestKind> = {
  "role.add": "ROLE_CHANGE",
  "role.remove": "ROLE_CHANGE",
  "grant.create": "GRANT",
  "grant.revoke": "GRANT",
  "workflow.publish": "WORKFLOW_PUBLISH",
  bulk: "BULK_CHANGE",
};

export async function activeSuperAdmins(organizationId: string, db: Db | typeof prisma = prisma) {
  return db.user.findMany({ where: { organizationId, status: "ACTIVE", roleAssignments: { some: { role: "SYSTEM_ADMIN" } } }, select: { id: true, name: true } });
}

async function applyPayload(payload: ChangePayload, ctx: { organizationId: string; requestedById: string; approvedById: string | null }) {
  switch (payload.op) {
    case "role.add":
      await addRole({ actorId: ctx.requestedById, userId: payload.userId, grant: payload.grant });
      return;
    case "role.remove":
      await removeRole({ actorId: ctx.requestedById, userId: payload.userId, assignmentId: payload.assignmentId });
      return;
    case "grant.create":
      await createGrant({ ...payload.grant, organizationId: ctx.organizationId, actorId: ctx.requestedById });
      return;
    case "grant.revoke":
      await revokeGrant({ grantId: payload.grantId, actorId: ctx.approvedById ?? ctx.requestedById, reason: payload.reason });
      return;
    case "workflow.publish":
      // The maker raised it; the publisher of record is whoever made it effective.
      await publishVersion({ versionId: payload.versionId, actorId: ctx.requestedById });
      return;
    default: {
      const fn = appliers.get(payload.op);
      if (!fn) throw new AdminError("INVALID_STATE", `No handler is registered for ${payload.op}.`);
      await fn(payload, ctx);
    }
  }
}

export type SubmitResult = { status: "APPLIED" | "PENDING"; changeRequestId: string | null; waived: boolean };

/**
 * Raise a high-risk change. Applied immediately when only one Super Admin exists
 * (single-admin organisations, document 6.4); otherwise queued for a second Super Admin.
 */
export async function submitChange(input: { organizationId: string; actorId: string; summary: string; payload: ChangePayload }): Promise<SubmitResult> {
  const admins = await activeSuperAdmins(input.organizationId);
  const others = admins.filter((a) => a.id !== input.actorId);
  if (others.length === 0) {
    await applyPayload(input.payload, { organizationId: input.organizationId, requestedById: input.actorId, approvedById: null });
    await recordAudit({ actorId: input.actorId, action: "CHANGE_APPLIED_UNCHECKED", entityType: "ChangeRequest", entityId: input.payload.op, after: { summary: input.summary, reason: "Only one active Super Admin; second approval waived" } });
    return { status: "APPLIED", changeRequestId: null, waived: true };
  }
  const request = await prisma.$transaction(async (tx) => {
    const created = await tx.changeRequest.create({ data: { organizationId: input.organizationId, kind: KIND_OF[input.payload.op], summary: input.summary, payload: input.payload as unknown as Prisma.InputJsonValue, requestedById: input.actorId } });
    await recordAudit({ actorId: input.actorId, action: "CHANGE_REQUESTED", entityType: "ChangeRequest", entityId: created.id, after: { kind: created.kind, summary: input.summary } }, tx);
    for (const a of others) {
      await enqueueNotification(tx, { recipientId: a.id, event: "change.pending", idempotencyKey: `change.pending:${created.id}:${a.id}`, payload: { changeRequestId: created.id, summary: input.summary } });
    }
    return created;
  });
  return { status: "PENDING", changeRequestId: request.id, waived: false };
}

export async function decideChange(input: { changeRequestId: string; actorId: string; approve: boolean; note?: string | null }) {
  const note = input.note?.trim() || null;
  if (!input.approve && !note) throw new AdminError("VALIDATION", "Give a reason for rejecting.", { note: "Required." });
  const request = await prisma.changeRequest.findUnique({ where: { id: input.changeRequestId } });
  if (!request) throw new AdminError("NOT_FOUND", "Change request not found.");
  if (request.status !== "PENDING") throw new AdminError("INVALID_STATE", "That change has already been decided.");
  if (request.requestedById === input.actorId) throw new AdminError("GUARD", "You cannot approve a change you raised: a second Super Admin must decide it.");
  const approver = await prisma.user.findUnique({ where: { id: input.actorId }, include: { roleAssignments: true } });
  if (!approver || approver.status !== "ACTIVE" || !approver.roleAssignments.some((r) => r.role === "SYSTEM_ADMIN")) throw new AdminError("FORBIDDEN", "Only a Super Admin can decide this change.");

  // Claim the decision first so two approvers cannot both apply it.
  const claimed = await prisma.changeRequest.updateMany({ where: { id: request.id, status: "PENDING" }, data: { status: input.approve ? "APPROVED" : "REJECTED", decidedById: input.actorId, decidedAt: new Date(), decisionNote: note } });
  if (claimed.count !== 1) throw new AdminError("INVALID_STATE", "That change has already been decided.");

  if (input.approve) {
    try {
      await applyPayload(request.payload as unknown as ChangePayload, { organizationId: request.organizationId, requestedById: request.requestedById, approvedById: input.actorId });
      await prisma.changeRequest.update({ where: { id: request.id }, data: { appliedAt: new Date() } });
    } catch (error) {
      // The change could not be applied (for example the user was removed meanwhile): reopen it for the record.
      await prisma.changeRequest.update({ where: { id: request.id }, data: { status: "REJECTED", decisionNote: `Approved but could not be applied: ${(error as Error).message}` } });
      await recordAudit({ actorId: input.actorId, action: "CHANGE_FAILED", entityType: "ChangeRequest", entityId: request.id, after: { error: (error as Error).message } });
      throw error;
    }
  }
  await prisma.$transaction(async (tx) => {
    await recordAudit({ actorId: input.actorId, action: input.approve ? "CHANGE_APPROVED" : "CHANGE_REJECTED", entityType: "ChangeRequest", entityId: request.id, after: { summary: request.summary, note, requestedById: request.requestedById } }, tx);
    await enqueueNotification(tx, { recipientId: request.requestedById, event: "change.decided", idempotencyKey: `change.decided:${request.id}`, payload: { changeRequestId: request.id, summary: request.summary, approved: input.approve, note } });
  });
  return prisma.changeRequest.findUniqueOrThrow({ where: { id: request.id } });
}

export async function cancelChange(input: { changeRequestId: string; actorId: string }) {
  const done = await prisma.changeRequest.updateMany({ where: { id: input.changeRequestId, requestedById: input.actorId, status: "PENDING" }, data: { status: "CANCELLED" } });
  if (done.count !== 1) throw new AdminError("INVALID_STATE", "Only the person who raised a pending change can withdraw it.");
  await recordAudit({ actorId: input.actorId, action: "CHANGE_CANCELLED", entityType: "ChangeRequest", entityId: input.changeRequestId });
}

export const changeInclude = {
  requestedBy: { select: { id: true, name: true } },
  decidedBy: { select: { id: true, name: true } },
} satisfies Prisma.ChangeRequestInclude;

export async function listChanges(organizationId: string, status?: "PENDING" | "ALL") {
  return prisma.changeRequest.findMany({ where: { organizationId, ...(status === "PENDING" ? { status: "PENDING" } : {}) }, include: changeInclude, orderBy: { createdAt: "desc" }, take: 100 });
}

export async function pendingChangeCount(organizationId: string, forUserId: string) {
  return prisma.changeRequest.count({ where: { organizationId, status: "PENDING", requestedById: { not: forUserId } } });
}

export type { Role };
