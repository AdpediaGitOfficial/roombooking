import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Role } from "@prisma/client";
import { prisma } from "../src/lib/db";
import { MaintenanceError } from "../src/modules/maintenance/errors";
import { assignWorkOrder, changeStatus, createWorkOrder, type Actor } from "../src/modules/maintenance/service";
import {
  acceptWorkOrder, addPart, addWorker, approveVendor, contractorAccessCheck, createSchedule, createVendor, decideCost, decidePermit, putOnHold, recordWork, requestPermit,
  resumeFromHold, runPreventive, scheduleVisit, submitEstimate, suspendVendor, sweepVendors, sweepWorkOrders, terminateVendor, vendorCompliance, verifyWorker, verifyWorkOrder, addVendorDocument, setRate,
} from "../src/modules/maintenance/extras";

let orgId: string;
let siteId: string;
let roomId: string;
const A: Record<string, Actor> = {};
const stamp = Date.now().toString(36);

async function expectError<T>(p: Promise<T>, code?: string) {
  try { await p; } catch (e) {
    expect(e).toBeInstanceOf(MaintenanceError);
    if (code) expect((e as MaintenanceError).code).toBe(code);
    return e as MaintenanceError;
  }
  throw new Error("expected MaintenanceError");
}

async function ensureUser(key: string, roles: Role[], vendorId?: string) {
  const email = `mx-${key}-${stamp}@example.com`;
  const user = await prisma.user.create({ data: { organizationId: orgId, email, name: key, status: "ACTIVE", vendorId: vendorId ?? null, username: `mx_${key}_${stamp}` } });
  for (const role of roles) await prisma.roleAssignment.create({ data: { userId: user.id, role } });
  A[key] = { id: user.id, roles, vendorId: vendorId ?? null };
}

async function newOrder(over: { assign?: boolean } = {}) {
  const wo = await createWorkOrder({ requesterId: A.resident.id, roomId, category: "Plumbing", description: "Tap leaking in the bathroom sink", priority: "MEDIUM" });
  if (over.assign) await assignWorkOrder({ workOrderId: wo.id, actor: A.coordinator, assigneeId: A.engineer.id });
  return wo;
}

beforeAll(async () => {
  const org = await prisma.organization.upsert({ where: { code: "TEST" }, update: {}, create: { code: "TEST", name: "Test Org" } });
  orgId = org.id;
  const site = await prisma.site.upsert({ where: { organizationId_code: { organizationId: orgId, code: "MNX" } }, update: {}, create: { organizationId: orgId, code: "MNX", name: "Extras Site", timezone: "UTC" } });
  siteId = site.id;
  const building = await prisma.building.upsert({ where: { siteId_code: { siteId, code: "MNX-B" } }, update: {}, create: { siteId, code: "MNX-B", name: "Extras Block" } });
  roomId = (await prisma.room.upsert({ where: { buildingId_code: { buildingId: building.id, code: "MNX-R1" } }, update: {}, create: { buildingId: building.id, code: "MNX-R1" } })).id;
  await ensureUser("resident", ["STAFF"]);
  await ensureUser("coordinator", ["MAINTENANCE_COORDINATOR"]);
  await ensureUser("admin", ["ACCOMMODATION_ADMIN"]);
  await ensureUser("engineer", ["TECHNICIAN"]);
  await ensureUser("officer", ["ACCOMMODATION_OFFICER"]);
});

afterAll(async () => { await prisma.$disconnect(); });

describe("cost approval against a threshold", () => {
  it("lets the Coordinator approve within the threshold but not above it, and blocks work until decided", async () => {
    const wo = await newOrder({ assign: true });
    await acceptWorkOrder(A.engineer, wo.id);
    await submitEstimate(A.engineer, wo.id, { amount: 300 });
    await expectError(changeStatus({ workOrderId: wo.id, actor: A.engineer, status: "IN_PROGRESS" }), "INVALID_TRANSITION");
    await expectError(decideCost(A.engineer, wo.id, true), "FORBIDDEN");
    await decideCost(A.coordinator, wo.id, true);
    await changeStatus({ workOrderId: wo.id, actor: A.engineer, status: "IN_PROGRESS" });

    const big = await newOrder({ assign: true });
    await submitEstimate(A.engineer, big.id, { amount: 5000 });
    await expectError(decideCost(A.coordinator, big.id, true), "FORBIDDEN"); // above threshold needs the Admin
    await decideCost(A.admin, big.id, true);
    expect((await prisma.workOrder.findUniqueOrThrow({ where: { id: big.id } })).costApprovalStatus).toBe("APPROVED");
  });

  it("needs a reason to reject a cost", async () => {
    const wo = await newOrder({ assign: true });
    await submitEstimate(A.engineer, wo.id, { amount: 100 });
    await expectError(decideCost(A.coordinator, wo.id, false), "NOTE_REQUIRED");
    await decideCost(A.coordinator, wo.id, false, "Too high");
    await expectError(changeStatus({ workOrderId: wo.id, actor: A.engineer, status: "IN_PROGRESS" }), "INVALID_TRANSITION");
  });
});

