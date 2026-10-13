import type { Role } from "@prisma/client";
import { rolesWithDefault } from "../../lib/permissions/matrix";

/** May check in, check out and run transfers (Admin decides, Reception executes). */
export const ALLOCATION_OPERATE_ROLES: Role[] = rolesWithDefault("accom.checkin");

/** May allocate beds, cancel allocations and override check-out clearance blockers. */
export const ALLOCATION_ADMIN_ROLES: Role[] = rolesWithDefault("accom.allocate");

/** May view allocation records. */
export const ALLOCATION_VIEW_ROLES: Role[] = rolesWithDefault("accom.view", "full", "view");
