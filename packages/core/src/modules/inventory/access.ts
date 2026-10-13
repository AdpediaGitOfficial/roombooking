import type { Role } from "@prisma/client";
import { rolesWithDefault } from "../../lib/permissions/matrix";

/** Create and edit item masters, write off, retire. */
export const INVENTORY_MANAGE_ROLES: Role[] = rolesWithDefault("inv.masters");

/** Day-to-day: issue, return, record damage (goods in and adjustments need the Inventory supervisor grant). */
export const INVENTORY_OPERATE_ROLES: Role[] = rolesWithDefault("inv.room_handover");

/** View the register and reports. */
export const INVENTORY_VIEW_ROLES: Role[] = rolesWithDefault("inv.room_assets", "full", "view");
