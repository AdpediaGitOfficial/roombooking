import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Role } from "@prisma/client";
import { prisma } from "../src/lib/db";
import type { ActorLike } from "../src/lib/permissions/actor";
import { HousekeepingError, assignTask, completeTask, createAdhocTask, inspectionChecklist, listCleaningTasks, performInspection, runInspectionSchedules, scheduleInspections, startTask } from "../src/modules/housekeeping/service";
import { ChargeError, decideCharge, exportCharges, listCharges, myCharges, raiseCharge, setRate } from "../src/modules/charges/service";
import { reportLoss, decideLoss } from "../src/modules/keys/extras";
import { issueKey, registerKey } from "../src/modules/keys/service";

const stamp = Date.now().toString(36);
let orgId: string, siteId: string, roomId: string, bedId: string, staffId: string, staffUserId: string;
const A: Record<string, ActorLike> = {};

async function mk(key: string, roles: Role[], sets: string[] = []) {
  const u = await prisma.user.create({ data: { organizationId: orgId, email: `hk-${key}-${stamp}@example.com`, name: key, status: "ACTIVE", username: `hk_${key}_${stamp}` } });
  for (const role of roles) await prisma.roleAssignment.create({ data: { userId: u.id, role } });
  A[key] = { id: u.id, roles, grants: sets.map((capabilitySet) => ({ capabilitySet, userId: u.id })) };
  return u;
}
async function expectErr<T>(p: Promise<T>, cls: typeof HousekeepingError | typeof ChargeError, code?: string) {
  try { await p; } catch (e) { expect(e).toBeInstanceOf(cls); if (code) expect((e as HousekeepingError).code).toBe(code); return; }
  throw new Error("expected error");
}

beforeAll(async () => {
  const org = await prisma.organization.upsert({ where: { code: "TEST" }, update: {}, create: { code: "TEST", name: "Test Org" } });
  orgId = org.id;
  const site = await prisma.site.create({ data: { organizationId: orgId, code: `HK${stamp}`.slice(0, 12), name: "HK Site", timezone: "UTC" } });
  siteId = site.id;
  const b = await prisma.building.create({ data: { siteId, code: `HKB${stamp}`.slice(0, 12), name: "HK Block" } });
  const room = await prisma.room.create({ data: { buildingId: b.id, code: "HK-1" } });
  roomId = room.id;
  bedId = (await prisma.bed.create({ data: { roomId, code: "HK-1-1", readiness: "NEEDS_CLEANING" } })).id;
  await mk("admin", ["ACCOMMODATION_ADMIN"]);
  await mk("admin2", ["ACCOMMODATION_ADMIN"]);
  await mk("super", ["SYSTEM_ADMIN"]);
  await mk("officer", ["ACCOMMODATION_OFFICER"]);
  await mk("cleaner", ["TECHNICIAN"]);
  await mk("cleaner2", ["TECHNICIAN"]);
  await mk("coord", ["MAINTENANCE_COORDINATOR"]);
  await mk("resident", ["STAFF"]);
  staffUserId = A.resident.id;
  staffId = (await prisma.staffProfile.create({ data: { organizationId: orgId, employeeId: `HK-${stamp}`, firstName: "Charge", lastName: "Payee", userId: staffUserId, verificationStatus: "VERIFIED" } })).id;
});

afterAll(async () => { await prisma.$disconnect(); });

describe("cleaning tasks", () => {
  it("lets housekeeping start and complete their own task, marking the bed ready", async () => {
    const t = await createAdhocTask(A.officer, { siteId, roomId, notes: "Deep clean" });
    await prisma.cleaningTask.update({ where: { id: t.id }, data: { bedId } });
    await expectErr(createAdhocTask(A.cleaner, { siteId, roomId }), HousekeepingError, "FORBIDDEN");
    await assignTask(A.officer, t.id, A.cleaner.id);
    await expectErr(startTask(A.cleaner2, t.id), HousekeepingError, "FORBIDDEN");
    await startTask(A.cleaner, t.id);
    await completeTask(A.cleaner, t.id, "Done");
    expect((await prisma.bed.findUniqueOrThrow({ where: { id: bedId } })).readiness).toBe("READY");
    expect((await listCleaningTasks(A.cleaner, { siteIds: [siteId], status: "done" })).some((x) => x.id === t.id)).toBe(true);
  });
});

