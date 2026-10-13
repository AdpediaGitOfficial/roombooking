import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { RequestError } from "@/modules/requests/errors";
import { updateType } from "@/modules/requests/builder";
import { canDecide, decideRequest, describeStatus, getRequest, listInbox, reassignStep, resubmitRequest, submitRequest, sweepRequests } from "@/modules/requests/service";

const stamp = Date.now().toString(36).toUpperCase();
let orgId: string; let admin: string; let manager: string; let senior: string; let resident: string; let typeId: string;
const h = 3600000;
const actor = (id: string, roles: Parameters<typeof canDecide>[1]["roles"]) => ({ id, roles });

async function expectError<T>(p: Promise<T>, code: string) {
  try { await p; } catch (e) { expect(e).toBeInstanceOf(RequestError); expect((e as RequestError).code).toBe(code); return e as RequestError; }
  throw new Error(`expected RequestError ${code}`);
}
async function submit(key: string) {
  const { request } = await submitRequest({ requesterId: resident, organizationId: orgId, typeCode: "SLOW", raw: { note: key }, idempotencyKey: `rp-${stamp}-${key}` });
  return request;
}
async function age(requestId: string, days: number) {
  await prisma.request.update({ where: { id: requestId }, data: { stepStartedAt: new Date(Date.now() - days * 24 * h) } });
}

beforeAll(async () => {
  const org = await prisma.organization.create({ data: { code: `RP-${stamp}`, name: "Policy Org" } });
  orgId = org.id;
  const mk = async (name: string, roles: Array<"SYSTEM_ADMIN" | "APPROVER" | "ACCOMMODATION_ADMIN" | "STAFF">) => (await prisma.user.create({ data: { organizationId: orgId, email: `rp-${name}-${stamp}@example.com`, name: `${name} ${stamp}`, status: "ACTIVE", roleAssignments: { create: roles.map((role) => ({ role })) } } })).id;
  admin = await mk("Admin", ["SYSTEM_ADMIN"]);
  manager = await mk("Manager", ["APPROVER"]);
  senior = await mk("Senior", ["ACCOMMODATION_ADMIN"]);
  resident = await mk("Resident", ["STAFF"]);
  const type = await prisma.requestType.create({ data: { organizationId: orgId, code: "SLOW", name: "Slow request", reminderAfterDays: 2, escalateAfterDays: 5, escalateToRole: "ACCOMMODATION_ADMIN", expireAfterDays: 10 } });
  typeId = type.id;
  await prisma.workflowVersion.create({ data: { requestTypeId: type.id, version: 1, isCurrent: true, publishedAt: new Date(), formSchema: { fields: [{ name: "note", label: "Note", type: "text", required: true }] }, steps: { create: [{ order: 1, name: "Manager approval", approverRole: "APPROVER", requireComment: false }, { order: 2, name: "Final approval", approverRole: "ACCOMMODATION_ADMIN", requireComment: false }] } } });
});

afterAll(async () => { await prisma.$disconnect(); });

