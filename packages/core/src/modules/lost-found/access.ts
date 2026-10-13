import type { Role } from "@prisma/client";

/** Authorise disposal and see claimant details on every item. */
export const LOST_FOUND_MANAGE_ROLES: Role[] = ["SYSTEM_ADMIN", "ACCOMMODATION_ADMIN"];

/** Register, store, record claims, verify and hand over. */
export const LOST_FOUND_OPERATE_ROLES: Role[] = [...LOST_FOUND_MANAGE_ROLES, "ACCOMMODATION_OFFICER", "INVENTORY_KEY_CUSTODIAN"];

/** Read the register and reports. */
export const LOST_FOUND_VIEW_ROLES: Role[] = [...LOST_FOUND_OPERATE_ROLES, "AUDITOR"];
