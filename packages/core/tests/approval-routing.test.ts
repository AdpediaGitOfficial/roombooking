import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Prisma, Role } from "@prisma/client";
import { prisma } from "../src/lib/db";
import { RequestError } from "../src/modules/requests/errors";
import { decideRequest, submitRequest, type Actor } from "../src/modules/requests/service";
import { checkEligibility } from "../src/modules/allocations/eligibility";

const stamp = Date.now().toString(36);
const uuid = () => `r-${Date.now()}-${Math.random().toString(36).slice(2)}`;
let orgId: string, siteA: string, siteB: string;
const U: Record<string, Actor> = {};

async function mk(key: string, roles: Array<{ role: Role; siteId?: string | null }>) {
  const u = await prisma.user.create({ data: { organizationId: orgId, email: `rt-${key}-${stamp}@example.com`, name: key, status: "ACTIVE", username: `rt_${key}_${stamp}` } });
  for (const r of roles) await prisma.roleAssignment.create({ data: { userId: u.id, role: r.role, siteId: r.siteId ?? null } });
  U[key] = { id: u.id, roles: roles.map((r) => r.role), roleAssignments: roles.map((r) => ({ role: r.role, siteId: r.siteId ?? null, buildingId: null })) };
  return u;
}
async function type(code: string, fields: Prisma.InputJsonObject[], steps: Array<{ name: string; approverRole: Role; requireComment?: boolean; siteScope?: string }>) {
  const t = await prisma.requestType.upsert({ where: { organizationId_code: { organizationId: orgId, code } }, update: {}, create: { organizationId: orgId, code, name: code } });
  await prisma.workflowVersion.updateMany({ where: { requestTypeId: t.id }, data: { isCurrent: false } });
  const version = await prisma.workflowVersion.create({ data: { requestTypeId: t.id, version: ((await prisma.workflowVersion.aggregate({ where: { requestTypeId: t.id }, _max: { version: true } }))._max.version ?? 0) + 1, formSchema: { fields }, isCurrent: true } });
  for (const [i, s] of steps.entries()) await prisma.approvalStep.create({ data: { workflowVersionId: version.id, order: i + 1, requireComment: false, ...s } });
}
async function expectErr<T>(p: Promise<T>) {
  try { await p; } catch (e) { expect(e).toBeInstanceOf(RequestError); return e as RequestError; }
  throw new Error("expected RequestError");
}

beforeAll(async () => {
  const org = await prisma.organization.upsert({ where: { code: "TEST" }, update: {}, create: { code: "TEST", name: "Test Org" } });
  orgId = org.id;
  siteA = (await prisma.site.create({ data: { organizationId: orgId, code: `RA${stamp}`.slice(0, 12), name: `Route Site A ${stamp}`, timezone: "UTC" } })).id;
  siteB = (await prisma.site.create({ data: { organizationId: orgId, code: `RB${stamp}`.slice(0, 12), name: `Route Site B ${stamp}`, timezone: "UTC" } })).id;
  const b = await prisma.building.create({ data: { siteId: siteA, code: `RB${stamp}`.slice(0, 12), name: "RB" } });
  const room = await prisma.room.create({ data: { buildingId: b.id, code: "R-1" } });
  const bed = await prisma.bed.create({ data: { roomId: room.id, code: "R-1-1" } });
  const resident = await mk("resident", [{ role: "STAFF" }]);
  const staff = await prisma.staffProfile.create({ data: { organizationId: orgId, employeeId: `RT-${stamp}`, firstName: "Route", lastName: "Resident", userId: resident.id, verificationStatus: "VERIFIED" } });
  await prisma.allocation.create({ data: { staffId: staff.id, bedId: bed.id, startDate: new Date("2026-01-01"), endDate: new Date("2026-12-31"), status: "CHECKED_IN", checkedInAt: new Date() } });
  await mk("aaA", [{ role: "ACCOMMODATION_ADMIN", siteId: siteA }]);
  await mk("aaB", [{ role: "ACCOMMODATION_ADMIN", siteId: siteB }]);
  await mk("aaAll", [{ role: "ACCOMMODATION_ADMIN" }]);
  await mk("sa", [{ role: "SYSTEM_ADMIN" }]);
});
afterAll(async () => { await prisma.$disconnect(); });

const submit = (typeCode: string, raw: Record<string, string>, who = "resident") => submitRequest({ organizationId: orgId, requesterId: U[who].id, typeCode, raw, idempotencyKey: uuid() } as never).then((r) => r.request);

