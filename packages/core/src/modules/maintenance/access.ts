import type { Role } from "@prisma/client";
import { rolesWithDefault } from "../../lib/permissions/matrix";

/**
 * Triage, assign, change any ticket, see internal notes by default. Accommodation Admins
 * hold the same powers through the Maintenance coordinator grant (use actorCan("maint.triage")).
 */
export const MAINTENANCE_COORDINATOR_ROLES: Role[] = rolesWithDefault("maint.triage");

/** May open the operations maintenance area: coordinators, technicians (their own assignments), vendors, officers, admins. */
export const MAINTENANCE_AREA_ROLES: Role[] = [
  ...new Set<Role>([
    ...rolesWithDefault("maint.view", "full", "view", "limited"),
    ...rolesWithDefault("maint.create", "full", "limited").filter((r) => r !== "STAFF"),
  ]),
].filter((r) => r !== "STAFF" && r !== "SECURITY");

/** Internal technicians that tickets can be assigned to. */
export const ASSIGNABLE_ROLES: Role[] = ["TECHNICIAN"];
