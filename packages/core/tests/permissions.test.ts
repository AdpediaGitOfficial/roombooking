import { describe, expect, it } from "vitest";
import { CAPABILITIES, CAPABILITY_BY_KEY, parseCell, rolesGrantable, rolesWithDefault } from "../src/lib/permissions/matrix";
import { CAPABILITY_SETS } from "../src/lib/permissions/sets";
import { ALL_ROLES, MATRIX_ROLES } from "../src/lib/permissions/roles";
import { accessTo, can, canAccess, canView, dataScope, extraAccessNotes, inScope, scopeCovers, scopeWhere, type Principal } from "../src/lib/permissions/engine";

const P = (roles: Array<{ role: Principal["roleAssignments"][number]["role"]; siteId?: string; buildingId?: string }>, grants: Principal["grants"] = []): Principal => ({ id: "u1", roleAssignments: roles, grants });

describe("matrix", () => {
  it("parses cells", () => {
    expect(parseCell("D")).toEqual({ state: "D", level: "full", tag: undefined });
    expect(parseCell("G (key supervisor)")).toEqual({ state: "G", level: "full", tag: "key supervisor" });
    expect(parseCell("V (masked)")).toMatchObject({ state: "D", level: "view", tag: "masked" });
    expect(parseCell("O + own room status")).toMatchObject({ state: "D", level: "own" });
    expect(parseCell("- (readiness only)")).toMatchObject({ state: "L", tag: "readiness only" });
    expect(parseCell("Execute")).toMatchObject({ state: "D", level: "limited", tag: "Execute" });
    expect(parseCell("On behalf")).toMatchObject({ state: "D", level: "limited", tag: "On behalf" });
  });

  it("has a unique key per capability and a cell for every role", () => {
    expect(new Set(CAPABILITIES.map((c) => c.key)).size).toBe(CAPABILITIES.length);
    for (const c of CAPABILITIES) for (const r of ALL_ROLES) expect(c.cells[r], `${c.key}/${r}`).toBeDefined();
    expect(MATRIX_ROLES).toHaveLength(10);
    expect(ALL_ROLES).toHaveLength(11);
  });

  it("keeps the invariants from the document", () => {
    // Nobody can edit or delete audit records.
    expect(ALL_ROLES.every((r) => CAPABILITY_BY_KEY.get("audit.edit")!.cells[r].state === "L")).toBe(true);
    // Hard delete is Super Admin only and never grantable.
    expect(rolesWithDefault("setup.hard_delete")).toEqual(["SYSTEM_ADMIN"]);
    expect(rolesGrantable("setup.hard_delete")).toEqual([]);
    // Roles, grants and workflows are Super Admin only.
    expect(rolesWithDefault("setup.roles")).toEqual(["SYSTEM_ADMIN"]);
    expect(rolesWithDefault("setup.workflows")).toEqual(["SYSTEM_ADMIN"]);
    // Admin decides, Reception executes: officers cannot allocate or approve.
    expect(rolesWithDefault("accom.allocate")).toEqual(["SYSTEM_ADMIN", "ACCOMMODATION_ADMIN"]);
    expect(rolesWithDefault("accom.approve")).toEqual(["SYSTEM_ADMIN", "ACCOMMODATION_ADMIN"]);
    // Residents never approve, technicians never triage.
    expect(CAPABILITY_BY_KEY.get("maint.triage")!.cells.TECHNICIAN.state).toBe("L");
    expect(CAPABILITY_BY_KEY.get("accom.approve")!.cells.STAFF.state).toBe("L");
  });

  it("covers every grantable cell with at least one capability set or allows a direct grant", () => {
    const covered = new Set(CAPABILITY_SETS.flatMap((s) => s.capabilities));
    for (const set of CAPABILITY_SETS) for (const k of set.capabilities) expect(CAPABILITY_BY_KEY.has(k), `${set.id}:${k}`).toBe(true);
    // Sets exist for the document's eight named grants.
    for (const id of ["HR", "MAINTENANCE_COORDINATOR", "KEY_SUPERVISOR", "INVENTORY_SUPERVISOR", "FACILITY_MANAGER", "BUILDING_CREATION", "EMERGENCY_CHECKIN", "NIGHT_KEYS"]) expect(CAPABILITY_SETS.some((s) => s.id === id)).toBe(true);
    expect(covered.has("keys.sensitive")).toBe(true);
  });
});

