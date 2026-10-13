"use server";

import { revalidatePath } from "next/cache";
import { ApiError } from "@sam/contract/index";
import { api } from "@/lib/api";
import { requireRole } from "@/lib/auth/authorize";
import { APPROVALS_AREA_ROLES } from "@sam/core/modules/requests/access";

type Role = NonNullable<Parameters<typeof api.delegations.create>[0]["roles"]>[number];
export type DelegationState = { error?: string; message?: string; fieldErrors?: Record<string, string>; values?: Record<string, string> };
const str = (fd: FormData, k: string) => { const v = fd.get(k); return typeof v === "string" ? v.trim() : ""; };

function revalidate() {
  revalidatePath("/approvals");
  revalidatePath("/approvals/delegations");
  revalidatePath("/my");
}

export async function createDelegationAction(_prev: DelegationState, formData: FormData): Promise<DelegationState> {
  const user = await requireRole(APPROVALS_AREA_ROLES, "/approvals/delegations");
  const values: Record<string, string> = { delegatorId: str(formData, "delegatorId") || user.id, delegateId: str(formData, "delegateId"), startsAt: str(formData, "startsAt"), endsAt: str(formData, "endsAt"), reason: str(formData, "reason"), roles: formData.getAll("roles").filter((r): r is string => typeof r === "string").join(",") };
  try {
    await api.delegations.create({
      delegatorId: values.delegatorId, delegateId: values.delegateId, roles: values.roles ? (values.roles.split(",") as Role[]) : [],
      startsAt: values.startsAt, endsAt: values.endsAt, reason: values.reason || undefined,
    });
  } catch (error) {
    if (error instanceof ApiError && error.status < 500) return { error: error.message, fieldErrors: error.fieldErrors, values };
    throw error;
  }
  revalidate();
  return { message: `Cover arranged from ${values.startsAt} to ${values.endsAt}.` };
}

export async function revokeDelegationAction(_prev: DelegationState, formData: FormData): Promise<DelegationState> {
  await requireRole(APPROVALS_AREA_ROLES, "/approvals/delegations");
  try {
    await api.delegations.revoke({ id: str(formData, "delegationId"), reason: str(formData, "reason") || undefined });
  } catch (error) {
    if (error instanceof ApiError && error.status < 500) return { error: error.message };
    throw error;
  }
  revalidate();
  return { message: "Delegation ended." };
}
