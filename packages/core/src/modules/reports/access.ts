import type { Role } from "@prisma/client";

/** May see the occupancy dashboard and reports. */
export const REPORT_VIEW_ROLES: Role[] = ["SYSTEM_ADMIN", "ACCOMMODATION_ADMIN", "ACCOMMODATION_OFFICER", "AUDITOR"];
