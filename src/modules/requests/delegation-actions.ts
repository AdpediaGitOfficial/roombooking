"use server";

import { revalidatePath } from "next/cache";
import type { Role } from "@prisma/client";
import { hasRole, requireRole } from "@/lib/auth/authorize";
import { APPROVALS_AREA_ROLES, REQUEST_ADMIN_ROLES } from "./access";
import { RequestError } from "./errors";
import { createDelegation, revokeDelegation } from "./delegations";

export type DelegationState = { error?: string; message?: string; fieldErrors?: Record<string, string>; values?: Record<string, string> };
const str = (fd: FormData, k: string) => { const v = fd.get(k); return typeof v === "string" ? v.trim() : ""; };

function revalidate() {
  revalidatePath("/approvals");
  revalidatePath("/approvals/delegations");
  revalidatePath("/my");
}

export async function createDelegationAction(_prev: DelegationState, formData: FormData): Promise<DelegationState> {
  const user = await requireRole(APPROVALS_AREA_ROLES, "/approvals/delegations");
  const isAdmin = hasRole(user, ...REQUEST_ADMIN_ROLES);
  const values: Record<string, string> = { delegatorId: str(formData, "delegatorId") || user.id, delegateId: str(formData, "delegateId"), startsAt: str(formData, "startsAt"), endsAt: str(formData, "endsAt"), reason: str(formData, "reason"), roles: formData.getAll("roles").filter((r): r is string => typeof r === "string").join(",") };
  try {
    await createDelegation({ delegatorId: values.delegatorId, delegateId: values.delegateId, roles: values.roles ? (values.roles.split(",") as Role[]) : [], startsAt: values.startsAt, endsAt: values.endsAt, reason: values.reason, actor: { id: user.id, isAdmin } });
  } catch (error) {
    if (error instanceof RequestError) return { error: error.message, fieldErrors: error.fieldErrors, values };
    throw error;
  }
  revalidate();
  return { message: `Cover arranged from ${values.startsAt} to ${values.endsAt}.` };
}

export async function revokeDelegationAction(_prev: DelegationState, formData: FormData): Promise<DelegationState> {
  const user = await requireRole(APPROVALS_AREA_ROLES, "/approvals/delegations");
  try {
    await revokeDelegation({ delegationId: str(formData, "delegationId"), actor: { id: user.id, isAdmin: hasRole(user, ...REQUEST_ADMIN_ROLES) }, reason: str(formData, "reason") || null });
  } catch (error) {
    if (error instanceof RequestError) return { error: error.message };
    throw error;
  }
  revalidate();
  return { message: "Delegation ended." };
}
