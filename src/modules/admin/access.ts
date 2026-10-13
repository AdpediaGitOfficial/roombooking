import type { Role } from "@prisma/client";

/** Create users, assign roles, change account status. */
export const USER_ADMIN_ROLES: Role[] = ["SYSTEM_ADMIN"];

/** Read users and the audit log. */
export const ADMIN_VIEW_ROLES: Role[] = ["SYSTEM_ADMIN", "AUDITOR"];

export const ROLE_DESCRIPTIONS: Record<Role, string> = {
  SYSTEM_ADMIN: "Configure the organisation, users, roles and settings. Use sparingly.",
  ACCOMMODATION_ADMIN: "Manage buildings, rooms, beds, allocations and final approvals.",
  ACCOMMODATION_OFFICER: "Reception: allocate, check in and out, hand over keys, raise and triage maintenance.",
  STAFF: "Resident self-service: own stay, requests, maintenance tickets.",
  APPROVER: "Line manager: first-step approval of staff requests.",
  MAINTENANCE: "Engineer: work tickets assigned to them.",
  VENDOR: "Contractor: tickets assigned to their company only, time-limited.",
  INVENTORY_KEY_CUSTODIAN: "Keys and inventory: register, issue, return, exceptions.",
  FACILITY_MANAGER: "Shared facilities and booking rules.",
  AUDITOR: "Read-only access to reports and the audit log.",
};

export const ALL_ROLES = Object.keys(ROLE_DESCRIPTIONS) as Role[];
