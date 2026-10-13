import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Role } from "@prisma/client";
import { prisma } from "../src/lib/db";
import type { ActorLike } from "../src/lib/permissions/actor";
import { KeyError } from "../src/modules/keys/errors";
import { InventoryError } from "../src/modules/inventory/errors";
import { registerKey, returnKey } from "../src/modules/keys/service";
import { bulkCreateKeys, completeKeyAudit, completeLoss, decideLoss, issueKeyAs, keyHistory, reportLoss, setSensitive, startKeyAudit } from "../src/modules/keys/extras";
import { createItem } from "../src/modules/inventory/service";
import { adjustWithinLimit, decideWriteOff, goodsIn, moveToStore, requestWriteOff } from "../src/modules/inventory/extras";
import { assignWorkOrder, changeStatus, createWorkOrder } from "../src/modules/maintenance/service";

const stamp = Date.now().toString(36);
let orgId: string, siteId: string, roomId: string, buildingId: string, staffId: string;
const A: Record<string, ActorLike> = {};

async function mk(key: string, roles: Role[], sets: string[] = []) {
  const u = await prisma.user.create({ data: { organizationId: orgId, email: `ki-${key}-${stamp}@example.com`, name: key, status: "ACTIVE", username: `ki_${key}_${stamp}` } });
  for (const role of roles) await prisma.roleAssignment.create({ data: { userId: u.id, role } });
  A[key] = { id: u.id, roles, grants: sets.map((capabilitySet) => ({ capabilitySet, userId: u.id })) };
}
async function expectCode<T>(p: Promise<T>, cls: typeof KeyError | typeof InventoryError, code?: string) {
  try { await p; } catch (e) { expect(e).toBeInstanceOf(cls); if (code) expect((e as KeyError).code).toBe(code); return; }
  throw new Error("expected error");
}

beforeAll(async () => {
  const org = await prisma.organization.upsert({ where: { code: "TEST" }, update: {}, create: { code: "TEST", name: "Test Org" } });
  orgId = org.id;
  const site = await prisma.site.upsert({ where: { organizationId_code: { organizationId: orgId, code: "KIX" } }, update: {}, create: { organizationId: orgId, code: "KIX", name: "KI Site", timezone: "UTC" } });
  siteId = site.id;
  const b = await prisma.building.upsert({ where: { siteId_code: { siteId, code: "KIX-B" } }, update: {}, create: { siteId, code: "KIX-B", name: "KI Block" } });
  buildingId = b.id;
  roomId = (await prisma.room.upsert({ where: { buildingId_code: { buildingId, code: "KIX-1" } }, update: {}, create: { buildingId, code: "KIX-1" } })).id;
  staffId = (await prisma.staffProfile.create({ data: { organizationId: orgId, employeeId: `KI-${stamp}`, firstName: "Holder", lastName: "One" } })).id;
  await prisma.keyTransaction.updateMany({ where: { key: { siteId }, type: "ISSUE", returnedAt: null }, data: { returnedAt: new Date() } });
  await prisma.key.updateMany({ where: { siteId, status: { not: "RETIRED" } }, data: { status: "RETIRED" } });
  await mk("admin", ["ACCOMMODATION_ADMIN"]);
  await mk("super", ["SYSTEM_ADMIN"]);
  await mk("officer", ["ACCOMMODATION_OFFICER"]);
  await mk("sup", ["ACCOMMODATION_OFFICER"], ["KEY_SUPERVISOR", "INVENTORY_SUPERVISOR"]);
  await mk("tech", ["TECHNICIAN"]);
  await mk("coord", ["MAINTENANCE_COORDINATOR"]);
  await mk("resident", ["STAFF"]);
});

afterAll(async () => { await prisma.$disconnect(); });

describe("keys: sensitive, job and emergency keys", () => {
  it("lets only a Key supervisor or Admin issue a sensitive key", async () => {
    const key = await registerKey({ siteId, code: `S-${stamp}`, roomId, actorId: A.admin.id });
    await setSensitive(A.admin, key.id, true);
    await expectCode(setSensitive(A.officer, key.id, false), KeyError, "FORBIDDEN");
    await expectCode(issueKeyAs(A.officer, { keyId: key.id, holderStaffId: staffId }), KeyError, "FORBIDDEN");
    const t = await issueKeyAs(A.sup, { keyId: key.id, holderStaffId: staffId });
    expect(t.type).toBe("ISSUE");
    await expectCode(keyHistory(A.officer, key.id), KeyError, "FORBIDDEN");
    expect((await keyHistory(A.sup, key.id)).length).toBeGreaterThan(0);
    await returnKey({ keyId: key.id, actorId: A.sup.id });
  });

  it("gives a technician job keys only for a room where they hold an open job", async () => {
    const key = await registerKey({ siteId, code: `J-${stamp}`, roomId, actorId: A.admin.id });
    await expectCode(issueKeyAs(A.tech, { keyId: key.id, holderName: "Tech" }), KeyError, "FORBIDDEN");
    const wo = await createWorkOrder({ requesterId: A.resident.id, roomId, category: "Doors and locks", description: "Door handle is loose", priority: "LOW" });
    await assignWorkOrder({ workOrderId: wo.id, actor: A.coord, assigneeId: A.tech.id });
    await issueKeyAs(A.tech, { keyId: key.id, holderName: "Tech" });
    await changeStatus({ workOrderId: wo.id, actor: A.tech, status: "IN_PROGRESS" });
  });

  it("requires an Admin and a reason for emergency keys", async () => {
    const key = await registerKey({ siteId, code: `E-${stamp}`, roomId, actorId: A.admin.id });
    await prisma.key.update({ where: { id: key.id }, data: { cabinet: "EMERGENCY box" } });
    await expectCode(issueKeyAs(A.officer, { keyId: key.id, holderName: "x", notes: "fire" }), KeyError, "FORBIDDEN");
    await expectCode(issueKeyAs(A.admin, { keyId: key.id, holderName: "x" }), KeyError, "VALIDATION");
    await issueKeyAs(A.admin, { keyId: key.id, holderName: "x", notes: "Fire drill" });
  });
});

