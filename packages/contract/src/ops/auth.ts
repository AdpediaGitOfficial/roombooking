import { z } from "zod";
import type { SessionUser } from "@sam/core/modules/auth/service";
import { op, out } from "../define";

export const auth = {
  login: op({
    id: "auth.login",
    method: "POST",
    path: "/v1/auth/login",
    summary: "Sign in with email and password and receive a session token",
    tag: "Authentication",
    access: "public",
    input: z.object({ email: z.string().max(320), password: z.string().max(200) }),
    output: out<{ token: string; expiresAt: Date; user: SessionUser }>(),
    rateLimit: { max: 20, windowSeconds: 60 },
  }),
  inviteInfo: op({
    id: "auth.inviteInfo",
    method: "GET",
    path: "/v1/auth/invites/:token",
    summary: "Who an invite or password-reset link was sent to",
    tag: "Authentication",
    access: "public",
    input: z.object({ token: z.string().min(1).max(200) }),
    output: out<{ name: string; email: string; purpose: "INVITE" | "RESET" }>(),
    rateLimit: { max: 30, windowSeconds: 60 },
  }),
  acceptInvite: op({
    id: "auth.acceptInvite",
    method: "POST",
    path: "/v1/auth/invites/:token/accept",
    summary: "Set a password from an invite or reset link and sign in",
    tag: "Authentication",
    access: "public",
    input: z.object({ token: z.string().min(1).max(200), password: z.string().max(200) }),
    output: out<{ token: string; expiresAt: Date; user: SessionUser }>(),
    rateLimit: { max: 10, windowSeconds: 60 },
  }),
  logout: op({
    id: "auth.logout",
    method: "POST",
    path: "/v1/auth/logout",
    summary: "End the current session",
    tag: "Authentication",
    input: z.object({}),
    output: out<{ ok: true }>(),
  }),
  me: op({
    id: "auth.me",
    method: "GET",
    path: "/v1/auth/me",
    summary: "The signed-in user and their roles",
    tag: "Authentication",
    input: z.object({}),
    output: out<SessionUser>(),
  }),
};
