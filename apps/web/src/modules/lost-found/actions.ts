"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireRole, requireUser } from "@/lib/auth/authorize";
import { prisma } from "@sam/core/lib/db";
import { LOST_FOUND_MANAGE_ROLES, LOST_FOUND_OPERATE_ROLES } from "@sam/core/modules/lost-found/access";
import { actorFor } from "./context";
import { LostFoundError } from "@sam/core/modules/lost-found/errors";
import { addPhoto, decideClaim, disposeItem, handOver, registerItem, storeItem, submitClaim, updateItem, withdrawClaim } from "@sam/core/modules/lost-found/service";

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
  if (error instanceof LostFoundError) return { error: error.message, fieldErrors: error.fieldErrors, values };
  throw error;
}

export async function registerItemAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const user = await requireRole(LOST_FOUND_OPERATE_ROLES, "/lost-found");
  const values: Record<string, string> = {};
  for (const k of ["siteId", "description", "category", "foundLocation", "foundAt", "foundByName", "storageLocation", "notes", "retentionDays"]) values[k] = str(formData, k);
  let id: string;
  try {
    const item = await registerItem({ siteId: values.siteId, actorId: user.id, description: values.description, category: values.category, foundLocation: values.foundLocation, foundAt: values.foundAt, foundByName: values.foundByName, storageLocation: values.storageLocation, notes: values.notes, retentionDays: values.retentionDays ? Number(values.retentionDays) : null, photos: await files(formData, "photos") });
    id = item.id;
  } catch (error) {
    return fail(error, values);
  }
  revalidate(id);
  redirect(`/lost-found/${id}`);
}

export async function updateItemAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const user = await requireRole(LOST_FOUND_OPERATE_ROLES, "/lost-found");
  const values: Record<string, string> = {};
  for (const k of ["itemId", "description", "category", "foundLocation", "foundByName", "notes", "retainUntil"]) values[k] = str(formData, k);
  try {
    await updateItem({ itemId: values.itemId, actorId: user.id, description: values.description, category: values.category, foundLocation: values.foundLocation, foundByName: values.foundByName, notes: values.notes, retainUntil: values.retainUntil || null });
  } catch (error) {
    return fail(error, values);
  }
  revalidate(values.itemId);
  return { message: "Saved.", values };
}

/** Store, photo, record claim, decide, hand over, dispose, withdraw: one handler keyed by `kind`. */
export async function itemAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const kind = str(formData, "kind");
  const user = kind === "DISPOSE" ? await requireRole(LOST_FOUND_MANAGE_ROLES, "/lost-found") : kind === "WITHDRAW" ? await requireUser("/my/lost-found") : await requireRole(LOST_FOUND_OPERATE_ROLES, "/lost-found");
  const actor = actorFor(user);
  const itemId = str(formData, "itemId");
  const values: Record<string, string> = {};
  for (const k of ["kind", "storageLocation", "notes", "note", "claimantStaffId", "claimantName", "claimantContact", "evidence", "recipientName", "method", "claimId"]) values[k] = str(formData, k);
  let message = "Saved.";
  try {
    switch (kind) {
      case "STORE": await storeItem({ itemId, actorId: user.id, storageLocation: values.storageLocation, notes: values.notes }); message = "Stored."; break;
      case "PHOTO": { const [photo] = await files(formData, "photo"); if (!photo) throw new LostFoundError("VALIDATION", "Choose a photo.", { photo: "Required." }); await addPhoto({ itemId, actorId: user.id, photo }); message = "Photo added."; break; }
      case "CLAIM": {
        const staff = values.claimantStaffId ? await prisma.staffProfile.findUnique({ where: { id: values.claimantStaffId } }) : null;
        await submitClaim({ itemId, actor, evidence: values.evidence, claimantId: staff?.id ?? null, claimantUserId: staff?.userId ?? null, claimantName: staff ? null : values.claimantName, claimantContact: values.claimantContact });
        message = "Claim recorded; verify it below."; break;
      }
      case "VERIFY": await decideClaim({ claimId: values.claimId, actor, verified: true, note: values.note }); message = "Claim verified. Record the handover once the owner collects the item."; break;
      case "REJECT": await decideClaim({ claimId: values.claimId, actor, verified: false, note: values.note }); message = "Claim rejected."; break;
      case "HANDOVER": { const [evidence] = await files(formData, "evidence"); await handOver({ itemId, actor, recipientName: values.recipientName, note: values.note, evidence: evidence ?? null }); message = "Handover recorded."; break; }
      case "DISPOSE": await disposeItem({ itemId, actor, method: values.method, note: values.note }); message = "Disposal recorded."; break;
      case "WITHDRAW": await withdrawClaim({ claimId: values.claimId, actor }); message = "Claim withdrawn."; break;
      default: throw new LostFoundError("VALIDATION", "Unknown action.");
    }
  } catch (error) {
    return fail(error, values);
  }
  revalidate(itemId);
  return { message };
}

/** Resident submits a claim from the self-service portal. */
export async function myClaimAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const user = await requireUser("/my/lost-found");
  const itemId = str(formData, "itemId");
  const values = { evidence: str(formData, "evidence"), claimantContact: str(formData, "claimantContact") };
  try {
    const staff = await prisma.staffProfile.findUnique({ where: { userId: user.id } });
    await submitClaim({ itemId, actor: actorFor(user), evidence: values.evidence, claimantId: staff?.id ?? null, claimantUserId: user.id, claimantName: staff ? null : user.name, claimantContact: values.claimantContact || user.email });
  } catch (error) {
    return fail(error, values);
  }
  revalidate(itemId);
  return { message: "Claim submitted. The accommodation office will check it and let you know." };
}
