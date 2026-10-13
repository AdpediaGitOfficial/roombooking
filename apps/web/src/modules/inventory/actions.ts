"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { AssetCondition } from "@prisma/client";
import { actorOf, requireRole, requireUser, userCan } from "@/lib/auth/authorize";
import { adjustWithinLimit, goodsIn } from "@sam/core/modules/inventory/extras";
import { guardScope } from "@/lib/auth/guards";
import { INVENTORY_MANAGE_ROLES, INVENTORY_OPERATE_ROLES } from "@sam/core/modules/inventory/access";
import { InventoryError } from "@sam/core/modules/inventory/errors";
import { CONDITIONS, adjustStock, createItem, issueItem, receiveStock, recordDamage, retireItem, returnItem, transferItem, updateItem, type Target } from "@sam/core/modules/inventory/service";

export type FormState = { error?: string; message?: string; fieldErrors?: Record<string, string>; values?: Record<string, string> };
export type ActionState = { error?: string; message?: string };

const str = (fd: FormData, k: string) => { const v = fd.get(k); return typeof v === "string" ? v.trim() : ""; };
const int = (fd: FormData, k: string) => { const s = str(fd, k); if (s === "") return null; const n = Number(s); return Number.isFinite(n) ? Math.trunc(n) : NaN; };
const condition = (fd: FormData): AssetCondition | null => { const c = str(fd, "condition"); return (CONDITIONS as string[]).includes(c) ? (c as AssetCondition) : null; };

/** The destination is submitted as "room:<id>", "staff:<id>" or "facility:<id>". */
function target(fd: FormData): Target {
  const [kind, id] = str(fd, "target").split(":");
  if (!id) return {};
  return kind === "room" ? { roomId: id } : kind === "staff" ? { staffId: id } : kind === "facility" ? { facilityId: id } : {};
}

function revalidate(itemId?: string, extra: string[] = []) {
  revalidatePath("/inventory");
  revalidatePath("/inventory/reports");
  revalidatePath("/my/stay");
  if (itemId) revalidatePath(`/inventory/${itemId}`);
  for (const p of extra) if (p.startsWith("/")) revalidatePath(p);
}

function fail(error: unknown, values?: Record<string, string>): FormState {
  if (error instanceof InventoryError) return { error: error.message, fieldErrors: error.fieldErrors, values };
  throw error;
}

export async function createItemAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const user = await requireRole(INVENTORY_MANAGE_ROLES, "/inventory");
  const values: Record<string, string> = {};
  for (const k of ["siteId", "sku", "name", "category", "description", "unit", "trackingType", "serialNumber", "condition", "reorderThreshold", "storageLocation", "openingQuantity", "notes"]) values[k] = str(formData, k);
  let id: string;
  try {
    const item = await createItem({
      siteId: values.siteId, sku: values.sku, name: values.name, category: values.category, description: values.description, unit: values.unit,
      trackingType: values.trackingType === "SERIALIZED" ? "SERIALIZED" : "STOCK", serialNumber: values.serialNumber, condition: condition(formData),
      reorderThreshold: int(formData, "reorderThreshold"), storageLocation: values.storageLocation, openingQuantity: int(formData, "openingQuantity"), notes: values.notes, actorId: user.id,
    });
    id = item.id;
  } catch (error) {
    return fail(error, values);
  }
  revalidate(id);
  redirect(`/inventory/${id}`);
}

export async function updateItemAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const user = await requireRole(INVENTORY_MANAGE_ROLES, "/inventory");
  await guardScope(user, "inv.room_assets", formData, [["itemId", "inventoryItem"]]);
  const values: Record<string, string> = {};
  for (const k of ["itemId", "name", "category", "description", "unit", "condition", "reorderThreshold", "storageLocation", "notes"]) values[k] = str(formData, k);
  try {
    await updateItem({ itemId: values.itemId, actorId: user.id, name: values.name, category: values.category, description: values.description, unit: values.unit, condition: condition(formData), reorderThreshold: int(formData, "reorderThreshold"), storageLocation: values.storageLocation, notes: values.notes });
  } catch (error) {
    return fail(error, values);
  }
  revalidate(values.itemId);
  return { message: "Item saved.", values };
}

/** Receive, issue, return, damage, adjust, transfer and retire share one handler keyed by `kind`. */
export async function movementAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const kind = str(formData, "kind");
  const supervisorOnly = ["RECEIVE", "ADJUST", "TRANSFER", "RETIRE"].includes(kind);
  const user = supervisorOnly ? await requireUser("/inventory") : await requireRole(INVENTORY_OPERATE_ROLES, "/inventory");
  await guardScope(user, "inv.room_assets", formData, [["itemId", "inventoryItem"]]);
  const itemId = str(formData, "itemId");
  const values: Record<string, string> = {};
  for (const k of ["kind", "quantity", "target", "condition", "reference", "notes", "countedQuantity", "reason", "toSiteId"]) values[k] = str(formData, k);
  const quantity = int(formData, "quantity") ?? undefined;
  let message = "Saved.";
  try {
    switch (kind) {
      case "RECEIVE": { const t = await goodsIn(actorOf(user), { itemId, quantity: quantity ?? NaN, reference: values.reference, notes: values.notes }); message = `Received ${t.quantity}; ${t.balanceAfter} on hand.`; break; }
      case "ISSUE": { const t = await issueItem({ itemId, actorId: user.id, quantity, target: target(formData), notes: values.notes }); message = t.balanceAfter == null ? "Issued." : `Issued; ${t.balanceAfter} on hand.`; break; }
      case "RETURN": { await returnItem({ itemId, actorId: user.id, quantity, target: target(formData), condition: condition(formData), notes: values.notes }); message = values.condition === "DAMAGED" ? "Returned and recorded as damaged." : "Returned."; break; }
      case "DAMAGE": { await recordDamage({ itemId, actorId: user.id, quantity, notes: values.notes }); message = "Damage recorded."; break; }
      case "ADJUST": { const t = await adjustWithinLimit(actorOf(user), { itemId, countedQuantity: int(formData, "countedQuantity") ?? NaN, reason: values.reason }); message = `Adjusted by ${t.quantity > 0 ? "+" : ""}${t.quantity}; ${t.balanceAfter} on hand.`; break; }
      case "TRANSFER": { if (!userCan(user, "inv.goods_in")) throw new InventoryError("FORBIDDEN", "Transfers need the Inventory supervisor or an Admin."); await transferItem({ itemId, actorId: user.id, toSiteId: values.toSiteId, quantity, notes: values.notes }); message = "Transferred."; break; }
      case "RETIRE": { if (!userCan(user, "inv.writeoff")) throw new InventoryError("FORBIDDEN", "Only an Admin can retire items: record a write-off request."); await retireItem({ itemId, actorId: user.id, notes: values.notes }); message = "Retired."; break; }
      default: throw new InventoryError("VALIDATION", "Unknown action.");
    }
  } catch (error) {
    return fail(error, values);
  }
  revalidate(itemId, [str(formData, "returnPath")]);
  return { message };
}
