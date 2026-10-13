import type { ApiContract } from "@sam/contract/index";
import { BroadcastError } from "@sam/core/modules/broadcasts/errors";
import { broadcastView, broadcastsView, cancelBroadcast, myAnnouncements, openAnnouncement, previewAudience, saveBroadcast, sendBroadcast } from "@sam/core/modules/broadcasts/service";
import type { Handlers } from "../register";

export const broadcastHandlers: Handlers<ApiContract>["broadcasts"] = {
  list: (ctx) => broadcastsView(ctx.user.organizationId),
  get: (ctx, input) => broadcastView(ctx.user.organizationId, input.id),
  preview: (ctx, input) => previewAudience(ctx.user.organizationId, input.audience),
  save: (ctx, input) => saveBroadcast({ organizationId: ctx.user.organizationId, actorId: ctx.user.id, broadcastId: input.broadcastId, title: input.title, body: input.body, audience: input.audience, emailCopy: input.emailCopy, whatsappCopy: input.whatsappCopy, send: input.send }),
  send: (ctx, input) => sendBroadcast({ broadcastId: input.id, actorId: ctx.user.id }),
  cancel: (ctx, input) => cancelBroadcast({ broadcastId: input.id, actorId: ctx.user.id }),
  announcements: (ctx) => myAnnouncements(ctx.user.id),
  async announcement(ctx, input) {
    const a = await openAnnouncement(ctx.user.id, input.id);
    if (!a) throw new BroadcastError("NOT_FOUND", "Announcement not found.");
    return a;
  },
};
