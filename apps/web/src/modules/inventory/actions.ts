"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { ApiError } from "@sam/contract/index";
import { api } from "@/lib/api";
import { requireRole } from "@/lib/auth/authorize";
import { INVENTORY_MANAGE_ROLES, INVENTORY_OPERATE_ROLES } from "@sam/core/modules/inventory/access";
import { CONDITIONS } from "@sam/core/modules/inventory/rules";

export type FormState = { error?: string; message?: string; fieldErrors?: Record<string, string>; values?: Record<string, string> };
export type ActionState = { error?: string; message?: string };

type Condition = "NEW" | "GOOD" | "FAIR" | "DAMAGED";
type Movement = Parameters<typeof api.inventory.movement>[0];

const str = (fd: FormData, k: string) => { const v = fd.get(k); return typeof v === "string" ? v.trim() : ""; };
/** A whole number from a form field: undefined when blank, 0 when it is not a number (the API then rejects it with its usual message). */
const int = (fd: FormData, k: string) => { const s = str(fd, k); if (s === "") return undefined; const n = Number(s); return Number.isFinite(n) ? Math.trunc(n) : 0; };
const condition = (fd: FormData): Condition | undefined => { const c = str(fd, "condition"); return (CONDITIONS as string[]).includes(c) ? (c as Condition) : undefined; };

/** The destination is submitted as "room:<id>", "staff:<id>" or "facility:<id>". */
function target(fd: FormData): Pick<Movement, "roomId" | "staffId" | "facilityId"> {
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
  if (error instanceof ApiError && error.status < 500) return { error: error.message, fieldErrors: error.fieldErrors, values };
  throw error;
}

export async function createItemAction(_prev: FormState, formData: FormData): Promise<FormState> {
  await requireRole(INVENTORY_MANAGE_ROLES, "/inventory");
  const values: Record<string, string> = {};
  for (const k of ["siteId", "sku", "name", "category", "description", "unit", "trackingType", "serialNumber", "condition", "reorderThreshold", "storageLocation", "openingQuantity", "notes"]) values[k] = str(formData, k);
  let id: string;
  try {
    const item = await api.inventory.create({
      siteId: values.siteId, sku: values.sku, name: values.name, category: values.category, description: values.description || undefined, unit: values.unit || undefined,
      trackingType: values.trackingType === "SERIALIZED" ? "SERIALIZED" : "STOCK", serialNumber: values.serialNumber || undefined, condition: condition(formData),
      reorderThreshold: int(formData, "reorderThreshold"), storageLocation: values.storageLocation || undefined, openingQuantity: int(formData, "openingQuantity"), notes: values.notes || undefined,
    });
    id = item.id;
  } catch (error) {
    return fail(error, values);
  }
  revalidate(id);
  redirect(`/inventory/${id}`);
}

export async function updateItemAction(_prev: FormState, formData: FormData): Promise<FormState> {
  await requireRole(INVENTORY_MANAGE_ROLES, "/inventory");
  const values: Record<string, string> = {};
  for (const k of ["itemId", "name", "category", "description", "unit", "condition", "reorderThreshold", "storageLocation", "notes"]) values[k] = str(formData, k);
  try {
    await api.inventory.update({ id: values.itemId, name: values.name, category: values.category, description: values.description || undefined, unit: values.unit || undefined, condition: condition(formData), reorderThreshold: int(formData, "reorderThreshold"), storageLocation: values.storageLocation || undefined, notes: values.notes || undefined });
  } catch (error) {
    return fail(error, values);
  }
  revalidate(values.itemId);
  return { message: "Item saved.", values };
}

/** Receive, issue, return, damage, adjust, transfer and retire share one handler keyed by `kind`. */
export async function movementAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const kind = str(formData, "kind") as Movement["kind"];
  const manageOnly = ["ADJUST", "TRANSFER", "RETIRE"].includes(kind);
  await requireRole(manageOnly ? INVENTORY_MANAGE_ROLES : INVENTORY_OPERATE_ROLES, "/inventory");
  const itemId = str(formData, "itemId");
  const values: Record<string, string> = {};
  for (const k of ["kind", "quantity", "target", "condition", "reference", "notes", "countedQuantity", "reason", "toSiteId"]) values[k] = str(formData, k);
  let message: string;
  try {
    ({ message } = await api.inventory.movement({
      id: itemId, kind, quantity: int(formData, "quantity"), ...target(formData), condition: condition(formData),
      reference: values.reference || undefined, notes: values.notes || undefined, countedQuantity: int(formData, "countedQuantity"),
      reason: values.reason || undefined, toSiteId: values.toSiteId || undefined,
    }));
  } catch (error) {
    return fail(error, values);
  }
  revalidate(itemId, [str(formData, "returnPath")]);
  return { message };
}
