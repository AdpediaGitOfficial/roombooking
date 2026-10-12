import type { Role } from "@prisma/client";

/** May allocate, transfer, check in and check out (SRS: admin + officer/reception). */
export const ALLOCATION_OPERATE_ROLES: Role[] = ["SYSTEM_ADMIN", "ACCOMMODATION_ADMIN", "ACCOMMODATION_OFFICER"];

/** May cancel allocations and override check-out clearance blockers. */
export const ALLOCATION_ADMIN_ROLES: Role[] = ["SYSTEM_ADMIN", "ACCOMMODATION_ADMIN"];

/** May view allocation records. */
export const ALLOCATION_VIEW_ROLES: Role[] = [...ALLOCATION_OPERATE_ROLES, "AUDITOR"];
