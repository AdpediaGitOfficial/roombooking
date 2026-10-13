import type { ApiContract } from "@sam/contract/index";
import type { SessionUser } from "@sam/core/modules/auth/service";
import { LOST_FOUND_MANAGE_ROLES, LOST_FOUND_OPERATE_ROLES } from "@sam/core/modules/lost-found/access";
import { addPhoto, decideClaim, disposeItem, getItemView, getMyItemView, getMyPortal, getRegisterView, handOver, recordClaim, registerItem, registerOptions, storeItem, submitMyClaim, updateItem, withdrawClaim, type Actor } from "@sam/core/modules/lost-found/service";
import type { Handlers } from "../register";

/** The lost-and-found module's view of the signed-in user, decided from their verified roles. */
function actorFor(user: SessionUser): Actor {
  const roles = user.roleAssignments.map((r) => r.role);
  return { id: user.id, isOperator: roles.some((r) => LOST_FOUND_OPERATE_ROLES.includes(r)), isManager: roles.some((r) => LOST_FOUND_MANAGE_ROLES.includes(r)) };
}

export const lostFoundHandlers: Handlers<ApiContract>["lostFound"] = {
  register: (_ctx, input) => getRegisterView({ filter: input.filter, q: input.q || null }),
  options: () => registerOptions(),
  mine: (ctx, input) => getMyPortal(ctx.user.id, input.q),
  getMine: (ctx, input) => getMyItemView(ctx.user.id, input.id),
  get: (_ctx, input) => getItemView(input.id),
  create: (ctx, input) =>
    registerItem({ siteId: input.siteId, actorId: ctx.user.id, description: input.description, category: input.category, foundLocation: input.foundLocation, foundAt: input.foundAt, foundByName: input.foundByName, storageLocation: input.storageLocation, notes: input.notes, retentionDays: input.retentionDays ?? null, photos: input.photos }),
  update: (ctx, input) => updateItem({ itemId: input.id, actorId: ctx.user.id, description: input.description, category: input.category, foundLocation: input.foundLocation, foundByName: input.foundByName, notes: input.notes, retainUntil: input.retainUntil || null }),
  store: (ctx, input) => storeItem({ itemId: input.id, actorId: ctx.user.id, storageLocation: input.storageLocation, notes: input.notes }),
  addPhoto: (ctx, input) => addPhoto({ itemId: input.id, actorId: ctx.user.id, photo: input.photo }),
  recordClaim: (ctx, input) => recordClaim({ itemId: input.id, actor: actorFor(ctx.user), evidence: input.evidence, claimantStaffId: input.claimantStaffId, claimantName: input.claimantName, claimantContact: input.claimantContact }),
  claim: (ctx, input) => submitMyClaim({ itemId: input.id, actor: actorFor(ctx.user), user: ctx.user, evidence: input.evidence, claimantContact: input.claimantContact }),
  decideClaim: (ctx, input) => decideClaim({ claimId: input.id, actor: actorFor(ctx.user), verified: input.verified, note: input.note }),
  withdrawClaim: (ctx, input) => withdrawClaim({ claimId: input.id, actor: actorFor(ctx.user) }),
  handOver: (ctx, input) => handOver({ itemId: input.id, actor: actorFor(ctx.user), recipientName: input.recipientName, note: input.note, evidence: input.evidence ?? null }),
  dispose: (ctx, input) => disposeItem({ itemId: input.id, actor: actorFor(ctx.user), method: input.method, note: input.note }),
};
