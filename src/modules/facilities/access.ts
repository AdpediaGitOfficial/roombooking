import type { Role } from "@prisma/client";

/** Configure facilities, approve bookings, cancel any booking. */
export const FACILITY_MANAGE_ROLES: Role[] = ["SYSTEM_ADMIN", "ACCOMMODATION_ADMIN", "FACILITY_MANAGER"];

/** Day-to-day: mark used / no-show, book on behalf. */
export const FACILITY_OPERATE_ROLES: Role[] = [...FACILITY_MANAGE_ROLES, "ACCOMMODATION_OFFICER"];

/** View the operations facility pages and reports. */
export const FACILITY_VIEW_ROLES: Role[] = [...FACILITY_OPERATE_ROLES, "AUDITOR"];
