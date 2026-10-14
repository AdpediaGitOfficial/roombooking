import type { FastifyRequest } from "fastify";
import type { Role } from "@prisma/client";
import { resolveSession, hashSessionToken } from "@sam/core/lib/auth/session-store";
import { HttpError } from "./http-error";
import { TtlCache } from "./session-cache";

export type AuthSession = NonNullable<Awaited<ReturnType<typeof resolveSession>>>;
/** The signed-in user as the services see it (includes fields that must never leave the API). */
export type AuthUser = AuthSession["user"];

export interface Authenticator {
  authenticate(token: string): Promise<AuthUser | null>;
  forget(token: string): void;
  readonly cacheSize: number;
}

export function bearerToken(request: FastifyRequest): string | null {
  const header = request.headers.authorization;
  if (!header) return null;
  const match = /^Bearer\s+(.+)$/i.exec(header);
  return match ? match[1].trim() : null;
}

export function createAuthenticator(ttlMs: number, max: number): Authenticator {
  const cache = new TtlCache<{ user: AuthUser; sessionExpiresAt: number }>(ttlMs, max);
  return {
    async authenticate(token) {
      const key = hashSessionToken(token);
      const hit = cache.get(key);
      if (hit && hit.sessionExpiresAt > Date.now()) return hit.user;
      const session = await resolveSession(token);
      if (!session) {
        cache.delete(key);
        return null;
      }
      cache.set(key, { user: session.user, sessionExpiresAt: session.expiresAt.getTime() });
      return session.user;
    },
    forget(token) {
      cache.delete(hashSessionToken(token));
    },
    get cacheSize() {
      return cache.size;
    },
  };
}

export function hasAnyRole(user: AuthUser, roles: readonly Role[]): boolean {
  return user.roleAssignments.some((a) => roles.includes(a.role));
}

export function unauthenticated(): HttpError {
  return new HttpError(401, "UNAUTHENTICATED", "Sign in to continue.");
}
