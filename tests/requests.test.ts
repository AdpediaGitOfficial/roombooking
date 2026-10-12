import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Prisma, Role } from "@prisma/client";
import { prisma } from "@/lib/db";
import { RequestError } from "@/modules/requests/errors";
import { validateSubmission, TYPE_RULES, type FormSchema } from "@/modules/requests/forms";
import { canDecide, decideRequest, getRequest, listInbox, resubmitRequest, submitRequest, withdrawRequest } from "@/modules/requests/service";
import { allocate, checkIn, transfer } from "@/modules/allocations/service";

const plus = (n: number) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);
const uuid = () => `t-${Date.now()}-${Math.random().toString(36).slice(2)}`;

let orgId: string;
const users: Record<string, { id: string; roles: Role[] }> = {};
let staffId: string;
let bedA: string;
let bedB: string;

async function expectError<T>(p: Promise<T>, code: string) {
  try { await p; } catch (e) {
    expect(e).toBeInstanceOf(RequestError);
    expect((e as RequestError).code).toBe(code);
    return e as RequestError;
  }
  throw new Error(`expected RequestError ${code}`);
}

async function ensureUser(key: string, email: string, roles: Role[]) {
  const user = await prisma.user.upsert({ where: { email }, update: { status: "ACTIVE" }, create: { organizationId: orgId, email, name: key, status: "ACTIVE" } });
  await prisma.roleAssignment.deleteMany({ where: { userId: user.id } });
  for (const role of roles) await prisma.roleAssignment.create({ data: { userId: user.id, role } });
  users[key] = { id: user.id, roles };
  return user;
}

async function ensureType(code: string, name: string, fields: Prisma.InputJsonObject[], steps: Array<{ name: string; approverRole: Role; requireComment: boolean }>) {
  const type = await prisma.requestType.upsert({ where: { organizationId_code: { organizationId: orgId, code } }, update: { name }, create: { organizationId: orgId, code, name } });
  await prisma.workflowVersion.updateMany({ where: { requestTypeId: type.id }, data: { isCurrent: false } });
  const version = await prisma.workflowVersion.upsert({
    where: { requestTypeId_version: { requestTypeId: type.id, version: 1 } },
    update: { formSchema: { fields }, isCurrent: true },
    create: { requestTypeId: type.id, version: 1, formSchema: { fields }, isCurrent: true },
  });
  await prisma.approvalStep.deleteMany({ where: { workflowVersionId: version.id, decisions: { none: {} } } });
  for (const [i, s] of steps.entries()) {
    await prisma.approvalStep.upsert({ where: { workflowVersionId_order: { workflowVersionId: version.id, order: i + 1 } }, update: s, create: { workflowVersionId: version.id, order: i + 1, ...s } });
  }
}

