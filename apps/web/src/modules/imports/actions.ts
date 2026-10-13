"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { ApiError } from "@sam/contract/index";
import { api } from "@/lib/api";
import { requireRole } from "@/lib/auth/authorize";
import { IMPORT_ROLES, type ImportKind } from "@sam/core/modules/imports/rules";

export type ImportState = { error?: string; message?: string };
const MAX_BYTES = 2 * 1024 * 1024;

export async function uploadAction(_prev: ImportState, formData: FormData): Promise<ImportState> {
  await requireRole(IMPORT_ROLES, "/admin/import");
  const kind = String(formData.get("kind") ?? "") as ImportKind;
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) return { error: "Choose a CSV file." };
  if (file.size > MAX_BYTES) return { error: "Files must be 2 MB or smaller." };
  let id: string;
  try {
    id = (await api.imports.preview({ kind, file: { bytes: new Uint8Array(await file.arrayBuffer()), fileName: file.name } })).id;
  } catch (error) {
    if (error instanceof ApiError && error.status < 500) return { error: error.message };
    throw error;
  }
  revalidatePath("/admin/import");
  redirect(`/admin/import/${id}`);
}

export async function commitAction(_prev: ImportState, formData: FormData): Promise<ImportState> {
  await requireRole(IMPORT_ROLES, "/admin/import");
  const batchId = String(formData.get("batchId") ?? "");
  try {
    const done = await api.imports.commit({ id: batchId, skipErrors: String(formData.get("skipErrors") ?? "") === "on" });
    const r = done.result as { create: number; update: number; skipped: number };
    revalidatePath("/admin/import"); revalidatePath(`/admin/import/${batchId}`); revalidatePath("/accommodation"); revalidatePath("/admin/users");
    return { message: `Imported: ${r.create} created, ${r.update} updated${r.skipped ? `, ${r.skipped} skipped` : ""}.` };
  } catch (error) {
    if (error instanceof ApiError && error.status < 500) return { error: error.message };
    throw error;
  }
}

export async function discardAction(_prev: ImportState, formData: FormData): Promise<ImportState> {
  await requireRole(IMPORT_ROLES, "/admin/import");
  const batchId = String(formData.get("batchId") ?? "");
  try {
    await api.imports.discard({ id: batchId });
  } catch (error) {
    if (error instanceof ApiError && error.status < 500) return { error: error.message };
    throw error;
  }
  revalidatePath("/admin/import"); revalidatePath(`/admin/import/${batchId}`);
  return { message: "Discarded." };
}