describe("engine", () => {
  it("default cells allow within scope only", () => {
    const aa = P([{ role: "ACCOMMODATION_ADMIN", siteId: "s1" }]);
    expect(can(aa, "accom.allocate")).toBe(true); // module-level check
    expect(can(aa, "accom.allocate", { siteId: "s1" })).toBe(true);
    expect(can(aa, "accom.allocate", { siteId: "s2" })).toBe(false);
    const global = P([{ role: "SYSTEM_ADMIN" }]);
    expect(can(global, "accom.allocate", { siteId: "s2" })).toBe(true);
  });

  it("grantable cells need a live grant, bound to the holder's scope", () => {
    const officer = P([{ role: "ACCOMMODATION_OFFICER", siteId: "s1" }]);
    expect(can(officer, "keys.sensitive", { siteId: "s1" })).toBe(false);
    const withSet = P([{ role: "ACCOMMODATION_OFFICER", siteId: "s1" }], [{ userId: "u1", capabilitySet: "KEY_SUPERVISOR" }]);
    expect(can(withSet, "keys.sensitive", { siteId: "s1" })).toBe(true);
    expect(accessTo(withSet, "keys.sensitive", { siteId: "s1" })?.via).toBe("grant");
    // A grant never widens scope.
    expect(can(withSet, "keys.sensitive", { siteId: "s2" })).toBe(false);
    const narrowGrant = P([{ role: "ACCOMMODATION_OFFICER" }], [{ userId: "u1", capabilitySet: "KEY_SUPERVISOR", siteId: "s1" }]);
    expect(can(narrowGrant, "keys.sensitive", { siteId: "s1" })).toBe(true);
    expect(can(narrowGrant, "keys.sensitive", { siteId: "s2" })).toBe(false);
    // Role-addressed grants apply to every holder of that role; single capabilities work too.
    const byRole = P([{ role: "ACCOMMODATION_OFFICER" }], [{ role: "ACCOMMODATION_OFFICER", capability: "keys.audit" }]);
    expect(can(byRole, "keys.audit")).toBe(true);
    expect(can(byRole, "keys.sensitive")).toBe(false);
  });

  it("expired and revoked grants stop working; locked cells never open", () => {
    const expired = P([{ role: "ACCOMMODATION_OFFICER" }], [{ userId: "u1", capabilitySet: "KEY_SUPERVISOR", expiresAt: new Date(Date.now() - 1000) }]);
    expect(can(expired, "keys.sensitive")).toBe(false);
    const revoked = P([{ role: "ACCOMMODATION_OFFICER" }], [{ userId: "u1", capabilitySet: "KEY_SUPERVISOR", revokedAt: new Date() }]);
    expect(can(revoked, "keys.sensitive")).toBe(false);
    // A grant naming a capability that is Locked for the role does nothing.
    const locked = P([{ role: "STAFF" }], [{ userId: "u1", capability: "accom.allocate" }]);
    expect(can(locked, "accom.allocate")).toBe(false);
    // Grants addressed to another user are ignored.
    const other = P([{ role: "ACCOMMODATION_OFFICER" }], [{ userId: "someone-else", capabilitySet: "KEY_SUPERVISOR" }]);
    expect(can(other, "keys.sensitive")).toBe(false);
  });

  it("separates full access from view-only, own-records and limited", () => {
    const manager = P([{ role: "READONLY_MANAGER" }]);
    expect(canView(manager, "accom.view")).toBe(true);
    expect(can(manager, "accom.view")).toBe(false);
    const resident = P([{ role: "STAFF" }]);
    expect(accessTo(resident, "accom.view")?.level).toBe("own");
    expect(canView(resident, "accom.view")).toBe(false);
    expect(canAccess(resident, "accom.view")).toBe(true);
    const officer = P([{ role: "ACCOMMODATION_OFFICER" }]);
    expect(accessTo(officer, "accom.transfer")).toMatchObject({ level: "limited", tag: "Execute" });
    expect(can(officer, "accom.transfer")).toBe(false);
  });

  it("derives data scope and query filters", () => {
    const aa = P([{ role: "ACCOMMODATION_ADMIN", siteId: "s1" }, { role: "ACCOMMODATION_ADMIN", buildingId: "b9", siteId: "s2" }]);
    const scope = dataScope(aa, "accom.allocate");
    expect(scope).toEqual({ all: false, siteIds: ["s1"], buildingIds: ["b9"] });
    expect(scopeWhere(scope, { site: "siteId", building: "buildingId" })).toEqual({ OR: [{ siteId: { in: ["s1"] } }, { buildingId: { in: ["b9"] } }] });
    expect(inScope(scope, { siteId: "s1" })).toBe(true);
    expect(inScope(scope, { siteId: "s2", buildingId: "b9" })).toBe(true);
    expect(inScope(scope, { siteId: "s2" })).toBe(false);
    expect(dataScope(P([{ role: "SYSTEM_ADMIN" }]), "accom.allocate")).toEqual({ all: true });
    // No access at all: an impossible filter rather than everything.
    expect(scopeWhere(dataScope(P([{ role: "STAFF" }]), "accom.allocate"), { site: "siteId" })).toEqual({ id: "__none__" });
    // A grantable capability narrows to the grant's scope.
    const officer = P([{ role: "ACCOMMODATION_OFFICER", siteId: "s1" }], [{ userId: "u1", capabilitySet: "KEY_SUPERVISOR", siteId: "s1" }]);
    expect(dataScope(officer, "keys.sensitive")).toEqual({ all: false, siteIds: ["s1"], buildingIds: [] });
    expect(dataScope(P([{ role: "ACCOMMODATION_OFFICER", siteId: "s1" }]), "keys.sensitive")).toEqual({ all: false, siteIds: [], buildingIds: [] });
  });

  it("building scopes need the building in context", () => {
    expect(scopeCovers({ buildingId: "b1", siteId: "s1" }, { buildingId: "b1", siteId: "s1" })).toBe(true);
    expect(scopeCovers({ buildingId: "b1", siteId: "s1" }, { siteId: "s1" })).toBe(false);
    expect(scopeCovers({ siteId: "s1" }, { buildingId: "b1", siteId: "s1" })).toBe(true);
  });

  it("lists extra access for the user to see", () => {
    const p = P([{ role: "ACCOMMODATION_OFFICER" }], [{ userId: "u1", capabilitySet: "KEY_SUPERVISOR", expiresAt: new Date(Date.now() + 86400000) }, { userId: "u1", capabilitySet: "NIGHT_KEYS", revokedAt: new Date() }]);
    expect(extraAccessNotes(p).map((n) => n.label)).toEqual(["Key supervisor"]);
  });
});
