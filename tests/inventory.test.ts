import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { InventoryError } from "@/modules/inventory/errors";
import { adjustStock, allocatedReport, conditionReport, createItem, getItem, inventorySummary, isLowStock, issueItem, itemsHeldBy, listItems, movementCsv, movementReport, receiveStock, recordDamage, retireItem, returnItem, stockBalanceReport, transferItem, updateItem } from "@/modules/inventory/service";
import { clearanceBlockers } from "@/modules/allocations/service";

let siteId: string;
let site2Id: string;
let roomId: string;
let facilityId: string;
let actorId: string;
let staffId: string;
const stamp = Date.now().toString(36).toUpperCase();
const uniq = (p: string) => `${p}-${stamp}`;

async function expectError<T>(p: Promise<T>, code: string) {
  try { await p; } catch (e) {
    expect(e).toBeInstanceOf(InventoryError);
    expect((e as InventoryError).code).toBe(code);
    return e as InventoryError;
  }
  throw new Error(`expected InventoryError ${code}`);
}

beforeAll(async () => {
  const org = await prisma.organization.upsert({ where: { code: "TEST" }, update: {}, create: { code: "TEST", name: "Test Org" } });
  actorId = (await prisma.user.upsert({ where: { email: "inv-custodian@example.com" }, update: { status: "ACTIVE" }, create: { organizationId: org.id, email: "inv-custodian@example.com", name: "Inventory Custodian", status: "ACTIVE" } })).id;
  siteId = (await prisma.site.upsert({ where: { organizationId_code: { organizationId: org.id, code: "INV" } }, update: {}, create: { organizationId: org.id, code: "INV", name: "Inventory Site", timezone: "UTC" } })).id;
  site2Id = (await prisma.site.upsert({ where: { organizationId_code: { organizationId: org.id, code: "INV2" } }, update: {}, create: { organizationId: org.id, code: "INV2", name: "Second Site", timezone: "UTC" } })).id;
  const building = await prisma.building.upsert({ where: { siteId_code: { siteId, code: "IB" } }, update: {}, create: { siteId, code: "IB", name: "Inventory Block" } });
  roomId = (await prisma.room.upsert({ where: { buildingId_code: { buildingId: building.id, code: "IB-R1" } }, update: {}, create: { buildingId: building.id, code: "IB-R1" } })).id;
  facilityId = (await prisma.facility.upsert({ where: { siteId_code: { siteId, code: "INV-GYM" } }, update: {}, create: { siteId, code: "INV-GYM", name: "Inventory Gym", capacity: 5 } })).id;
  staffId = (await prisma.staffProfile.upsert({ where: { organizationId_employeeId: { organizationId: org.id, employeeId: "INV-1" } }, update: { employmentStatus: "ACTIVE" }, create: { organizationId: org.id, employeeId: "INV-1", firstName: "Item", lastName: "Holder" } })).id;
});

afterAll(async () => { await prisma.$disconnect(); });

describe("items", () => {
  it("creates stock lines with an opening balance and assets one by one; rejects duplicates", async () => {
    const sku = uniq("PILLOW");
    const stock = await createItem({ siteId, sku, name: "Pillow", category: "Bedding", trackingType: "STOCK", reorderThreshold: 5, openingQuantity: 10, actorId });
    expect(stock.quantity).toBe(10);
    expect(stock.sku).toBe(sku);
    await expectError(createItem({ siteId, sku: sku.toLowerCase(), name: "Pillow", category: "Bedding", trackingType: "STOCK", actorId }), "VALIDATION");
    await expectError(createItem({ siteId, sku: uniq("X"), name: "", category: "Bedding", trackingType: "STOCK", actorId }), "VALIDATION");
    await expectError(createItem({ siteId, sku: uniq("TV"), name: "Television", category: "Electronics", trackingType: "SERIALIZED", actorId }), "VALIDATION");
    const tv = await createItem({ siteId, sku: uniq("TV"), name: "Television 32\"", category: "Electronics", trackingType: "SERIALIZED", serialNumber: uniq("SN"), condition: "NEW", actorId });
    expect(tv.quantity).toBe(1);
    const err = await expectError(createItem({ siteId, sku: uniq("TV2"), name: "Television", category: "Electronics", trackingType: "SERIALIZED", serialNumber: tv.serialNumber, actorId }), "VALIDATION");
    expect(err.fieldErrors.serialNumber).toBeTruthy();
    const detail = (await getItem(stock.id))!;
    expect(detail.transactions[0].type).toBe("RECEIPT");
    expect(detail.transactions[0].balanceAfter).toBe(10);
  });

  it("updates details and flags low stock against the threshold", async () => {
    const sku = uniq("SOAP");
    const item = await createItem({ siteId, sku, name: "Soap bar", category: "Toiletries", trackingType: "STOCK", reorderThreshold: 20, openingQuantity: 15, actorId });
    expect(isLowStock(item)).toBe(true);
    const updated = await updateItem({ itemId: item.id, actorId, name: "Soap bar 100g", category: "Toiletries", reorderThreshold: 10, storageLocation: "Store room B" });
    expect(updated.name).toBe("Soap bar 100g");
    expect(isLowStock(updated)).toBe(false);
    expect((await listItems({ filter: "low", siteId })).some((i) => i.id === item.id)).toBe(false);
    await receiveStock({ itemId: item.id, actorId, quantity: 5, reference: "PO-1" });
    expect((await listItems({ q: "soap", siteId }))[0].quantity).toBe(20);
    expect((await inventorySummary(siteId)).stockLines).toBeGreaterThanOrEqual(2);
  });
});

