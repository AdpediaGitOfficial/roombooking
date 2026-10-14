import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "../src/lib/db";
import { verifyPassword } from "../src/lib/auth/password";
import { createSessionRecord, resolveSession } from "../src/lib/auth/session-store";
import { AdminError } from "../src/modules/admin/errors";
import { acceptToken, addRole, createUser, getUser, issueToken, listUsers, lookupToken, removeRole, setUserStatus, updateUser } from "../src/modules/admin/users-service";

let orgId: string;
let adminId: string;
let siteId: string;
let buildingId: string;
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
  const org = await prisma.organization.upsert({ where: { code: "ADM" }, update: {}, create: { code: "ADM", name: "Admin Test Org" } });
  orgId = org.id;
  const admin = await prisma.user.upsert({ where: { email: "adm-root@example.com" }, update: { status: "ACTIVE", passwordHash: "x" }, create: { organizationId: orgId, email: "adm-root@example.com", name: "Root Admin", status: "ACTIVE", passwordHash: "x" } });
  adminId = admin.id;
  if (!(await prisma.roleAssignment.findFirst({ where: { userId: adminId, role: "SYSTEM_ADMIN" } }))) await prisma.roleAssignment.create({ data: { userId: adminId, role: "SYSTEM_ADMIN" } });
  const site = await prisma.site.upsert({ where: { organizationId_code: { organizationId: orgId, code: "ADM-S" } }, update: {}, create: { organizationId: orgId, code: "ADM-S", name: "Admin Site" } });
  siteId = site.id;
  buildingId = (await prisma.building.upsert({ where: { siteId_code: { siteId, code: "ADM-B" } }, update: {}, create: { siteId, code: "ADM-B", name: "Admin Block" } })).id;
  // Only one active admin in this org: makes the last-admin guard testable.
  await prisma.user.updateMany({ where: { organizationId: orgId, id: { not: adminId }, roleAssignments: { some: { role: "SYSTEM_ADMIN" } } }, data: { status: "DEACTIVATED" } });
});

afterAll(async () => { await prisma.$disconnect(); });

describe("create and invite", () => {
  it("validates input and uniqueness", async () => {
    const e = await expectError(createUser({ actorId: adminId, organizationId: orgId, name: "", email: "bad", roles: [] }), "VALIDATION");
    expect(Object.keys(e.fieldErrors).sort()).toEqual(["email", "name", "roles"]);
    await expectError(createUser({ actorId: adminId, organizationId: orgId, name: "Dup", email: "adm-root@example.com", roles: [{ role: "STAFF" }] }), "VALIDATION");
    await expectError(createUser({ actorId: adminId, organizationId: orgId, name: "V", email: `v-${stamp}@example.com`, roles: [{ role: "VENDOR" }] }), "VALIDATION");
  });

  it("creates an invited user with scoped roles, a one-time invite that sets the password and activates", async () => {
    const email = `officer-${stamp}@example.com`;
    const { user, invitePath } = await createUser({ actorId: adminId, organizationId: orgId, name: "New Officer", email: email.toUpperCase(), roles: [{ role: "ACCOMMODATION_OFFICER", siteId }, { role: "STAFF" }] });
    expect(user.status).toBe("INVITED");
    expect(user.email).toBe(email);
    const token = invitePath.split("/").pop()!;
    expect(user.tokenHash).not.toBe(token);
    const full = (await getUser(user.id))!;
    expect(full.roleAssignments.map((r) => [r.role, r.siteId])).toEqual([["ACCOMMODATION_OFFICER", siteId], ["STAFF", null]]);
    expect(await prisma.notification.findFirst({ where: { recipientId: user.id, event: "user.invited", channel: "EMAIL" } })).not.toBeNull();

    expect((await lookupToken(token))?.id).toBe(user.id);
    await expectError(acceptToken({ token, password: "short" }), "VALIDATION");
    const activated = await acceptToken({ token, password: "Welcome-2026-x" });
    expect(activated.status).toBe("ACTIVE");
    expect(await verifyPassword("Welcome-2026-x", activated.passwordHash)).toBe(true);
    expect(activated.tokenHash).toBeNull();
    await expectError(acceptToken({ token, password: "Welcome-2026-y" }), "INVALID_STATE"); // used once
    expect(await prisma.auditEvent.findFirst({ where: { entityId: user.id, action: "USER_ACTIVATED" } })).not.toBeNull();
  });

  it("rejects expired tokens and refuses invites for active accounts", async () => {
    const { user, invitePath } = await createUser({ actorId: adminId, organizationId: orgId, name: "Late", email: `late-${stamp}@example.com`, roles: [{ role: "STAFF" }] });
    await prisma.user.update({ where: { id: user.id }, data: { tokenExpiresAt: new Date(Date.now() - 1000) } });
    expect(await lookupToken(invitePath.split("/").pop()!)).toBeNull();
    const reissued = await issueToken({ actorId: adminId, userId: user.id, purpose: "INVITE" });
    expect((await lookupToken(reissued.path.split("/").pop()!))?.id).toBe(user.id);
    await expectError(issueToken({ actorId: adminId, userId: user.id, purpose: "RESET" }), "INVALID_STATE");
  });
});