describe("inspections", () => {
  it("creates inspections from a schedule and turns failed items into work orders", async () => {
    await expectErr(scheduleInspections(A.officer, { siteId, title: "Quarterly", frequencyDays: 90, firstDue: "2026-01-01" }), HousekeepingError, "FORBIDDEN");
    const s = await scheduleInspections(A.admin, { siteId, roomId, title: `Quarterly ${stamp}`, frequencyDays: 90, firstDue: new Date().toISOString().slice(0, 10) });
    expect(await runInspectionSchedules()).toBeGreaterThanOrEqual(1);
    const insp = await prisma.inspection.findFirstOrThrow({ where: { scheduleId: s.id } });
    const list = await inspectionChecklist(orgId, insp.templateId, siteId);
    const answers = list.items.map((i, n) => ({ id: i.id, ok: n !== 2, note: n === 2 ? "Socket sparks" : undefined }));
    await expectErr(performInspection(A.resident, insp.id, answers), HousekeepingError, "FORBIDDEN");
    await expectErr(performInspection(A.admin, insp.id, list.items.map((i) => ({ id: i.id, ok: false }))), HousekeepingError, "VALIDATION");
    const r = await performInspection(A.admin, insp.id, answers);
    expect(r.inspection.status).toBe("ISSUES_FOUND");
    expect(r.workOrderIds).toHaveLength(1);
    const wo = await prisma.workOrder.findUniqueOrThrow({ where: { id: r.workOrderIds[0] } });
    expect(wo.source).toBe("INSPECTION");
    expect(wo.inspectionId).toBe(insp.id);
    expect(wo.category).toBe("Electrical");
  });
});

describe("charges", () => {
  it("records a charge from a rate, needs a different Admin to approve and exports it once", async () => {
    await expectErr(setRate(A.admin, orgId, { kind: "DAMAGE", code: "DOOR", name: "Door repair", amount: 150 }), ChargeError, "FORBIDDEN"); // needs the grant
    const granted: ActorLike = { ...A.admin, grants: [{ capabilitySet: "ADMIN_OVERRIDES", userId: A.admin.id }] };
    await setRate(granted, orgId, { kind: "DAMAGE", code: `DOOR${stamp}`, name: "Door repair", amount: 150 });
    const c = await raiseCharge(A.officer, { staffId, siteId, kind: "DAMAGE", description: "Broken door", rateCode: `DOOR${stamp}`, quantity: 2 });
    expect(Number(c.amount)).toBe(300);
    expect(c.status).toBe("PENDING_APPROVAL");
    await expectErr(raiseCharge(A.resident, { staffId, kind: "DAMAGE", description: "x", amount: 1 }), ChargeError, "FORBIDDEN");
    await expectErr(decideCharge(A.officer, c.id, "approve"), ChargeError, "FORBIDDEN");
    await expectErr(decideCharge(A.admin, c.id, "reject"), ChargeError, "VALIDATION");
    expect((await myCharges(staffId)).length).toBe(1);
    await decideCharge(A.admin, c.id, "approve");
    expect(await prisma.notification.count({ where: { recipientId: staffUserId, event: "charge.approved", channel: "IN_APP" } })).toBe(1);
    const self = await raiseCharge(A.admin, { staffId, kind: "OTHER", description: "Late fee", amount: 20 });
    await expectErr(decideCharge(A.admin, self.id, "approve"), ChargeError, "FORBIDDEN"); // recorder cannot approve
    await decideCharge(A.admin2, self.id, "approve");
    const { batch, csv } = await exportCharges(A.admin, orgId, "2026-10");
    expect(batch.rowCount).toBeGreaterThanOrEqual(2);
    expect(csv).toContain("Broken door");
    expect((await listCharges({ filter: "exported", staffId })).length).toBe(2);
    await expectErr(exportCharges(A.admin, orgId, "2026-10"), ChargeError, "INVALID_STATE"); // nothing left to export
  });

  it("charges a contractor's lost key to the vendor, not a resident", async () => {
    const vendor = await prisma.vendor.create({ data: { organizationId: orgId, name: `Key Loser ${stamp}` } });
    await prisma.rate.upsert({ where: { organizationId_kind_code_siteId: { organizationId: orgId, kind: "DAMAGE", code: "KEY_LOSS", siteId: null as never } }, update: { active: true, amount: 75 }, create: { organizationId: orgId, kind: "DAMAGE", code: "KEY_LOSS", name: "Lost key", amount: 75 } }).catch(async () => {
      const ex = await prisma.rate.findFirst({ where: { organizationId: orgId, code: "KEY_LOSS", siteId: null } });
      if (!ex) await prisma.rate.create({ data: { organizationId: orgId, kind: "DAMAGE", code: "KEY_LOSS", name: "Lost key", amount: 75 } });
    });
    const key = await registerKey({ siteId, code: `K-${stamp}`, roomId, actorId: A.admin.id });
    await issueKey({ keyId: key.id, actorId: A.admin.id, holderName: "Contractor Joe", holderVendorId: vendor.id });
    const lc = await reportLoss(A.officer, key.id, "Lost on site");
    const decided = await decideLoss(A.admin, lc.id, true);
    expect(decided.decisionNote ?? "").toContain("vendor");
    const charges = await listCharges({ filter: "all", vendorId: vendor.id });
    expect(charges).toHaveLength(1);
    expect(charges[0].staffId).toBeNull();
    expect(Number(charges[0].amount)).toBe(75);
  });
});