describe("accept, hold, verify", () => {
  it("runs accept -> hold -> resume -> resolve -> verify -> auto close", async () => {
    const wo = await newOrder({ assign: true });
    await expectError(acceptWorkOrder(A.coordinator, wo.id), "FORBIDDEN");
    await acceptWorkOrder(A.engineer, wo.id);
    await putOnHold(A.engineer, wo.id, "Parts", "Waiting for a washer");
    expect((await prisma.workOrder.findUniqueOrThrow({ where: { id: wo.id } })).status).toBe("ON_HOLD");
    await resumeFromHold(A.engineer, wo.id);
    await changeStatus({ workOrderId: wo.id, actor: A.engineer, status: "IN_PROGRESS" });
    await changeStatus({ workOrderId: wo.id, actor: A.engineer, status: "RESOLVED", note: "Replaced washer" });
    await expectError(verifyWorkOrder(A.engineer, wo.id, { rating: 5 }), "FORBIDDEN");
    await expectError(verifyWorkOrder(A.resident, wo.id, { rating: 9 }), "VALIDATION");
    await verifyWorkOrder(A.resident, wo.id, { rating: 4, comment: "Good" });
    const verified = await prisma.workOrder.findUniqueOrThrow({ where: { id: wo.id } });
    expect(verified.status).toBe("VERIFIED");
    expect(verified.rating).toBe(4);
    await prisma.workOrder.update({ where: { id: wo.id }, data: { autoCloseAt: new Date(Date.now() - 1000) } });
    expect(await sweepWorkOrders()).toBeGreaterThanOrEqual(1);
    expect((await prisma.workOrder.findUniqueOrThrow({ where: { id: wo.id } })).status).toBe("CLOSED");
  });

  it("lets an Officer verify only for a vacant room", async () => {
    const wo = await newOrder({ assign: true });
    await changeStatus({ workOrderId: wo.id, actor: A.engineer, status: "IN_PROGRESS" });
    await changeStatus({ workOrderId: wo.id, actor: A.engineer, status: "RESOLVED", note: "Done" });
    await verifyWorkOrder(A.officer, wo.id, { rating: 5 }); // room MNX-R1 has nobody checked in
    expect((await prisma.workOrder.findUniqueOrThrow({ where: { id: wo.id } })).status).toBe("VERIFIED");
  });
});

describe("parts, labour and permits", () => {
  it("records labour, root cause and a part by name", async () => {
    const wo = await newOrder({ assign: true });
    await recordWork(A.engineer, wo.id, { laborHours: 1.5, rootCause: "Worn washer" });
    await addPart(A.engineer, wo.id, { name: "Washer", quantity: 2, unitCost: 3 });
    const row = await prisma.workOrder.findUniqueOrThrow({ where: { id: wo.id } });
    expect(Number(row.laborHours)).toBe(1.5);
    expect(await prisma.workOrderPart.count({ where: { workOrderId: wo.id } })).toBe(1);
    await expectError(addPart(A.resident, wo.id, { name: "x", quantity: 1 }), "FORBIDDEN");
  });

  it("blocks starting a high-risk job until another person approves the permit", async () => {
    const wo = await newOrder({ assign: true });
    const permit = await requestPermit(A.engineer, wo.id, { type: "Work at height", hazards: "Fall" });
    await expectError(changeStatus({ workOrderId: wo.id, actor: A.engineer, status: "IN_PROGRESS" }), "INVALID_TRANSITION");
    await expectError(decidePermit(A.engineer, permit.id, true), "FORBIDDEN");
    await expectError(decidePermit(A.coordinator, permit.id, false), "NOTE_REQUIRED");
    await decidePermit(A.coordinator, permit.id, true);
    await changeStatus({ workOrderId: wo.id, actor: A.engineer, status: "IN_PROGRESS" });
  });
});

describe("preventive schedules", () => {
  it("raises a work order when due and rolls the schedule forward", async () => {
    await expectError(createSchedule(A.engineer, orgId, { title: "x", category: "Electrical", frequencyDays: 30, firstDue: "2026-01-01", siteId }), "FORBIDDEN");
    const s = await createSchedule(A.coordinator, orgId, { title: `Fire panel check ${stamp}`, category: "Electrical", frequencyDays: 30, firstDue: new Date(Date.now() - 86400000).toISOString().slice(0, 10), siteId, roomId: null, assigneeId: A.engineer.id });
    expect(await runPreventive()).toBeGreaterThanOrEqual(1);
    const generated = await prisma.workOrder.findFirst({ where: { preventiveScheduleId: s.id } });
    expect(generated?.source).toBe("PREVENTIVE");
    expect(generated?.status).toBe("ASSIGNED");
    const after = await prisma.preventiveSchedule.findUniqueOrThrow({ where: { id: s.id } });
    expect(after.nextDueAt.getTime()).toBeGreaterThan(Date.now());
  });
});