describe("roles", () => {
  it("adds and removes scoped roles, rejects duplicates, and protects the last administrator", async () => {
    const user = await prisma.user.findUniqueOrThrow({ where: { email: `officer-${stamp}@example.com` } });
    const grant = await addRole({ actorId: adminId, userId: user.id, grant: { role: "APPROVER", buildingId } });
    expect(grant.siteId).toBe(siteId); // building scope implies its site
    await expectError(addRole({ actorId: adminId, userId: user.id, grant: { role: "APPROVER", buildingId } }), "INVALID_STATE");
    await expectError(addRole({ actorId: adminId, userId: user.id, grant: { role: "VENDOR" } }), "VALIDATION");
    await removeRole({ actorId: adminId, userId: user.id, assignmentId: grant.id });
    expect((await getUser(user.id))!.roleAssignments.some((r) => r.role === "APPROVER")).toBe(false);

    const adminRole = await prisma.roleAssignment.findFirstOrThrow({ where: { userId: adminId, role: "SYSTEM_ADMIN" } });
    await expectError(removeRole({ actorId: adminId, userId: adminId, assignmentId: adminRole.id }), "GUARD");
    const other = await prisma.user.create({ data: { organizationId: orgId, email: `admin2-${stamp}@example.com`, name: "Second Admin", status: "ACTIVE", passwordHash: "x", roleAssignments: { create: { role: "SYSTEM_ADMIN" } } } });
    const otherRole = await prisma.roleAssignment.findFirstOrThrow({ where: { userId: other.id } });
    // With two admins, the second can lose the role; then the first is the last and protected again.
    await removeRole({ actorId: adminId, userId: other.id, assignmentId: otherRole.id });
    await expectError(setUserStatus({ actorId: other.id, userId: adminId, status: "SUSPENDED", reason: "test" }), "GUARD");
    expect(await prisma.auditEvent.count({ where: { entityId: user.id, action: { in: ["ROLE_GRANTED", "ROLE_REVOKED"] } } })).toBeGreaterThanOrEqual(2);
  });
});