describe("keys: loss approval, audit and bulk creation", () => {
  it("runs report -> approve (lock-change order) -> replace", async () => {
    const key = await registerKey({ siteId, code: `L-${stamp}`, roomId, actorId: A.admin.id });
    const c = await reportLoss(A.officer, key.id, "Dropped in the car park");
    await expectCode(decideLoss(A.officer, c.id, true), KeyError, "FORBIDDEN"); // no loss_approve default for officers
    const approved = await decideLoss(A.admin, c.id, true);
    expect(approved.status).toBe("LOCK_CHANGE_ORDERED");
    await expectCode(completeLoss(A.admin, c.id, `L2-${stamp}`), KeyError, "INVALID_STATE"); // lock change not finished
    await prisma.workOrder.update({ where: { id: approved.workOrderId! }, data: { status: "CLOSED" } });
    const replacement = await completeLoss(A.admin, c.id, `L2-${stamp}`);
    expect(replacement.replacesKeyId).toBe(key.id);
    expect((await prisma.keyLossCase.findUniqueOrThrow({ where: { id: c.id } })).status).toBe("CLOSED");
  });

  it("reconciles a key audit and reports missing and unexpected keys", async () => {
    await prisma.key.updateMany({ where: { siteId, status: { not: "RETIRED" } }, data: { status: "RETIRED" } });
    const k1 = await registerKey({ siteId, code: `A1-${stamp}`, roomId, actorId: A.admin.id });
    await registerKey({ siteId, code: `A2-${stamp}`, roomId, actorId: A.admin.id });
    await expectCode(startKeyAudit(A.resident, siteId), KeyError, "FORBIDDEN");
    const audit = await startKeyAudit(A.admin, siteId);
    const done = await completeKeyAudit(A.admin, audit.id, [k1.code, `ZZ-${stamp}`]);
    const v = done.variances as { missing: string[]; unexpected: Array<{ code: string }> };
    expect(v.missing).toEqual([`A2-${stamp}`]);
    expect(v.unexpected[0].code).toBe(`ZZ-${stamp}`);
  });

  it("creates copies per room in bulk without duplicating", async () => {
    const first = await bulkCreateKeys(A.admin, { siteId, buildingId, copies: 2, prefix: `B${stamp}-` });
    expect(first.created).toBe(first.rooms * 2);
    const again = await bulkCreateKeys(A.admin, { siteId, buildingId, copies: 2, prefix: `B${stamp}-` });
    expect(again.created).toBe(0);
    await expectCode(bulkCreateKeys(A.officer, { siteId, copies: 1 }), KeyError, "FORBIDDEN");
  });
});

describe("inventory: goods in, adjustments, write-offs", () => {
  async function stock(qty: number, unitValue: number) {
    const item = await createItem({ siteId, sku: `SKU-${Math.random().toString(36).slice(2, 8)}`, name: "Bulb", category: "Electrical", trackingType: "STOCK", openingQuantity: qty, actorId: A.admin.id });
    await prisma.inventoryItem.update({ where: { id: item.id }, data: { unitValue } });
    return item;
  }

  it("gates goods in and store transfers to the supervisor, and adjustments to a limit", async () => {
    const item = await stock(10, 5);
    await expectCode(goodsIn(A.officer, { itemId: item.id, quantity: 5 }), InventoryError, "FORBIDDEN");
    await goodsIn(A.sup, { itemId: item.id, quantity: 5 });
    await moveToStore(A.sup, item.id, "Store B");
    expect((await prisma.inventoryItem.findUniqueOrThrow({ where: { id: item.id } })).store).toBe("Store B");
    await adjustWithinLimit(A.sup, { itemId: item.id, countedQuantity: 14, reason: "Recount" });
    await expectCode(adjustWithinLimit(A.sup, { itemId: item.id, countedQuantity: 100, reason: "Big" }), InventoryError, "FORBIDDEN");
    await adjustWithinLimit(A.admin, { itemId: item.id, countedQuantity: 100, reason: "Delivery found" });
  });

  it("routes write-offs to an Admin, and above the value limit to a Super Admin", async () => {
    const small = await stock(10, 5);
    const w1 = await requestWriteOff(A.sup, { itemId: small.id, quantity: 2, reason: "Broken" });
    expect(w1.needsSuperAdmin).toBe(false);
    await expectCode(decideWriteOff(A.sup, w1.id, true), InventoryError, "FORBIDDEN");
    await decideWriteOff(A.admin, w1.id, true);
    expect((await prisma.inventoryItem.findUniqueOrThrow({ where: { id: small.id } })).quantity).toBe(8);

    const big = await stock(10, 500);
    const w2 = await requestWriteOff(A.sup, { itemId: big.id, quantity: 5, reason: "Flood damage" });
    expect(w2.needsSuperAdmin).toBe(true);
    await expectCode(decideWriteOff(A.admin, w2.id, true), InventoryError, "FORBIDDEN");
    await decideWriteOff(A.super, w2.id, true);
    expect((await prisma.inventoryItem.findUniqueOrThrow({ where: { id: big.id } })).quantity).toBe(5);
  });
});