describe("vendor lifecycle and contractor access", () => {
  it("creates pending, approves, suspends with reasons, and protects open work on termination", async () => {
    await expectError(createVendor(A.coordinator, orgId, { name: "No grant" }), "FORBIDDEN"); // Coordinator needs the grant
    const granted: Actor = { ...A.coordinator, grants: [{ capability: "maint.vendor_create", userId: A.coordinator.id }] };
    const v = await createVendor(granted, orgId, { name: `Cool Air ${stamp}`, contractEnd: "2099-01-01" });
    expect(v.state).toBe("PENDING_APPROVAL"); // an Admin approves
    await expectError(approveVendor(A.coordinator, v.id), "FORBIDDEN");
    await approveVendor(A.admin, v.id);
    await expectError(suspendVendor(A.admin, v.id, ""), "NOTE_REQUIRED");
    const wo = await newOrder();
    await prisma.workOrder.update({ where: { id: wo.id }, data: { vendorId: v.id, status: "ASSIGNED" } });
    await expectError(terminateVendor(A.admin, v.id, "Poor service"), "INVALID_TRANSITION");
    await prisma.workOrder.update({ where: { id: wo.id }, data: { status: "CANCELLED" } });
    await suspendVendor(A.admin, v.id, "Insurance lapsed");
    expect((await prisma.vendor.findUniqueOrThrow({ where: { id: v.id } })).state).toBe("SUSPENDED");
  });

  it("allows contractor access only when contract, documents, worker, job and window are all valid", async () => {
    const v = await createVendor(A.admin, orgId, { name: `Spark Co ${stamp}`, contractEnd: "2099-01-01" });
    const worker = await addWorker(A.admin, v.id, { name: "Ravi", idNumber: "784-1" });
    const wo = await newOrder();
    await prisma.workOrder.update({ where: { id: wo.id }, data: { vendorId: v.id, status: "ASSIGNED" } });
    const start = new Date(Date.now() + 3600_000), end = new Date(Date.now() + 7200_000);
    let check = await contractorAccessCheck({ vendorId: v.id, workerIds: [worker.id], workOrderId: wo.id, start, end });
    expect(check.ok).toBe(false); // worker not verified yet
    await verifyWorker(A.admin, worker.id, true);
    check = await contractorAccessCheck({ vendorId: v.id, workerIds: [worker.id], workOrderId: wo.id, start, end });
    expect(check).toEqual({ ok: true, reasons: [] });
    await addVendorDocument(A.admin, v.id, { kind: "INSURANCE", expiresAt: "2000-01-01" });
    check = await contractorAccessCheck({ vendorId: v.id, workerIds: [worker.id], workOrderId: wo.id, start, end });
    expect(check.ok).toBe(false);
    expect(check.reasons.join(" ")).toMatch(/insurance/i);
    await expectError(scheduleVisit(A.coordinator, { workOrderId: wo.id, vendorId: v.id, workerIds: [worker.id], start: start.toISOString(), end: end.toISOString() }));
    // Suspending the vendor ends access: workers suspended, pending visits cancelled.
    await prisma.vendorDocument.deleteMany({ where: { vendorId: v.id } });
    const visit = await scheduleVisit(A.coordinator, { workOrderId: wo.id, vendorId: v.id, workerIds: [worker.id], start: start.toISOString(), end: end.toISOString() });
    await suspendVendor(A.admin, v.id, "Contract dispute");
    expect((await prisma.contractorVisit.findUniqueOrThrow({ where: { id: visit.id } })).status).toBe("CANCELLED");
    expect((await prisma.contractorWorker.findUniqueOrThrow({ where: { id: worker.id } })).status).toBe("SUSPENDED");
  });

  it("reports expiring contracts and documents and marks lapsed vendors expired", async () => {
    const soon = new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10);
    const v = await createVendor(A.admin, orgId, { name: `Soon ${stamp}`, contractEnd: soon });
    const gone = await createVendor(A.admin, orgId, { name: `Gone ${stamp}`, contractEnd: "2099-01-01" });
    await prisma.vendor.update({ where: { id: gone.id }, data: { contractEnd: new Date("2020-01-01") } });
    expect((await vendorCompliance()).some((c) => c.vendorId === v.id && c.what === "Contract")).toBe(true);
    await sweepVendors();
    expect((await prisma.vendor.findUniqueOrThrow({ where: { id: gone.id } })).state).toBe("EXPIRED");
    await setRate(A.admin, v.id, { category: "Electrical", rate: 80 });
    expect(await prisma.vendorRate.count({ where: { vendorId: v.id, active: true } })).toBe(1);
  }, 60_000);
});