describe("site-scoped approval steps", () => {
  it("needs the sending site's Admin first and the receiving site's Admin second", async () => {
    await type(`XFER${stamp}`, [{ name: "targetSite", label: "Receiving site", type: "select", required: true, optionsSource: "sites" }, { name: "reason", label: "Reason", type: "textarea", required: true }], [
      { name: "Sending", approverRole: "ACCOMMODATION_ADMIN", siteScope: "REQUESTER" }, { name: "Receiving", approverRole: "ACCOMMODATION_ADMIN", siteScope: "TARGET", requireComment: true },
    ]);
    const r = await submit(`XFER${stamp}`, { targetSite: `Route Site B ${stamp}`, reason: "Project move" });
    await expect(decideRequest({ requestId: r.id, actor: U.aaB, action: "APPROVE" })).rejects.toMatchObject({ message: expect.stringContaining("requester's site") });
    await decideRequest({ requestId: r.id, actor: U.aaA, action: "APPROVE" });
    await expect(decideRequest({ requestId: r.id, actor: U.aaA, action: "APPROVE", comment: "again" })).rejects.toBeInstanceOf(RequestError); // sending-site admin cannot also accept for the receiving site
    const done = await decideRequest({ requestId: r.id, actor: U.aaB, action: "APPROVE", comment: "Accepted" });
    expect(["APPROVED", "FULFILLED"]).toContain(done.status);
  });
});

describe("a different person for each step", () => {
  it("blocks the same approver on two steps, lets a Super Admin stand in for the second Admin, and waives the rule only when nobody else exists", async () => {
    await type(`EXT${stamp}`, [{ name: "newEndDate", label: "New end date", type: "date", required: true }, { name: "reason", label: "Reason", type: "textarea", required: true }], [
      { name: "Admin", approverRole: "ACCOMMODATION_ADMIN" }, { name: "Second Admin or Super Admin", approverRole: "ACCOMMODATION_ADMIN", requireComment: true },
    ]);
    const r = await submit(`EXT${stamp}`, { newEndDate: "2027-03-01", reason: "Project overrun" });
    await decideRequest({ requestId: r.id, actor: U.aaAll, action: "APPROVE" });
    const blocked = await expectErr(decideRequest({ requestId: r.id, actor: U.aaAll, action: "APPROVE", comment: "me again" }));
    expect(blocked.message).toMatch(/different person/);
    const fin = await decideRequest({ requestId: r.id, actor: U.sa, action: "APPROVE", comment: "Super admin agrees" });
    expect(["APPROVED", "FULFILLED"]).toContain(fin.status);
  });

  it("extends the stay when an extension request is approved and fulfilled", async () => {
    // Uses the seeded-style type code so the built-in fulfilment runs.
    await type("EXTENSION_BEYOND_POLICY", [{ name: "newEndDate", label: "New end date", type: "date", required: true }, { name: "reason", label: "Why", type: "textarea", required: true }], [{ name: "Admin", approverRole: "ACCOMMODATION_ADMIN" }, { name: "Second", approverRole: "ACCOMMODATION_ADMIN", requireComment: true }]);
    const r = await submit("EXTENSION_BEYOND_POLICY", { newEndDate: "2027-06-30", reason: "Long project" });
    await decideRequest({ requestId: r.id, actor: U.aaAll, action: "APPROVE" });
    const done = await decideRequest({ requestId: r.id, actor: U.sa, action: "APPROVE", comment: "ok" });
    expect(done.status).toBe("FULFILLED");
    const stay = await prisma.allocation.findFirstOrThrow({ where: { staff: { userId: U.resident.id }, status: "CHECKED_IN" } });
    expect(stay.endDate!.toISOString().slice(0, 10)).toBe("2027-06-30");
  });
});

describe("eligibility exception", () => {
  it("lifts the room check for a short time once a different Admin approves", async () => {
    await type("ELIGIBILITY_EXCEPTION", [{ name: "employeeId", label: "Employee ID", type: "text", required: true }, { name: "reason", label: "Why", type: "textarea", required: true }], [{ name: "Second Admin or Super Admin", approverRole: "ACCOMMODATION_ADMIN", requireComment: true }]);
    const person = await prisma.staffProfile.create({ data: { organizationId: orgId, employeeId: `EX-${stamp}`, firstName: "Needs", lastName: "Exception", grade: "G1" } });
    const rule = { grades: ["G9"] };
    expect(checkEligibility(person, {}, rule, { startDate: "2026-10-20", endDate: null }).ok).toBe(false);
    const r = await submit("ELIGIBILITY_EXCEPTION", { employeeId: `EX-${stamp}`, reason: "Project lead needs the senior block" }, "aaA");
    await expectErr(decideRequest({ requestId: r.id, actor: U.aaA, action: "APPROVE", comment: "self" })); // self-approval blocked
    const done = await decideRequest({ requestId: r.id, actor: U.aaAll, action: "APPROVE", comment: "Agreed" });
    expect(done.status).toBe("FULFILLED");
    const fresh = await prisma.staffProfile.findUniqueOrThrow({ where: { id: person.id } });
    expect(checkEligibility(fresh, {}, rule, { startDate: "2026-10-20", endDate: null }).ok).toBe(true);
  });
});
