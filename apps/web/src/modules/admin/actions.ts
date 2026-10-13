"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { Role, UserStatus } from "@prisma/client";
import { requireCapability, requireRole, requireUser } from "@/lib/auth/authorize";
import { createSession, getCurrentUser } from "@/lib/auth/session";
import { recordAudit } from "@sam/core/lib/audit";
import { USER_ADMIN_ROLES } from "@sam/core/modules/admin/access";
import { AdminError } from "@sam/core/modules/admin/errors";
import { acceptToken, createUser, issueToken, resetPasswordTemporary, setUserStatus, signOutEverywhere, unlockUser, updateUser, type RoleGrant } from "@sam/core/modules/admin/users-service";
import { revokeGrant } from "@sam/core/modules/admin/grants";
import { cancelChange, decideChange, submitChange } from "@sam/core/modules/admin/change-requests";
import { CAPABILITY_SET_BY_ID } from "@sam/core/lib/permissions/sets";
import { ROLE_META } from "@sam/core/lib/permissions/roles";

export type FormState = { error?: string; fieldErrors?: Record<string, string>; values?: Record<string, string> };
export type ActionState = { error?: string; message?: string; link?: string; secret?: string };

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
  const mode = str(formData, "mode") === "invite" ? "invite" : "temp_password";
  let id: string;
  let temporaryPassword: string | null;
  let username: string;
  try {
    const result = await createUser({ actorId: actor.id, organizationId: actor.organizationId, name: str(formData, "name"), username: str(formData, "username") || null, email: str(formData, "email") || null, roles: grantsFrom(formData), staffProfileId: str(formData, "staffProfileId") || null, vendorId: str(formData, "vendorId") || null, accessExpiresAt: str(formData, "accessExpiresAt") || null, mode });
    id = result.user.id;
    username = result.user.username;
    temporaryPassword = result.temporaryPassword;
  } catch (error) {
    if (error instanceof AdminError) return { error: error.message, fieldErrors: error.fieldErrors, values };
    throw error;
  }
  revalidateUsers(id);
  // The temporary password is shown once, here; it is also sent by WhatsApp or email when the person has either.
  if (temporaryPassword) return { values: { created: "1", userId: id, username, temporaryPassword } };
  redirect(`/admin/users/${id}?invited=1`);
}

export async function updateUserAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const actor = await requireRole(USER_ADMIN_ROLES, "/admin/users");
  const userId = str(formData, "userId");
  try {
    await updateUser({ actorId: actor.id, userId, name: str(formData, "name"), username: str(formData, "username") || null, email: str(formData, "email") || null, staffProfileId: str(formData, "staffProfileId") || null, vendorId: str(formData, "vendorId") || null, accessExpiresAt: str(formData, "accessExpiresAt") || null });
  } catch (error) {
    if (error instanceof AdminError) return { error: error.message, fieldErrors: error.fieldErrors };
    throw error;
  }
  revalidateUsers(userId);
  return { values: { message: "Saved." } };
}

function submittedMessage(r: { status: "APPLIED" | "PENDING"; waived: boolean }, applied: string): string {
  if (r.status === "PENDING") return "Submitted: a second Super Admin must approve this before it takes effect.";
  return r.waived ? `${applied} (applied at once: you are the only active Super Admin, so the second approval was waived and the audit log says so).` : applied;
}

export async function addRoleAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const actor = await requireRole(USER_ADMIN_ROLES, "/admin/users");
  const userId = str(formData, "userId");
  const scope = str(formData, "scope");
  const [kind, id] = scope.split(":");
  const role = str(formData, "role") as Role;
  let message = "";
  const error = await run(async () => {
    const r = await submitChange({ organizationId: actor.organizationId, actorId: actor.id, summary: `Grant the ${ROLE_META[role]?.label ?? role} role to a user`, payload: { op: "role.add", userId, grant: { role, siteId: kind === "site" ? id : null, buildingId: kind === "building" ? id : null } } });
    message = submittedMessage(r, "Role granted.");
  });
  if (error) return { error };
  revalidateUsers(userId);
  revalidatePath("/admin/changes");
  return { message };
}

