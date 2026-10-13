"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { ApiError } from "@sam/contract/index";
import { api } from "@/lib/api";
import { requireRole } from "@/lib/auth/authorize";
import { ALLOCATION_ADMIN_ROLES, ALLOCATION_OPERATE_ROLES } from "@sam/core/modules/allocations/access";

export type ActionState = { error?: string; message?: string };

function str(formData: FormData, key: string): string {
  return String(formData.get(key) ?? "").trim();
}

function revalidateAccommodation(allocationId?: string) {
  revalidatePath("/accommodation");
  revalidatePath("/accommodation/allocations");
  if (allocationId) revalidatePath(`/accommodation/allocations/${allocationId}`);
}

async function run<T>(fn: () => Promise<T>): Promise<{ ok: true; value: T } | { ok: false; error: string }> {
  try {
    return { ok: true, value: await fn() };
  } catch (error) {
    if (error instanceof ApiError && error.status < 500) return { ok: false, error: error.message };
    throw error;
  }
}

export async function allocateAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  await requireRole(ALLOCATION_OPERATE_ROLES);
  const result = await run(() =>
    api.allocations.allocate({
      staffId: str(formData, "staffId"),
      bedId: str(formData, "bedId"),
      startDate: str(formData, "startDate"),
      endDate: str(formData, "endDate") || undefined,
      reason: str(formData, "reason") || undefined,
    }),
  );
  if (!result.ok) return { error: result.error };
  revalidateAccommodation(result.value.id);
  redirect(`/accommodation/allocations/${result.value.id}`);
}

export async function checkInAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  await requireRole(ALLOCATION_OPERATE_ROLES);
  const id = str(formData, "allocationId");
  const result = await run(() => api.allocations.checkIn({ id, notes: str(formData, "notes") || undefined }));
  if (!result.ok) return { error: result.error };
  revalidateAccommodation(id);
  return { message: "Checked in." };
}

export async function checkOutAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  await requireRole(ALLOCATION_OPERATE_ROLES);
  const id = str(formData, "allocationId");
  const result = await run(() => api.allocations.checkOut({ id, notes: str(formData, "notes") || undefined, overrideReason: str(formData, "overrideReason") || undefined }));
  if (!result.ok) return { error: result.error };
  revalidateAccommodation(id);
  return { message: "Checked out." };
}

export async function cancelAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  await requireRole(ALLOCATION_ADMIN_ROLES);
  const id = str(formData, "allocationId");
  const result = await run(() => api.allocations.cancel({ id, reason: str(formData, "reason") }));
  if (!result.ok) return { error: result.error };
  revalidateAccommodation(id);
  return { message: "Allocation cancelled." };
}

export async function transferAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  await requireRole(ALLOCATION_OPERATE_ROLES);
  const id = str(formData, "allocationId");
  const result = await run(() =>
    api.allocations.transfer({
      id,
      toBedId: str(formData, "toBedId"),
      effectiveDate: str(formData, "effectiveDate"),
      reason: str(formData, "reason"),
      requestId: str(formData, "requestId") || undefined,
    }),
  );
  if (!result.ok) return { error: result.error };
  revalidateAccommodation(id);
  revalidateAccommodation(result.value.id);
  revalidatePath("/approvals");
  revalidatePath("/my/requests");
  redirect(`/accommodation/allocations/${result.value.id}`);
}