beforeAll(async () => {
  const org = await prisma.organization.upsert({ where: { code: "TEST" }, update: {}, create: { code: "TEST", name: "Test Org" } });
  orgId = org.id;
  const requester = await ensureUser("requester", "wf-requester@example.com", ["STAFF"]);
  await ensureUser("manager", "wf-manager@example.com", ["APPROVER"]);
  await ensureUser("manager2", "wf-manager2@example.com", ["APPROVER"]);
  await ensureUser("accadmin", "wf-accadmin@example.com", ["ACCOMMODATION_ADMIN"]);
  await ensureUser("officer", "wf-officer@example.com", ["ACCOMMODATION_OFFICER"]);

  const staff = await prisma.staffProfile.upsert({
    where: { organizationId_employeeId: { organizationId: orgId, employeeId: "WF-1" } },
    update: { userId: requester.id },
    create: { organizationId: orgId, employeeId: "WF-1", firstName: "Work", lastName: "Flow", userId: requester.id },
  });
  staffId = staff.id;
  const site = await prisma.site.upsert({ where: { organizationId_code: { organizationId: orgId, code: "WFS" } }, update: {}, create: { organizationId: orgId, code: "WFS", name: "Workflow Site", timezone: "UTC" } });
  const building = await prisma.building.upsert({ where: { siteId_code: { siteId: site.id, code: "WF-B" } }, update: {}, create: { siteId: site.id, code: "WF-B", name: "Workflow Block" } });
  const room = await prisma.room.upsert({ where: { buildingId_code: { buildingId: building.id, code: "WF-R1" } }, update: {}, create: { buildingId: building.id, code: "WF-R1" } });
  bedA = (await prisma.bed.upsert({ where: { roomId_code: { roomId: room.id, code: "WF-R1-1" } }, update: {}, create: { roomId: room.id, code: "WF-R1-1" } })).id;
  bedB = (await prisma.bed.upsert({ where: { roomId_code: { roomId: room.id, code: "WF-R1-2" } }, update: {}, create: { roomId: room.id, code: "WF-R1-2" } })).id;

  const twoStep = [
    { name: "Line manager approval", approverRole: "APPROVER" as Role, requireComment: false },
    { name: "Accommodation administrator approval", approverRole: "ACCOMMODATION_ADMIN" as Role, requireComment: true },
  ];
  await ensureType("ROOM_CHANGE", "Room change", [
    { name: "reason", label: "Reason", type: "textarea", required: true },
    { name: "effectiveDate", label: "Move date", type: "date", required: true },
  ], twoStep);
  await ensureType("VISITOR_STAY", "Visitor stay", [
    { name: "visitorName", label: "Visitor", type: "text", required: true },
    { name: "arrivalDate", label: "Arrival", type: "date", required: true },
    { name: "departureDate", label: "Departure", type: "date", required: true },
  ], [{ name: "Line manager approval", approverRole: "APPROVER", requireComment: false }]);
  await ensureType("EXIT_CLEARANCE", "Exit clearance", [
    { name: "lastWorkingDay", label: "Last working day", type: "date", required: true },
  ], [{ name: "Line manager approval", approverRole: "APPROVER", requireComment: false }]);
  await ensureType("NO_APPROVAL", "Auto", [{ name: "note", label: "Note", type: "text" }], []);

  await prisma.allocation.deleteMany({ where: { staffId } });
  await prisma.approvalDecision.deleteMany({ where: { request: { requesterId: requester.id } } });
  await prisma.requestSubmission.deleteMany({ where: { request: { requesterId: requester.id } } });
  await prisma.request.deleteMany({ where: { requesterId: requester.id } });
  await prisma.notification.deleteMany({ where: { recipientId: requester.id } });
});

afterAll(async () => { await prisma.$disconnect(); });

describe("form validation", () => {
  const schema: FormSchema = { fields: [
    { name: "reason", label: "Reason", type: "textarea", required: true },
    { name: "count", label: "Count", type: "number", min: 1, max: 5 },
    { name: "when", label: "When", type: "date", required: true },
    { name: "where", label: "Where", type: "select", optionsSource: "buildings" },
    { name: "agree", label: "Agree", type: "checkbox", required: true },
  ] };
  it("reports every invalid field and types valid values", () => {
    const { errors } = validateSubmission(schema, { reason: "", count: "9", when: "not-a-date", where: "Nowhere", agree: "" }, { where: ["Block A"] });
    expect(Object.keys(errors).sort()).toEqual(["agree", "count", "reason", "when", "where"]);
    const ok = validateSubmission(schema, { reason: "Noise", count: "3", when: "2026-11-01", where: "Block A", agree: "on" }, { where: ["Block A"] });
    expect(ok.errors).toEqual({});
    expect(ok.data).toEqual({ reason: "Noise", count: 3, when: "2026-11-01", where: "Block A", agree: true });
  });
  it("applies cross-field type rules", () => {
    expect(TYPE_RULES.VISITOR_STAY({ arrivalDate: "2026-11-05", departureDate: "2026-11-01" }, "2026-10-12")).toHaveProperty("departureDate");
    expect(TYPE_RULES.EXIT_CLEARANCE({ lastWorkingDay: "2026-01-01" }, "2026-10-12")).toHaveProperty("lastWorkingDay");
  });
});