describe("policy sweep", () => {
  it("starts the clock on submission and reminds approvers once after the reminder period", async () => {
    const r = await submit("remind");
    expect((await getRequest(r.id))!.stepStartedAt).not.toBeNull();
    let res = await sweepRequests();
    expect(await prisma.notification.count({ where: { channel: "IN_APP", recipientId: manager, event: "request.reminder", idempotencyKey: { contains: r.id } } })).toBe(0);
    await age(r.id, 2.5);
    res = await sweepRequests();
    expect(res.reminded).toBeGreaterThanOrEqual(1);
    expect(await prisma.notification.count({ where: { channel: "IN_APP", recipientId: manager, event: "request.reminder", idempotencyKey: { contains: r.id } } })).toBe(1);
    expect(await prisma.notification.count({ where: { channel: "IN_APP", recipientId: senior, event: "request.reminder", idempotencyKey: { contains: r.id } } })).toBe(0);
    await sweepRequests();
    expect(await prisma.notification.count({ where: { channel: "IN_APP", recipientId: manager, event: "request.reminder", idempotencyKey: { contains: r.id } } })).toBe(1);
  });

  it("escalates a stale step to the configured role, moving it out of the original approver's inbox", async () => {
    const r = await submit("escalate");
    await age(r.id, 6);
    const res = await sweepRequests();
    expect(res.escalated).toBeGreaterThanOrEqual(1);
    const full = (await getRequest(r.id))!;
    expect(full.stepRoleOverride).toBe("ACCOMMODATION_ADMIN");
    expect(full.escalatedAt).not.toBeNull();
    expect(describeStatus(full)).toContain("escalated to accommodation admin");
    expect(canDecide(full, actor(manager, ["APPROVER"])).ok).toBe(false);
    expect(canDecide(full, actor(senior, ["ACCOMMODATION_ADMIN"])).ok).toBe(true);
    expect((await listInbox(actor(senior, ["ACCOMMODATION_ADMIN"]))).some((x) => x.id === r.id)).toBe(true);
    expect(await prisma.notification.count({ where: { channel: "IN_APP", recipientId: senior, event: "request.escalated", idempotencyKey: { contains: r.id } } })).toBe(1);
    expect(await prisma.notification.count({ where: { channel: "IN_APP", recipientId: resident, event: "request.escalated_requester" } })).toBeGreaterThanOrEqual(1);
    // Sweeping again neither re-escalates nor reminds the old role.
    await sweepRequests();
    expect(await prisma.auditEvent.count({ where: { entityId: r.id, action: "REQUEST_ESCALATED" } })).toBe(1);
    // The senior approves step 1; step 2 starts fresh with no override.
    await decideRequest({ requestId: r.id, actor: actor(senior, ["ACCOMMODATION_ADMIN"]), action: "APPROVE" });
    const next = (await getRequest(r.id))!;
    expect(next.currentStepOrder).toBe(2);
    expect(next.stepRoleOverride).toBeNull();
    expect(next.escalatedAt).toBeNull();
    expect(next.stepStartedAt!.getTime()).toBeGreaterThan(Date.now() - 60000);
  });

  it("expires a request after the expiry period, notifies the requester, and allows resubmission", async () => {
    const r = await submit("expire");
    await age(r.id, 11);
    const res = await sweepRequests();
    expect(res.expired).toBeGreaterThanOrEqual(1);
    const full = (await getRequest(r.id))!;
    expect(full.status).toBe("EXPIRED");
    expect(describeStatus(full)).toContain("Expired");
    expect(await prisma.notification.findFirst({ where: { recipientId: resident, event: "request.expired", idempotencyKey: { contains: r.id } } })).not.toBeNull();
    await expectError(decideRequest({ requestId: r.id, actor: actor(manager, ["APPROVER"]), action: "APPROVE" }), "INVALID_STATE");
    const again = await resubmitRequest({ requestId: r.id, requesterId: resident, raw: { note: "expire again" } });
    expect(again.status).toBe("PENDING_APPROVAL");
    expect(again.submissionVersion).toBe(2);
    expect(again.expiredAt).toBeNull();
    expect(again.stepStartedAt!.getTime()).toBeGreaterThan(Date.now() - 60000);
  });

  it("lets an administrator reassign a step to another role with a reason, and the policy can be switched off per type", async () => {
    const r = await submit("reassign");
    await expectError(reassignStep({ requestId: r.id, actor: actor(manager, ["APPROVER"]), role: "ACCOMMODATION_ADMIN", reason: "x" }), "FORBIDDEN");
    await expectError(reassignStep({ requestId: r.id, actor: actor(admin, ["SYSTEM_ADMIN"]), role: "ACCOMMODATION_ADMIN", reason: "" }), "VALIDATION");
    await expectError(reassignStep({ requestId: r.id, actor: actor(admin, ["SYSTEM_ADMIN"]), role: "APPROVER", reason: "same" }), "VALIDATION");
    await reassignStep({ requestId: r.id, actor: actor(admin, ["SYSTEM_ADMIN"]), role: "ACCOMMODATION_ADMIN", reason: "Manager has left the company" });
    const full = (await getRequest(r.id))!;
    expect(full.stepRoleOverride).toBe("ACCOMMODATION_ADMIN");
    expect(canDecide(full, actor(senior, ["ACCOMMODATION_ADMIN"])).ok).toBe(true);
    expect(await prisma.notification.count({ where: { channel: "IN_APP", recipientId: senior, event: "request.reassigned", idempotencyKey: { contains: r.id } } })).toBe(1);
    expect(await prisma.auditEvent.findFirst({ where: { entityId: r.id, action: "REQUEST_STEP_REASSIGNED" } })).not.toBeNull();
    await updateType({ typeId, actorId: admin, name: "Slow request", status: "ACTIVE", policy: { reminderAfterDays: 0, escalateAfterDays: 0, escalateToRole: null, expireAfterDays: 0 } });
    await expectError(updateType({ typeId, actorId: admin, name: "Slow request", status: "ACTIVE", policy: { expireAfterDays: -1 } }), "VALIDATION");
    const quiet = await submit("quiet");
    await age(quiet.id, 30);
    const res = await sweepRequests();
    expect((await getRequest(quiet.id))!.status).toBe("PENDING_APPROVAL");
    expect(res.expired + res.escalated).toBe(0);
  });
});
