"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { ApiError } from "@sam/contract/index";
import { api } from "@/lib/api";
import { requireRole } from "@/lib/auth/authorize";
import { KEY_MANAGE_ROLES, KEY_OPERATE_ROLES } from "@sam/core/modules/keys/access";

export type FormState = { error?: string; fieldErrors?: Record<string, string>; values?: Record<string, string> };
export type ActionState = { error?: string; message?: string };

const str = (fd: FormData, k: string) => { const v = fd.get(k); return typeof v === "string" ? v.trim() : ""; };

function revalidateKeys(keyId?: string, extra: string[] = []) {
  revalidatePath("/keys");
  revalidatePath("/my/stay");
  if (keyId) revalidatePath(`/keys/${keyId}`);
  for (const p of extra) revalidatePath(p);
}

async function attempt<T>(call: () => Promise<T>): Promise<{ ok: true; value: T } | { ok: false; error: ApiError }> {
  try {
    return { ok: true, value: await call() };
  } catch (error) {
    if (error instanceof ApiError && error.status < 500) return { ok: false, error };
    throw error;
  }
}

export async function registerKeyAction(_prev: FormState, formData: FormData): Promise<FormState> {
  await requireRole(KEY_MANAGE_ROLES, "/keys");
  const values: Record<string, string> = {};
  for (const k of ["siteId", "code", "label", "roomId", "facilityId", "allowCopies", "notes"]) values[k] = str(formData, k);
  const result = await attempt(() =>
    api.keys.create({ siteId: values.siteId, code: values.code, label: values.label || undefined, roomId: values.roomId || undefined, facilityId: values.facilityId || undefined, allowCopies: values.allowCopies === "on", notes: values.notes || undefined }),
  );
  if (!result.ok) return { error: result.error.message, fieldErrors: result.error.fieldErrors, values };
  revalidateKeys(result.value.id);
  redirect(`/keys/${result.value.id}`);
}

export async function issueKeyAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  await requireRole(KEY_OPERATE_ROLES, "/keys");
  const id = str(formData, "keyId");
  const result = await attempt(() =>
    api.keys.issue({ id, holderStaffId: str(formData, "holderStaffId") || undefined, holderName: str(formData, "holderName") || undefined, condition: str(formData, "condition") || undefined, expectedReturnAt: str(formData, "expectedReturnAt") || undefined, notes: str(formData, "notes") || undefined }),
  );
  if (!result.ok) return { error: result.error.message };
  revalidateKeys(id, [str(formData, "returnPath")].filter(Boolean));
  return { message: "Key issued." };
}

export async function returnKeyAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  await requireRole(KEY_OPERATE_ROLES, "/keys");
  const id = str(formData, "keyId");
  const result = await attempt(() => api.keys.returnKey({ id, condition: str(formData, "condition") || undefined, notes: str(formData, "notes") || undefined }));
  if (!result.ok) return { error: result.error.message };
  revalidateKeys(id, [str(formData, "returnPath")].filter(Boolean));
  return { message: "Key returned." };
}

export async function keyExceptionAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  await requireRole(KEY_MANAGE_ROLES, "/keys");
  const id = str(formData, "keyId");
  const kind = str(formData, "kind");
  if (!["LOST", "FOUND", "DAMAGED", "SEND_REPAIR", "BACK_REPAIR", "RETIRE"].includes(kind)) return { error: "Unknown action." };
  const result = await attempt(() => api.keys.exception({ id, kind: kind as "LOST", notes: str(formData, "notes"), incidentRef: str(formData, "incidentRef") || undefined }));
  if (!result.ok) return { error: result.error.message };
  revalidateKeys(id);
  return { message: result.value.message };
}

export async function replaceKeyAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  await requireRole(KEY_MANAGE_ROLES, "/keys");
  const id = str(formData, "keyId");
  const result = await attempt(() => api.keys.replace({ id, newCode: str(formData, "newCode"), notes: str(formData, "notes") || undefined }));
  if (!result.ok) return { error: result.error.message };
  revalidateKeys(id);
  revalidatePath(`/keys/${result.value.id}`);
  redirect(`/keys/${result.value.id}`);
}
