import "server-only";
import { cache } from "react";
import { cookies } from "next/headers";
import { ApiError } from "@sam/contract/index";
import { SESSION_COOKIE, api, getSessionToken } from "@/lib/api";

export { SESSION_COOKIE };

/** Stores the token the API issued in an httpOnly cookie. */
export async function setSessionCookie(token: string, expiresAt: Date) {
  const cookieStore = await cookies();
  cookieStore.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    expires: expiresAt,
  });
}

/** Current user for this request, or null. Memoised per request. */
export const getCurrentUser = cache(async () => {
  if (!(await getSessionToken())) return null;
  try {
    return await api.auth.me();
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) return null;
    throw error;
  }
});

export async function destroyCurrentSession() {
  if (await getSessionToken()) {
    try { await api.auth.logout(); } catch { /* the session may already be gone; the cookie is cleared regardless */ }
  }
  (await cookies()).delete(SESSION_COOKIE);
}
