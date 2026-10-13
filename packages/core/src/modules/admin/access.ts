import type { Role } from "@prisma/client";
import { rolesWithAnyDefault, rolesWithDefault } from "../../lib/permissions/matrix";

export { ALL_ROLES, ROLE_DESCRIPTIONS, ROLE_META, roleLabel } from "../../lib/permissions/roles";

/** Create users, assign roles, change account status. */
export const USER_ADMIN_ROLES: Role[] = rolesWithDefault("setup.users");

/** Read users and the audit log. */
export const ADMIN_VIEW_ROLES: Role[] = rolesWithAnyDefault("setup.users");
