import type { Role } from "@prisma/client";
import { rolesWithDefault } from "../../lib/permissions/matrix";

/** May see every request and act as a fallback reviewer of the record. */
export const REQUEST_ADMIN_ROLES: Role[] = rolesWithDefault("accom.approve");

/** May open the approvals area at all (admins plus anyone who can be an approver). */
export const APPROVALS_AREA_ROLES: Role[] = [...REQUEST_ADMIN_ROLES, "LINE_MANAGER", "ACCOMMODATION_OFFICER", "MAINTENANCE_COORDINATOR", "AUDITOR"];
