// Inventory (SRS 5.7). Stock lines carry an on-hand quantity that is changed
// only through a logged movement inside a transaction; a serialised asset is
// a single unit (quantity 1 in store, 0 while issued or retired) with at most
// one open assignment, both enforced by the database (INV-04).
import type { AssetCondition, InventoryTransactionType, Prisma, PrismaClient } from "@prisma/client";
import { prisma } from "../../lib/db";
import { recordAudit } from "../../lib/audit";
import { InventoryError } from "./errors";

type Tx = Prisma.TransactionClient;
type Db = Tx | PrismaClient;

export const CONDITIONS: AssetCondition[] = ["NEW", "GOOD", "FAIR", "DAMAGED"];

export const itemInclude = {
  site: { select: { id: true, name: true } },
  room: { include: { building: { select: { id: true, name: true, code: true } } } },
  assignments: {
    where: { endedAt: null },
    include: {
      room: { include: { building: { select: { name: true } } } },
      staff: { select: { id: true, employeeId: true, firstName: true, lastName: true, userId: true } },
      facility: { select: { id: true, name: true } },
      assignedBy: { select: { name: true } },
    },
  },
} satisfies Prisma.InventoryItemInclude;
export type ItemRecord = Prisma.InventoryItemGetPayload<{ include: typeof itemInclude }>;

export const transactionInclude = {
  actor: { select: { id: true, name: true } },
  room: { include: { building: { select: { name: true } } } },
  staff: { select: { id: true, employeeId: true, firstName: true, lastName: true } },
  facility: { select: { id: true, name: true } },
  counterpart: { select: { id: true, name: true, site: { select: { name: true } } } },
} satisfies Prisma.InventoryTransactionInclude;
export type TransactionRecord = Prisma.InventoryTransactionGetPayload<{ include: typeof transactionInclude }>;

/** Where an item or quantity goes: exactly one of room, resident (staff) or facility. */
export type Target = { roomId?: string | null; staffId?: string | null; facilityId?: string | null };

function normaliseTarget(t: Target): { roomId: string | null; staffId: string | null; facilityId: string | null } {
  const out = { roomId: t.roomId || null, staffId: t.staffId || null, facilityId: t.facilityId || null };
  const n = [out.roomId, out.staffId, out.facilityId].filter(Boolean).length;
  if (n !== 1) throw new InventoryError("VALIDATION", "Choose one destination: a room, a resident or a facility.", { target: "Required." });
  return out;
}

export function targetLabel(t: { room?: { code: string; building: { name: string } } | null; staff?: { firstName: string; lastName: string; employeeId: string } | null; facility?: { name: string } | null }): string {
  if (t.room) return `${t.room.building.name} room ${t.room.code}`;
  if (t.staff) return `${t.staff.firstName} ${t.staff.lastName} (${t.staff.employeeId})`;
  if (t.facility) return t.facility.name;
  return "—";
}

function translateDbError(error: unknown): never {
  const e = error as { code?: string; message?: string; meta?: { target?: unknown; modelName?: string; constraint?: string } };
  const text = `${e?.meta?.modelName ?? ""} ${JSON.stringify(e?.meta?.target ?? "")} ${e?.meta?.constraint ?? ""} ${e?.message ?? ""}`;
  if (e?.code === "P2002") {
    if (/one_open_assignment/.test(text)) throw new InventoryError("CONFLICT", "This asset was issued to someone else a moment ago.");
    if (/serialNumber/.test(text)) throw new InventoryError("VALIDATION", "That serial number is already registered.", { serialNumber: "Already registered." });
    if (/stock_sku|sku/.test(text)) throw new InventoryError("VALIDATION", "A stock item with that SKU already exists at this site.", { sku: "Already used at this site." });
  }
  if (/quantity_check/.test(text)) throw new InventoryError("INSUFFICIENT_STOCK", "Not enough stock on hand.");
  throw error;
}

// ---------------------------------------------------------------------------
// Items (INV-01)
// ---------------------------------------------------------------------------

export type ItemInput = {
  siteId: string; sku: string; name: string; category: string; description?: string | null; unit?: string | null;
  trackingType: "STOCK" | "SERIALIZED"; serialNumber?: string | null; condition?: AssetCondition | null;
  reorderThreshold?: number | null; storageLocation?: string | null; notes?: string | null;
  /** Opening quantity for a stock line (logged as a receipt). */
  openingQuantity?: number | null; actorId: string;
};

function validateItem(input: Pick<ItemInput, "sku" | "name" | "category" | "trackingType" | "serialNumber" | "reorderThreshold" | "openingQuantity">) {
  const errors: Record<string, string> = {};
  if (!input.sku.trim()) errors.sku = "Enter a SKU or item code.";
  if (!input.name.trim()) errors.name = "Enter a name.";
  if (!input.category.trim()) errors.category = "Enter a category.";
  if (input.trackingType === "SERIALIZED" && !input.serialNumber?.trim()) errors.serialNumber = "Serialised assets need a serial number or asset tag.";
  if (input.reorderThreshold != null && (!Number.isInteger(input.reorderThreshold) || input.reorderThreshold < 0)) errors.reorderThreshold = "Enter a whole number of zero or more.";
  if (input.openingQuantity != null && (!Number.isInteger(input.openingQuantity) || input.openingQuantity < 0)) errors.openingQuantity = "Enter a whole number of zero or more.";
  if (Object.keys(errors).length) throw new InventoryError("VALIDATION", "Please correct the highlighted fields.", errors);
}

