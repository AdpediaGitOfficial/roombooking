// Inventory extras from the Roles, Permissions & Module Map (5.5): goods in and store transfers for the Inventory
// supervisor, adjustments within a limit, and write-offs that an Admin (or, above the limit, the Super Admin) approves.
import { prisma } from "../../lib/db";
import { usersWithRoles } from "../../lib/recipients";
import { recordAudit } from "../../lib/audit";
import { enqueueNotification } from "../../lib/notifications";
import { actorCan, type ActorLike } from "../../lib/permissions/actor";
import { orgSetting } from "../../lib/settings";
import { InventoryError } from "./errors";
import { adjustStock, receiveStock } from "./service";

const siteOf = async (itemId: string) => {
  const item = await prisma.inventoryItem.findUnique({ where: { id: itemId } });
  if (!item) throw new InventoryError("NOT_FOUND", "Item not found.");
  return item;
};

export const adjustLimitUnits = () => orgSetting<number>("inventory.adjustLimit", 20);
export const writeOffLimitValue = () => orgSetting<number>("inventory.writeoffLimit", 1000);

export async function goodsIn(actor: ActorLike, input: { itemId: string; quantity: number; reference?: string | null; notes?: string | null }) {
  const item = await siteOf(input.itemId);
  if (!actorCan(actor, "inv.goods_in", { siteId: item.siteId })) throw new InventoryError("FORBIDDEN", "Goods in needs the Inventory supervisor or an Admin.");
  return receiveStock({ ...input, actorId: actor.id });
}

/** Stock count correction. Anyone with the adjust right may correct up to the limit; larger corrections go through a write-off. */
export async function adjustWithinLimit(actor: ActorLike, input: { itemId: string; countedQuantity: number; reason: string }) {
  const item = await siteOf(input.itemId);
  if (!actorCan(actor, "inv.adjust", { siteId: item.siteId })) throw new InventoryError("FORBIDDEN", "Adjustments need the Inventory supervisor or an Admin.");
  const limit = await adjustLimitUnits();
  const delta = Math.abs(input.countedQuantity - item.quantity);
  if (delta > limit && !actorCan(actor, "inv.writeoff", { siteId: item.siteId })) throw new InventoryError("FORBIDDEN", `Adjustments above ${limit} units need an Accommodation Admin. Record a write-off request instead.`);
  return adjustStock({ ...input, actorId: actor.id });
}

/** Moves a stock line or asset to another store (a label within the site) and logs the transfer. */
export async function moveToStore(actor: ActorLike, itemId: string, store: string, notes?: string | null) {
  const item = await siteOf(itemId);
  if (!actorCan(actor, "inv.goods_in", { siteId: item.siteId })) throw new InventoryError("FORBIDDEN", "Store transfers need the Inventory supervisor or an Admin.");
  const to = store.trim();
  if (!to) throw new InventoryError("VALIDATION", "Choose the destination store.", { store: "Required." });
  if (item.store === to) throw new InventoryError("VALIDATION", "That item is already in that store.", { store: "Same store." });
  return prisma.$transaction(async (tx) => {
    await tx.inventoryItem.update({ where: { id: itemId }, data: { store: to } });
    await tx.inventoryTransaction.create({ data: { itemId, type: "TRANSFER", quantity: 0, balanceAfter: item.quantity, actorId: actor.id, notes: `Store ${item.store ?? "—"} → ${to}${notes ? `: ${notes.trim()}` : ""}` } });
    await recordAudit({ actorId: actor.id, action: "INVENTORY_STORE_TRANSFER", entityType: "InventoryItem", entityId: itemId, before: { store: item.store }, after: { store: to } }, tx);
  });
}

// ---------------------------------------------------------------------------
// Write-off: request -> approval
// ---------------------------------------------------------------------------

