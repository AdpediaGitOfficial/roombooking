import type { Role } from "@prisma/client";

/** Create and edit items, adjust stock, transfer between sites, retire. */
export const INVENTORY_MANAGE_ROLES: Role[] = ["SYSTEM_ADMIN", "ACCOMMODATION_ADMIN", "INVENTORY_KEY_CUSTODIAN"];

/** Day-to-day: receive, issue, return, record damage. */
export const INVENTORY_OPERATE_ROLES: Role[] = [...INVENTORY_MANAGE_ROLES, "ACCOMMODATION_OFFICER"];

/** View the register and reports. */
export const INVENTORY_VIEW_ROLES: Role[] = [...INVENTORY_OPERATE_ROLES, "AUDITOR", "MAINTENANCE"];
