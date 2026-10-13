import "server-only";
import "./audit-context";
import { redirect } from "next/navigation";
import type { Role } from "@prisma/client";
import { getCurrentUser } from "@/lib/auth/session";
import { accessTo, can, canAccess, canAccessAny, type Access, type Principal, type ScopeContext } from "@sam/core/lib/permissions/engine";
import type { ActorLike } from "@sam/core/lib/permissions/actor";

export type CurrentUser = NonNullable<Awaited<ReturnType<typeof getCurrentUser>>>;

export function hasRole(user: Pick<CurrentUser, "roleAssignments">, ...roles: Role[]): boolean {
  return user.roleAssignments.some((assignment) => roles.includes(assignment.role));
}

/** The user as the permission engine sees them: role assignments plus live capability grants. */
export function principalOf(user: CurrentUser): Principal {
  return { id: user.id, vendorId: user.vendorId, roleAssignments: user.roleAssignments, grants: user.grants };
}

/** The user as a service-layer actor (roles, assignments, grants), for modules that check capabilities themselves. */
export function actorOf(user: CurrentUser): ActorLike & { vendorId: string | null } {
  return { id: user.id, roles: user.roleAssignments.map((r) => r.role), vendorId: user.vendorId, roleAssignments: user.roleAssignments, grants: user.grants };
}

/** Full access to a capability at a place (create, edit, approve, ...). Use it to show or hide buttons. */
export function userCan(user: CurrentUser, key: string, ctx?: ScopeContext): boolean {
  return can(principalOf(user), key, ctx);
}

/** Any access (view-only, own records or limited included). Use it for navigation and read screens. */
export function userCanAccess(user: CurrentUser, key: string, ctx?: ScopeContext): boolean {
  return canAccess(principalOf(user), key, ctx);
}

export function userCanAccessAny(user: CurrentUser, keys: string[], ctx?: ScopeContext): boolean {
  return canAccessAny(principalOf(user), keys, ctx);
}

export function userAccess(user: CurrentUser, key: string, ctx?: ScopeContext): Access | null {
  return accessTo(principalOf(user), key, ctx);
}

/** Redirects to the login page when there is no active session, and to the password change page while a temporary password is in force. */
export async function requireUser(returnTo?: string): Promise<CurrentUser> {
  const user = await getCurrentUser();
  if (!user) {
    const target = returnTo ? `/login?next=${encodeURIComponent(returnTo)}` : "/login";
    redirect(target);
  }
  if (user.mustChangePassword) redirect("/change-password");
  return user;
}

/** Requires an active session holding at least one of the given roles (default access only; prefer requireCapability). */
export async function requireRole(roles: Role[], returnTo?: string): Promise<CurrentUser> {
  const user = await requireUser(returnTo);
  if (!hasRole(user, ...roles)) redirect("/forbidden");
  return user;
}

/**
 * Requires access to at least one of the capabilities (document principle 7: one permission engine).
 * `level: "full"` (default) needs create/edit rights; `"access"` also admits view-only and own-record access.
 */
export async function requireCapability(keys: string | string[], opts: { returnTo?: string; ctx?: ScopeContext; level?: "full" | "access" } = {}): Promise<CurrentUser> {
  const user = await requireUser(opts.returnTo);
  const list = Array.isArray(keys) ? keys : [keys];
  const ok = (opts.level ?? "full") === "full" ? list.some((k) => userCan(user, k, opts.ctx)) : userCanAccessAny(user, list, opts.ctx);
  if (!ok) redirect("/forbidden");
  return user;
}

/** Only allows redirects to relative paths within this app. */
export function safeReturnPath(value: string | null | undefined, fallback = "/"): string {
  if (!value || !value.startsWith("/") || value.startsWith("//") || value.startsWith("/login")) {
    return fallback;
  }
  return value;
}
