// Pure delegation rules and record shapes. No database access, so the web app
// and the API can both import this file.
import type { DelegationStatus, Prisma, Role } from "@prisma/client";
import { APPROVER_ROLES } from "./builder-rules";

export type DelegatedRole = { role: Role; delegatorId: string; delegatorName: string; delegationId: string };

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
