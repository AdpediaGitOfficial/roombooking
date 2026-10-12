"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { WorkOrderPriority, WorkOrderStatus } from "@prisma/client";
import { requireUser, type CurrentUser } from "@/lib/auth/authorize";
import { MaintenanceError } from "./errors";
import { addNote, assignWorkOrder, changeStatus, createWorkOrder, triageWorkOrder, type Actor } from "./service";

export type FormState = { error?: string; fieldErrors?: Record<string, string>; values?: Record<string, string> };
export type ActionState = { error?: string; message?: string };

function str(formData: FormData, key: string): string {
  const v = formData.get(key);
  return typeof v === "string" ? v.trim() : "";
}

async function photoFrom(formData: FormData): Promise<{ bytes: Uint8Array; fileName: string } | null> {
  const file = formData.get("photo");
  if (!(file instanceof File) || file.size === 0) return null;
  return { bytes: new Uint8Array(await file.arrayBuffer()), fileName: file.name };
}

function actorOf(user: CurrentUser): Actor {
  return { id: user.id, roles: user.roleAssignments.map((r) => r.role), vendorId: user.vendorId };
}

function revalidateMaintenance(id?: string) {
  revalidatePath("/my");
  revalidatePath("/my/maintenance");
  revalidatePath("/maintenance");
  if (id) {
    revalidatePath(`/my/maintenance/${id}`);
    revalidatePath(`/maintenance/${id}`);
  }
}

export async function createWorkOrderAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const user = await requireUser("/my/maintenance/new");
  const values: Record<string, string> = {};
  for (const key of ["category", "priority", "description", "preferredContact", "locationNote", "roomId", "buildingId", "returnTo"]) values[key] = str(formData, key);
  let id: string;
  try {
    const created = await createWorkOrder({
      requesterId: user.id,
      roomId: values.roomId || null,
      buildingId: values.buildingId || null,
      locationNote: values.locationNote || null,
      category: values.category,
      description: values.description,
      priority: (values.priority || "MEDIUM") as WorkOrderPriority,
      preferredContact: values.preferredContact || null,
      photo: await photoFrom(formData),
    });
    id = created.id;
  } catch (error) {
    if (error instanceof MaintenanceError) return { error: error.message, fieldErrors: error.fieldErrors, values };
    throw error;
  }
  revalidateMaintenance(id);
  redirect(values.returnTo === "ops" ? `/maintenance/${id}` : `/my/maintenance/${id}`);
}

export async function assignAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requireUser("/maintenance");
  const workOrderId = str(formData, "workOrderId");
  const target = str(formData, "target"); // "user:<id>" | "vendor:<id>"
  const [kind, id] = target.split(":");
  try {
    await assignWorkOrder({ workOrderId, actor: actorOf(user), assigneeId: kind === "user" ? id : null, vendorId: kind === "vendor" ? id : null, note: str(formData, "note") || null });
  } catch (error) {
    if (error instanceof MaintenanceError) return { error: error.message };
    throw error;
  }
  revalidateMaintenance(workOrderId);
  return { message: "Assigned." };
}

export async function statusAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requireUser("/maintenance");
  const workOrderId = str(formData, "workOrderId");
  const status = str(formData, "status") as WorkOrderStatus;
  try {
    await changeStatus({ workOrderId, actor: actorOf(user), status, note: str(formData, "note") || null });
  } catch (error) {
    if (error instanceof MaintenanceError) return { error: error.message };
    throw error;
  }
  revalidateMaintenance(workOrderId);
  return { message: `Updated to ${status.toLowerCase().replace(/_/g, " ")}.` };
}

export async function triageAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requireUser("/maintenance");
  const workOrderId = str(formData, "workOrderId");
  try {
    await triageWorkOrder({ workOrderId, actor: actorOf(user), category: str(formData, "category") || null, priority: (str(formData, "priority") || null) as WorkOrderPriority | null, markTriaged: true });
  } catch (error) {
    if (error instanceof MaintenanceError) return { error: error.message };
    throw error;
  }
  revalidateMaintenance(workOrderId);
  return { message: "Triage saved." };
}

export async function noteAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requireUser("/maintenance");
  const workOrderId = str(formData, "workOrderId");
  try {
    await addNote({ workOrderId, actor: actorOf(user), note: str(formData, "note"), internal: str(formData, "internal") === "on", photo: await photoFrom(formData) });
  } catch (error) {
    if (error instanceof MaintenanceError) return { error: error.message };
    throw error;
  }
  revalidateMaintenance(workOrderId);
  return { message: "Note added." };
}
