import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "../src/lib/db";
import { AdminError } from "../src/modules/admin/errors";
import { activeGrantsFor, createGrant, expireGrants, listActiveGrants, revokeGrant } from "../src/modules/admin/grants";
import { cancelChange, decideChange, submitChange } from "../src/modules/admin/change-requests";
import { createUser, generateTemporaryPassword, requestSelfServiceReset, resetPasswordTemporary, unlockUser } from "../src/modules/admin/users-service";
import { resolveSession, createSessionRecord } from "../src/lib/auth/session-store";
import { principalOf } from "../src/lib/permissions/actor";
import { can } from "../src/lib/permissions/engine";
import { verifyPassword } from "../src/lib/auth/password";

let orgId: string;
let sa1: string;
let sa2: string;
let officerId: string;
let siteId: string;
const stamp = Date.now().toString(36);

async function expectError<T>(p: Promise<T>, code: string) {
  try { await p; } catch (e) {
    expect(e).toBeInstanceOf(AdminError);
    expect((e as AdminError).code).toBe(code);
    return e as AdminError;
  }
  throw new Error(`expected AdminError ${code}`);
}

beforeAll(async () => {
  // Own organisation so Super Admin counts are not disturbed by other test files.
  const org = await prisma.organization.create({ data: { code: `GR-${stamp}`, name: "Grant Org" } });
  orgId = org.id;
  siteId = (await prisma.site.create({ data: { organizationId: orgId, code: "GS", name: "Grant Site", timezone: "UTC" } })).id;
  sa1 = (await prisma.user.create({ data: { organizationId: orgId, username: `gsa1-${stamp}`, name: "SA One", status: "ACTIVE", roleAssignments: { create: { role: "SYSTEM_ADMIN" } } } })).id;
  officerId = (await prisma.user.create({ data: { organizationId: orgId, username: `gof-${stamp}`, name: "Officer", status: "ACTIVE", roleAssignments: { create: { role: "ACCOMMODATION_OFFICER" } } } })).id;
});
afterAll(async () => { await prisma.$disconnect(); });

