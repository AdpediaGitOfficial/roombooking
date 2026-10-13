"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { DecisionAction } from "@prisma/client";
import { requireRole, requireUser } from "@/lib/auth/authorize";
import { APPROVALS_AREA_ROLES } from "./access";
import { RequestError } from "./errors";
import { decideRequest, resubmitRequest, submitRequest, withDelegations, withdrawRequest } from "./service";

export type FormState = { error?: string; fieldErrors?: Record<string, string>; values?: Record<string, string> };
export type ActionState = { error?: string; message?: string };

const CONTROL_FIELDS = new Set(["typeCode", "requestId", "idempotencyKey"]);

function fieldValues(formData: FormData): Record<string, string> {
  const raw: Record<string, string> = {};
  for (const [key, value] of formData.entries()) {
    if (CONTROL_FIELDS.has(key) || typeof value !== "string") continue;
    raw[key] = value;
  }
  return raw;
}

function revalidateRequests(id?: string) {
  revalidatePath("/my");
  revalidatePath("/my/requests");
  revalidatePath("/approvals");
  if (id) {
    revalidatePath(`/my/requests/${id}`);
    revalidatePath(`/approvals/${id}`);
  }
}

export async function submitRequestAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const user = await requireUser("/my/requests/new");
  const raw = fieldValues(formData);
  let id: string;
  try {
    const { request } = await submitRequest({
      requesterId: user.id,
      organizationId: user.organizationId,
      typeCode: String(formData.get("typeCode") ?? ""),
      idempotencyKey: String(formData.get("idempotencyKey") ?? ""),
      raw,
    });
    id = request.id;
  } catch (error) {
    if (error instanceof RequestError) return { error: error.message, fieldErrors: error.fieldErrors, values: raw };
    throw error;
  }
  revalidateRequests(id);
  redirect(`/my/requests/${id}`);
}

export async function resubmitRequestAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const user = await requireUser("/my/requests");
  const requestId = String(formData.get("requestId") ?? "");
  const raw = fieldValues(formData);
  try {
    await resubmitRequest({ requestId, requesterId: user.id, raw });
  } catch (error) {
    if (error instanceof RequestError) return { error: error.message, fieldErrors: error.fieldErrors, values: raw };
    throw error;
  }
  revalidateRequests(requestId);
  redirect(`/my/requests/${requestId}`);
}

export async function withdrawRequestAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requireUser("/my/requests");
  const requestId = String(formData.get("requestId") ?? "");
  try {
    await withdrawRequest({ requestId, requesterId: user.id, reason: String(formData.get("reason") ?? "") || null });
  } catch (error) {
    if (error instanceof RequestError) return { error: error.message };
    throw error;
  }
  revalidateRequests(requestId);
  return { message: "Request withdrawn." };
}

export async function decideRequestAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requireRole(APPROVALS_AREA_ROLES, "/approvals");
  const requestId = String(formData.get("requestId") ?? "");
  const action = String(formData.get("action") ?? "") as DecisionAction;
  if (!["APPROVE", "REJECT", "REQUEST_CHANGES"].includes(action)) return { error: "Choose a decision." };
  try {
    await decideRequest({ requestId, actor: await withDelegations({ id: user.id, roles: user.roleAssignments.map((r) => r.role) }), action, comment: String(formData.get("comment") ?? "") });
  } catch (error) {
    if (error instanceof RequestError) return { error: error.message };
    throw error;
  }
  revalidateRequests(requestId);
  const label = action === "APPROVE" ? "Approved." : action === "REJECT" ? "Rejected." : "Returned to the requester for changes.";
  return { message: label };
}
