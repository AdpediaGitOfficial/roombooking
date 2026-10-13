// One permission engine for navigation, buttons, data queries, reports and
// exports (document section 3). A permission is Module x Action x Scope.
//
// For each role the user holds, the capability cell decides:
//   Default   always on within the assignment's scope
//   Grantable on only while an unrevoked, unexpired grant covers it
//   Locked    never available, whatever the grants
// Grants are bound to the holder's scope: a grant never widens scope.
import type { Role } from "@prisma/client";
import { CAPABILITY_BY_KEY, type Cell, type CellLevel } from "./matrix";
import { CAPABILITY_SET_BY_ID } from "./sets";

export type AssignmentLite = { role: Role; siteId?: string | null; buildingId?: string | null };
export type GrantLite = {
  capabilitySet?: string | null;
  capability?: string | null;
  role?: Role | null;
  userId?: string | null;
  siteId?: string | null;
  buildingId?: string | null;
  expiresAt?: Date | null;
  revokedAt?: Date | null;
};
export type Principal = {
  id: string;
  roleAssignments: AssignmentLite[];
  /** Active grants addressed to this user or to any role the user holds. */
  grants?: GrantLite[];
  vendorId?: string | null;
};

/** Where an action takes place; both ids when the building is known. */
export type ScopeContext = { siteId?: string | null; buildingId?: string | null };

export type Access = { level: CellLevel; tag?: string; via: "default" | "grant"; role: Role };

const RANK: Record<CellLevel, number> = { full: 4, view: 3, limited: 2, own: 1 };

/** True when the scope (assignment or grant) covers the place of the action. */
export function scopeCovers(scope: { siteId?: string | null; buildingId?: string | null }, ctx: ScopeContext): boolean {
  if (!scope.siteId && !scope.buildingId) return true;
  if (scope.buildingId) return !!ctx.buildingId && ctx.buildingId === scope.buildingId;
  // Site scope covers anything inside the site; a context with no site is a module-level check.
  if (!ctx.siteId && !ctx.buildingId) return true;
  return ctx.siteId === scope.siteId;
}

function grantActive(g: GrantLite, now: Date): boolean {
  return !g.revokedAt && (!g.expiresAt || g.expiresAt > now);
}

function grantCovers(g: GrantLite, key: string, role: Role, userId: string): boolean {
  const names = g.capability === key || (!!g.capabilitySet && CAPABILITY_SET_BY_ID.get(g.capabilitySet)?.capabilities.includes(key));
  if (!names) return false;
  if (g.userId) return g.userId === userId;
  return g.role === role;
}

/** Best access the principal has to a capability at a place, or null. */
export function accessTo(p: Principal, key: string, ctx: ScopeContext = {}, now = new Date()): Access | null {
  const cap = CAPABILITY_BY_KEY.get(key);
  if (!cap) return null;
  let best: Access | null = null;
  for (const a of p.roleAssignments) {
    const cell: Cell | undefined = cap.cells[a.role];
    if (!cell || cell.state === "L") continue;
    if (!scopeCovers(a, ctx)) continue;
    let via: Access["via"] = "default";
    if (cell.state === "G") {
      const covered = (p.grants ?? []).some((g) => grantActive(g, now) && grantCovers(g, key, a.role, p.id) && scopeCovers(g, ctx));
      if (!covered) continue;
      via = "grant";
    }
    if (!best || RANK[cell.level] > RANK[best.level]) best = { level: cell.level, tag: cell.tag, via, role: a.role };
  }
  return best;
}

/** Full access (create, edit, approve, ...) at a place. */
export function can(p: Principal, key: string, ctx: ScopeContext = {}): boolean {
  return accessTo(p, key, ctx)?.level === "full";
}

/** Any access at all, including view-only, own-records and limited. Drives navigation and read screens. */
export function canAccess(p: Principal, key: string, ctx: ScopeContext = {}): boolean {
  return accessTo(p, key, ctx) !== null;
}

/** At least read access: full or view-only. */
export function canView(p: Principal, key: string, ctx: ScopeContext = {}): boolean {
  const level = accessTo(p, key, ctx)?.level;
  return level === "full" || level === "view";
}

