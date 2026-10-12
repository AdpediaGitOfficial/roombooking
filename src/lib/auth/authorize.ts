import "server-only";
import { redirect } from "next/navigation";
import type { Role } from "@prisma/client";
import { getCurrentUser } from "@/lib/auth/session";

export type CurrentUser = NonNullable<Awaited<ReturnType<typeof getCurrentUser>>>;

export function hasRole(user: CurrentUser, ...roles: Role[]): boolean {
  return user.roleAssignments.some((assignment) => roles.includes(assignment.role));
}

/** Redirects to the login page when there is no active session. */
export async function requireUser(returnTo?: string): Promise<CurrentUser> {
  const user = await getCurrentUser();
  if (!user) {
    const target = returnTo ? `/login?next=${encodeURIComponent(returnTo)}` : "/login";
    redirect(target);
  }
  return user;
}

/** Requires an active session holding at least one of the given roles. */
export async function requireRole(roles: Role[], returnTo?: string): Promise<CurrentUser> {
  const user = await requireUser(returnTo);
  if (!hasRole(user, ...roles)) redirect("/forbidden");
  return user;
}

/** Only allows redirects to relative paths within this app. */
export function safeReturnPath(value: string | null | undefined, fallback = "/"): string {
  if (!value || !value.startsWith("/") || value.startsWith("//") || value.startsWith("/login")) {
    return fallback;
  }
  return value;
}
