// Role catalogue from the Roles, Permissions & Module Map (section 2).
import type { Role } from "@prisma/client";

export type RoleMeta = {
  code: string;
  label: string;
  type: "Core" | "External" | "Oversight" | "Route step";
  job: string;
  scope: string;
  screen: string;
};

export const ROLE_META: Record<Role, RoleMeta> = {
  SYSTEM_ADMIN: { code: "SA", label: "Super Admin", type: "Core", job: "Configure organisation, structure, roles and permissions; full control of all data.", scope: "All sites", screen: "Web" },
  ACCOMMODATION_ADMIN: { code: "AA", label: "Accommodation Admin", type: "Core", job: "Decide and approve: rooms, allocations, transfers, staff master, eligibility, exits.", scope: "Assigned sites (optionally buildings)", screen: "Web" },
  ACCOMMODATION_OFFICER: { code: "OF", label: "Accommodation Officer / Reception", type: "Core", job: "Execute approved arrivals, departures, keys and desk operations.", scope: "Assigned sites / desk", screen: "Web, tablet" },
  STAFF: { code: "RS", label: "Staff / Resident", type: "Core", job: "Self-service: own stay, requests, tickets, bookings, visitors.", scope: "Self", screen: "Mobile" },
  MAINTENANCE_COORDINATOR: { code: "MC", label: "Maintenance Coordinator", type: "Core", job: "Triage, assign, approve costs, manage SLAs and vendors.", scope: "Assigned sites", screen: "Web" },
  TECHNICIAN: { code: "TE", label: "Technician", type: "Core", job: "Do assigned work orders (housekeeping staff are technicians with the Housekeeping category).", scope: "Own assigned jobs", screen: "Mobile" },
  VENDOR: { code: "VC", label: "Vendor / Contractor", type: "External", job: "Do assigned jobs within contract and visit window.", scope: "Own vendor's assigned jobs", screen: "Phone" },
  SECURITY: { code: "SE", label: "Security", type: "Core", job: "Gate entry, visitors, contractors, incidents and SOS.", scope: "Assigned sites / gates", screen: "Tablet, phone" },
  READONLY_MANAGER: { code: "RM", label: "Read-only Manager", type: "Oversight", job: "Watch performance (L1 and L2 reports).", scope: "Assigned scope", screen: "Web" },
  AUDITOR: { code: "AU", label: "Auditor", type: "Oversight", job: "Check that actions followed the rules (audit history).", scope: "All sites, read-only", screen: "Web" },
  LINE_MANAGER: { code: "LM", label: "Line Manager", type: "Route step", job: "Approve work-related requests via a link.", scope: "Direct reports", screen: "Email / WhatsApp link" },
};

/** Column order used by the permission matrix. */
export const MATRIX_ROLES: Role[] = [
  "SYSTEM_ADMIN",
  "ACCOMMODATION_ADMIN",
  "ACCOMMODATION_OFFICER",
  "STAFF",
  "MAINTENANCE_COORDINATOR",
  "TECHNICIAN",
  "VENDOR",
  "SECURITY",
  "READONLY_MANAGER",
  "AUDITOR",
];

export const ALL_ROLES: Role[] = [...MATRIX_ROLES, "LINE_MANAGER"];

export const ROLE_DESCRIPTIONS: Record<Role, string> = Object.fromEntries(
  ALL_ROLES.map((r) => [r, ROLE_META[r].job]),
) as Record<Role, string>;

export function roleLabel(role: Role): string {
  return ROLE_META[role].label;
}