describe("grants", () => {
  it("requires a reason and a target, and refuses grants that cannot take effect", async () => {
    await expectError(createGrant({ organizationId: orgId, actorId: sa1, capabilitySet: "KEY_SUPERVISOR", userId: officerId, reason: " " }), "VALIDATION");
    await expectError(createGrant({ organizationId: orgId, actorId: sa1, capabilitySet: "KEY_SUPERVISOR", reason: "x" }), "VALIDATION");
    // Residents are Locked out of key supervision, so the grant would do nothing.
    const resident = await prisma.user.create({ data: { organizationId: orgId, username: `gres-${stamp}`, name: "Res", status: "ACTIVE", roleAssignments: { create: { role: "STAFF" } } } });
    await expectError(createGrant({ organizationId: orgId, actorId: sa1, capabilitySet: "KEY_SUPERVISOR", userId: resident.id, reason: "x" }), "VALIDATION");
    await expectError(createGrant({ organizationId: orgId, actorId: sa1, capabilitySet: "KEY_SUPERVISOR", userId: officerId, reason: "x", expiresAt: "2020-01-01" }), "VALIDATION");
  });

  it("switches a capability on for one user within scope, audits it, and ends it on revoke", async () => {
    const grant = await createGrant({ organizationId: orgId, actorId: sa1, capabilitySet: "KEY_SUPERVISOR", userId: officerId, siteId, reason: "Covers the key cabinet", expiresAt: "2099-01-01" });
    const { token } = await createSessionRecord(officerId);
    const session = await resolveSession(token);
    expect(session!.user.grants.map((g) => g.id)).toContain(grant.id);
    const principal = principalOf({ id: officerId, roles: ["ACCOMMODATION_OFFICER"], roleAssignments: session!.user.roleAssignments, grants: session!.user.grants });
    expect(can(principal, "keys.sensitive", { siteId })).toBe(true); // the grant is bound to the site
    expect(can(principal, "keys.sensitive", { siteId: "another-site" })).toBe(false); // and never widens beyond it
    expect((await listActiveGrants(orgId)).map((g) => g.id)).toContain(grant.id);
    expect(await prisma.auditEvent.count({ where: { action: "GRANT_CREATED", entityId: grant.id } })).toBe(1);
    expect(await prisma.notification.count({ where: { recipientId: officerId, event: "access.granted", channel: "IN_APP" } })).toBeGreaterThan(0);

    await expectError(revokeGrant({ grantId: grant.id, actorId: sa1, reason: "" }), "VALIDATION");
    await revokeGrant({ grantId: grant.id, actorId: sa1, reason: "Cabinet moved" });
    expect((await activeGrantsFor(officerId, ["ACCOMMODATION_OFFICER"])).map((g) => g.id)).not.toContain(grant.id);
    await expectError(revokeGrant({ grantId: grant.id, actorId: sa1, reason: "again" }), "INVALID_STATE");
  });

  it("applies role-addressed grants to every holder and expires them automatically", async () => {
    const grant = await createGrant({ organizationId: orgId, actorId: sa1, capability: "keys.audit", role: "ACCOMMODATION_OFFICER", reason: "Quarter-end audit" });
    expect((await activeGrantsFor(officerId, ["ACCOMMODATION_OFFICER"])).map((g) => g.id)).toContain(grant.id);
    await prisma.permissionGrant.update({ where: { id: grant.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
    expect((await activeGrantsFor(officerId, ["ACCOMMODATION_OFFICER"])).map((g) => g.id)).not.toContain(grant.id);
    expect(await expireGrants()).toBeGreaterThanOrEqual(1);
    expect(await prisma.auditEvent.count({ where: { action: "GRANT_EXPIRED", entityId: grant.id } })).toBe(1);
  });
});

describe("maker-checker", () => {
  it("applies at once when there is only one Super Admin, and says so in the audit log", async () => {
    const result = await submitChange({ organizationId: orgId, actorId: sa1, summary: "Give officer the Night keys set? (single admin)", payload: { op: "grant.create", grant: { capabilitySet: "FACILITY_MANAGER", userId: officerId, reason: "Single admin" } } });
    expect(result).toMatchObject({ status: "APPLIED", waived: true });
    expect(await prisma.auditEvent.count({ where: { action: "CHANGE_APPLIED_UNCHECKED" } })).toBeGreaterThan(0);
  });

  it("holds the change for a second Super Admin, who cannot be the maker", async () => {
    sa2 = (await prisma.user.create({ data: { organizationId: orgId, username: `gsa2-${stamp}`, name: "SA Two", status: "ACTIVE", roleAssignments: { create: { role: "SYSTEM_ADMIN" } } } })).id;
    const result = await submitChange({ organizationId: orgId, actorId: sa1, summary: "Make officer a security lead", payload: { op: "role.add", userId: officerId, grant: { role: "SECURITY" } } });
    expect(result.status).toBe("PENDING");
    const id = result.changeRequestId!;
    expect(await prisma.roleAssignment.count({ where: { userId: officerId, role: "SECURITY" } })).toBe(0);
    await expectError(decideChange({ changeRequestId: id, actorId: sa1, approve: true }), "GUARD");
    await expectError(decideChange({ changeRequestId: id, actorId: officerId, approve: true }), "FORBIDDEN");
    await expectError(decideChange({ changeRequestId: id, actorId: sa2, approve: false }), "VALIDATION"); // rejection needs a reason
    expect(await prisma.notification.count({ where: { recipientId: sa2, event: "change.pending" } })).toBe(1);

    await decideChange({ changeRequestId: id, actorId: sa2, approve: true });
    expect(await prisma.roleAssignment.count({ where: { userId: officerId, role: "SECURITY" } })).toBe(1);
    expect((await prisma.changeRequest.findUniqueOrThrow({ where: { id } })).appliedAt).not.toBeNull();
    await expectError(decideChange({ changeRequestId: id, actorId: sa2, approve: true }), "INVALID_STATE");
  });

  it("rejects and withdraws changes without applying them; the database also forbids self-approval", async () => {
    const r = await submitChange({ organizationId: orgId, actorId: sa1, summary: "Another role", payload: { op: "role.add", userId: officerId, grant: { role: "READONLY_MANAGER" } } });
    await decideChange({ changeRequestId: r.changeRequestId!, actorId: sa2, approve: false, note: "Not needed" });
    expect(await prisma.roleAssignment.count({ where: { userId: officerId, role: "READONLY_MANAGER" } })).toBe(0);
    const w = await submitChange({ organizationId: orgId, actorId: sa1, summary: "Withdrawn", payload: { op: "role.add", userId: officerId, grant: { role: "READONLY_MANAGER" } } });
    await expectError(cancelChange({ changeRequestId: w.changeRequestId!, actorId: sa2 }), "INVALID_STATE");
    await cancelChange({ changeRequestId: w.changeRequestId!, actorId: sa1 });
    await expect(prisma.changeRequest.update({ where: { id: w.changeRequestId! }, data: { decidedById: sa1 } })).rejects.toThrow();
  });
});

describe("accounts", () => {
  it("creates a user with a temporary password that must be changed, without needing an email", async () => {
    const { user, temporaryPassword, invitePath } = await createUser({ actorId: sa1, organizationId: orgId, name: "Phone User", username: `+97150${stamp}`.replace(/[^a-z0-9+._@-]/g, ""), roles: [{ role: "STAFF" }], mode: "temp_password" });
    expect(invitePath).toBeNull();
    expect(user.email).toBeNull();
    expect(user.status).toBe("ACTIVE");
    expect(user.mustChangePassword).toBe(true);
    expect(await verifyPassword(temporaryPassword!, user.passwordHash!)).toBe(true);
    expect(temporaryPassword).toHaveLength(13);
    expect(generateTemporaryPassword()).not.toBe(generateTemporaryPassword());
  });

  it("rejects duplicate and malformed usernames", async () => {
    const name = `dup-${stamp}`;
    await createUser({ actorId: sa1, organizationId: orgId, name: "A", username: name, roles: [{ role: "STAFF" }], mode: "temp_password" });
    await expectError(createUser({ actorId: sa1, organizationId: orgId, name: "B", username: name.toUpperCase(), roles: [{ role: "STAFF" }], mode: "temp_password" }), "VALIDATION");
    await expectError(createUser({ actorId: sa1, organizationId: orgId, name: "C", username: "x", roles: [{ role: "STAFF" }], mode: "temp_password" }), "VALIDATION");
  });

  it("super admin reset ends sessions and forces a change; unlock clears the lockout", async () => {
    const u = await prisma.user.create({ data: { organizationId: orgId, username: `rst-${stamp}`, name: "Reset", status: "ACTIVE", passwordHash: "x", lockedUntil: new Date(Date.now() + 600000), failedLoginAttempts: 3 } });
    const { token } = await createSessionRecord(u.id);
    const { temporaryPassword } = await resetPasswordTemporary({ actorId: sa1, userId: u.id });
    expect(await resolveSession(token)).toBeNull();
    const after = await prisma.user.findUniqueOrThrow({ where: { id: u.id } });
    expect(after.mustChangePassword).toBe(true);
    expect(after.lockedUntil).toBeNull();
    expect(await verifyPassword(temporaryPassword, after.passwordHash!)).toBe(true);
    await prisma.user.update({ where: { id: u.id }, data: { lockedUntil: new Date(Date.now() + 600000), failedLoginAttempts: 5 } });
    await unlockUser({ actorId: sa1, userId: u.id });
    expect((await prisma.user.findUniqueOrThrow({ where: { id: u.id } })).lockedUntil).toBeNull();
  });

  it("self-service reset sends a link to the registered email and gives nothing away for unknown accounts", async () => {
    const u = await prisma.user.create({ data: { organizationId: orgId, username: `self-${stamp}`, email: `self-${stamp}@example.com`, name: "Self", status: "ACTIVE", passwordHash: "x" } });
    await requestSelfServiceReset(`SELF-${stamp}`);
    const row = await prisma.user.findUniqueOrThrow({ where: { id: u.id } });
    expect(row.tokenPurpose).toBe("RESET");
    expect(await prisma.notification.count({ where: { recipientId: u.id, event: "user.password_reset", channel: "EMAIL" } })).toBe(1);
    await requestSelfServiceReset(`SELF-${stamp}`); // throttled: no second link
    expect(await prisma.notification.count({ where: { recipientId: u.id, event: "user.password_reset" } })).toBe(1);
    await expect(requestSelfServiceReset("no-such-user")).resolves.toBeUndefined();
    const noChannel = await prisma.user.create({ data: { organizationId: orgId, username: `nochan-${stamp}`, name: "No channel", status: "ACTIVE", passwordHash: "x" } });
    await requestSelfServiceReset(noChannel.username);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: noChannel.id } })).tokenHash).toBeNull();
  });
});
