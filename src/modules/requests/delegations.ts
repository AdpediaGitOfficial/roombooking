// Approval delegation and absence cover (WF-06). A delegator hands their
// approver roles to a delegate for a date range; the delegate then sees and
// decides the delegator's steps, and every such decision records both names.
import type { DelegationStatus, Prisma, Role } from "@prisma/client";
import { prisma } from "@/lib/db";
import { recordAudit } from "@/lib/audit";
import { enqueueNotification } from "@/lib/notifications";
import { APPROVER_ROLES } from "./builder";
import { RequestError } from "./errors";

export type DelegatedRole = { role: Role; delegatorId: string; delegatorName: string; delegationId: string };

const ISO = /^\d{4}-\d{2}-\d{2}$/;
const day = (iso: string) => new Date(`${iso}T00:00:00.000Z`);
export const isoDay = (d: Date) => d.toISOString().slice(0, 10);

export const delegationInclude = {
  delegator: { select: { id: true, name: true, email: true, roleAssignments: { select: { role: true } } } },
  delegate: { select: { id: true, name: true, email: true } },
  createdBy: { select: { id: true, name: true } },
  revokedBy: { select: { id: true, name: true } },
  _count: { select: { decisions: true } },
} satisfies Prisma.ApprovalDelegationInclude;
export type DelegationRecord = Prisma.ApprovalDelegationGetPayload<{ include: typeof delegationInclude }>;

/** The approver roles a person can hand over: the route-eligible roles they hold. */
export function delegatableRoles(roles: Role[]): Role[] {
  return roles.filter((r) => APPROVER_ROLES.includes(r));
}

/** Roles a delegation covers right now: its listed roles, or every delegatable role the delegator currently holds. */
export function coveredRoles(d: { roles: Role[]; delegator: { roleAssignments: Array<{ role: Role }> } }): Role[] {
  const held = delegatableRoles(d.delegator.roleAssignments.map((r) => r.role));
  return d.roles.length ? d.roles.filter((r) => held.includes(r)) : held;
}

export function isLive(d: { status: DelegationStatus; startsAt: Date; endsAt: Date }, now: Date = new Date()): boolean {
  const today = isoDay(now);
  return d.status === "ACTIVE" && isoDay(d.startsAt) <= today && today <= isoDay(d.endsAt);
}

export type CreateInput = { delegatorId: string; delegateId: string; roles?: Role[]; startsAt: string; endsAt: string; reason?: string | null; actor: { id: string; isAdmin: boolean }; now?: Date };

export async function createDelegation(input: CreateInput) {
  const now = input.now ?? new Date();
  const errors: Record<string, string> = {};
  if (!input.delegateId) errors.delegateId = "Choose who will cover.";
  if (input.delegateId && input.delegateId === input.delegatorId) errors.delegateId = "You cannot delegate to yourself.";
  if (!ISO.test(input.startsAt)) errors.startsAt = "Enter a start date.";
  if (!ISO.test(input.endsAt)) errors.endsAt = "Enter an end date.";
  if (ISO.test(input.startsAt) && ISO.test(input.endsAt) && input.endsAt < input.startsAt) errors.endsAt = "The end date must be on or after the start date.";
  if (ISO.test(input.endsAt) && input.endsAt < isoDay(now)) errors.endsAt = "The end date has already passed.";
  if (Object.keys(errors).length) throw new RequestError("VALIDATION", "Please correct the highlighted fields.", errors);
  if (input.actor.id !== input.delegatorId && !input.actor.isAdmin) throw new RequestError("FORBIDDEN", "You can only delegate your own approvals.");

  const [delegator, delegate] = await Promise.all([
    prisma.user.findUnique({ where: { id: input.delegatorId }, include: { roleAssignments: true } }),
    prisma.user.findUnique({ where: { id: input.delegateId } }),
  ]);
  if (!delegator) throw new RequestError("NOT_FOUND", "Delegator not found.");
  if (!delegate || delegate.status !== "ACTIVE" || delegate.organizationId !== delegator.organizationId) throw new RequestError("VALIDATION", "The delegate must be an active user of this organisation.", { delegateId: "Not available." });
  const held = delegatableRoles(delegator.roleAssignments.map((r) => r.role));
  if (held.length === 0) throw new RequestError("VALIDATION", "This person holds no approver role to delegate.", { delegatorId: "No approver role." });
  const roles = (input.roles ?? []).filter((r) => held.includes(r));
  if (input.roles?.length && roles.length === 0) throw new RequestError("VALIDATION", "Choose at least one role the delegator holds.", { roles: "Not held." });

  const overlap = await prisma.approvalDelegation.findFirst({ where: { delegatorId: input.delegatorId, delegateId: input.delegateId, status: "ACTIVE", startsAt: { lte: day(input.endsAt) }, endsAt: { gte: day(input.startsAt) } } });
  if (overlap) throw new RequestError("CONFLICT", `An active delegation to this person already covers ${isoDay(overlap.startsAt)} to ${isoDay(overlap.endsAt)}.`);

  return prisma.$transaction(async (tx) => {
    const d = await tx.approvalDelegation.create({ data: { delegatorId: input.delegatorId, delegateId: input.delegateId, roles, startsAt: day(input.startsAt), endsAt: day(input.endsAt), reason: input.reason?.trim() || null, createdById: input.actor.id } });
    await recordAudit({ actorId: input.actor.id, action: "DELEGATION_CREATED", entityType: "ApprovalDelegation", entityId: d.id, after: { delegatorId: d.delegatorId, delegateId: d.delegateId, roles, startsAt: input.startsAt, endsAt: input.endsAt, reason: d.reason } }, tx);
    await enqueueNotification(tx, { recipientId: input.delegateId, event: "delegation.started", idempotencyKey: `delegation.started:${d.id}`, payload: { delegationId: d.id, delegator: delegator.name, startsAt: input.startsAt, endsAt: input.endsAt, roles: (roles.length ? roles : held).map((r) => r.toLowerCase().replaceAll("_", " ")).join(", ") } });
    if (input.actor.id !== input.delegatorId) await enqueueNotification(tx, { recipientId: input.delegatorId, event: "delegation.arranged", idempotencyKey: `delegation.arranged:${d.id}`, payload: { delegationId: d.id, delegate: delegate.name, startsAt: input.startsAt, endsAt: input.endsAt } });
    return d;
  });
}

