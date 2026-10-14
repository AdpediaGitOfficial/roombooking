import type { ApiContract } from "@sam/contract/index";
import type { SessionUser } from "@sam/core/modules/auth/service";
import { REQUEST_ADMIN_ROLES } from "@sam/core/modules/requests/access";
import { createDraft, createType, discardDraft, publishVersion, saveDraft, updateType } from "@sam/core/modules/requests/builder";
import { createDelegation, revokeDelegation } from "@sam/core/modules/requests/delegations";
import { decideRequest, reassignStep, resubmitRequest, submitRequest, withDelegations, withdrawRequest } from "@sam/core/modules/requests/service";
import { approvalView, approvalsInbox, delegationsView, formType, formTypes, myRequestView, myRequests, newRequestForm, startableTypes } from "@sam/core/modules/requests/views";
import type { Handlers } from "../register";

const rolesOf = (user: SessionUser) => user.roleAssignments.map((r) => r.role);
const isAdmin = (user: SessionUser) => rolesOf(user).some((r) => REQUEST_ADMIN_ROLES.includes(r));

export const requestHandlers: Handlers<ApiContract>["requests"] = {
  types: (ctx) => startableTypes(ctx.user.organizationId),
  form: (ctx, input) => newRequestForm(ctx.user.organizationId, input.typeCode),
  mine: (ctx) => myRequests(ctx.user.id),
  getMine: (ctx, input) => myRequestView(ctx.user.id, input.id),
  submit: (ctx, input) => submitRequest({ requesterId: ctx.user.id, organizationId: ctx.user.organizationId, typeCode: input.typeCode, idempotencyKey: input.idempotencyKey, raw: input.fields }),
  resubmit: (ctx, input) => resubmitRequest({ requestId: input.id, requesterId: ctx.user.id, raw: input.fields }),
  withdraw: (ctx, input) => withdrawRequest({ requestId: input.id, requesterId: ctx.user.id, reason: input.reason || null }),
};

export const approvalHandlers: Handlers<ApiContract>["approvals"] = {
  inbox: (ctx, input) => approvalsInbox({ id: ctx.user.id, roles: rolesOf(ctx.user) }, input.filter),
  get: (ctx, input) => approvalView({ id: ctx.user.id, roles: rolesOf(ctx.user) }, input.id),
  async decide(ctx, input) {
    const actor = await withDelegations({ id: ctx.user.id, roles: rolesOf(ctx.user) });
    return decideRequest({ requestId: input.id, actor, action: input.action, comment: input.comment ?? "" });
  },
  reassign: (ctx, input) => reassignStep({ requestId: input.id, actor: { id: ctx.user.id, roles: rolesOf(ctx.user) }, role: input.role, reason: input.reason }),
};

export const delegationHandlers: Handlers<ApiContract>["delegations"] = {
  view: (ctx) => delegationsView({ id: ctx.user.id, organizationId: ctx.user.organizationId, roles: rolesOf(ctx.user) }),
  create: (ctx, input) =>
    createDelegation({ delegatorId: input.delegatorId ?? ctx.user.id, delegateId: input.delegateId, roles: input.roles, startsAt: input.startsAt, endsAt: input.endsAt, reason: input.reason, actor: { id: ctx.user.id, isAdmin: isAdmin(ctx.user) } }),
  revoke: (ctx, input) => revokeDelegation({ delegationId: input.id, actor: { id: ctx.user.id, isAdmin: isAdmin(ctx.user) }, reason: input.reason || null }),
};

export const formHandlers: Handlers<ApiContract>["forms"] = {
  list: (ctx) => formTypes(ctx.user.organizationId),
  get: (ctx, input) => formType(ctx.user.organizationId, input.id),
  createType: (ctx, input) => createType({ organizationId: ctx.user.organizationId, actorId: ctx.user.id, code: input.code, name: input.name, description: input.description }),
  updateType: (ctx, input) =>
    updateType({
      typeId: input.id, actorId: ctx.user.id, name: input.name, description: input.description, status: input.status,
      policy: { reminderAfterDays: input.reminderAfterDays ?? null, escalateAfterDays: input.escalateAfterDays ?? null, expireAfterDays: input.expireAfterDays ?? null, escalateToRole: input.escalateToRole ?? null },
    }),
  createDraft: (ctx, input) => createDraft({ typeId: input.id, actorId: ctx.user.id }),
  async saveDraft(ctx, input) {
    await saveDraft({ versionId: input.id, actorId: ctx.user.id, schema: input.schema, steps: input.steps, changeNote: input.changeNote });
    if (input.publish) await publishVersion({ versionId: input.id, actorId: ctx.user.id });
    return { published: input.publish };
  },
  discardDraft: (ctx, input) => discardDraft({ versionId: input.id, actorId: ctx.user.id }),
};
