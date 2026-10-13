// Pure inventory rules, record shapes and labels. No database access, so the
// web app and the API can both import this file.
import type { AssetCondition, InventoryTransactionType, Prisma } from "@prisma/client";

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

export function targetLabel(t: { room?: { code: string; building: { name: string } } | null; staff?: { firstName: string; lastName: string; employeeId: string } | null; facility?: { name: string } | null }): string {
  if (t.room) return `${t.room.building.name} room ${t.room.code}`;
  if (t.staff) return `${t.staff.firstName} ${t.staff.lastName} (${t.staff.employeeId})`;
  if (t.facility) return t.facility.name;
  return "—";
}

export type HeldItem = { itemId: string; sku: string; name: string; serialNumber: string | null; unit: string; quantity: number; since: Date | null };

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

export type Outstanding = { roomId: string | null; staffId: string | null; facilityId: string | null; quantity: number };

export type OutstandingRow = Outstanding & { label: string };

export type MovementFilter = { siteId?: string | null; from?: string | null; to?: string | null; type?: InventoryTransactionType | null; itemId?: string | null };

export type StockBalanceRow = { category: string; lines: number; units: number; low: number; assets: number; assetsIssued: number };

export type AllocatedRow = { label: string; kind: "room" | "resident" | "facility"; items: Array<{ itemId: string; name: string; sku: string; serialNumber: string | null; quantity: number; unit: string; since: Date | null }> };

export type ConditionRow = { condition: AssetCondition; count: number; issued: number };

export function describeTransaction(type: InventoryTransactionType): string {
  return { RECEIPT: "Receipt", ISSUE: "Issued", RETURN: "Returned", TRANSFER: "Transfer", ADJUSTMENT: "Adjustment", DAMAGE: "Damage", RETIREMENT: "Retired" }[type];
}

export function describeCondition(c: AssetCondition): string {
  return { NEW: "New", GOOD: "Good", FAIR: "Fair", DAMAGED: "Damaged", RETIRED: "Retired" }[c];
}
