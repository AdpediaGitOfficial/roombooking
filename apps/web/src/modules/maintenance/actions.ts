"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { ApiError } from "@sam/contract/index";
import { api } from "@/lib/api";
import { requireUser } from "@/lib/auth/authorize";

export type FormState = { error?: string; fieldErrors?: Record<string, string>; values?: Record<string, string> };
export type ActionState = { error?: string; message?: string };

function str(formData: FormData, key: string): string {
  const v = formData.get(key);
  return typeof v === "string" ? v.trim() : "";
}

/** An attached photo, or undefined when none was chosen. */
async function photoFrom(formData: FormData): Promise<{ bytes: Uint8Array; fileName: string } | undefined> {
  const file = formData.get("photo");
  if (!(file instanceof File) || file.size === 0) return undefined;
  return { bytes: new Uint8Array(await file.arrayBuffer()), fileName: file.name };
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

/** Runs an API call and turns a refusal into a message; real failures still surface. */
async function attempt<T>(call: () => Promise<T>): Promise<{ ok: true; value: T } | { ok: false; error: ApiError }> {
  try {
    return { ok: true, value: await call() };
  } catch (error) {
    if (error instanceof ApiError && error.status < 500) return { ok: false, error };
    throw error;
  }
}

export async function createWorkOrderAction(_prev: FormState, formData: FormData): Promise<FormState> {
  await requireUser("/my/maintenance/new");
  const values: Record<string, string> = {};
  for (const key of ["category", "priority", "description", "preferredContact", "locationNote", "roomId", "buildingId", "returnTo"]) values[key] = str(formData, key);
  const result = await attempt(async () =>
    api.maintenance.create({
      category: values.category,
      description: values.description,
      priority: (values.priority || "MEDIUM") as "LOW" | "MEDIUM" | "HIGH" | "URGENT",
      roomId: values.roomId || undefined,
      buildingId: values.buildingId || undefined,
      locationNote: values.locationNote || undefined,
      preferredContact: values.preferredContact || undefined,
      photo: await photoFrom(formData),
    }),
  );
  if (!result.ok) return { error: result.error.message, fieldErrors: result.error.fieldErrors, values };
  const id = result.value.id;
  revalidateMaintenance(id);
  redirect(values.returnTo === "ops" ? `/maintenance/${id}` : `/my/maintenance/${id}`);
}

export async function assignAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  await requireUser("/maintenance");
  const id = str(formData, "workOrderId");
  const [kind, target] = str(formData, "target").split(":"); // "user:<id>" | "vendor:<id>"
  const result = await attempt(() =>
    api.maintenance.assign({ id, assigneeId: kind === "user" ? target : undefined, vendorId: kind === "vendor" ? target : undefined, note: str(formData, "note") || undefined }),
  );
  if (!result.ok) return { error: result.error.message };
  revalidateMaintenance(id);
  return { message: "Assigned." };
}

export async function statusAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  await requireUser("/maintenance");
  const id = str(formData, "workOrderId");
  const status = str(formData, "status") as Parameters<typeof api.maintenance.changeStatus>[0]["status"];
  const result = await attempt(() => api.maintenance.changeStatus({ id, status, note: str(formData, "note") || undefined }));
  if (!result.ok) return { error: result.error.message };
  revalidateMaintenance(id);
  return { message: `Updated to ${status.toLowerCase().replace(/_/g, " ")}.` };
}

export async function triageAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  await requireUser("/maintenance");
  const id = str(formData, "workOrderId");
  const priority = str(formData, "priority") as "LOW" | "MEDIUM" | "HIGH" | "URGENT" | "";
  const result = await attempt(() => api.maintenance.triage({ id, category: str(formData, "category") || undefined, priority: priority || undefined }));
  if (!result.ok) return { error: result.error.message };
  revalidateMaintenance(id);
  return { message: "Triage saved." };
}

export async function noteAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  await requireUser("/maintenance");
  const id = str(formData, "workOrderId");
  const result = await attempt(async () => api.maintenance.addNote({ id, note: str(formData, "note"), internal: str(formData, "internal") === "on", photo: await photoFrom(formData) }));
  if (!result.ok) return { error: result.error.message };
  revalidateMaintenance(id);
  return { message: "Note added." };
}
