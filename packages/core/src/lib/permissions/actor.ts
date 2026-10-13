// Bridges service-layer actors ({ id, roles }) to the permission engine.
import type { Role } from "@prisma/client";
import { accessTo, can, canAccess, type AssignmentLite, type GrantLite, type Principal, type ScopeContext } from "./engine";

/** The minimum a service needs to know about who is acting. Web code passes the assignments and grants too. */
export type ActorLike = {
  id: string;
  roles: Role[];
  vendorId?: string | null;
  roleAssignments?: AssignmentLite[];
  grants?: GrantLite[];
};

/** An actor with only role names is treated as holding each role across every site. */
export function principalOf(actor: ActorLike): Principal {
  return {
    id: actor.id,
    vendorId: actor.vendorId,
    roleAssignments: actor.roleAssignments ?? actor.roles.map((role) => ({ role })),
    grants: actor.grants ?? [],
  };
}

export function actorCan(actor: ActorLike, key: string, ctx: ScopeContext = {}): boolean {
  return can(principalOf(actor), key, ctx);
}

export function actorCanAccess(actor: ActorLike, key: string, ctx: ScopeContext = {}): boolean {
  return canAccess(principalOf(actor), key, ctx);
}

export function actorAccess(actor: ActorLike, key: string, ctx: ScopeContext = {}) {
  return accessTo(principalOf(actor), key, ctx);
}

/** Access at one of the given levels (for example view-only managers as well as full-access admins). */
export function actorCanAccessLevel(actor: ActorLike, key: string, ctx: ScopeContext, levels: Array<"full" | "view" | "own" | "limited">): boolean {
  const level = accessTo(principalOf(actor), key, ctx)?.level;
  return !!level && levels.includes(level);
}
