"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { ApiError } from "@sam/contract/index";
import { api } from "@/lib/api";
import { requireRole, requireUser } from "@/lib/auth/authorize";
import { LOST_FOUND_MANAGE_ROLES, LOST_FOUND_OPERATE_ROLES } from "@sam/core/modules/lost-found/access";

export type FormState = { error?: string; message?: string; fieldErrors?: Record<string, string>; values?: Record<string, string> };

const str = (fd: FormData, k: string) => { const v = fd.get(k); return typeof v === "string" ? v.trim() : ""; };
async function files(fd: FormData, key: string): Promise<Array<{ bytes: Uint8Array; fileName: string }>> {
  const out: Array<{ bytes: Uint8Array; fileName: string }> = [];
  for (const f of fd.getAll(key)) if (f instanceof File && f.size > 0) out.push({ bytes: new Uint8Array(await f.arrayBuffer()), fileName: f.name });
  return out;
}

function revalidate(itemId?: string) {
  revalidatePath("/lost-found");
  revalidatePath("/my/lost-found");
  revalidatePath("/my");
  if (itemId) { revalidatePath(`/lost-found/${itemId}`); revalidatePath(`/my/lost-found/${itemId}`); }
}

function fail(error: unknown, values?: Record<string, string>): FormState {
  if (error instanceof ApiError && error.status < 500) return { error: error.message, fieldErrors: error.fieldErrors, values };
  throw error;
}

export async function registerItemAction(_prev: FormState, formData: FormData): Promise<FormState> {
  await requireRole(LOST_FOUND_OPERATE_ROLES, "/lost-found");
  const values: Record<string, string> = {};
  for (const k of ["siteId", "description", "category", "foundLocation", "foundAt", "foundByName", "storageLocation", "notes", "retentionDays"]) values[k] = str(formData, k);
  let id: string;
  try {
    const item = await api.lostFound.create({
      siteId: values.siteId, description: values.description, category: values.category || undefined, foundLocation: values.foundLocation || undefined, foundAt: values.foundAt,
      foundByName: values.foundByName || undefined, storageLocation: values.storageLocation || undefined, notes: values.notes || undefined,
      retentionDays: values.retentionDays ? Number(values.retentionDays) : undefined, photos: await files(formData, "photos"),
    });
    id = item.id;
  } catch (error) {
    return fail(error, values);
  }
  revalidate(id);
  redirect(`/lost-found/${id}`);
}

export async function updateItemAction(_prev: FormState, formData: FormData): Promise<FormState> {
  await requireRole(LOST_FOUND_OPERATE_ROLES, "/lost-found");
  const values: Record<string, string> = {};
  for (const k of ["itemId", "description", "category", "foundLocation", "foundByName", "notes", "retainUntil"]) values[k] = str(formData, k);
  try {
    await api.lostFound.update({ id: values.itemId, description: values.description, category: values.category || undefined, foundLocation: values.foundLocation || undefined, foundByName: values.foundByName || undefined, notes: values.notes || undefined, retainUntil: values.retainUntil || undefined });
  } catch (error) {
    return fail(error, values);
  }
  revalidate(values.itemId);
  return { message: "Saved.", values };
}

/** Store, photo, record claim, decide, hand over, dispose, withdraw: one handler keyed by `kind`. */
export async function itemAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const kind = str(formData, "kind");
  if (kind === "DISPOSE") await requireRole(LOST_FOUND_MANAGE_ROLES, "/lost-found");
  else if (kind === "WITHDRAW") await requireUser("/my/lost-found");
  else await requireRole(LOST_FOUND_OPERATE_ROLES, "/lost-found");
  const itemId = str(formData, "itemId");
  const values: Record<string, string> = {};
  for (const k of ["kind", "storageLocation", "notes", "note", "claimantStaffId", "claimantName", "claimantContact", "evidence", "recipientName", "method", "claimId"]) values[k] = str(formData, k);
  let message = "Saved.";
  try {
    switch (kind) {
      case "STORE": await api.lostFound.store({ id: itemId, storageLocation: values.storageLocation, notes: values.notes || undefined }); message = "Stored."; break;
      case "PHOTO": {
        const [photo] = await files(formData, "photo");
        if (!photo) return { error: "Choose a photo.", fieldErrors: { photo: "Required." }, values };
        await api.lostFound.addPhoto({ id: itemId, photo });
        message = "Photo added.";
        break;
      }
      case "CLAIM":
        await api.lostFound.recordClaim({ id: itemId, evidence: values.evidence, claimantStaffId: values.claimantStaffId || undefined, claimantName: values.claimantName || undefined, claimantContact: values.claimantContact || undefined });
        message = "Claim recorded; verify it below.";
        break;
      case "VERIFY": await api.lostFound.decideClaim({ id: values.claimId, verified: true, note: values.note || undefined }); message = "Claim verified. Record the handover once the owner collects the item."; break;
      case "REJECT": await api.lostFound.decideClaim({ id: values.claimId, verified: false, note: values.note || undefined }); message = "Claim rejected."; break;
      case "HANDOVER": {
        const [evidence] = await files(formData, "evidence");
        await api.lostFound.handOver({ id: itemId, recipientName: values.recipientName || undefined, note: values.note || undefined, evidence });
        message = "Handover recorded.";
        break;
      }
      case "DISPOSE": await api.lostFound.dispose({ id: itemId, method: values.method, note: values.note }); message = "Disposal recorded."; break;
      case "WITHDRAW": await api.lostFound.withdrawClaim({ id: values.claimId }); message = "Claim withdrawn."; break;
      default: return { error: "Unknown action.", values };
    }
  } catch (error) {
    return fail(error, values);
  }
  revalidate(itemId);
  return { message };
}

/** Resident submits a claim from the self-service portal. */
export async function myClaimAction(_prev: FormState, formData: FormData): Promise<FormState> {
  await requireUser("/my/lost-found");
  const itemId = str(formData, "itemId");
  const values = { evidence: str(formData, "evidence"), claimantContact: str(formData, "claimantContact") };
  try {
    await api.lostFound.claim({ id: itemId, evidence: values.evidence, claimantContact: values.claimantContact || undefined });
  } catch (error) {
    return fail(error, values);
  }
  revalidate(itemId);
  return { message: "Claim submitted. The accommodation office will check it and let you know." };
}
