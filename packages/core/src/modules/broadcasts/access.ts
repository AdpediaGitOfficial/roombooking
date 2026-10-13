import type { Role } from "@prisma/client";

/** Compose and send broadcasts to sites, buildings and user groups (COM-03). */
export const BROADCAST_ROLES: Role[] = ["SYSTEM_ADMIN", "ACCOMMODATION_ADMIN", "ACCOMMODATION_OFFICER"];