describe("submission", () => {
  it("rejects invalid data with field errors and creates nothing", async () => {
    const e = await expectError(submitRequest({ requesterId: users.requester.id, organizationId: orgId, typeCode: "ROOM_CHANGE", raw: { reason: "" }, idempotencyKey: uuid() }), "VALIDATION");
    expect(e.fieldErrors).toHaveProperty("reason");
    expect(e.fieldErrors).toHaveProperty("effectiveDate");
  });

  it("creates a pending request at step 1 and keeps submission history; the same token returns the same request", async () => {
    const key = uuid();
    const first = await submitRequest({ requesterId: users.requester.id, organizationId: orgId, typeCode: "ROOM_CHANGE", raw: { reason: "Noisy room", effectiveDate: plus(10) }, idempotencyKey: key });
    expect(first.duplicate).toBe(false);
    expect(first.request.status).toBe("PENDING_APPROVAL");
    expect(first.request.currentStepOrder).toBe(1);
    const again = await submitRequest({ requesterId: users.requester.id, organizationId: orgId, typeCode: "ROOM_CHANGE", raw: { reason: "Noisy room", effectiveDate: plus(10) }, idempotencyKey: key });
    expect(again.duplicate).toBe(true);
    expect(again.request.id).toBe(first.request.id);
    const full = await getRequest(first.request.id);
    expect(full?.submissions).toHaveLength(1);
  });

  it("approves immediately when the route has no steps", async () => {
    const { request } = await submitRequest({ requesterId: users.requester.id, organizationId: orgId, typeCode: "NO_APPROVAL", raw: { note: "x" }, idempotencyKey: uuid() });
    expect(request.status).toBe("FULFILLED");
  });
});

describe("decisions", () => {
  let id: string;
  it("routes to the right inbox and blocks self-approval and wrong roles", async () => {
    const { request } = await submitRequest({ requesterId: users.requester.id, organizationId: orgId, typeCode: "ROOM_CHANGE", raw: { reason: "Leak", effectiveDate: plus(10) }, idempotencyKey: uuid() });
    id = request.id;
    expect((await listInbox(users.manager)).map((r) => r.id)).toContain(id);
    expect((await listInbox(users.accadmin)).map((r) => r.id)).not.toContain(id);
    expect(canDecide((await getRequest(id))!, users.requester).ok).toBe(false);
    await expectError(decideRequest({ requestId: id, actor: users.accadmin, action: "APPROVE" }), "FORBIDDEN");
  });

  it("requires a reason to return or reject", async () => {
    await expectError(decideRequest({ requestId: id, actor: users.manager, action: "REQUEST_CHANGES", comment: "" }), "COMMENT_REQUIRED");
  });

  it("lets exactly one of two concurrent approvers decide a step", async () => {
    const results = await Promise.allSettled([
      decideRequest({ requestId: id, actor: users.manager, action: "APPROVE" }),
      decideRequest({ requestId: id, actor: users.manager2, action: "APPROVE" }),
    ]);
    const ok = results.filter((r) => r.status === "fulfilled");
    const failed = results.filter((r) => r.status === "rejected") as PromiseRejectedResult[];
    expect(ok).toHaveLength(1);
    expect(failed).toHaveLength(1);
    expect((failed[0].reason as RequestError).code).toBe("CONFLICT");
    const r = await getRequest(id);
    expect(r?.status).toBe("PENDING_APPROVAL");
    expect(r?.currentStepOrder).toBe(2);
    expect(r?.decisions).toHaveLength(1);
  });

  it("enforces a required comment at step 2 and then approves a room change into the awaiting-move state", async () => {
    await expectError(decideRequest({ requestId: id, actor: users.accadmin, action: "APPROVE", comment: "" }), "COMMENT_REQUIRED");
    const approved = await decideRequest({ requestId: id, actor: users.accadmin, action: "APPROVE", comment: "Bed available in Block B" });
    expect(approved.status).toBe("APPROVED");
    expect(approved.fulfilmentNote).toContain("office");
    const note = await prisma.notification.findFirst({ where: { recipientId: users.requester.id, event: "request.approved", idempotencyKey: `request.approved:${id}:1` } });
    expect(note).not.toBeNull();
  });

  it("closes the room change exactly once when the officer transfers with the request reference", async () => {
    const a = await allocate({ staffId, bedId: bedA, startDate: plus(-5), actorId: users.officer.id });
    await checkIn({ allocationId: a.id, actorId: users.officer.id, today: plus(-5) });
    const moved = await transfer({ allocationId: a.id, toBedId: bedB, effectiveDate: plus(0), reason: "Room change", actorId: users.officer.id, today: plus(0), requestId: id });
    const r = await getRequest(id);
    expect(r?.status).toBe("FULFILLED");
    expect(r?.allocations.map((x) => x.id)).toContain(moved.id);
    // A second transfer citing the same request is refused and does not create another allocation.
    const countBefore = await prisma.allocation.count({ where: { staffId } });
    await expectError(transfer({ allocationId: moved.id, toBedId: bedA, effectiveDate: plus(1), reason: "again", actorId: users.officer.id, today: plus(0), requestId: id }), "INVALID_STATE");
    expect(await prisma.allocation.count({ where: { staffId } })).toBe(countBefore);
  });
});