export async function createItem(input: ItemInput) {
  validateItem(input);
  const serialised = input.trackingType === "SERIALIZED";
  const opening = serialised ? 1 : (input.openingQuantity ?? 0);
  try {
    return await prisma.$transaction(async (tx) => {
      const item = await tx.inventoryItem.create({
        data: {
          siteId: input.siteId, sku: input.sku.trim().toUpperCase(), name: input.name.trim(), category: input.category.trim(), description: input.description?.trim() || null,
          unit: serialised ? "unit" : (input.unit?.trim() || "pcs"), trackingType: input.trackingType, serialNumber: serialised ? input.serialNumber!.trim() : null,
          condition: input.condition ?? "GOOD", reorderThreshold: serialised ? null : (input.reorderThreshold ?? null), storageLocation: input.storageLocation?.trim() || null,
          notes: input.notes?.trim() || null, quantity: opening,
        },
      });
      await tx.inventoryTransaction.create({ data: { itemId: item.id, type: "RECEIPT", quantity: opening, balanceAfter: opening, actorId: input.actorId, notes: serialised ? "Asset registered" : "Opening balance" } });
      await recordAudit({ actorId: input.actorId, action: "INVENTORY_ITEM_CREATED", entityType: "InventoryItem", entityId: item.id, after: { sku: item.sku, name: item.name, trackingType: item.trackingType, serialNumber: item.serialNumber, quantity: opening } }, tx);
      return item;
    });
  } catch (e) { translateDbError(e); }
}

export type UpdateItemInput = { itemId: string; actorId: string; name: string; category: string; description?: string | null; unit?: string | null; reorderThreshold?: number | null; storageLocation?: string | null; notes?: string | null; condition?: AssetCondition | null };

export async function updateItem(input: UpdateItemInput) {
  const errors: Record<string, string> = {};
  if (!input.name.trim()) errors.name = "Enter a name.";
  if (!input.category.trim()) errors.category = "Enter a category.";
  if (input.reorderThreshold != null && (!Number.isInteger(input.reorderThreshold) || input.reorderThreshold < 0)) errors.reorderThreshold = "Enter a whole number of zero or more.";
  if (Object.keys(errors).length) throw new InventoryError("VALIDATION", "Please correct the highlighted fields.", errors);
  return prisma.$transaction(async (tx) => {
    const before = await tx.inventoryItem.findUnique({ where: { id: input.itemId } });
    if (!before) throw new InventoryError("NOT_FOUND", "Item not found.");
    if (before.status !== "ACTIVE") throw new InventoryError("INVALID_STATE", "Retired items cannot be edited.");
    const condition = before.trackingType === "SERIALIZED" && input.condition ? input.condition : before.condition;
    if (condition === "RETIRED") throw new InventoryError("VALIDATION", "Use Retire to retire an asset.", { condition: "Not allowed here." });
    const after = await tx.inventoryItem.update({
      where: { id: input.itemId },
      data: { name: input.name.trim(), category: input.category.trim(), description: input.description?.trim() || null, unit: before.trackingType === "STOCK" ? (input.unit?.trim() || "pcs") : before.unit, reorderThreshold: before.trackingType === "STOCK" ? (input.reorderThreshold ?? null) : null, storageLocation: input.storageLocation?.trim() || null, notes: input.notes?.trim() || null, condition },
    });
    await recordAudit({ actorId: input.actorId, action: "INVENTORY_ITEM_UPDATED", entityType: "InventoryItem", entityId: input.itemId, before: { name: before.name, category: before.category, reorderThreshold: before.reorderThreshold, storageLocation: before.storageLocation, condition: before.condition }, after: { name: after.name, category: after.category, reorderThreshold: after.reorderThreshold, storageLocation: after.storageLocation, condition: after.condition } }, tx);
    return after;
  });
}

// ---------------------------------------------------------------------------
// Movements (INV-02, INV-03, INV-04)
// ---------------------------------------------------------------------------

async function loadItem(tx: Tx, itemId: string) {
  // Row lock so two movements on the same line are applied one after the other.
  await tx.$queryRaw`SELECT id FROM "InventoryItem" WHERE id = ${itemId} FOR UPDATE`;
  const item = await tx.inventoryItem.findUnique({ where: { id: itemId }, include: itemInclude });
  if (!item) throw new InventoryError("NOT_FOUND", "Item not found.");
  return item;
}

function positive(qty: number, field = "quantity") {
  if (!Number.isInteger(qty) || qty < 1) throw new InventoryError("VALIDATION", "Enter a quantity of at least 1.", { [field]: "At least 1." });
}

