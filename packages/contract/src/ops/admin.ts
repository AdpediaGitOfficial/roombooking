import { z } from "zod";
import type { Role } from "@prisma/client";
import { ADMIN_VIEW_ROLES, ALL_ROLES, USER_ADMIN_ROLES } from "@sam/core/modules/admin/access";
import type * as svc from "@sam/core/modules/admin/users-service";
import { bool, cuid, op, out, pageInput, type Ret } from "../define";

const role = z.enum(ALL_ROLES as [Role, ...Role[]]);
const text = (max: number) => z.string().max(max).optional();
const grant = z.object({ role, siteId: cuid().nullish(), buildingId: cuid().nullish() });
const userStatus = z.enum(["INVITED", "ACTIVE", "SUSPENDED", "DEACTIVATED"]);

export const users = {
  list: op({
    id: "users.list",
    method: "GET",
    path: "/v1/admin/users",
    summary: "Users in the caller's organisation, filtered",
    tag: "Administration",
    access: ADMIN_VIEW_ROLES,
    input: z.object({ q: text(200), status: userStatus.optional(), role: role.optional(), ...pageInput }),
    output: out<Ret<typeof svc.listUsers>>(),
  }),
  options: op({
    id: "users.options",
    method: "GET",
    path: "/v1/admin/users/options",
    summary: "Pick-lists for the new-user form: scopes, vendors and staff records without an account",
    tag: "Administration",
    access: USER_ADMIN_ROLES,
    input: z.object({}),
    output: out<Ret<typeof svc.newUserOptions>>(),
  }),
  get: op({
    id: "users.get",
    method: "GET",
    path: "/v1/admin/users/:id",
    summary: "One user with their roles, sessions, pick-lists and recent audit trail",
    tag: "Administration",
    access: ADMIN_VIEW_ROLES,
    input: z.object({ id: cuid(), invited: bool().default(false) }),
    output: out<Ret<typeof svc.getUserView>>(),
  }),
  create: op({
    id: "users.create",
    method: "POST",
    path: "/v1/admin/users",
    summary: "Create an account and queue the invitation",
    tag: "Administration",
    access: USER_ADMIN_ROLES,
    input: z.object({ name: z.string().max(200), email: z.string().max(320), roles: z.array(grant).default([]), staffProfileId: cuid().optional(), vendorId: cuid().optional(), accessExpiresAt: text(10) }),
    output: out<{ id: string; invitePath: string }>(),
  }),
  update: op({
    id: "users.update",
    method: "PUT",
    path: "/v1/admin/users/:id",
    summary: "Edit a user's details and links",
    tag: "Administration",
    access: USER_ADMIN_ROLES,
    input: z.object({ id: cuid(), name: z.string().max(200), email: z.string().max(320), staffProfileId: cuid().optional(), vendorId: cuid().optional(), accessExpiresAt: text(10) }),
    output: out<Ret<typeof svc.updateUser>>(),
  }),
  addRole: op({
    id: "users.addRole",
    method: "POST",
    path: "/v1/admin/users/:id/roles",
    summary: "Grant a role, optionally scoped to a site or building",
    tag: "Administration",
    access: USER_ADMIN_ROLES,
    input: z.object({ id: cuid(), role, siteId: cuid().nullish(), buildingId: cuid().nullish() }),
    output: out<Ret<typeof svc.addRole>>(),
  }),
  removeRole: op({
    id: "users.removeRole",
    method: "DELETE",
    path: "/v1/admin/users/:id/roles/:assignmentId",
    summary: "Remove a role assignment (the last system administrator is protected)",
    tag: "Administration",
    access: USER_ADMIN_ROLES,
    input: z.object({ id: cuid(), assignmentId: cuid() }),
    output: out<Ret<typeof svc.removeRole>>(),
  }),
  setStatus: op({
    id: "users.setStatus",
    method: "PUT",
    path: "/v1/admin/users/:id/status",
    summary: "Activate, suspend or deactivate an account",
    tag: "Administration",
    access: USER_ADMIN_ROLES,
    input: z.object({ id: cuid(), status: z.enum(["ACTIVE", "SUSPENDED", "DEACTIVATED"]), reason: text(500) }),
    output: out<Ret<typeof svc.setUserStatus>>(),
  }),
  signOutEverywhere: op({
    id: "users.signOutEverywhere",
    method: "POST",
    path: "/v1/admin/users/:id/sessions/revoke",
    summary: "End every session of a user",
    tag: "Administration",
    access: USER_ADMIN_ROLES,
    input: z.object({ id: cuid() }),
    output: out<{ ended: number }>(),
  }),
  issueToken: op({
    id: "users.issueToken",
    method: "POST",
    path: "/v1/admin/users/:id/tokens",
    summary: "Create a one-time invite or password-reset link",
    tag: "Administration",
    access: USER_ADMIN_ROLES,
    input: z.object({ id: cuid(), purpose: z.enum(["INVITE", "RESET"]) }),
    output: out<Ret<typeof svc.issueToken>>(),
  }),
};

export const audit = {
  list: op({
    id: "audit.list",
    method: "GET",
    path: "/v1/admin/audit",
    summary: "The audit log, filtered, with the entity types to filter by",
    tag: "Administration",
    access: ADMIN_VIEW_ROLES,
    input: z.object({ entityType: text(60), action: text(80), entityId: text(80), actorId: cuid().optional(), ...pageInput }),
    output: out<Ret<typeof svc.auditView>>(),
  }),
};
