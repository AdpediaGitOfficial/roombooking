import type { SessionUser } from "@sam/core/modules/auth/service";
import type { Actor } from "@sam/core/modules/maintenance/rules";

/** The maintenance module's view of the signed-in user. */
export function actorOf(user: SessionUser): Actor {
  return { id: user.id, roles: user.roleAssignments.map((r) => r.role), vendorId: user.vendorId };
}