describe("status and sessions", () => {
  it("suspending and deactivating end sessions; reactivation requires a password; self-change is refused", async () => {
    const user = await prisma.user.findUniqueOrThrow({ where: { email: `officer-${stamp}@example.com` } });
    const { token } = await createSessionRecord(user.id);
    expect(await resolveSession(token)).not.toBeNull();
    await expectError(setUserStatus({ actorId: adminId, userId: user.id, status: "SUSPENDED" }), "VALIDATION"); // reason required
    await setUserStatus({ actorId: adminId, userId: user.id, status: "SUSPENDED", reason: "Investigation" });
    expect(await resolveSession(token)).toBeNull();
    await expectError(setUserStatus({ actorId: adminId, userId: user.id, status: "SUSPENDED", reason: "again" }), "INVALID_STATE");
    await setUserStatus({ actorId: adminId, userId: user.id, status: "ACTIVE" });
    expect((await getUser(user.id))!.status).toBe("ACTIVE");
    await expectError(setUserStatus({ actorId: adminId, userId: adminId, status: "DEACTIVATED", reason: "x" }), "GUARD");

    const invited = await prisma.user.findUniqueOrThrow({ where: { email: `late-${stamp}@example.com` } });
    await expectError(setUserStatus({ actorId: adminId, userId: invited.id, status: "ACTIVE" }), "INVALID_STATE");

    await setUserStatus({ actorId: adminId, userId: user.id, status: "DEACTIVATED", reason: "Left the company" });
    await expectError(issueToken({ actorId: adminId, userId: user.id, purpose: "RESET" }), "INVALID_STATE");
    const history = await prisma.auditEvent.findMany({ where: { entityId: user.id, action: "USER_STATUS_CHANGED" } });
    expect(history.length).toBeGreaterThanOrEqual(3);
  });

  it("a reset link sets a new password and ends existing sessions", async () => {
    const { user, invitePath } = await createUser({ actorId: adminId, organizationId: orgId, name: "Reset Me", email: `reset-${stamp}@example.com`, roles: [{ role: "STAFF" }] });
    await acceptToken({ token: invitePath.split("/").pop()!, password: "First-Pass-123" });
    const { token: session } = await createSessionRecord(user.id);
    const reset = await issueToken({ actorId: adminId, userId: user.id, purpose: "RESET" });
    expect(await resolveSession(session)).not.toBeNull(); // issuing does not log them out
    await acceptToken({ token: reset.path.split("/").pop()!, password: "Second-Pass-456" });
    expect(await resolveSession(session)).toBeNull(); // using it does
    const fresh = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(await verifyPassword("Second-Pass-456", fresh.passwordHash)).toBe(true);
  });
});

describe("update and list", () => {
  it("links staff records exclusively, keeps vendor users linked, and searches by name, email and employee id", async () => {
    const staff = await prisma.staffProfile.upsert({ where: { organizationId_employeeId: { organizationId: orgId, employeeId: "ADM-E1" } }, update: { userId: null }, create: { organizationId: orgId, employeeId: "ADM-E1", firstName: "Linked", lastName: "Person" } });
    const a = await createUser({ actorId: adminId, organizationId: orgId, name: "Link A", email: `linka-${stamp}@example.com`, roles: [{ role: "STAFF" }], staffProfileId: staff.id });
    await expectError(createUser({ actorId: adminId, organizationId: orgId, name: "Link B", email: `linkb-${stamp}@example.com`, roles: [{ role: "STAFF" }], staffProfileId: staff.id }), "VALIDATION");
    await updateUser({ actorId: adminId, userId: a.user.id, name: "Link A Renamed", email: a.user.email, staffProfileId: null });
    expect((await prisma.staffProfile.findUniqueOrThrow({ where: { id: staff.id } })).userId).toBeNull();
    const vendor = await prisma.vendor.create({ data: { organizationId: orgId, name: `Vendor ${stamp}` } });
    const v = await createUser({ actorId: adminId, organizationId: orgId, name: "Vendor User", email: `vendor-${stamp}@example.com`, roles: [{ role: "VENDOR" }], vendorId: vendor.id, accessExpiresAt: "2030-01-01" });
    expect(v.user.accessExpiresAt?.toISOString().slice(0, 10)).toBe("2030-01-01");
    await expectError(updateUser({ actorId: adminId, userId: v.user.id, name: "Vendor User", email: v.user.email, vendorId: null }), "VALIDATION");

    expect((await listUsers(orgId, { q: "renamed" })).rows.map((u) => u.id)).toContain(a.user.id);
    expect((await listUsers(orgId, { q: `vendor-${stamp}` })).rows.map((u) => u.id)).toContain(v.user.id);
    expect((await listUsers(orgId, { role: "VENDOR" })).rows.every((u) => u.roleAssignments.some((r) => r.role === "VENDOR"))).toBe(true);
    expect((await listUsers(orgId, { status: "INVITED" })).rows.every((u) => u.status === "INVITED")).toBe(true);

    // Pages are bounded and report the total.
    const first = await listUsers(orgId, {}, { page: 1, pageSize: 2 });
    expect(first.rows.length).toBeLessThanOrEqual(2);
    expect(first.total).toBeGreaterThanOrEqual(2);
    expect(first.pages).toBe(Math.ceil(first.total / 2));
    const second = await listUsers(orgId, {}, { page: 2, pageSize: 2 });
    expect(second.rows.map((u) => u.id).filter((id) => first.rows.some((r) => r.id === id))).toEqual([]);
  });
});