/** Applies a signed change to the on-hand quantity and logs it; refuses to go below zero. */
async function move(tx: Tx, item: ItemRecord, type: InventoryTransactionType, delta: number, data: Omit<Prisma.InventoryTransactionUncheckedCreateInput, "itemId" | "type" | "quantity" | "balanceAfter">) {
  if (delta < 0) {
    const r = await tx.inventoryItem.updateMany({ where: { id: item.id, quantity: { gte: -delta } }, data: { quantity: { decrement: -delta } } });
    if (r.count !== 1) {
      const available = item.quantity;
      throw new InventoryError("INSUFFICIENT_STOCK", item.trackingType === "SERIALIZED" ? "This asset is not in store." : `Only ${available} ${item.unit} on hand.`);
    }
  } else if (delta > 0) {
    await tx.inventoryItem.update({ where: { id: item.id }, data: { quantity: { increment: delta } } });
  }
  const balance = item.quantity + delta;
  const t = await tx.inventoryTransaction.create({ data: { ...data, itemId: item.id, type, quantity: delta, balanceAfter: balance } });
  return { transaction: t, balance };
}

export type ReceiveInput = { itemId: string; actorId: string; quantity: number; reference?: string | null; notes?: string | null };

export async function receiveStock(input: ReceiveInput) {
  positive(input.quantity);
  return prisma.$transaction(async (tx) => {
    const item = await loadItem(tx, input.itemId);
    if (item.status !== "ACTIVE") throw new InventoryError("INVALID_STATE", "This item is retired.");
    if (item.trackingType !== "STOCK") throw new InventoryError("INVALID_STATE", "Serialised assets are registered one by one, not received as stock.");
    const { transaction, balance } = await move(tx, item, "RECEIPT", input.quantity, { actorId: input.actorId, reference: input.reference?.trim() || null, notes: input.notes?.trim() || null });
    await recordAudit({ actorId: input.actorId, action: "INVENTORY_RECEIPT", entityType: "InventoryItem", entityId: item.id, after: { quantity: input.quantity, balance, reference: input.reference ?? null } }, tx);
    return transaction;
  });
}

export type IssueInput = { itemId: string; actorId: string; quantity?: number; target: Target; notes?: string | null };

/** Issues stock units or a serialised asset to a room, resident or facility. */
export async function issueItem(input: IssueInput) {
  const target = normaliseTarget(input.target);
  try {
    return await prisma.$transaction(async (tx) => {
      const item = await loadItem(tx, input.itemId);
      if (item.status !== "ACTIVE") throw new InventoryError("INVALID_STATE", "This item is retired.");
      const serialised = item.trackingType === "SERIALIZED";
      const qty = serialised ? 1 : (input.quantity ?? 0);
      positive(qty);
      if (serialised) {
        if (item.assignments.length > 0) throw new InventoryError("INVALID_STATE", `This asset is already with ${targetLabel(item.assignments[0])}.`);
        if (item.condition === "DAMAGED") throw new InventoryError("INVALID_STATE", "A damaged asset cannot be issued until its condition is updated.");
        await tx.assetAssignment.create({ data: { itemId: item.id, ...target, assignedById: input.actorId, notes: input.notes?.trim() || null } });
      }
      const { transaction, balance } = await move(tx, item, "ISSUE", -qty, { actorId: input.actorId, ...target, notes: input.notes?.trim() || null });
      await recordAudit({ actorId: input.actorId, action: "INVENTORY_ISSUE", entityType: "InventoryItem", entityId: item.id, after: { quantity: qty, balance, ...target } }, tx);
      return transaction;
    });
  } catch (e) { translateDbError(e); }
}

export type ReturnInput = { itemId: string; actorId: string; quantity?: number; target: Target; condition?: AssetCondition | null; notes?: string | null };

/**
 * Takes stock units or an asset back from a target. Units returned damaged
 * are written off straight away so the on-hand figure stays usable stock.
 */
export async function returnItem(input: ReturnInput) {
  const target = normaliseTarget(input.target);
  return prisma.$transaction(async (tx) => {
    const item = await loadItem(tx, input.itemId);
    const serialised = item.trackingType === "SERIALIZED";
    const qty = serialised ? 1 : (input.quantity ?? 0);
    positive(qty);
    const damaged = input.condition === "DAMAGED";
    if (serialised) {
      const open = item.assignments[0];
      if (!open) throw new InventoryError("INVALID_STATE", "This asset is not issued.");
      if ((open.roomId ?? null) !== target.roomId || (open.staffId ?? null) !== target.staffId || (open.facilityId ?? null) !== target.facilityId) {
        throw new InventoryError("VALIDATION", `This asset is with ${targetLabel(open)}, not the selected destination.`, { target: "Does not match." });
      }
      await tx.assetAssignment.update({ where: { id: open.id }, data: { endedAt: new Date(), endedById: input.actorId } });
      if (input.condition) await tx.inventoryItem.update({ where: { id: item.id }, data: { condition: input.condition } });
    } else {
      const outstanding = await outstandingAt(tx, item.id, target);
      if (qty > outstanding) throw new InventoryError("VALIDATION", `Only ${outstanding} ${item.unit} of this item ${outstanding === 1 ? "is" : "are"} issued there.`, { quantity: `At most ${outstanding}.` });
    }
    const { transaction } = await move(tx, item, "RETURN", qty, { actorId: input.actorId, ...target, condition: input.condition ?? null, notes: input.notes?.trim() || null });
    let balance = transaction.balanceAfter ?? item.quantity + qty;
    if (damaged && !serialised) {
      const refreshed = { ...item, quantity: balance };
      const w = await move(tx, refreshed, "DAMAGE", -qty, { actorId: input.actorId, ...target, condition: "DAMAGED", notes: "Returned damaged" });
      balance = w.balance;
    }
    await recordAudit({ actorId: input.actorId, action: "INVENTORY_RETURN", entityType: "InventoryItem", entityId: item.id, after: { quantity: qty, balance, condition: input.condition ?? null, ...target } }, tx);
    return transaction;
  });
}

