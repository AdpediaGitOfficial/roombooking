import "server-only";
import { api } from "@/lib/api";
import { requireUser, type CurrentUser } from "@/lib/auth/authorize";

/** The signed-in user plus their own staff record (null when none is linked). */
export async function requireResident(returnTo: string) {
  const user = await requireUser(returnTo);
  const staff = await api.me.staff();
  return { user, staff };
}

/** True when the user holds only the STAFF role (or none), i.e. a plain resident. */
export function isResidentOnly(user: CurrentUser): boolean {
  return user.roleAssignments.every((r) => r.role === "STAFF");
}
