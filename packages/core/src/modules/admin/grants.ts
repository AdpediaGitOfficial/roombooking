// Capability grants (document section 3): switched on by the Super Admin per role
// or per user, bound to the holder's scope, with a mandatory reason, an optional
// expiry, and an audit trail for every grant and revoke.
import type { Prisma, Role } from "@prisma/client";
import { prisma } from "../../lib/db";
import { recordAudit } from "../../lib/audit";
import { enqueueNotification } from "../../lib/notifications";
import { CAPABILITY_BY_KEY } from "../../lib/permissions/matrix";
import { CAPABILITY_SET_BY_ID } from "../../lib/permissions/sets";
import { ALL_ROLES } from "../../lib/permissions/roles";
import { AdminError } from "./errors";

type Db = Prisma.TransactionClient;

export type CreateGrantInput = {
  organizationId: string;
  actorId: string;
  /** Exactly one of capabilitySet / capability. */
  capabilitySet?: string | null;
  capability?: string | null;
  /** Exactly one of role / userId. */
  role?: Role | null;
  userId?: string | null;
  siteId?: string | null;
  buildingId?: string | null;
  reason: string;
  expiresAt?: string | Date | null;
};

/** Capabilities a grant names, resolved from the set or the single key. */
export function grantCapabilities(g: { capabilitySet?: string | null; capability?: string | null }): string[] {
  if (g.capabilitySet) return CAPABILITY_SET_BY_ID.get(g.capabilitySet)?.capabilities ?? [];
  return g.capability ? [g.capability] : [];
}

