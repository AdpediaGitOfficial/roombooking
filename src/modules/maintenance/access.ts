import type { Role } from "@prisma/client";

/** Triage, assign, change any ticket, see internal notes. */
export const MAINTENANCE_COORDINATOR_ROLES: Role[] = ["SYSTEM_ADMIN", "ACCOMMODATION_ADMIN", "ACCOMMODATION_OFFICER"];

/** May open the operations maintenance area: coordinators, engineers (their own assignments), vendors, auditors. */
export const MAINTENANCE_AREA_ROLES: Role[] = [...MAINTENANCE_COORDINATOR_ROLES, "MAINTENANCE", "AUDITOR", "VENDOR"];

/** Internal engineers that tickets can be assigned to. */
export const ASSIGNABLE_ROLES: Role[] = ["MAINTENANCE"];