export async function removeRoleAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const actor = await requireRole(USER_ADMIN_ROLES, "/admin/users");
  const userId = str(formData, "userId");
  let message = "";
  const error = await run(async () => {
    const r = await submitChange({ organizationId: actor.organizationId, actorId: actor.id, summary: "Remove a role from a user", payload: { op: "role.remove", userId, assignmentId: str(formData, "assignmentId") } });
    message = submittedMessage(r, "Role removed.");
  });
  if (error) return { error };
  revalidateUsers(userId);
  revalidatePath("/admin/changes");
  return { message };
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

export async function resetPasswordAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const actor = await requireRole(USER_ADMIN_ROLES, "/admin/users");
  const userId = str(formData, "userId");
  let secret = "";
  const error = await run(async () => { secret = (await resetPasswordTemporary({ actorId: actor.id, userId })).temporaryPassword; });
  if (error) return { error };
  revalidateUsers(userId);
  return { message: "Password reset. All sessions ended; the person must choose a new password at next sign-in. Share the temporary password below (it was also sent by WhatsApp or email where possible).", secret };
}

export async function unlockAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const actor = await requireRole(USER_ADMIN_ROLES, "/admin/users");
  const userId = str(formData, "userId");
  const error = await run(() => unlockUser({ actorId: actor.id, userId }));
  if (error) return { error };
  revalidateUsers(userId);
  return { message: "Account unlocked." };
}

// ---------------------------------------------------------------------------
// Capability grants and maker-checker (document sections 3 and 6.3)
// ---------------------------------------------------------------------------

export async function createGrantAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const actor = await requireCapability("setup.roles", { returnTo: "/admin/access" });
  const target = str(formData, "target"); // "role:<ROLE>" or "user:<id>"
  const [targetKind, targetId] = target.split(":");
  const scope = str(formData, "scope");
  const [scopeKind, scopeId] = scope.split(":");
  const what = str(formData, "capability"); // "set:<ID>" or "cap:<key>"
  const [whatKind, whatId] = what.split(":");
  let message = "";
  const error = await run(async () => {
    const label = whatKind === "set" ? (CAPABILITY_SET_BY_ID.get(whatId)?.label ?? whatId) : whatId;
    const r = await submitChange({
      organizationId: actor.organizationId,
      actorId: actor.id,
      summary: `Grant "${label}" to ${targetKind === "role" ? `every ${ROLE_META[targetId as Role]?.label ?? targetId}` : "a user"}`,
      payload: { op: "grant.create", grant: { capabilitySet: whatKind === "set" ? whatId : null, capability: whatKind === "cap" ? whatId : null, role: targetKind === "role" ? (targetId as Role) : null, userId: targetKind === "user" ? targetId : null, siteId: scopeKind === "site" ? scopeId : null, buildingId: scopeKind === "building" ? scopeId : null, reason: str(formData, "reason"), expiresAt: str(formData, "expiresAt") || null } },
    });
    message = submittedMessage(r, "Access granted.");
  });
  if (error) return { error };
  revalidatePath("/admin/access");
  revalidatePath("/admin/changes");
  if (targetKind === "user") revalidateUsers(targetId);
  return { message };
}

export async function revokeGrantAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const actor = await requireCapability("setup.roles", { returnTo: "/admin/access" });
  const error = await run(() => revokeGrant({ grantId: str(formData, "grantId"), actorId: actor.id, reason: str(formData, "reason") }));
  if (error) return { error };
  revalidatePath("/admin/access");
  const userId = str(formData, "userId");
  if (userId) revalidateUsers(userId);
  return { message: "Access revoked." };
}

export async function decideChangeAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const actor = await requireCapability("setup.roles", { returnTo: "/admin/changes" });
  const approve = str(formData, "decision") === "approve";
  const error = await run(() => decideChange({ changeRequestId: str(formData, "changeRequestId"), actorId: actor.id, approve, note: str(formData, "note") || null }));
  if (error) return { error };
  revalidatePath("/admin/changes");
  revalidatePath("/admin/access");
  revalidatePath("/admin/users");
  return { message: approve ? "Approved and applied." : "Rejected." };
}

export async function cancelChangeAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const actor = await requireCapability("setup.roles", { returnTo: "/admin/changes" });
  const error = await run(() => cancelChange({ changeRequestId: str(formData, "changeRequestId"), actorId: actor.id }));
  if (error) return { error };
  revalidatePath("/admin/changes");
  return { message: "Withdrawn." };
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
