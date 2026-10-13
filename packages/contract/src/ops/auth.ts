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
