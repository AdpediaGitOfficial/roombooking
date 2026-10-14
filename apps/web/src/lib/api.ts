import "server-only";
import { cookies, headers } from "next/headers";
import { notFound } from "next/navigation";
import { ApiError, contract, createClient } from "@sam/contract/index";
import { apiUrl } from "./api-url";

/** Awaits an API call and renders the 404 page when the API says the record does not exist. */
export async function orNotFound<T>(call: Promise<T>): Promise<T> {
  try {
    return await call;
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) notFound();
    throw error;
  }
}

export const SESSION_COOKIE = "sam_session";

/** Where the API service listens (an internal address; browsers never call it directly). */
const API_URL = apiUrl();

export async function getSessionToken(): Promise<string | null> {
  return (await cookies()).get(SESSION_COOKIE)?.value ?? null;
}

/**
 * Typed client for the API. Each call reads the visitor's session cookie and
 * forwards it as a bearer token, together with the visitor's address and
 * browser, so the API's audit trail and rate limits see the real client.
 */
export const api = createClient(contract, {
  baseUrl: API_URL,
  token: getSessionToken,
  headers: async () => {
    const h = await headers();
    const out: Record<string, string> = {};
    const forwarded = h.get("x-forwarded-for");
    if (forwarded) out["x-forwarded-for"] = forwarded;
    const ua = h.get("user-agent");
    if (ua) out["user-agent"] = ua;
    return out;
  },
  timeoutMs: Number(process.env.API_TIMEOUT_MS ?? 30000),
});
