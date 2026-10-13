import type { Role } from "@prisma/client";
import { ACCOMMODATION_VIEW_ROLES } from "@sam/core/modules/accommodation/access";
import { ALLOCATION_VIEW_ROLES } from "@sam/core/modules/allocations/access";
import { APPROVALS_AREA_ROLES } from "@sam/core/modules/requests/access";
import { MAINTENANCE_AREA_ROLES } from "@sam/core/modules/maintenance/access";
import { FACILITY_VIEW_ROLES } from "@sam/core/modules/facilities/access";
import { KEY_VIEW_ROLES } from "@sam/core/modules/keys/access";
import { INVENTORY_VIEW_ROLES } from "@sam/core/modules/inventory/access";
import { LOST_FOUND_VIEW_ROLES } from "@sam/core/modules/lost-found/access";
import { REPORT_VIEW_ROLES } from "@sam/core/modules/reports/access";
import { ADMIN_VIEW_ROLES, USER_ADMIN_ROLES } from "@sam/core/modules/admin/access";
import { BROADCAST_ROLES } from "@sam/core/modules/broadcasts/access";
import { FORM_BUILDER_ROLES } from "@sam/core/modules/requests/builder";

export type NavItem = { href: string; label: string; icon: string; description: string; roles: Role[] | "ALL" };
export type NavGroup = { label: string; items: NavItem[] };

const CONFIG_ROLES: Role[] = ["SYSTEM_ADMIN", "ACCOMMODATION_ADMIN"];
const ROLES = (...r: Role[]): Role[] => r;