export type AdjustInput = { itemId: string; actorId: string; countedQuantity: number; reason: string };

/** Stock count correction: sets the on-hand figure and logs the difference (INV-02 adjustment). */
export async function adjustStock(input: AdjustInput) {
  if (!Number.isInteger(input.countedQuantity) || input.countedQuantity < 0) throw new InventoryError("VALIDATION", "Enter the counted quantity.", { countedQuantity: "Whole number of zero or more." });
  if (!input.reason.trim()) throw new InventoryError("VALIDATION", "Give a reason for the adjustment.", { reason: "Required." });
  return prisma.$transaction(async (tx) => {
    const item = await loadItem(tx, input.itemId);
    if (item.status !== "ACTIVE" || item.trackingType !== "STOCK") throw new InventoryError("INVALID_STATE", "Only active stock lines can be adjusted.");
    const delta = input.countedQuantity - item.quantity;
    if (delta === 0) throw new InventoryError("VALIDATION", "The count matches the current balance; nothing to adjust.", { countedQuantity: "No change." });
    const { transaction, balance } = await move(tx, item, "ADJUSTMENT", delta, { actorId: input.actorId, notes: input.reason.trim() });
    await recordAudit({ actorId: input.actorId, action: "INVENTORY_ADJUSTMENT", entityType: "InventoryItem", entityId: item.id, before: { quantity: item.quantity }, after: { quantity: balance, reason: input.reason } }, tx);
    return transaction;
  });
}

export type DamageInput = { itemId: string; actorId: string; quantity?: number; notes: string };

/** Writes off damaged stock units, or marks an asset as damaged (it stays on the register). */
export async function recordDamage(input: DamageInput) {
  if (!input.notes.trim()) throw new InventoryError("VALIDATION", "Describe the damage.", { notes: "Required." });
  return prisma.$transaction(async (tx) => {
    const item = await loadItem(tx, input.itemId);
    if (item.status !== "ACTIVE") throw new InventoryError("INVALID_STATE", "This item is retired.");
    if (item.trackingType === "SERIALIZED") {
      await tx.inventoryItem.update({ where: { id: item.id }, data: { condition: "DAMAGED" } });
      const t = await tx.inventoryTransaction.create({ data: { itemId: item.id, type: "DAMAGE", quantity: 0, balanceAfter: item.quantity, actorId: input.actorId, condition: "DAMAGED", notes: input.notes.trim(), ...(item.assignments[0] ? { roomId: item.assignments[0].roomId, staffId: item.assignments[0].staffId, facilityId: item.assignments[0].facilityId } : {}) } });
      await recordAudit({ actorId: input.actorId, action: "INVENTORY_DAMAGE", entityType: "InventoryItem", entityId: item.id, before: { condition: item.condition }, after: { condition: "DAMAGED", notes: input.notes } }, tx);
      return t;
    }
    const qty = input.quantity ?? 0;
    positive(qty);
    const { transaction, balance } = await move(tx, item, "DAMAGE", -qty, { actorId: input.actorId, condition: "DAMAGED", notes: input.notes.trim() });
    await recordAudit({ actorId: input.actorId, action: "INVENTORY_DAMAGE", entityType: "InventoryItem", entityId: item.id, after: { quantity: qty, balance, notes: input.notes } }, tx);
    return transaction;
  });
}

export type TransferInput = { itemId: string; actorId: string; toSiteId: string; quantity?: number; notes?: string | null };

/**
 * Moves stock units to the same SKU at another site (creating the line there
 * if needed) or re-homes an asset that is in store. Both movements are logged
 * and linked.
 */
