import type { Role } from "@prisma/client";

/** Register keys, record lost/damaged, replace and retire. */
export const KEY_MANAGE_ROLES: Role[] = ["SYSTEM_ADMIN", "ACCOMMODATION_ADMIN", "INVENTORY_KEY_CUSTODIAN"];

/** Issue and return keys (includes reception handover at check-in/out). */
export const KEY_OPERATE_ROLES: Role[] = [...KEY_MANAGE_ROLES, "ACCOMMODATION_OFFICER"];

/** View the register and reports. */
export const KEY_VIEW_ROLES: Role[] = [...KEY_OPERATE_ROLES, "AUDITOR"];