/** Every entry the sidebar can show. A role's layout below picks and orders them; the matrix still gates each one. */
export const NAV_CATALOG = {
  home: { href: "/", label: "Home", icon: "⌂", description: "What needs your attention today", roles: "ALL" },
  dashboard: { href: "/dashboard", label: "Executive 360", icon: "▦", description: "Occupancy, arrivals, departures and pending actions", roles: REPORT_VIEW_ROLES },
  accommodation: { href: "/accommodation", label: "Site tree", icon: "⌂", description: "Sites, buildings, rooms and beds", roles: ACCOMMODATION_VIEW_ROLES },
  desk: { href: "/desk", label: "Front desk", icon: "☖", description: "Today's arrivals, departures, readiness and shift log", roles: ROLES("SYSTEM_ADMIN", "ACCOMMODATION_ADMIN", "ACCOMMODATION_OFFICER") },
  people: { href: "/people", label: "People", icon: "☺", description: "Staff directory, joiners, exits, verification", roles: ROLES("SYSTEM_ADMIN", "ACCOMMODATION_ADMIN", "ACCOMMODATION_OFFICER", "SECURITY", "READONLY_MANAGER", "AUDITOR") },
  waitlist: { href: "/accommodation/waitlist", label: "Waitlist", icon: "⧖", description: "People waiting for a bed", roles: ROLES("SYSTEM_ADMIN", "ACCOMMODATION_ADMIN") },
  archive: { href: "/admin/archive", label: "Archive", icon: "▭", description: "Restore archived records within 30 days", roles: ROLES("SYSTEM_ADMIN", "ACCOMMODATION_ADMIN") },
  security: { href: "/security", label: "Gate", icon: "⛉", description: "Verify residents, admit visitors and contractors", roles: ROLES("SYSTEM_ADMIN", "ACCOMMODATION_ADMIN", "ACCOMMODATION_OFFICER", "SECURITY") },
  visitors: { href: "/security/visitors", label: "Visitors", icon: "☍", description: "Pre-registered, walk-in and overnight visitors", roles: ROLES("SYSTEM_ADMIN", "ACCOMMODATION_ADMIN", "ACCOMMODATION_OFFICER", "SECURITY") },
  incidents: { href: "/security/incidents", label: "Incidents", icon: "⚠", description: "Report, review and close incidents", roles: ROLES("SYSTEM_ADMIN", "ACCOMMODATION_ADMIN", "ACCOMMODATION_OFFICER", "SECURITY", "MAINTENANCE_COORDINATOR", "TECHNICIAN", "AUDITOR") },
  parcels: { href: "/security/parcels", label: "Parcels", icon: "▢", description: "Log, notify and hand over parcels", roles: ROLES("ACCOMMODATION_OFFICER", "SECURITY") },
  sos: { href: "/security/sos", label: "SOS", icon: "✚", description: "Active alerts and response times", roles: ROLES("SYSTEM_ADMIN", "ACCOMMODATION_ADMIN", "ACCOMMODATION_OFFICER", "SECURITY") },
  patrol: { href: "/security/patrol", label: "Patrols", icon: "↻", description: "Patrol rounds and checkpoints", roles: ROLES("SECURITY") },
  shiftLog: { href: "/desk/shift", label: "Shift log", icon: "◔", description: "Start and end your shift; handover notes", roles: ROLES("ACCOMMODATION_OFFICER", "SECURITY") },
  restricted: { href: "/security/restricted", label: "Restricted list", icon: "⊘", description: "People who must not be admitted", roles: ROLES("SYSTEM_ADMIN", "ACCOMMODATION_ADMIN", "ACCOMMODATION_OFFICER", "SECURITY", "AUDITOR") },
  housekeeping: { href: "/housekeeping", label: "Housekeeping", icon: "✧", description: "Cleaning tasks and room inspections", roles: ROLES("ACCOMMODATION_ADMIN", "ACCOMMODATION_OFFICER", "TECHNICIAN", "MAINTENANCE_COORDINATOR") },
  charges: { href: "/charges", label: "Charges", icon: "¤", description: "Damage, fees and rent; approval and payroll export", roles: ROLES("SYSTEM_ADMIN", "ACCOMMODATION_ADMIN", "ACCOMMODATION_OFFICER", "AUDITOR") },
  allocations: { href: "/accommodation/allocations", label: "Allocations", icon: "⇄", description: "Assign beds, check in and out, transfers", roles: ALLOCATION_VIEW_ROLES },
  approvals: { href: "/approvals", label: "Approvals", icon: "✓", description: "Room change, visitor, family and exit requests", roles: APPROVALS_AREA_ROLES },
  delegations: { href: "/approvals/delegations", label: "Delegations", icon: "⇉", description: "Approval cover while away", roles: APPROVALS_AREA_ROLES },
  maintenance: { href: "/maintenance", label: "Work orders", icon: "⚒", description: "Work orders, assignment and contractor access", roles: MAINTENANCE_AREA_ROLES },
  facilities: { href: "/facilities", label: "Facilities", icon: "◷", description: "Shared facilities, calendars and bookings", roles: FACILITY_VIEW_ROLES },
  keys: { href: "/keys", label: "Keys", icon: "⚿", description: "Issue, return, lost and damaged keys", roles: KEY_VIEW_ROLES },
  inventory: { href: "/inventory", label: "Inventory", icon: "▤", description: "Stock, serialised assets, issues and returns", roles: INVENTORY_VIEW_ROLES },
  lostFound: { href: "/lost-found", label: "Lost & found", icon: "◎", description: "Found items, claims, handover and disposal", roles: LOST_FOUND_VIEW_ROLES },
  reports: { href: "/reports", label: "Report suite", icon: "▥", description: "Movements, maintenance, facilities, keys; filters and CSV", roles: REPORT_VIEW_ROLES },
  users: { href: "/admin/users", label: "Users", icon: "◉", description: "Accounts, sign-in, roles and status", roles: ADMIN_VIEW_ROLES },
  access: { href: "/admin/access", label: "Roles & access", icon: "⚿", description: "Permission matrix, grants and access review", roles: ADMIN_VIEW_ROLES },
  changes: { href: "/admin/changes", label: "Pending changes", icon: "⇋", description: "Second-admin approval of high-risk changes", roles: USER_ADMIN_ROLES },
  audit: { href: "/admin/audit", label: "Audit log", icon: "≡", description: "Who changed what, and when", roles: ROLES("SYSTEM_ADMIN", "ACCOMMODATION_ADMIN", "AUDITOR", "READONLY_MANAGER") },
  notifications: { href: "/admin/notifications", label: "Notifications", icon: "✉", description: "In-app, email and WhatsApp delivery", roles: ADMIN_VIEW_ROLES },
  broadcasts: { href: "/admin/broadcasts", label: "Broadcasts", icon: "▣", description: "Announcements to sites, buildings or roles", roles: BROADCAST_ROLES },
  forms: { href: "/admin/forms", label: "Forms & routes", icon: "✎", description: "Request forms and approval routes", roles: FORM_BUILDER_ROLES },
  imports: { href: "/admin/import", label: "Import & export", icon: "⇅", description: "Staff and accommodation from CSV", roles: CONFIG_ROLES },
  myStay: { href: "/my", label: "My stay", icon: "☺", description: "Your own bed, requests and tickets", roles: "ALL" },
} satisfies Record<string, NavItem>;