export function canAny(p: Principal, keys: string[], ctx: ScopeContext = {}): boolean {
  return keys.some((k) => can(p, k, ctx));
}

export function canAccessAny(p: Principal, keys: string[], ctx: ScopeContext = {}): boolean {
  return keys.some((k) => canAccess(p, k, ctx));
}

export type DataScope = { all: true } | { all: false; siteIds: string[]; buildingIds: string[] };

/**
 * The part of the estate the principal may see for a capability: every site, or the union of
 * their assignments' sites and buildings that actually confer access. Use it to filter queries
 * and reports (document principle 2).
 */
export function dataScope(p: Principal, key: string, now = new Date()): DataScope {
  const cap = CAPABILITY_BY_KEY.get(key);
  const siteIds = new Set<string>();
  const buildingIds = new Set<string>();
  if (!cap) return { all: false, siteIds: [], buildingIds: [] };
  for (const a of p.roleAssignments) {
    const cell = cap.cells[a.role];
    if (!cell || cell.state === "L") continue;
    // The assignment scope narrowed by the covering grant's scope, if the cell needs a grant.
    let scopes: { siteId?: string | null; buildingId?: string | null }[] = [a];
    if (cell.state === "G") {
      scopes = (p.grants ?? [])
        .filter((g) => grantActive(g, now) && grantCovers(g, key, a.role, p.id))
        .map((g) => intersect(a, g))
        .filter((s): s is { siteId?: string | null; buildingId?: string | null } => s !== null);
      if (scopes.length === 0) continue;
    }
    for (const s of scopes) {
      if (!s.siteId && !s.buildingId) return { all: true };
      if (s.buildingId) buildingIds.add(s.buildingId);
      else if (s.siteId) siteIds.add(s.siteId);
    }
  }
  return { all: false, siteIds: [...siteIds], buildingIds: [...buildingIds] };
}

function intersect(a: { siteId?: string | null; buildingId?: string | null }, b: { siteId?: string | null; buildingId?: string | null }) {
  if (!a.siteId && !a.buildingId) return b;
  if (!b.siteId && !b.buildingId) return a;
  if (a.buildingId && b.buildingId) return a.buildingId === b.buildingId ? a : null;
  if (a.buildingId) return !b.siteId || b.siteId === a.siteId ? a : null;
  if (b.buildingId) return !a.siteId || a.siteId === b.siteId ? b : null;
  return a.siteId === b.siteId ? a : null;
}

/** Prisma `where` fragment restricting rows to a data scope. `site`/`building` name the columns. */
export function scopeWhere(scope: DataScope, fields: { site?: string; building?: string }): Record<string, unknown> {
  if (scope.all) return {};
  const or: Record<string, unknown>[] = [];
  if (fields.site && scope.siteIds.length) or.push({ [fields.site]: { in: scope.siteIds } });
  if (fields.building && scope.buildingIds.length) or.push({ [fields.building]: { in: scope.buildingIds } });
  return or.length ? { OR: or } : { id: "__none__" };
}

/** Whether a place falls inside a data scope. */
export function inScope(scope: DataScope, ctx: ScopeContext): boolean {
  if (scope.all) return true;
  if (ctx.buildingId && scope.buildingIds.includes(ctx.buildingId)) return true;
  if (ctx.siteId && scope.siteIds.includes(ctx.siteId)) return true;
  return false;
}

export function hasRole(p: Pick<Principal, "roleAssignments">, ...roles: Role[]): boolean {
  return p.roleAssignments.some((a) => roles.includes(a.role));
}

/** Notes shown to a user about access they hold through a grant (document: "the user sees a note of extra access"). */
export function extraAccessNotes(p: Principal, now = new Date()): { label: string; expiresAt?: Date | null }[] {
  const out: { label: string; expiresAt?: Date | null }[] = [];
  for (const g of p.grants ?? []) {
    if (!grantActive(g, now)) continue;
    const label = g.capabilitySet ? (CAPABILITY_SET_BY_ID.get(g.capabilitySet)?.label ?? g.capabilitySet) : (CAPABILITY_BY_KEY.get(g.capability ?? "")?.label ?? g.capability ?? "");
    out.push({ label, expiresAt: g.expiresAt });
  }
  return out;
}
