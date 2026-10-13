"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { Role, UserStatus } from "@prisma/client";
import { requireRole, requireUser } from "@/lib/auth/authorize";
import { createSession, getCurrentUser } from "@/lib/auth/session";
import { recordAudit } from "@sam/core/lib/audit";
import { USER_ADMIN_ROLES } from "@sam/core/modules/admin/access";
import { AdminError } from "@sam/core/modules/admin/errors";
import { acceptToken, addRole, createUser, issueToken, removeRole, setUserStatus, signOutEverywhere, updateUser, type RoleGrant } from "@sam/core/modules/admin/users-service";

export type FormState = { error?: string; fieldErrors?: Record<string, string>; values?: Record<string, string> };
export type ActionState = { error?: string; message?: string; link?: string };

const str = (fd: FormData, k: string) => { const v = fd.get(k); return typeof v === "string" ? v.trim() : ""; };

function grantsFrom(formData: FormData): RoleGrant[] {
  const grants: RoleGrant[] = [];
  for (const role of formData.getAll("roles")) {
    if (typeof role !== "string") continue;
    const scope = str(formData, `scope_${role}`); // "", "site:<id>" or "building:<id>"
    const [kind, id] = scope.split(":");
    grants.push({ role: role as Role, siteId: kind === "site" ? id : null, buildingId: kind === "building" ? id : null });
  }
  return grants;
}

function revalidateUsers(id?: string) {
  revalidatePath("/admin/users");
  if (id) revalidatePath(`/admin/users/${id}`);
}

async function run(fn: () => Promise<unknown>): Promise<string | null> {
  try { await fn(); return null; } catch (error) {
    if (error instanceof AdminError) return error.message;
    throw error;
  }
}

export async function createUserAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const actor = await requireRole(USER_ADMIN_ROLES, "/admin/users/new");
  const values: Record<string, string> = {};
  for (const [k, v] of formData.entries()) if (typeof v === "string") values[k] = v;
  let id: string;
  try {
    const { user } = await createUser({ actorId: actor.id, organizationId: actor.organizationId, name: str(formData, "name"), email: str(formData, "email"), roles: grantsFrom(formData), staffProfileId: str(formData, "staffProfileId") || null, vendorId: str(formData, "vendorId") || null, accessExpiresAt: str(formData, "accessExpiresAt") || null });
    id = user.id;
  } catch (error) {
    if (error instanceof AdminError) return { error: error.message, fieldErrors: error.fieldErrors, values };
    throw error;
  }
  revalidateUsers(id);
  redirect(`/admin/users/${id}?invited=1`);
}

export async function updateUserAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const actor = await requireRole(USER_ADMIN_ROLES, "/admin/users");
  const userId = str(formData, "userId");
  try {
    await updateUser({ actorId: actor.id, userId, name: str(formData, "name"), email: str(formData, "email"), staffProfileId: str(formData, "staffProfileId") || null, vendorId: str(formData, "vendorId") || null, accessExpiresAt: str(formData, "accessExpiresAt") || null });
  } catch (error) {
    if (error instanceof AdminError) return { error: error.message, fieldErrors: error.fieldErrors };
    throw error;
  }
  revalidateUsers(userId);
  return { values: { message: "Saved." } };
}

export async function addRoleAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const actor = await requireRole(USER_ADMIN_ROLES, "/admin/users");
  const userId = str(formData, "userId");
  const scope = str(formData, "scope");
  const [kind, id] = scope.split(":");
  const error = await run(() => addRole({ actorId: actor.id, userId, grant: { role: str(formData, "role") as Role, siteId: kind === "site" ? id : null, buildingId: kind === "building" ? id : null } }));
  if (error) return { error };
  revalidateUsers(userId);
  return { message: "Role granted." };
}

export async function removeRoleAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const actor = await requireRole(USER_ADMIN_ROLES, "/admin/users");
  const userId = str(formData, "userId");
  const error = await run(() => removeRole({ actorId: actor.id, userId, assignmentId: str(formData, "assignmentId") }));
  if (error) return { error };
  revalidateUsers(userId);
  return { message: "Role removed." };
}

export async function statusAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const actor = await requireRole(USER_ADMIN_ROLES, "/admin/users");
  const userId = str(formData, "userId");
  const status = str(formData, "status") as Extract<UserStatus, "ACTIVE" | "SUSPENDED" | "DEACTIVATED">;
  const error = await run(() => setUserStatus({ actorId: actor.id, userId, status, reason: str(formData, "reason") || null }));
  if (error) return { error };
  revalidateUsers(userId);
  return { message: `Account ${status.toLowerCase()}.` };
}

export async function signOutEverywhereAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const actor = await requireRole(USER_ADMIN_ROLES, "/admin/users");
  const userId = str(formData, "userId");
  const count = await signOutEverywhere({ actorId: actor.id, userId });
  revalidateUsers(userId);
  return { message: `${count} session${count === 1 ? "" : "s"} ended.` };
}

export async function tokenAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const actor = await requireRole(USER_ADMIN_ROLES, "/admin/users");
  const userId = str(formData, "userId");
  const purpose = str(formData, "purpose") === "RESET" ? "RESET" : "INVITE";
  let link = "";
  const error = await run(async () => { link = (await issueToken({ actorId: actor.id, userId, purpose })).path; });
  if (error) return { error };
  revalidateUsers(userId);
  return { message: purpose === "INVITE" ? "New invite link created. Share it with the person; it works once." : "Password reset link created. Share it with the person; it works once.", link };
}

/** Public: set a password from an invite / reset link, then sign in. */
export async function acceptInviteAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const token = str(formData, "token");
  const password = str(formData, "password");
  if (password !== str(formData, "confirmPassword")) return { error: "The passwords do not match.", fieldErrors: { confirmPassword: "Does not match." } };
  let userId: string;
  try {
    userId = (await acceptToken({ token, password })).id;
  } catch (error) {
    if (error instanceof AdminError) return { error: error.message, fieldErrors: error.fieldErrors };
    throw error;
  }
  await createSession(userId);
  await recordAudit({ actorId: userId, action: "LOGIN_SUCCESS", entityType: "User", entityId: userId, after: { via: "invite_link" } });
  redirect("/");
}

export async function noop() {
  await requireUser("/");
  await getCurrentUser();
}