export async function requestWriteOff(actor: ActorLike, input: { itemId: string; quantity: number; reason: string }) {
  const item = await siteOf(input.itemId);
  if (!actorCan(actor, "inv.adjust", { siteId: item.siteId }) && !actorCan(actor, "inv.writeoff", { siteId: item.siteId })) throw new InventoryError("FORBIDDEN", "Your role does not allow recording write-offs.");
  if (!input.reason?.trim()) throw new InventoryError("VALIDATION", "Give a reason.", { reason: "Required." });
  const qty = item.trackingType === "SERIALIZED" ? 1 : input.quantity;
  if (!Number.isInteger(qty) || qty < 1) throw new InventoryError("VALIDATION", "Enter the quantity to write off.", { quantity: "Whole number." });
  if (item.trackingType === "STOCK" && qty > item.quantity) throw new InventoryError("INSUFFICIENT_STOCK", `Only ${item.quantity} on hand.`, { quantity: "Too many." });
  if (item.status !== "ACTIVE") throw new InventoryError("INVALID_STATE", "That item is retired.");
  const value = Number(item.unitValue ?? 0) * qty;
  const limit = await writeOffLimitValue();
  return prisma.$transaction(async (tx) => {
    const w = await tx.inventoryWriteOff.create({ data: { itemId: item.id, quantity: qty, value, reason: input.reason.trim(), recordedById: actor.id, needsSuperAdmin: value > limit } });
    await recordAudit({ actorId: actor.id, action: "WRITE_OFF_REQUESTED", entityType: "InventoryWriteOff", entityId: w.id, after: { itemId: item.id, quantity: qty, value, needsSuperAdmin: w.needsSuperAdmin } }, tx);
    const approvers = await usersWithRoles(tx, w.needsSuperAdmin ? ["SYSTEM_ADMIN"] : ["ACCOMMODATION_ADMIN", "SYSTEM_ADMIN"], item.siteId);
    for (const a of approvers) await enqueueNotification(tx, { recipientId: a.id, event: "inventory.writeoff_pending", idempotencyKey: `writeoff:${w.id}:${a.id}`, payload: { writeOffId: w.id, item: item.name, quantity: qty, value } });
    return w;
  });
}

export async function decideWriteOff(actor: ActorLike, writeOffId: string, approve: boolean, note?: string | null) {
  const w = await prisma.inventoryWriteOff.findUnique({ where: { id: writeOffId } });
  if (!w) throw new InventoryError("NOT_FOUND", "Write-off not found.");
  const item = await siteOf(w.itemId);
  if (!actorCan(actor, "inv.writeoff", { siteId: item.siteId })) throw new InventoryError("FORBIDDEN", "Only an Accommodation Admin can approve write-offs.");
  if (w.needsSuperAdmin && !actor.roles.includes("SYSTEM_ADMIN")) throw new InventoryError("FORBIDDEN", "This write-off is above the limit: a Super Admin must approve it.");
  if (w.status !== "PENDING") throw new InventoryError("INVALID_STATE", "That write-off has already been decided.");
  if (w.recordedById === actor.id) throw new InventoryError("FORBIDDEN", "Someone else must approve a write-off you recorded.");
  if (!approve && !note?.trim()) throw new InventoryError("VALIDATION", "Give a reason for rejecting.", { note: "Required." });
  return prisma.$transaction(async (tx) => {
    const fresh = await tx.inventoryItem.findUniqueOrThrow({ where: { id: item.id }, include: { assignments: { where: { endedAt: null } } } });
    if (approve) {
      if (fresh.assignments.length) throw new InventoryError("INVALID_STATE", "The asset is still issued: take it back first.");
      if (fresh.trackingType === "STOCK") {
        if (w.quantity > fresh.quantity) throw new InventoryError("INSUFFICIENT_STOCK", `Only ${fresh.quantity} on hand now.`);
        await tx.inventoryItem.update({ where: { id: fresh.id }, data: { quantity: { decrement: w.quantity } } });
        await tx.inventoryTransaction.create({ data: { itemId: fresh.id, type: "RETIREMENT", quantity: -w.quantity, balanceAfter: fresh.quantity - w.quantity, actorId: actor.id, reference: `WO-${w.id.slice(-6).toUpperCase()}`, notes: `Write-off: ${w.reason}` } });
      } else {
        await tx.inventoryItem.update({ where: { id: fresh.id }, data: { status: "INACTIVE", retiredAt: new Date(), condition: "RETIRED", quantity: 0 } });
        await tx.inventoryTransaction.create({ data: { itemId: fresh.id, type: "RETIREMENT", quantity: -fresh.quantity, balanceAfter: 0, actorId: actor.id, reference: `WO-${w.id.slice(-6).toUpperCase()}`, notes: `Disposal: ${w.reason}` } });
      }
    }
    const updated = await tx.inventoryWriteOff.update({ where: { id: w.id }, data: { status: approve ? "APPROVED" : "REJECTED", decidedById: actor.id, decidedAt: new Date(), decisionNote: note?.trim() || null } });
    await recordAudit({ actorId: actor.id, action: approve ? "WRITE_OFF_APPROVED" : "WRITE_OFF_REJECTED", entityType: "InventoryWriteOff", entityId: w.id, after: { itemId: item.id, value: Number(w.value) } }, tx);
    return updated;
  });
}

export async function listWriteOffs(status?: "PENDING" | "APPROVED" | "REJECTED") {
  const rows = await prisma.inventoryWriteOff.findMany({ where: status ? { status } : {}, orderBy: { createdAt: "desc" }, take: 100 });
  const items = new Map((await prisma.inventoryItem.findMany({ where: { id: { in: rows.map((r) => r.itemId) } }, select: { id: true, name: true, sku: true, siteId: true } })).map((i) => [i.id, i]));
  return rows.map((r) => ({ ...r, item: items.get(r.itemId)! }));
}
