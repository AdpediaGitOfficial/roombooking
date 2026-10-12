import type { Role } from "@prisma/client";

/** Roles that may change the accommodation hierarchy and bed configuration. */
export const ACCOMMODATION_MANAGE_ROLES: Role[] = ["SYSTEM_ADMIN", "ACCOMMODATION_ADMIN"];

/** Roles that may view occupancy and bed details. */
export const ACCOMMODATION_VIEW_ROLES: Role[] = [
  ...ACCOMMODATION_MANAGE_ROLES,
  "ACCOMMODATION_OFFICER",
  "AUDITOR",
];