export async function transferItem(input: TransferInput) {
  try {
    return await prisma.$transaction(async (tx) => {
      const item = await loadItem(tx, input.itemId);
      if (item.status !== "ACTIVE") throw new InventoryError("INVALID_STATE", "This item is retired.");
      if (input.toSiteId === item.siteId) throw new InventoryError("VALIDATION", "Choose a different site.", { toSiteId: "Same site." });
      const toSite = await tx.site.findUnique({ where: { id: input.toSiteId } });
      if (!toSite) throw new InventoryError("NOT_FOUND", "Destination site not found.");
      const notes = input.notes?.trim() || null;
      if (item.trackingType === "SERIALIZED") {
        if (item.assignments.length > 0) throw new InventoryError("INVALID_STATE", `Take the asset back from ${targetLabel(item.assignments[0])} before transferring it.`);
        await tx.inventoryItem.update({ where: { id: item.id }, data: { siteId: toSite.id, roomId: null, storageLocation: null } });
        const t = await tx.inventoryTransaction.create({ data: { itemId: item.id, type: "TRANSFER", quantity: 0, balanceAfter: item.quantity, actorId: input.actorId, notes: `Moved from ${item.site.name} to ${toSite.name}${notes ? ` · ${notes}` : ""}` } });
        await recordAudit({ actorId: input.actorId, action: "INVENTORY_TRANSFER", entityType: "InventoryItem", entityId: item.id, before: { siteId: item.siteId }, after: { siteId: toSite.id } }, tx);
        return t;
      }
      const qty = input.quantity ?? 0;
      positive(qty);
      let counterpart = await tx.inventoryItem.findFirst({ where: { siteId: toSite.id, sku: item.sku, serialNumber: null } });
      if (!counterpart) {
        counterpart = await tx.inventoryItem.create({ data: { siteId: toSite.id, sku: item.sku, name: item.name, category: item.category, description: item.description, unit: item.unit, trackingType: "STOCK", reorderThreshold: item.reorderThreshold, quantity: 0 } });
      } else if (counterpart.status !== "ACTIVE") {
        throw new InventoryError("INVALID_STATE", `The ${item.sku} line at ${toSite.name} is retired.`);
      }
      await tx.$queryRaw`SELECT id FROM "InventoryItem" WHERE id = ${counterpart.id} FOR UPDATE`;
      const out = await move(tx, item, "TRANSFER", -qty, { actorId: input.actorId, counterpartItemId: counterpart.id, notes: notes ?? `To ${toSite.name}` });
      await tx.inventoryItem.update({ where: { id: counterpart.id }, data: { quantity: { increment: qty } } });
      await tx.inventoryTransaction.create({ data: { itemId: counterpart.id, type: "TRANSFER", quantity: qty, balanceAfter: counterpart.quantity + qty, actorId: input.actorId, counterpartItemId: item.id, notes: notes ?? `From ${item.site.name}` } });
      await recordAudit({ actorId: input.actorId, action: "INVENTORY_TRANSFER", entityType: "InventoryItem", entityId: item.id, after: { quantity: qty, toSiteId: toSite.id, counterpartItemId: counterpart.id, balance: out.balance } }, tx);
      return out.transaction;
    });
  } catch (e) { translateDbError(e); }
}

export type RetireInput = { itemId: string; actorId: string; notes: string };

/** Retires an asset (must be in store) or closes a stock line (remaining units are written off). */
export async function retireItem(input: RetireInput) {
  if (!input.notes.trim()) throw new InventoryError("VALIDATION", "Give a reason.", { notes: "Required." });
  return prisma.$transaction(async (tx) => {
    const item = await loadItem(tx, input.itemId);
    if (item.status !== "ACTIVE") throw new InventoryError("INVALID_STATE", "Already retired.");
    if (item.assignments.length > 0) throw new InventoryError("INVALID_STATE", `Take the asset back from ${targetLabel(item.assignments[0])} first.`);
    if (item.trackingType === "STOCK" && (await outstandingAll(tx, item.id)) > 0) throw new InventoryError("INVALID_STATE", "Units of this item are still issued; return them first.");
    const { balance } = await move(tx, item, "RETIREMENT", -item.quantity, { actorId: input.actorId, notes: input.notes.trim() });
    const now = new Date();
    await tx.inventoryItem.update({ where: { id: item.id }, data: { status: "INACTIVE", retiredAt: now, condition: item.trackingType === "SERIALIZED" ? "RETIRED" : item.condition } });
    await recordAudit({ actorId: input.actorId, action: "INVENTORY_RETIRED", entityType: "InventoryItem", entityId: item.id, before: { quantity: item.quantity, status: item.status }, after: { quantity: balance, status: "INACTIVE", notes: input.notes } }, tx);
  });
}

// ---------------------------------------------------------------------------
// Stock issued to targets (derived from the movement log)
// ---------------------------------------------------------------------------

type Outstanding = { roomId: string | null; staffId: string | null; facilityId: string | null; quantity: number };

/** Units of a stock line currently out at each room, resident or facility. */
export async function outstandingByTarget(itemId: string, db: Db = prisma): Promise<Outstanding[]> {
  const rows = await db.inventoryTransaction.groupBy({
    by: ["roomId", "staffId", "facilityId"],
    where: { itemId, type: { in: ["ISSUE", "RETURN"] }, OR: [{ roomId: { not: null } }, { staffId: { not: null } }, { facilityId: { not: null } }] },
    _sum: { quantity: true },
  });
  return rows.map((r) => ({ roomId: r.roomId, staffId: r.staffId, facilityId: r.facilityId, quantity: -(r._sum.quantity ?? 0) })).filter((r) => r.quantity > 0);
}

