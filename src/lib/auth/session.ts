import "server-only";
import { cache } from "react";
import { cookies, headers } from "next/headers";
import {
  createSessionRecord,
  resolveSession,
  revokeSessionByToken,
} from "@/lib/auth/session-store";

export const SESSION_COOKIE = "sam_session";

export async function createSession(userId: string) {
  const h = await headers();
  const { token, session } = await createSessionRecord(userId, {
    ipAddress: h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null,
    userAgent: h.get("user-agent"),
  });
  const cookieStore = await cookies();
  cookieStore.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    expires: session.expiresAt,
  });
  return session;
}

/** Current user for this request, or null. Memoised per request. */
export const getCurrentUser = cache(async () => {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const session = await resolveSession(token);
  return session?.user ?? null;
});

export async function destroyCurrentSession() {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;
  if (token) await revokeSessionByToken(token);
  cookieStore.delete(SESSION_COOKIE);
}
