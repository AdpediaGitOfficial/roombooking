import type { Role } from "@prisma/client";
import { ACCOMMODATION_VIEW_ROLES } from "@/modules/accommodation/access";
import { ALLOCATION_VIEW_ROLES } from "@/modules/allocations/access";
import { APPROVALS_AREA_ROLES } from "@/modules/requests/access";
import { MAINTENANCE_AREA_ROLES } from "@/modules/maintenance/access";
import { FACILITY_VIEW_ROLES } from "@/modules/facilities/access";
import { KEY_VIEW_ROLES } from "@/modules/keys/access";
import { INVENTORY_VIEW_ROLES } from "@/modules/inventory/access";
import { LOST_FOUND_VIEW_ROLES } from "@/modules/lost-found/access";
import { REPORT_VIEW_ROLES } from "@/modules/reports/access";
import { ADMIN_VIEW_ROLES, USER_ADMIN_ROLES } from "@/modules/admin/access";
import { BROADCAST_ROLES } from "@/modules/broadcasts/access";

export type NavItem = { href: string; label: string; icon: string; description: string; roles: Role[] | "ALL" };
export type NavGroup = { label: string; items: NavItem[] };

const CONFIG_ROLES: Role[] = ["SYSTEM_ADMIN", "ACCOMMODATION_ADMIN"];

/** Sidebar and home-page entries, gated by the same role lists the pages enforce. */
export const NAV_GROUPS: NavGroup[] = [
  {
    label: "Workspace",
    items: [
      { href: "/dashboard", label: "Dashboard", icon: "▦", description: "Occupancy, arrivals, departures and pending actions", roles: REPORT_VIEW_ROLES },
      { href: "/accommodation", label: "Accommodation", icon: "⌂", description: "Sites, buildings, rooms and beds", roles: ACCOMMODATION_VIEW_ROLES },
      { href: "/accommodation/allocations", label: "Allocations", icon: "⇄", description: "Assign beds, check in and out, transfers", roles: ALLOCATION_VIEW_ROLES },
      { href: "/approvals", label: "Approvals", icon: "✓", description: "Room change, visitor, family and exit requests", roles: APPROVALS_AREA_ROLES },
      { href: "/maintenance", label: "Maintenance", icon: "⚒", description: "Work orders, assignment and contractor access", roles: MAINTENANCE_AREA_ROLES },
      { href: "/facilities", label: "Facilities", icon: "◷", description: "Shared facilities, calendars and bookings", roles: FACILITY_VIEW_ROLES },
      { href: "/keys", label: "Keys", icon: "⚿", description: "Issue, return, lost and damaged keys", roles: KEY_VIEW_ROLES },
      { href: "/inventory", label: "Inventory", icon: "▤", description: "Stock, serialised assets, issues and returns", roles: INVENTORY_VIEW_ROLES },
      { href: "/lost-found", label: "Lost & found", icon: "◎", description: "Found items, claims, handover and disposal", roles: LOST_FOUND_VIEW_ROLES },
    ],
  },
  {
    label: "Reports",
    items: [
      { href: "/reports", label: "Report suite", icon: "▥", description: "Movements, maintenance, facilities, keys; filters and CSV", roles: REPORT_VIEW_ROLES },
    ],
  },
  {
    label: "Administration",
    items: [
      { href: "/admin/users", label: "Users & roles", icon: "◉", description: "Accounts, roles, invitations and status", roles: ADMIN_VIEW_ROLES },
      { href: "/admin/audit", label: "Audit log", icon: "≡", description: "Who changed what, and when", roles: ADMIN_VIEW_ROLES },
      { href: "/admin/notifications", label: "Notifications", icon: "✉", description: "In-app, email and WhatsApp delivery", roles: ADMIN_VIEW_ROLES },
      { href: "/admin/broadcasts", label: "Broadcasts", icon: "▣", description: "Announcements to sites, buildings or roles", roles: BROADCAST_ROLES },
      { href: "/admin/forms", label: "Forms & routes", icon: "✎", description: "Request forms and approval routes", roles: CONFIG_ROLES },
      { href: "/admin/import", label: "Import & export", icon: "⇅", description: "Staff and accommodation from CSV", roles: CONFIG_ROLES },
      { href: "/approvals/delegations", label: "Delegations", icon: "⇉", description: "Approval cover while away", roles: APPROVALS_AREA_ROLES },
    ],
  },
  {
    label: "Me",
    items: [
      { href: "/my", label: "My stay", icon: "☺", description: "Your own bed, requests and tickets", roles: "ALL" },
    ],
  },
];

export const USER_ADMIN = USER_ADMIN_ROLES;

export function visibleGroups(roles: Role[]): NavGroup[] {
  return NAV_GROUPS.map((g) => ({ ...g, items: g.items.filter((i) => i.roles === "ALL" || i.roles.some((r) => roles.includes(r))) })).filter((g) => g.items.length > 0);
}