async function outstandingAt(db: Db, itemId: string, target: { roomId: string | null; staffId: string | null; facilityId: string | null }): Promise<number> {
  const agg = await db.inventoryTransaction.aggregate({ where: { itemId, type: { in: ["ISSUE", "RETURN"] }, roomId: target.roomId, staffId: target.staffId, facilityId: target.facilityId }, _sum: { quantity: true } });
  return -(agg._sum.quantity ?? 0);
}

async function outstandingAll(db: Db, itemId: string): Promise<number> {
  return (await outstandingByTarget(itemId, db)).reduce((s, r) => s + r.quantity, 0);
}

export type HeldItem = { itemId: string; sku: string; name: string; serialNumber: string | null; unit: string; quantity: number; since: Date | null };

/** Assets and stock units currently with a target (resident, room or facility). */
export async function itemsHeldBy(target: Target, db: Db = prisma): Promise<HeldItem[]> {
  const t = { roomId: target.roomId || null, staffId: target.staffId || null, facilityId: target.facilityId || null };
  const [assignments, stock] = await Promise.all([
    db.assetAssignment.findMany({ where: { ...t, endedAt: null }, include: { item: true }, orderBy: { startedAt: "asc" } }),
    db.inventoryTransaction.groupBy({ by: ["itemId"], where: { ...t, type: { in: ["ISSUE", "RETURN"] }, item: { trackingType: "STOCK" } }, _sum: { quantity: true }, _max: { createdAt: true } }),
  ]);
  const out: HeldItem[] = assignments.map((a) => ({ itemId: a.itemId, sku: a.item.sku, name: a.item.name, serialNumber: a.item.serialNumber, unit: a.item.unit, quantity: 1, since: a.startedAt }));
  const stockIds = stock.filter((s) => -(s._sum.quantity ?? 0) > 0).map((s) => s.itemId);
  if (stockIds.length) {
    const items = await db.inventoryItem.findMany({ where: { id: { in: stockIds } } });
    for (const s of stock) {
      const item = items.find((i) => i.id === s.itemId);
      const qty = -(s._sum.quantity ?? 0);
      if (item && qty > 0) out.push({ itemId: item.id, sku: item.sku, name: item.name, serialNumber: null, unit: item.unit, quantity: qty, since: s._max.createdAt });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Queries, warnings and reports (INV-05, INV-06)
// ---------------------------------------------------------------------------

export function isLowStock(item: Pick<ItemRecord, "trackingType" | "status" | "quantity" | "reorderThreshold">): boolean {
  return item.trackingType === "STOCK" && item.status === "ACTIVE" && item.reorderThreshold != null && item.quantity <= item.reorderThreshold;
}

export function describeLocation(item: ItemRecord): string {
  if (item.assignments[0]) return `with ${targetLabel(item.assignments[0])}`;
  if (item.status !== "ACTIVE") return "retired";
  return item.storageLocation ?? (item.room ? `${item.room.building.name} room ${item.room.code}` : "in store");
}

export type ItemFilter = "all" | "stock" | "assets" | "low" | "issued" | "damaged" | "retired";
export const ITEM_FILTERS: Array<[ItemFilter, string]> = [["all", "All"], ["stock", "Stock"], ["assets", "Assets"], ["low", "Low stock"], ["issued", "Issued"], ["damaged", "Damaged"], ["retired", "Retired"]];

export async function listItems(opts: { filter?: ItemFilter; q?: string | null; siteId?: string | null; category?: string | null } = {}) {
  const filter = opts.filter ?? "all";
  const where: Prisma.InventoryItemWhereInput = {
    ...(opts.siteId ? { siteId: opts.siteId } : {}),
    ...(opts.category ? { category: opts.category } : {}),
    ...(opts.q ? { OR: [{ name: { contains: opts.q, mode: "insensitive" } }, { sku: { contains: opts.q, mode: "insensitive" } }, { serialNumber: { contains: opts.q, mode: "insensitive" } }, { category: { contains: opts.q, mode: "insensitive" } }] } : {}),
    ...(filter === "retired" ? { status: "INACTIVE" } : { status: "ACTIVE" }),
    ...(filter === "stock" ? { trackingType: "STOCK" } : {}),
    ...(filter === "assets" ? { trackingType: "SERIALIZED" } : {}),
    ...(filter === "issued" ? { trackingType: "SERIALIZED", assignments: { some: { endedAt: null } } } : {}),
    ...(filter === "damaged" ? { condition: "DAMAGED" } : {}),
  };
  const items = await prisma.inventoryItem.findMany({ where, include: itemInclude, orderBy: [{ category: "asc" }, { name: "asc" }, { serialNumber: "asc" }] });
  return filter === "low" ? items.filter(isLowStock) : items;
}

export async function getItem(id: string) {
  const item = await prisma.inventoryItem.findUnique({ where: { id }, include: itemInclude });
  if (!item) return null;
  const [transactions, outstanding] = await Promise.all([
    prisma.inventoryTransaction.findMany({ where: { itemId: id }, include: transactionInclude, orderBy: { createdAt: "desc" } }),
    item.trackingType === "STOCK" ? outstandingByTarget(id) : Promise.resolve([] as Outstanding[]),
  ]);
  const targets = await resolveTargets(outstanding);
  return { item, transactions, outstanding: targets };
}

export type OutstandingRow = Outstanding & { label: string };

async function resolveTargets(rows: Outstanding[]): Promise<OutstandingRow[]> {
  const roomIds = rows.map((r) => r.roomId).filter((x): x is string => !!x);
  const staffIds = rows.map((r) => r.staffId).filter((x): x is string => !!x);
  const facilityIds = rows.map((r) => r.facilityId).filter((x): x is string => !!x);
  const [rooms, staff, facilities] = await Promise.all([
    roomIds.length ? prisma.room.findMany({ where: { id: { in: roomIds } }, include: { building: { select: { name: true } } } }) : [],
    staffIds.length ? prisma.staffProfile.findMany({ where: { id: { in: staffIds } } }) : [],
    facilityIds.length ? prisma.facility.findMany({ where: { id: { in: facilityIds } } }) : [],
  ]);
  return rows.map((r) => ({ ...r, label: targetLabel({ room: rooms.find((x) => x.id === r.roomId) ?? null, staff: staff.find((x) => x.id === r.staffId) ?? null, facility: facilities.find((x) => x.id === r.facilityId) ?? null }) }));
}

export async function categories(siteId?: string | null): Promise<string[]> {
  const rows = await prisma.inventoryItem.findMany({ where: siteId ? { siteId } : {}, select: { category: true }, distinct: ["category"], orderBy: { category: "asc" } });
  return rows.map((r) => r.category);
}

export async function inventorySummary(siteId?: string | null) {
  const where = siteId ? { siteId } : {};
  const [stockLines, assets, issued, damaged, lowCandidates] = await Promise.all([
    prisma.inventoryItem.count({ where: { ...where, status: "ACTIVE", trackingType: "STOCK" } }),
    prisma.inventoryItem.count({ where: { ...where, status: "ACTIVE", trackingType: "SERIALIZED" } }),
    prisma.assetAssignment.count({ where: { endedAt: null, item: where } }),
    prisma.inventoryItem.count({ where: { ...where, status: "ACTIVE", condition: "DAMAGED" } }),
    prisma.inventoryItem.findMany({ where: { ...where, status: "ACTIVE", trackingType: "STOCK", reorderThreshold: { not: null } }, select: { trackingType: true, status: true, quantity: true, reorderThreshold: true } }),
  ]);
  return { stockLines, assets, issued, damaged, lowStock: lowCandidates.filter(isLowStock).length };
}

export type MovementFilter = { siteId?: string | null; from?: string | null; to?: string | null; type?: InventoryTransactionType | null; itemId?: string | null };

export async function movementReport(filter: MovementFilter, limit = 500) {
  const where: Prisma.InventoryTransactionWhereInput = {
    ...(filter.itemId ? { itemId: filter.itemId } : {}),
    ...(filter.siteId ? { item: { siteId: filter.siteId } } : {}),
    ...(filter.type ? { type: filter.type } : {}),
    ...(filter.from || filter.to ? { createdAt: { ...(filter.from ? { gte: new Date(`${filter.from}T00:00:00.000Z`) } : {}), ...(filter.to ? { lt: new Date(new Date(`${filter.to}T00:00:00.000Z`).getTime() + 86400000) } : {}) } } : {}),
  };
  return prisma.inventoryTransaction.findMany({ where, include: { ...transactionInclude, item: { select: { id: true, sku: true, name: true, unit: true, serialNumber: true, site: { select: { name: true } } } } }, orderBy: { createdAt: "desc" }, take: limit });
}

export type StockBalanceRow = { category: string; lines: number; units: number; low: number; assets: number; assetsIssued: number };

export async function stockBalanceReport(siteId?: string | null): Promise<StockBalanceRow[]> {
  const items = await prisma.inventoryItem.findMany({ where: { ...(siteId ? { siteId } : {}), status: "ACTIVE" }, include: { assignments: { where: { endedAt: null }, select: { id: true } } }, orderBy: { category: "asc" } });
  const map = new Map<string, StockBalanceRow>();
  for (const i of items) {
    const row = map.get(i.category) ?? { category: i.category, lines: 0, units: 0, low: 0, assets: 0, assetsIssued: 0 };
    if (i.trackingType === "STOCK") { row.lines++; row.units += i.quantity; if (isLowStock({ ...i, trackingType: "STOCK" })) row.low++; }
    else { row.assets++; if (i.assignments.length) row.assetsIssued++; }
    map.set(i.category, row);
  }
  return [...map.values()];
}

export type AllocatedRow = { label: string; kind: "room" | "resident" | "facility"; items: Array<{ itemId: string; name: string; sku: string; serialNumber: string | null; quantity: number; unit: string; since: Date | null }> };

/** Everything currently out, grouped by where it is (INV-06 allocated asset report). */
export async function allocatedReport(siteId?: string | null): Promise<AllocatedRow[]> {
  const itemWhere = { ...(siteId ? { siteId } : {}) };
  const [assignments, stock] = await Promise.all([
    prisma.assetAssignment.findMany({ where: { endedAt: null, item: itemWhere }, include: { item: true, room: { include: { building: { select: { name: true } } } }, staff: true, facility: true } }),
    prisma.inventoryTransaction.groupBy({ by: ["itemId", "roomId", "staffId", "facilityId"], where: { type: { in: ["ISSUE", "RETURN"] }, item: { ...itemWhere, trackingType: "STOCK" }, OR: [{ roomId: { not: null } }, { staffId: { not: null } }, { facilityId: { not: null } }] }, _sum: { quantity: true }, _max: { createdAt: true } }),
  ]);
  const open = stock.filter((s) => -(s._sum.quantity ?? 0) > 0);
  const resolved = await resolveTargets(open.map((s) => ({ roomId: s.roomId, staffId: s.staffId, facilityId: s.facilityId, quantity: -(s._sum.quantity ?? 0) })));
  const items = open.length ? await prisma.inventoryItem.findMany({ where: { id: { in: open.map((s) => s.itemId) } } }) : [];
  const groups = new Map<string, AllocatedRow>();
  const push = (key: string, label: string, kind: AllocatedRow["kind"], entry: AllocatedRow["items"][number]) => {
    const g = groups.get(key) ?? { label, kind, items: [] };
    g.items.push(entry);
    groups.set(key, g);
  };
  for (const a of assignments) {
    const key = a.roomId ? `room:${a.roomId}` : a.staffId ? `staff:${a.staffId}` : `facility:${a.facilityId}`;
    push(key, targetLabel(a), a.roomId ? "room" : a.staffId ? "resident" : "facility", { itemId: a.itemId, name: a.item.name, sku: a.item.sku, serialNumber: a.item.serialNumber, quantity: 1, unit: a.item.unit, since: a.startedAt });
  }
  open.forEach((s, i) => {
    const item = items.find((x) => x.id === s.itemId);
    if (!item) return;
    const key = s.roomId ? `room:${s.roomId}` : s.staffId ? `staff:${s.staffId}` : `facility:${s.facilityId}`;
    push(key, resolved[i].label, s.roomId ? "room" : s.staffId ? "resident" : "facility", { itemId: item.id, name: item.name, sku: item.sku, serialNumber: null, quantity: -(s._sum.quantity ?? 0), unit: item.unit, since: s._max.createdAt });
  });
  return [...groups.values()].sort((a, b) => a.label.localeCompare(b.label));
}

export type ConditionRow = { condition: AssetCondition; count: number; issued: number };

export async function conditionReport(siteId?: string | null): Promise<ConditionRow[]> {
  const assets = await prisma.inventoryItem.findMany({ where: { ...(siteId ? { siteId } : {}), trackingType: "SERIALIZED" }, include: { assignments: { where: { endedAt: null }, select: { id: true } } } });
  const order: AssetCondition[] = ["NEW", "GOOD", "FAIR", "DAMAGED", "RETIRED"];
  return order.map((condition) => {
    const rows = assets.filter((a) => a.condition === condition);
    return { condition, count: rows.length, issued: rows.filter((a) => a.assignments.length > 0).length };
  }).filter((r) => r.count > 0);
}

function csvEscape(v: unknown): string {
  const s = v == null ? "" : String(v);
  return /[",\n]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
}

export async function movementCsv(filter: MovementFilter, actorId: string): Promise<string> {
  const rows = await movementReport(filter, 10000);
  await recordAudit({ actorId, action: "REPORT_EXPORTED", entityType: "Report", entityId: "inventory-movements", after: { filter: { ...filter } as Record<string, string | null | undefined> } });
  const header = ["When", "Site", "SKU", "Item", "Serial", "Type", "Quantity", "Balance after", "Destination", "Condition", "Reference", "Notes", "By"];
  const lines = rows.map((t) => [t.createdAt.toISOString(), t.item.site.name, t.item.sku, t.item.name, t.item.serialNumber ?? "", t.type, t.quantity, t.balanceAfter ?? "", targetLabel(t), t.condition ?? "", t.reference ?? "", t.notes ?? "", t.actor.name].map(csvEscape).join(","));
  return [header.join(","), ...lines].join("\n") + "\n";
}

export function describeTransaction(type: InventoryTransactionType): string {
  return { RECEIPT: "Receipt", ISSUE: "Issued", RETURN: "Returned", TRANSFER: "Transfer", ADJUSTMENT: "Adjustment", DAMAGE: "Damage", RETIREMENT: "Retired" }[type];
}

export function describeCondition(c: AssetCondition): string {
  return { NEW: "New", GOOD: "Good", FAIR: "Fair", DAMAGED: "Damaged", RETIRED: "Retired" }[c];
}
