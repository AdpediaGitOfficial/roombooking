"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { ApiError } from "@sam/contract/index";
import { api } from "@/lib/api";
import { requireRole, requireUser } from "@/lib/auth/authorize";
import { getCurrentUser, setSessionCookie } from "@/lib/auth/session";
import { USER_ADMIN_ROLES } from "@sam/core/modules/admin/access";

export type FormState = { error?: string; fieldErrors?: Record<string, string>; values?: Record<string, string> };
export type ActionState = { error?: string; message?: string; link?: string };

type Role = NonNullable<Parameters<typeof api.users.addRole>[0]>["role"];
type Grant = { role: Role; siteId: string | null; buildingId: string | null };

const str = (fd: FormData, k: string) => { const v = fd.get(k); return typeof v === "string" ? v.trim() : ""; };

/** "", "site:<id>" or "building:<id>" from the scope picker. */
function scopeOf(scope: string): Pick<Grant, "siteId" | "buildingId"> {
  const [kind, id] = scope.split(":");
  return { siteId: kind === "site" ? id : null, buildingId: kind === "building" ? id : null };
}

function grantsFrom(formData: FormData): Grant[] {
  const grants: Grant[] = [];
  for (const role of formData.getAll("roles")) {
    if (typeof role !== "string") continue;
    grants.push({ role: role as Role, ...scopeOf(str(formData, `scope_${role}`)) });
  }
  return grants;
}

function revalidateUsers(id?: string) {
  revalidatePath("/admin/users");
  if (id) revalidatePath(`/admin/users/${id}`);
}

async function run(fn: () => Promise<unknown>): Promise<string | null> {
  try { await fn(); return null; } catch (error) {
    if (error instanceof ApiError && error.status < 500) return error.message;
    throw error;
  }
}

export async function createUserAction(_prev: FormState, formData: FormData): Promise<FormState> {
  await requireRole(USER_ADMIN_ROLES, "/admin/users/new");
  const values: Record<string, string> = {};
  for (const [k, v] of formData.entries()) if (typeof v === "string") values[k] = v;
  let id: string;
  try {
    ({ id } = await api.users.create({ name: str(formData, "name"), email: str(formData, "email"), roles: grantsFrom(formData), staffProfileId: str(formData, "staffProfileId") || undefined, vendorId: str(formData, "vendorId") || undefined, accessExpiresAt: str(formData, "accessExpiresAt") || undefined }));
  } catch (error) {
    if (error instanceof ApiError && error.status < 500) return { error: error.message, fieldErrors: error.fieldErrors, values };
    throw error;
  }
  revalidateUsers(id);
  redirect(`/admin/users/${id}?invited=1`);
}

export async function updateUserAction(_prev: FormState, formData: FormData): Promise<FormState> {
  await requireRole(USER_ADMIN_ROLES, "/admin/users");
  const userId = str(formData, "userId");
  try {
    await api.users.update({ id: userId, name: str(formData, "name"), email: str(formData, "email"), staffProfileId: str(formData, "staffProfileId") || undefined, vendorId: str(formData, "vendorId") || undefined, accessExpiresAt: str(formData, "accessExpiresAt") || undefined });
  } catch (error) {
    if (error instanceof ApiError && error.status < 500) return { error: error.message, fieldErrors: error.fieldErrors };
    throw error;
  }
  revalidateUsers(userId);
  return { values: { message: "Saved." } };
}

export async function addRoleAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  await requireRole(USER_ADMIN_ROLES, "/admin/users");
  const userId = str(formData, "userId");
  const error = await run(() => api.users.addRole({ id: userId, role: str(formData, "role") as Role, ...scopeOf(str(formData, "scope")) }));
  if (error) return { error };
  revalidateUsers(userId);
  return { message: "Role granted." };
}

export async function removeRoleAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  await requireRole(USER_ADMIN_ROLES, "/admin/users");
  const userId = str(formData, "userId");
  const error = await run(() => api.users.removeRole({ id: userId, assignmentId: str(formData, "assignmentId") }));
  if (error) return { error };
  revalidateUsers(userId);
  return { message: "Role removed." };
}

export async function statusAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  await requireRole(USER_ADMIN_ROLES, "/admin/users");
  const userId = str(formData, "userId");
  const status = str(formData, "status") as "ACTIVE" | "SUSPENDED" | "DEACTIVATED";
  const error = await run(() => api.users.setStatus({ id: userId, status, reason: str(formData, "reason") || undefined }));
  if (error) return { error };
  revalidateUsers(userId);
  return { message: `Account ${status.toLowerCase()}.` };
}

export async function signOutEverywhereAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  await requireRole(USER_ADMIN_ROLES, "/admin/users");
  const userId = str(formData, "userId");
  const { ended } = await api.users.signOutEverywhere({ id: userId });
  revalidateUsers(userId);
  return { message: `${ended} session${ended === 1 ? "" : "s"} ended.` };
}

export async function tokenAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  await requireRole(USER_ADMIN_ROLES, "/admin/users");
  const userId = str(formData, "userId");
  const purpose = str(formData, "purpose") === "RESET" ? "RESET" : "INVITE";
  let link = "";
  const error = await run(async () => { link = (await api.users.issueToken({ id: userId, purpose })).path; });
  if (error) return { error };
  revalidateUsers(userId);
  return { message: purpose === "INVITE" ? "New invite link created. Share it with the person; it works once." : "Password reset link created. Share it with the person; it works once.", link };
}

/** Public: set a password from an invite / reset link, then sign in. */
export async function acceptInviteAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const token = str(formData, "token");
  const password = str(formData, "password");
  if (password !== str(formData, "confirmPassword")) return { error: "The passwords do not match.", fieldErrors: { confirmPassword: "Does not match." } };
  try {
    const session = await api.auth.acceptInvite({ token, password });
    await setSessionCookie(session.token, session.expiresAt);
  } catch (error) {
    if (error instanceof ApiError && error.status < 500) return { error: error.message, fieldErrors: error.fieldErrors };
    throw error;
  }
  redirect("/");
}

export async function noop() {
  await requireUser("/");
  await getCurrentUser();
}
