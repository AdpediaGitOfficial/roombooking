import type { ApiContract } from "@sam/contract/index";
import { addRole, auditView, createUser, getUserView, issueToken, listUsers, newUserOptions, removeRole, setUserStatus, signOutEverywhere, updateUser } from "@sam/core/modules/admin/users-service";
import type { Handlers } from "../register";

export const userHandlers: Handlers<ApiContract>["users"] = {
  list: (ctx, input) => listUsers(ctx.user.organizationId, { q: input.q, status: input.status ?? null, role: input.role ?? null }),
  options: (ctx) => newUserOptions(ctx.user.organizationId),
  get: (ctx, input) => getUserView(ctx.user.organizationId, input.id, input.invited),
  async create(ctx, input) {
    const { user, invitePath } = await createUser({
      actorId: ctx.user.id, organizationId: ctx.user.organizationId, name: input.name, email: input.email,
      roles: input.roles, staffProfileId: input.staffProfileId ?? null, vendorId: input.vendorId ?? null, accessExpiresAt: input.accessExpiresAt || null,
    });
    return { id: user.id, invitePath };
  },
  update: (ctx, input) => updateUser({ actorId: ctx.user.id, userId: input.id, name: input.name, email: input.email, staffProfileId: input.staffProfileId ?? null, vendorId: input.vendorId ?? null, accessExpiresAt: input.accessExpiresAt || null }),
  addRole: (ctx, input) => addRole({ actorId: ctx.user.id, userId: input.id, grant: { role: input.role, siteId: input.siteId ?? null, buildingId: input.buildingId ?? null } }),
  removeRole: (ctx, input) => removeRole({ actorId: ctx.user.id, userId: input.id, assignmentId: input.assignmentId }),
  setStatus: (ctx, input) => setUserStatus({ actorId: ctx.user.id, userId: input.id, status: input.status, reason: input.reason || null }),
  async signOutEverywhere(ctx, input) {
    return { ended: await signOutEverywhere({ actorId: ctx.user.id, userId: input.id }) };
  },
  issueToken: (ctx, input) => issueToken({ actorId: ctx.user.id, userId: input.id, purpose: input.purpose }),
};

export const auditHandlers: Handlers<ApiContract>["audit"] = {
  list: (_ctx, input) => auditView({ entityType: input.entityType, action: input.action, entityId: input.entityId, actorId: input.actorId }),
};