function parseExpiry(value: string | Date | null | undefined): Date | null {
  if (!value) return null;
  const d = value instanceof Date ? value : new Date(/^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T23:59:59.000Z` : value);
  if (Number.isNaN(d.getTime())) throw new AdminError("VALIDATION", "Enter a valid expiry date.", { expiresAt: "Invalid date." });
  if (d <= new Date()) throw new AdminError("VALIDATION", "The expiry date must be in the future.", { expiresAt: "Must be in the future." });
  return d;
}

/** Validates the grant can have an effect (some target role holds a Grantable cell for it) and returns the roles it reaches. */
async function validateGrant(tx: Db, input: CreateGrantInput): Promise<Role[]> {
  const errors: Record<string, string> = {};
  if (!!input.capabilitySet === !!input.capability) errors.capability = "Choose a capability set or a single capability.";
  if (!!input.role === !!input.userId) errors.target = "Choose a role or a user.";
  if (!input.reason?.trim()) errors.reason = "Give a reason.";
  if (input.capabilitySet && !CAPABILITY_SET_BY_ID.has(input.capabilitySet)) errors.capability = "Unknown capability set.";
  if (input.capability && !CAPABILITY_BY_KEY.has(input.capability)) errors.capability = "Unknown capability.";
  if (input.role && !ALL_ROLES.includes(input.role)) errors.target = "Unknown role.";
  if (Object.keys(errors).length) throw new AdminError("VALIDATION", "Please correct the highlighted fields.", errors);

  let roles: Role[];
  if (input.userId) {
    const user = await tx.user.findUnique({ where: { id: input.userId }, include: { roleAssignments: true } });
    if (!user || user.organizationId !== input.organizationId) throw new AdminError("VALIDATION", "Unknown user.", { target: "Unknown user." });
    roles = [...new Set(user.roleAssignments.map((r) => r.role))];
    if (roles.length === 0) throw new AdminError("VALIDATION", "That user holds no role, so a grant would have no effect.", { target: "No role." });
  } else {
    roles = [input.role as Role];
  }
  const caps = grantCapabilities(input);
  const effective = caps.some((key) => {
    const cap = CAPABILITY_BY_KEY.get(key);
    return cap && roles.some((r) => cap.cells[r]?.state === "G");
  });
  if (!effective) {
    throw new AdminError("VALIDATION", "That capability is Locked for the chosen role (or already on by default), so the grant would have no effect.", { capability: "Not grantable to this role." });
  }
  if (input.buildingId) {
    const b = await tx.building.findUnique({ where: { id: input.buildingId } });
    if (!b) throw new AdminError("VALIDATION", "Unknown building scope.", { scope: "Unknown building." });
    input.siteId = b.siteId;
  } else if (input.siteId) {
    if (!(await tx.site.findUnique({ where: { id: input.siteId } }))) throw new AdminError("VALIDATION", "Unknown site scope.", { scope: "Unknown site." });
  }
  return roles;
}

export async function createGrant(input: CreateGrantInput, tx?: Db) {
  const run = async (db: Db) => {
    await validateGrant(db, input);
    const expiresAt = parseExpiry(input.expiresAt);
    const grant = await db.permissionGrant.create({
      data: {
        organizationId: input.organizationId,
        capabilitySet: input.capabilitySet || null,
        capability: input.capability || null,
        role: input.role || null,
        userId: input.userId || null,
        siteId: input.siteId || null,
        buildingId: input.buildingId || null,
        reason: input.reason.trim(),
        grantedById: input.actorId,
        expiresAt,
      },
    });
    await recordAudit({
      actorId: input.actorId,
      action: "GRANT_CREATED",
      entityType: "PermissionGrant",
      entityId: grant.id,
      after: { capabilitySet: grant.capabilitySet, capability: grant.capability, role: grant.role, userId: grant.userId, siteId: grant.siteId, buildingId: grant.buildingId, expiresAt: expiresAt?.toISOString() ?? null, reason: grant.reason },
    }, db);
    // The user sees a note of the extra access they hold (and is told when it is granted).
    const holders = grant.userId ? [grant.userId] : (await db.user.findMany({ where: { status: "ACTIVE", roleAssignments: { some: { role: grant.role as Role } } }, select: { id: true } })).map((u) => u.id);
    for (const id of holders) {
      await enqueueNotification(db, { recipientId: id, channel: "IN_APP", event: "access.granted", idempotencyKey: `grant:${grant.id}:${id}`, payload: { grantId: grant.id, label: grant.capabilitySet ? (CAPABILITY_SET_BY_ID.get(grant.capabilitySet)?.label ?? grant.capabilitySet) : (CAPABILITY_BY_KEY.get(grant.capability ?? "")?.label ?? grant.capability), expiresAt: expiresAt?.toISOString() ?? null } });
    }
    return grant;
  };
  return tx ? run(tx) : prisma.$transaction(run);
}

export async function revokeGrant(input: { grantId: string; actorId: string; reason: string }, tx?: Db) {
  const run = async (db: Db) => {
    if (!input.reason?.trim()) throw new AdminError("VALIDATION", "Give a reason.", { reason: "Required." });
    const grant = await db.permissionGrant.findUnique({ where: { id: input.grantId } });
    if (!grant) throw new AdminError("NOT_FOUND", "Grant not found.");
    if (grant.revokedAt) throw new AdminError("INVALID_STATE", "That grant has already ended.");
    const updated = await db.permissionGrant.update({ where: { id: grant.id }, data: { revokedAt: new Date(), revokedById: input.actorId, revokeReason: input.reason.trim() } });
    await recordAudit({ actorId: input.actorId, action: "GRANT_REVOKED", entityType: "PermissionGrant", entityId: grant.id, before: { capabilitySet: grant.capabilitySet, capability: grant.capability, role: grant.role, userId: grant.userId }, after: { reason: input.reason.trim() } }, db);
    return updated;
  };
  return tx ? run(tx) : prisma.$transaction(run);
}

export { activeGrantsFor } from "../../lib/permissions/loader";

/** Ends grants whose expiry has passed and records it (access ends automatically; this keeps the audit trail honest). */
export async function expireGrants(now = new Date()): Promise<number> {
  const due = await prisma.permissionGrant.findMany({ where: { revokedAt: null, expiresAt: { lte: now } } });
  for (const g of due) {
    await prisma.$transaction(async (tx) => {
      const done = await tx.permissionGrant.updateMany({ where: { id: g.id, revokedAt: null }, data: { revokedAt: now, revokeReason: "Expired" } });
      if (done.count === 1) await recordAudit({ action: "GRANT_EXPIRED", entityType: "PermissionGrant", entityId: g.id, after: { expiresAt: g.expiresAt?.toISOString() ?? null }, source: "system" }, tx);
    });
  }
  return due.length;
}

export const grantInclude = {
  user: { select: { id: true, name: true, username: true } },
  grantedBy: { select: { id: true, name: true } },
  revokedBy: { select: { id: true, name: true } },
} satisfies Prisma.PermissionGrantInclude;

/** Access review: every grant live now, newest first (Super Admin dashboard). */
export async function listActiveGrants(organizationId: string) {
  const now = new Date();
  return prisma.permissionGrant.findMany({
    where: { organizationId, revokedAt: null, OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] },
    include: grantInclude,
    orderBy: { createdAt: "desc" },
  });
}

/** Grant history for one user (what was granted, by whom, why). */
export async function listGrantsForUser(userId: string) {
  return prisma.permissionGrant.findMany({ where: { userId }, include: grantInclude, orderBy: { createdAt: "desc" } });
}

export async function listGrantHistory(organizationId: string, take = 100) {
  return prisma.permissionGrant.findMany({ where: { organizationId }, include: grantInclude, orderBy: { createdAt: "desc" }, take });
}