export async function revokeDelegation(input: { delegationId: string; actor: { id: string; isAdmin: boolean }; reason?: string | null }) {
  return prisma.$transaction(async (tx) => {
    const d = await tx.approvalDelegation.findUnique({ where: { id: input.delegationId }, include: { delegator: { select: { name: true } } } });
    if (!d) throw new RequestError("NOT_FOUND", "Delegation not found.");
    if (d.status !== "ACTIVE") throw new RequestError("INVALID_STATE", "This delegation has already ended.");
    if (input.actor.id !== d.delegatorId && input.actor.id !== d.delegateId && !input.actor.isAdmin) throw new RequestError("FORBIDDEN", "Only the delegator, the delegate or an administrator can end a delegation.");
    const now = new Date();
    const updated = await tx.approvalDelegation.update({ where: { id: d.id }, data: { status: "REVOKED", revokedAt: now, revokedById: input.actor.id } });
    await recordAudit({ actorId: input.actor.id, action: "DELEGATION_REVOKED", entityType: "ApprovalDelegation", entityId: d.id, before: { status: "ACTIVE" }, after: { status: "REVOKED", reason: input.reason ?? null } }, tx);
    if (input.actor.id !== d.delegateId) await enqueueNotification(tx, { recipientId: d.delegateId, event: "delegation.ended", idempotencyKey: `delegation.ended:${d.id}`, payload: { delegationId: d.id, delegator: d.delegator.name } });
    return updated;
  });
}

/** Roles the person holds through live delegations right now, with who they are covering for. */
export async function delegatedRolesFor(delegateId: string, now: Date = new Date()): Promise<DelegatedRole[]> {
  const today = day(isoDay(now));
  const rows = await prisma.approvalDelegation.findMany({ where: { delegateId, status: "ACTIVE", startsAt: { lte: today }, endsAt: { gte: today }, delegator: { status: "ACTIVE" } }, include: { delegator: { select: { id: true, name: true, roleAssignments: { select: { role: true } } } } } });
  const out: DelegatedRole[] = [];
  for (const d of rows) for (const role of coveredRoles(d)) out.push({ role, delegatorId: d.delegatorId, delegatorName: d.delegator.name, delegationId: d.id });
  return out;
}

export async function listDelegations(user: { id: string; isAdmin: boolean }, now: Date = new Date()) {
  const where: Prisma.ApprovalDelegationWhereInput = user.isAdmin ? {} : { OR: [{ delegatorId: user.id }, { delegateId: user.id }] };
  const rows = await prisma.approvalDelegation.findMany({ where, include: delegationInclude, orderBy: [{ status: "asc" }, { startsAt: "desc" }], take: 200 });
  return rows.map((d) => ({ ...d, live: isLive(d, now), covered: coveredRoles(d), upcoming: d.status === "ACTIVE" && isoDay(d.startsAt) > isoDay(now), expired: d.status === "ACTIVE" && isoDay(d.endsAt) < isoDay(now) }));
}

/** People who may receive a delegation: active users of the organisation other than the delegator. */
export async function delegateOptions(organizationId: string, excludeId: string) {
  const users = await prisma.user.findMany({ where: { organizationId, status: "ACTIVE", id: { not: excludeId }, roleAssignments: { some: { role: { not: "STAFF" } } } }, select: { id: true, name: true, email: true }, orderBy: { name: "asc" } });
  return users.map((u) => ({ id: u.id, label: `${u.name} (${u.email})` }));
}

/** People an administrator may create cover for: anyone holding a delegatable role. */
export async function delegatorOptions(organizationId: string) {
  const users = await prisma.user.findMany({ where: { organizationId, status: "ACTIVE", roleAssignments: { some: { role: { in: APPROVER_ROLES } } } }, select: { id: true, name: true, email: true, roleAssignments: { select: { role: true } } }, orderBy: { name: "asc" } });
  return users.map((u) => ({ id: u.id, label: `${u.name} (${u.email})`, roles: delegatableRoles(u.roleAssignments.map((r) => r.role)) }));
}
