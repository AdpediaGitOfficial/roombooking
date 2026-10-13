import type { Role } from "@prisma/client";
import { rolesWithDefault } from "../../lib/permissions/matrix";

/** Compose and send broadcasts to sites, buildings and user groups (COM-03). Officers and coordinators by grant. */
export const BROADCAST_ROLES: Role[] = rolesWithDefault("comm.broadcast");