export type NavId = keyof typeof NAV_CATALOG;
type Layout = Array<[label: string, ids: NavId[]]>;

/** Sidebar groups per role (document section 10); users with several roles see the union. */
export const ROLE_NAV: Partial<Record<Role, Layout>> = {
  SYSTEM_ADMIN: [
    ["Overview", ["home", "dashboard"]],
    ["Setup", ["accommodation", "imports", "people", "archive"]],
    ["Access", ["users", "access", "changes"]],
    ["Workflows", ["forms", "approvals", "delegations"]],
    ["Integrations", ["notifications", "broadcasts"]],
    ["Operations", ["desk", "allocations", "waitlist", "maintenance", "keys", "inventory", "facilities", "lostFound", "housekeeping"]],
    ["Security", ["security", "visitors", "incidents", "restricted"]],
    ["Charges", ["charges"]],
    ["Reports", ["reports"]],
    ["Audit", ["audit"]],
  ],
  ACCOMMODATION_ADMIN: [
    ["Overview", ["home", "dashboard"]],
    ["Accommodation", ["accommodation", "allocations", "waitlist", "desk", "people"]],
    ["Requests", ["approvals", "delegations"]],
    ["Operations", ["maintenance", "keys", "inventory", "facilities", "lostFound", "housekeeping"]],
    ["Security", ["security", "visitors", "incidents", "restricted"]],
    ["Charges", ["charges"]],
    ["Communication", ["broadcasts", "notifications"]],
    ["Setup", ["imports", "archive", "audit"]],
    ["Reports", ["reports"]],
  ],
  ACCOMMODATION_OFFICER: [
    ["Front desk", ["home", "desk", "allocations", "people", "visitors", "parcels", "keys", "facilities", "lostFound", "housekeeping", "shiftLog"]],
    ["Operations", ["maintenance", "inventory", "approvals"]],
    ["Reports", ["reports"]],
  ],
  MAINTENANCE_COORDINATOR: [
    ["Overview", ["home"]],
    ["Maintenance", ["maintenance", "housekeeping", "incidents"]],
    ["Resources", ["inventory", "keys", "facilities"]],
    ["Reports", ["reports"]],
  ],
  TECHNICIAN: [["My work", ["home", "maintenance", "housekeeping", "incidents"]]],
  VENDOR: [["My work", ["home", "maintenance"]]],
  SECURITY: [["Gate", ["home", "security", "visitors", "incidents", "parcels", "sos", "patrol", "shiftLog", "restricted", "people", "lostFound"]]],
  READONLY_MANAGER: [
    ["Overview", ["home", "dashboard"]],
    ["Reports", ["reports"]],
  ],
  AUDITOR: [
    ["Overview", ["home"]],
    ["Audit", ["audit", "reports", "incidents", "restricted", "charges"]],
  ],
  LINE_MANAGER: [["Approvals", ["home", "approvals", "delegations"]]],
};

const ORDER: Role[] = ["SYSTEM_ADMIN", "ACCOMMODATION_ADMIN", "ACCOMMODATION_OFFICER", "MAINTENANCE_COORDINATOR", "SECURITY", "TECHNICIAN", "VENDOR", "READONLY_MANAGER", "AUDITOR", "LINE_MANAGER"];

/** Sidebar and home entries for a user: their roles' layouts, merged by group name, filtered by what the matrix allows. */
export function visibleGroups(roles: Role[]): NavGroup[] {
  const groups: NavGroup[] = [];
  const seen = new Set<string>();
  for (const role of ORDER.filter((r) => roles.includes(r))) {
    for (const [label, ids] of ROLE_NAV[role] ?? []) {
      const items: NavItem[] = [];
      for (const id of ids) {
        const item: NavItem = NAV_CATALOG[id];
        const allowed = item.roles === "ALL" || item.roles.some((r) => roles.includes(r));
        if (!allowed || seen.has(item.href)) continue;
        seen.add(item.href);
        items.push(item);
      }
      if (!items.length) continue;
      const existing = groups.find((g) => g.label === label);
      if (existing) existing.items.push(...items);
      else groups.push({ label, items });
    }
  }
  return groups;
}

export const USER_ADMIN = USER_ADMIN_ROLES;
