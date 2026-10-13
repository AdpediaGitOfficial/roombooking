"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireRole } from "@/lib/auth/authorize";
import { KEY_MANAGE_ROLES, KEY_OPERATE_ROLES } from "@sam/core/modules/keys/access";
import { KeyError } from "@sam/core/modules/keys/errors";
import { issueKey, markFound, registerKey, replaceKey, reportDamaged, reportLost, retireKey, returnKey, setRepairState } from "@sam/core/modules/keys/service";

export type FormState = { error?: string; fieldErrors?: Record<string, string>; values?: Record<string, string> };
export type ActionState = { error?: string; message?: string };

const str = (fd: FormData, k: string) => { const v = fd.get(k); return typeof v === "string" ? v.trim() : ""; };

function revalidateKeys(keyId?: string, extra: string[] = []) {
  revalidatePath("/keys");
  revalidatePath("/my/stay");
  if (keyId) revalidatePath(`/keys/${keyId}`);
  for (const p of extra) revalidatePath(p);
}

async function run(fn: () => Promise<unknown>): Promise<string | null> {
  try { await fn(); return null; } catch (error) {
    if (error instanceof KeyError) return error.message;
    throw error;
  }
}

export async function registerKeyAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const user = await requireRole(KEY_MANAGE_ROLES, "/keys");
  const values: Record<string, string> = {};
  for (const k of ["siteId", "code", "label", "roomId", "facilityId", "allowCopies", "notes"]) values[k] = str(formData, k);
  let id: string;
  try {
    const key = await registerKey({ siteId: values.siteId, code: values.code, label: values.label, roomId: values.roomId || null, facilityId: values.facilityId || null, allowCopies: values.allowCopies === "on", notes: values.notes, actorId: user.id });
    id = key.id;
  } catch (error) {
    if (error instanceof KeyError) return { error: error.message, fieldErrors: error.fieldErrors, values };
    throw error;
  }
  revalidateKeys(id);
  redirect(`/keys/${id}`);
}

export async function issueKeyAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requireRole(KEY_OPERATE_ROLES, "/keys");
  const keyId = str(formData, "keyId");
  const error = await run(() => issueKey({ keyId, actorId: user.id, holderStaffId: str(formData, "holderStaffId") || null, holderName: str(formData, "holderName") || null, condition: str(formData, "condition") || null, expectedReturnAt: str(formData, "expectedReturnAt") || null, notes: str(formData, "notes") || null }));
  if (error) return { error };
  revalidateKeys(keyId, [str(formData, "returnPath")].filter(Boolean));
  return { message: "Key issued." };
}

export async function returnKeyAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requireRole(KEY_OPERATE_ROLES, "/keys");
  const keyId = str(formData, "keyId");
  const error = await run(() => returnKey({ keyId, actorId: user.id, condition: str(formData, "condition") || null, notes: str(formData, "notes") || null }));
  if (error) return { error };
  revalidateKeys(keyId, [str(formData, "returnPath")].filter(Boolean));
  return { message: "Key returned." };
}

export async function keyExceptionAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requireRole(KEY_MANAGE_ROLES, "/keys");
  const keyId = str(formData, "keyId");
  const kind = str(formData, "kind");
  const notes = str(formData, "notes");
  let message = "Saved.";
  const error = await run(async () => {
    switch (kind) {
      case "LOST": await reportLost({ keyId, actorId: user.id, notes, incidentRef: str(formData, "incidentRef") || null }); message = "Recorded as lost. The holder remains accountable until the key is replaced or found."; break;
      case "FOUND": await markFound({ keyId, actorId: user.id, notes }); message = "Recorded as found."; break;
      case "DAMAGED": await reportDamaged({ keyId, actorId: user.id, notes }); message = "Recorded as damaged."; break;
      case "SEND_REPAIR": await setRepairState({ keyId, actorId: user.id, state: "UNDER_REPAIR", notes }); message = "Sent for repair."; break;
      case "BACK_REPAIR": await setRepairState({ keyId, actorId: user.id, state: "AVAILABLE", notes }); message = "Back in service."; break;
      case "RETIRE": await retireKey({ keyId, actorId: user.id, notes }); message = "Key retired."; break;
      default: throw new KeyError("VALIDATION", "Unknown action.");
    }
  });
  if (error) return { error };
  revalidateKeys(keyId);
  return { message };
}

export async function replaceKeyAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requireRole(KEY_MANAGE_ROLES, "/keys");
  const keyId = str(formData, "keyId");
  let newId: string | null = null;
  const error = await run(async () => { newId = (await replaceKey({ keyId, actorId: user.id, newCode: str(formData, "newCode"), notes: str(formData, "notes") || null })).id; });
  if (error) return { error };
  revalidateKeys(keyId);
  if (newId) { revalidatePath(`/keys/${newId}`); redirect(`/keys/${newId}`); }
  return { message: "Replaced." };
}