describe("movements", () => {
  it("issues and returns stock to rooms and residents, never below zero, and only what is outstanding", async () => {
    const item = await createItem({ siteId, sku: uniq("TOWEL"), name: "Bath towel", category: "Linen", trackingType: "STOCK", openingQuantity: 6, actorId });
    await issueItem({ itemId: item.id, actorId, quantity: 4, target: { roomId } });
    await issueItem({ itemId: item.id, actorId, quantity: 2, target: { staffId } });
    const e = await expectError(issueItem({ itemId: item.id, actorId, quantity: 1, target: { roomId } }), "INSUFFICIENT_STOCK");
    expect(e.message).toContain("Only 0");
    await expectError(issueItem({ itemId: item.id, actorId, quantity: 1, target: {} }), "VALIDATION");
    await expectError(issueItem({ itemId: item.id, actorId, quantity: 1, target: { roomId, staffId } }), "VALIDATION");
    const detail = (await getItem(item.id))!;
    expect(detail.item.quantity).toBe(0);
    expect(detail.outstanding.map((o) => o.quantity).sort()).toEqual([2, 4]);
    // Return more than outstanding at a target is refused
    await expectError(returnItem({ itemId: item.id, actorId, quantity: 5, target: { roomId } }), "VALIDATION");
    await returnItem({ itemId: item.id, actorId, quantity: 3, target: { roomId } });
    // Return damaged: comes back and is written off in the same transaction
    await returnItem({ itemId: item.id, actorId, quantity: 1, target: { roomId }, condition: "DAMAGED" });
    const after = (await getItem(item.id))!;
    expect(after.item.quantity).toBe(3);
    expect(after.transactions.map((t) => t.type).slice(0, 2)).toEqual(["DAMAGE", "RETURN"]);
    expect(after.outstanding).toEqual([expect.objectContaining({ staffId, quantity: 2 })]);
    const held = await itemsHeldBy({ staffId });
    expect(held.find((h) => h.itemId === item.id)?.quantity).toBe(2);
    expect((await clearanceBlockers(staffId)).some((b) => b.label === "2 × Bath towel")).toBe(true);
    await returnItem({ itemId: item.id, actorId, quantity: 2, target: { staffId } });
    expect((await clearanceBlockers(staffId)).some((b) => b.label.includes("Bath towel"))).toBe(false);
  });

  it("lets only one of two concurrent issues take the last units", async () => {
    const item = await createItem({ siteId, sku: uniq("KETTLE"), name: "Kettle", category: "Appliances", trackingType: "STOCK", openingQuantity: 3, actorId });
    const results = await Promise.allSettled([
      issueItem({ itemId: item.id, actorId, quantity: 2, target: { roomId } }),
      issueItem({ itemId: item.id, actorId, quantity: 2, target: { facilityId } }),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(((results.find((r) => r.status === "rejected") as PromiseRejectedResult).reason as InventoryError).code).toBe("INSUFFICIENT_STOCK");
    expect((await prisma.inventoryItem.findUniqueOrThrow({ where: { id: item.id } })).quantity).toBe(1);
  });

  it("assigns a serialised asset once, blocks check-out while held, returns it with a condition and refuses to issue it damaged", async () => {
    const tv = await createItem({ siteId, sku: uniq("FRIDGE"), name: "Mini fridge", category: "Appliances", trackingType: "SERIALIZED", serialNumber: uniq("FR"), actorId });
    await issueItem({ itemId: tv.id, actorId, target: { staffId } });
    await expectError(issueItem({ itemId: tv.id, actorId, target: { roomId } }), "INVALID_STATE");
    expect((await prisma.inventoryItem.findUniqueOrThrow({ where: { id: tv.id } })).quantity).toBe(0);
    expect((await clearanceBlockers(staffId)).some((b) => b.label === `Mini fridge #${tv.serialNumber}`)).toBe(true);
    await expectError(retireItem({ itemId: tv.id, actorId, notes: "old" }), "INVALID_STATE");
    await expectError(returnItem({ itemId: tv.id, actorId, target: { roomId } }), "VALIDATION");
    await returnItem({ itemId: tv.id, actorId, target: { staffId }, condition: "DAMAGED", notes: "Door seal torn" });
    const detail = (await getItem(tv.id))!;
    expect(detail.item.condition).toBe("DAMAGED");
    expect(detail.item.quantity).toBe(1);
    expect(detail.item.assignments).toHaveLength(0);
    await expectError(issueItem({ itemId: tv.id, actorId, target: { roomId } }), "INVALID_STATE");
    await updateItem({ itemId: tv.id, actorId, name: tv.name, category: tv.category, condition: "FAIR" });
    await issueItem({ itemId: tv.id, actorId, target: { roomId } });
    expect((await itemsHeldBy({ roomId })).some((h) => h.itemId === tv.id)).toBe(true);
    // Two concurrent assignments of the same asset: exactly one wins
    const fresh = await createItem({ siteId, sku: uniq("HEATER"), name: "Heater", category: "Appliances", trackingType: "SERIALIZED", serialNumber: uniq("HT"), actorId });
    const results = await Promise.allSettled([issueItem({ itemId: fresh.id, actorId, target: { roomId } }), issueItem({ itemId: fresh.id, actorId, target: { staffId } })]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(await prisma.assetAssignment.count({ where: { itemId: fresh.id, endedAt: null } })).toBe(1);
  });

  it("adjusts stock to a counted figure with a reason and writes off damage", async () => {
    const item = await createItem({ siteId, sku: uniq("BULB"), name: "LED bulb", category: "Electrical", trackingType: "STOCK", openingQuantity: 40, actorId });
    await expectError(adjustStock({ itemId: item.id, actorId, countedQuantity: 37, reason: "" }), "VALIDATION");
    await expectError(adjustStock({ itemId: item.id, actorId, countedQuantity: 40, reason: "count" }), "VALIDATION");
    const t = await adjustStock({ itemId: item.id, actorId, countedQuantity: 37, reason: "Monthly count" });
    expect(t.quantity).toBe(-3);
    expect(t.balanceAfter).toBe(37);
    await expectError(recordDamage({ itemId: item.id, actorId, quantity: 100, notes: "flood" }), "INSUFFICIENT_STOCK");
    const d = await recordDamage({ itemId: item.id, actorId, quantity: 7, notes: "Water damage in store" });
    expect(d.balanceAfter).toBe(30);
    const audit = await prisma.auditEvent.findFirst({ where: { entityId: item.id, action: "INVENTORY_ADJUSTMENT" } });
    expect(audit).not.toBeNull();
  });

  it("transfers stock between sites, creating the line at the destination, and re-homes assets in store", async () => {
    const item = await createItem({ siteId, sku: uniq("SHEET"), name: "Bed sheet", category: "Linen", trackingType: "STOCK", reorderThreshold: 4, openingQuantity: 12, actorId });
    await expectError(transferItem({ itemId: item.id, actorId, toSiteId: siteId, quantity: 2 }), "VALIDATION");
    await expectError(transferItem({ itemId: item.id, actorId, toSiteId: site2Id, quantity: 20 }), "INSUFFICIENT_STOCK");
    const t = await transferItem({ itemId: item.id, actorId, toSiteId: site2Id, quantity: 5, notes: "Restock second site" });
    expect(t.quantity).toBe(-5);
    const counterpart = await prisma.inventoryItem.findFirstOrThrow({ where: { siteId: site2Id, sku: item.sku, serialNumber: null } });
    expect(counterpart.quantity).toBe(5);
    expect(counterpart.reorderThreshold).toBe(4);
    expect((await prisma.inventoryTransaction.findFirst({ where: { itemId: counterpart.id, type: "TRANSFER" } }))?.counterpartItemId).toBe(item.id);
    await transferItem({ itemId: item.id, actorId, toSiteId: site2Id, quantity: 1 });
    expect((await prisma.inventoryItem.findUniqueOrThrow({ where: { id: counterpart.id } })).quantity).toBe(6);
    const asset = await createItem({ siteId, sku: uniq("LAMP"), name: "Desk lamp", category: "Furniture", trackingType: "SERIALIZED", serialNumber: uniq("LP"), actorId });
    await issueItem({ itemId: asset.id, actorId, target: { facilityId } });
    await expectError(transferItem({ itemId: asset.id, actorId, toSiteId: site2Id }), "INVALID_STATE");
    await returnItem({ itemId: asset.id, actorId, target: { facilityId } });
    await transferItem({ itemId: asset.id, actorId, toSiteId: site2Id });
    expect((await prisma.inventoryItem.findUniqueOrThrow({ where: { id: asset.id } })).siteId).toBe(site2Id);
  });

  it("retires assets and stock lines, refusing while anything is still out, and keeps history", async () => {
    const item = await createItem({ siteId, sku: uniq("MOP"), name: "Mop", category: "Cleaning", trackingType: "STOCK", openingQuantity: 3, actorId });
    await issueItem({ itemId: item.id, actorId, quantity: 1, target: { facilityId } });
    await expectError(retireItem({ itemId: item.id, actorId, notes: "worn" }), "INVALID_STATE");
    await returnItem({ itemId: item.id, actorId, quantity: 1, target: { facilityId } });
    await retireItem({ itemId: item.id, actorId, notes: "Replaced by new model" });
    const retired = await prisma.inventoryItem.findUniqueOrThrow({ where: { id: item.id } });
    expect(retired.status).toBe("INACTIVE");
    expect(retired.quantity).toBe(0);
    await expectError(receiveStock({ itemId: item.id, actorId, quantity: 1 }), "INVALID_STATE");
    await expectError(updateItem({ itemId: item.id, actorId, name: "x", category: "y" }), "INVALID_STATE");
    expect((await listItems({ filter: "retired", siteId })).some((i) => i.id === item.id)).toBe(true);
    await expect(prisma.inventoryTransaction.deleteMany({ where: { itemId: item.id } })).rejects.toThrow(/cannot be deleted/);
  });
});

describe("reports", () => {
  it("reports balances by category, movements with filters and CSV, allocations by location and asset condition", async () => {
    const balance = await stockBalanceReport(siteId);
    expect(balance.find((r) => r.category === "Linen")?.lines).toBeGreaterThanOrEqual(2);
    const moves = await movementReport({ siteId, type: "TRANSFER" });
    expect(moves.length).toBeGreaterThanOrEqual(2);
    expect(moves.every((m) => m.type === "TRANSFER")).toBe(true);
    const today = new Date().toISOString().slice(0, 10);
    expect((await movementReport({ siteId, from: today, to: today })).length).toBeGreaterThan(5);
    expect((await movementReport({ siteId, from: "2000-01-01", to: "2000-01-02" })).length).toBe(0);
    const csv = await movementCsv({ siteId, type: "ADJUSTMENT" }, actorId);
    expect(csv.split("\n")[0]).toContain("Balance after");
    expect(csv).toContain("Monthly count");
    const allocated = await allocatedReport(siteId);
    const room = allocated.find((r) => r.label.includes("IB-R1"));
    expect(room?.items.some((i) => i.name === "Mini fridge")).toBe(true);
    const conditions = await conditionReport(siteId);
    expect(conditions.find((c) => c.condition === "FAIR")?.issued).toBeGreaterThanOrEqual(1);
    const summary = await inventorySummary(siteId);
    expect(summary.issued).toBeGreaterThanOrEqual(2);
  });
});
