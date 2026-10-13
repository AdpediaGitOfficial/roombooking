import type { Role } from "@prisma/client";

/** May see every request and act as a fallback reviewer of the record. */
export const REQUEST_ADMIN_ROLES: Role[] = ["SYSTEM_ADMIN", "ACCOMMODATION_ADMIN"];

/** May open the approvals area at all (admins plus anyone who can be an approver). */
export const APPROVALS_AREA_ROLES: Role[] = [...REQUEST_ADMIN_ROLES, "APPROVER", "ACCOMMODATION_OFFICER", "FACILITY_MANAGER", "AUDITOR"];
