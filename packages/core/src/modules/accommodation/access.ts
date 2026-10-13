import type { Role } from "@prisma/client";
import { rolesWithDefault } from "../../lib/permissions/matrix";

/** Roles that may change the accommodation inside a site: floors, units, rooms and beds. */
export const ACCOMMODATION_MANAGE_ROLES: Role[] = rolesWithDefault("setup.structure");

/** Roles that may view occupancy and bed details (own-record residents use the portal). */
export const ACCOMMODATION_VIEW_ROLES: Role[] = rolesWithDefault("accom.view", "full", "view");
