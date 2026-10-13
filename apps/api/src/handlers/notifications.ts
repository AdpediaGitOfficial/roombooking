import type { ApiContract } from "@sam/contract/index";
import { notificationsView, retryFailed, runOutbox, sendTest } from "@sam/core/modules/notifications/admin";
import type { Handlers } from "../register";

export const notificationHandlers: Handlers<ApiContract>["notifications"] = {
  view: (_ctx, input) => notificationsView(input.channel, input.status ?? null),
  runWorker: (ctx) => runOutbox(ctx.user.id),
  async retry(ctx, input) {
    return { queued: await retryFailed(input.id, ctx.user.id) };
  },
  sendTest: (ctx, input) => sendTest(input.channel, { id: ctx.user.id, email: ctx.user.email }),
};
