import type { Role } from "@prisma/client";
import { rolesWithDefault } from "../../lib/permissions/matrix";

/** Register keys, record lost/damaged, replace and retire. */
export const KEY_MANAGE_ROLES: Role[] = rolesWithDefault("keys.register");

/** Issue and return standard keys (includes reception handover at check-in/out). */
export const KEY_OPERATE_ROLES: Role[] = rolesWithDefault("keys.standard");

/** View the register and reports. */
export const KEY_VIEW_ROLES: Role[] = [...new Set([...rolesWithDefault("keys.standard"), ...rolesWithDefault("keys.register", "full", "view")])];
