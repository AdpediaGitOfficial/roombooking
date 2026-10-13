"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { StayType } from "@prisma/client";
import { actorOf, hasRole, requireRole } from "@/lib/auth/authorize";
import { guardScope } from "@/lib/auth/guards";
import { ALLOCATION_ADMIN_ROLES, ALLOCATION_OPERATE_ROLES } from "@sam/core/modules/allocations/access";
import { AllocationError } from "@sam/core/modules/allocations/errors";
import { RequestError } from "@sam/core/modules/requests/errors";
import { allocate, cancel, checkIn, checkOut, transfer } from "@sam/core/modules/allocations/service";

export type ActionState = { error?: string; message?: string };

function str(formData: FormData, key: string): string {
  return String(formData.get(key) ?? "").trim();
}

/** Ticks and notes from a check-in or check-out checklist: fields named check_<item id>. */
function checklistFrom(formData: FormData): Record<string, boolean | string> | null {
  const out: Record<string, boolean | string> = {};
  for (const [k, v] of formData.entries()) if (k.startsWith("check_") && typeof v === "string") out[k.slice(6)] = v === "on" ? true : v;
  return Object.keys(out).length ? out : null;
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
    if (error instanceof AllocationError || error instanceof RequestError) return { ok: false, error: error.message };
    throw error;
  }
}

export async function allocateAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  // Admin decides, Reception executes: placing someone in a bed is the Admin's decision (document principle 5).
  const user = await requireRole(ALLOCATION_ADMIN_ROLES);
  await guardScope(user, "accom.view", formData, [["allocationId", "allocation"], ["bedId", "bed"], ["toBedId", "bed"]]);
  const result = await run(() =>
    allocate({
      staffId: str(formData, "staffId"),
      bedId: str(formData, "bedId"),
      startDate: str(formData, "startDate"),
      endDate: str(formData, "endDate") || null,
      reason: str(formData, "reason") || null,
      actorId: user.id,
      actor: actorOf(user),
      stayType: (str(formData, "stayType") || undefined) as StayType | undefined,
      eligibilityOverrideReason: str(formData, "eligibilityOverrideReason") || null,
    }),
  );
  if (!result.ok) return { error: result.error };
  revalidateAccommodation(result.value.id);
  redirect(`/accommodation/allocations/${result.value.id}`);
}

export async function checkInAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requireRole(ALLOCATION_OPERATE_ROLES);
  await guardScope(user, "accom.view", formData, [["allocationId", "allocation"], ["bedId", "bed"], ["toBedId", "bed"]]);
  const allocationId = str(formData, "allocationId");
  const result = await run(() => checkIn({ allocationId, actorId: user.id, notes: str(formData, "notes") || null, checklist: checklistFrom(formData), acceptNotReady: formData.get("acceptNotReady") === "on" }));
  if (!result.ok) return { error: result.error };
  revalidateAccommodation(allocationId);
  return { message: "Checked in." };
}

export async function checkOutAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requireRole(ALLOCATION_OPERATE_ROLES);
  await guardScope(user, "accom.view", formData, [["allocationId", "allocation"], ["bedId", "bed"], ["toBedId", "bed"]]);
  const allocationId = str(formData, "allocationId");
  const result = await run(() =>
    checkOut({
      allocationId,
      actorId: user.id,
      notes: str(formData, "notes") || null,
      overrideReason: str(formData, "overrideReason") || null,
      canOverride: hasRole(user, ...ALLOCATION_ADMIN_ROLES),
      checklist: checklistFrom(formData),
    }),
  );
  if (!result.ok) return { error: result.error };
  revalidateAccommodation(allocationId);
  return { message: "Checked out." };
}

export async function cancelAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requireRole(ALLOCATION_ADMIN_ROLES);
  await guardScope(user, "accom.view", formData, [["allocationId", "allocation"], ["bedId", "bed"], ["toBedId", "bed"]]);
  const allocationId = str(formData, "allocationId");
  const result = await run(() => cancel({ allocationId, actorId: user.id, reason: str(formData, "reason") }));
  if (!result.ok) return { error: result.error };
  revalidateAccommodation(allocationId);
  return { message: "Allocation cancelled." };
}

export async function transferAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requireRole(ALLOCATION_OPERATE_ROLES);
  await guardScope(user, "accom.view", formData, [["allocationId", "allocation"], ["bedId", "bed"], ["toBedId", "bed"]]);
  const allocationId = str(formData, "allocationId");
  const result = await run(() =>
    transfer({
      allocationId,
      toBedId: str(formData, "toBedId"),
      effectiveDate: str(formData, "effectiveDate"),
      reason: str(formData, "reason"),
      actorId: user.id,
      requestId: str(formData, "requestId") || null,
    }),
  );
  if (!result.ok) return { error: result.error };
  revalidateAccommodation(allocationId);
  revalidateAccommodation(result.value.id);
  revalidatePath("/approvals");
  revalidatePath("/my/requests");
  redirect(`/accommodation/allocations/${result.value.id}`);
}
