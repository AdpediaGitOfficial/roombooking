import type { Role } from "@prisma/client";
import { rolesWithDefault } from "../../lib/permissions/matrix";

/** Configure facilities, approve bookings, cancel any booking (Facility manager grant for officers). */
export const FACILITY_MANAGE_ROLES: Role[] = rolesWithDefault("fac.configure");

/** Day-to-day: mark used / no-show, book on behalf. */
export const FACILITY_OPERATE_ROLES: Role[] = rolesWithDefault("fac.book_behalf");

/** View the operations facility pages and reports. */
export const FACILITY_VIEW_ROLES: Role[] = rolesWithDefault("fac.view", "full", "view").filter((r) => r !== "STAFF");