describe("changes requested, resubmission, rejection, withdrawal", () => {
  it("returns a request for changes, preserves history on resubmit, and restarts the route", async () => {
    const { request } = await submitRequest({ requesterId: users.requester.id, organizationId: orgId, typeCode: "VISITOR_STAY", raw: { visitorName: "A", arrivalDate: plus(3), departureDate: plus(5) }, idempotencyKey: uuid() });
    const returned = await decideRequest({ requestId: request.id, actor: users.manager, action: "REQUEST_CHANGES", comment: "Full name please" });
    expect(returned.status).toBe("CHANGES_REQUESTED");
    await expectError(resubmitRequest({ requestId: request.id, requesterId: users.manager.id, raw: {} }), "FORBIDDEN");
    const resubmitted = await resubmitRequest({ requestId: request.id, requesterId: users.requester.id, raw: { visitorName: "Alex Person", arrivalDate: plus(3), departureDate: plus(5) } });
    expect(resubmitted.status).toBe("PENDING_APPROVAL");
    expect(resubmitted.submissionVersion).toBe(2);
    const full = await getRequest(request.id);
    expect(full?.submissions.map((s) => s.version)).toEqual([1, 2]);
    expect(full?.decisions).toHaveLength(1);
    const done = await decideRequest({ requestId: request.id, actor: users.manager, action: "APPROVE" });
    expect(done.status).toBe("FULFILLED");
  });

  it("rejects with a reason and refuses further decisions", async () => {
    const { request } = await submitRequest({ requesterId: users.requester.id, organizationId: orgId, typeCode: "VISITOR_STAY", raw: { visitorName: "B", arrivalDate: plus(3), departureDate: plus(4) }, idempotencyKey: uuid() });
    const rejected = await decideRequest({ requestId: request.id, actor: users.manager, action: "REJECT", comment: "Not permitted during audit week" });
    expect(rejected.status).toBe("REJECTED");
    await expectError(decideRequest({ requestId: request.id, actor: users.manager, action: "APPROVE" }), "INVALID_STATE");
  });

  it("lets the requester withdraw while pending, but not after a decision", async () => {
    const { request } = await submitRequest({ requesterId: users.requester.id, organizationId: orgId, typeCode: "VISITOR_STAY", raw: { visitorName: "C", arrivalDate: plus(3), departureDate: plus(4) }, idempotencyKey: uuid() });
    await expectError(withdrawRequest({ requestId: request.id, requesterId: users.manager.id }), "FORBIDDEN");
    const w = await withdrawRequest({ requestId: request.id, requesterId: users.requester.id, reason: "Plans changed" });
    expect(w.status).toBe("CANCELLED");
    await expectError(withdrawRequest({ requestId: request.id, requesterId: users.requester.id }), "INVALID_STATE");
  });
});

describe("exit clearance fulfilment", () => {
  it("sets the current allocation's end date to the last working day", async () => {
    const lastDay = plus(20);
    const { request } = await submitRequest({ requesterId: users.requester.id, organizationId: orgId, typeCode: "EXIT_CLEARANCE", raw: { lastWorkingDay: lastDay }, idempotencyKey: uuid() });
    const done = await decideRequest({ requestId: request.id, actor: users.manager, action: "APPROVE" });
    expect(done.status).toBe("FULFILLED");
    const current = await prisma.allocation.findFirst({ where: { staffId, status: "CHECKED_IN" } });
    expect(current?.endDate?.toISOString().slice(0, 10)).toBe(lastDay);
    expect(current?.requestId).toBe(request.id);
  });
});
