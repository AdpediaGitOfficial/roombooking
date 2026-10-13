import type { ApiContract } from "@sam/contract/index";
import { acceptInvite, inviteInfo, signIn, signOut, toSessionUser } from "@sam/core/modules/auth/service";
import type { Handlers } from "../register";

export const authHandlers: Handlers<ApiContract>["auth"] = {
  async login(ctx, input) {
    const userAgent = ctx.request.headers["user-agent"];
    const { token, expiresAt, user } = await signIn(input, { ipAddress: ctx.ip, userAgent: typeof userAgent === "string" ? userAgent : null });
    return { token, expiresAt, user };
  },
  inviteInfo: (_ctx, input) => inviteInfo(input.token),
  async acceptInvite(ctx, input) {
    const userAgent = ctx.request.headers["user-agent"];
    return acceptInvite(input, { ipAddress: ctx.ip, userAgent: typeof userAgent === "string" ? userAgent : null });
  },
  async logout(ctx) {
    await signOut(ctx.token, ctx.user.id);
    ctx.auth.forget(ctx.token);
    return { ok: true as const };
  },
  me(ctx) {
    return toSessionUser(ctx.user);
  },
};
