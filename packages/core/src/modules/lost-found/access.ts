import type { Role } from "@prisma/client";
import { rolesWithDefault } from "../../lib/permissions/matrix";

/** Authorise disposal and see claimant details on every item. */
export const LOST_FOUND_MANAGE_ROLES: Role[] = ["SYSTEM_ADMIN", "ACCOMMODATION_ADMIN"];

/** Register, store, record claims, verify and hand over (Officer, Security and admins). */
export const LOST_FOUND_OPERATE_ROLES: Role[] = rolesWithDefault("lf.operate");

/** Read the register and reports. */
export const LOST_FOUND_VIEW_ROLES: Role[] = LOST_FOUND_OPERATE_ROLES;
