// Role home screens (document section 10): action-first, in the same order for every role:
// what needs action, today or the pipeline, health KPIs, quick actions. The module card grid that
// repeated the sidebar is gone; each role lands on the work that belongs to it.
import type { Role } from "@prisma/client";
import { prisma } from "../../lib/db";
import type { Principal } from "../../lib/permissions/engine";
import { canAccess } from "../../lib/permissions/engine";
import { visibleSiteIds, siteWhere, type SiteScope } from "../../lib/permissions/scope";
import { getDashboard } from "../reports/service";
import { listInbox, withDelegations } from "../requests/service";

export type Tone = "danger" | "warning" | "info" | "ok";
export type HomeItem = { label: string; count: number; href: string; tone?: Tone; hint?: string };
export type HomeRow = { primary: string; secondary?: string; href?: string; badge?: string };
export type HomeList = { title: string; empty: string; rows: HomeRow[]; href?: string };
export type HomeKpi = { label: string; value: string | number; note?: string; href?: string; tone?: Tone };
export type Home = { role: Role; title: string; subtitle: string; needsAction: HomeItem[]; lists: HomeList[]; kpis: HomeKpi[]; quick: Array<{ label: string; href: string }> };

/** Which home a user lands on: the most operational role they hold. */
const HOME_ORDER: Role[] = ["SYSTEM_ADMIN", "ACCOMMODATION_ADMIN", "ACCOMMODATION_OFFICER", "MAINTENANCE_COORDINATOR", "SECURITY", "TECHNICIAN", "VENDOR", "READONLY_MANAGER", "AUDITOR", "LINE_MANAGER", "STAFF"];
export function primaryRole(roles: Role[]): Role | null {
  return HOME_ORDER.find((r) => roles.includes(r)) ?? null;
}

const day = 86400000;
const iso = (d: Date) => d.toISOString().slice(0, 10);
const pct = (n: number, d: number) => (d > 0 ? `${Math.round((n / d) * 100)}%` : "–");
const only = (items: HomeItem[]) => items; // keep zero-count rows: "nothing to do" is information

type Ctx = { principal: Principal; roles: Role[]; userId: string; organizationId: string; sites: SiteScope; now: Date };

export async function buildHome(principal: Principal, user: { id: string; organizationId: string; name: string }, now: Date = new Date()): Promise<Home | null> {
  const roles = [...new Set(principal.roleAssignments.map((a) => a.role))];
  const role = primaryRole(roles);
  if (!role || role === "STAFF") return null;
  const key = role === "SYSTEM_ADMIN" ? "setup.users" : role === "ACCOMMODATION_ADMIN" ? "accom.allocate" : role === "ACCOMMODATION_OFFICER" ? "accom.checkin" : role === "MAINTENANCE_COORDINATOR" ? "maint.triage" : "rep.l1";
  const visible = await visibleSiteIds(principal, key);
  const ctx: Ctx = { principal, roles, userId: user.id, organizationId: user.organizationId, sites: visible, now };
  switch (role) {
    case "SYSTEM_ADMIN": return superAdminHome(ctx, user.name);
    case "ACCOMMODATION_ADMIN": return accommodationAdminHome(ctx, user.name);
    case "ACCOMMODATION_OFFICER": return officerHome(ctx, user.name);
    case "MAINTENANCE_COORDINATOR": return coordinatorHome(ctx, user.name);
    case "TECHNICIAN":
    case "VENDOR": return fieldHome(ctx, user.name, role);
    case "SECURITY": return securityHome(ctx, user.name);
    case "READONLY_MANAGER": return managerHome(ctx, user.name);
    case "AUDITOR": return auditorHome(ctx, user.name);
    case "LINE_MANAGER": return lineManagerHome(ctx, user.name);
    default: return null;
  }
}

const first = (name: string) => name.split(" ")[0];

// ---------------------------------------------------------------------------
// Super Admin
// ---------------------------------------------------------------------------

async function superAdminHome(c: Ctx, name: string): Promise<Home> {
  const weekAgo = new Date(c.now.getTime() - 7 * day);
  const [changes, failedNotifications, locked, destructive, config, sites, beds, users, occupied, openOrders] = await Promise.all([
    prisma.changeRequest.count({ where: { organizationId: c.organizationId, status: "PENDING", requestedById: { not: c.userId } } }),
    prisma.notification.count({ where: { status: "FAILED", createdAt: { gte: weekAgo } } }),
    prisma.user.count({ where: { organizationId: c.organizationId, lockedUntil: { gt: c.now } } }),
    prisma.auditEvent.findMany({ where: { OR: [{ action: { contains: "ARCHIVE" } }, { action: { contains: "DELETE" } }, { action: { contains: "DEACTIVAT" } }, { action: { contains: "REVOKED" } }, { action: { contains: "PURGE" } }] }, orderBy: { createdAt: "desc" }, take: 6, include: { actor: { select: { name: true } } } }),
    prisma.auditEvent.findMany({ where: { OR: [{ action: { startsWith: "WORKFLOW_" } }, { action: { startsWith: "GRANT_" } }, { action: { startsWith: "ROLE_" } }, { action: { startsWith: "CHANGE_" } }, { action: { startsWith: "SITE_" } }] }, orderBy: { createdAt: "desc" }, take: 6, include: { actor: { select: { name: true } } } }),
    prisma.site.count({ where: { status: "ACTIVE" } }),
    prisma.bed.count({ where: { status: { not: "RETIRED" } } }),
    prisma.user.count({ where: { organizationId: c.organizationId, status: "ACTIVE" } }),
    prisma.allocation.count({ where: { status: "CHECKED_IN" } }),
    prisma.workOrder.count({ where: { status: { notIn: ["CLOSED", "CANCELLED"] } } }),
  ]);
  const audit = (e: (typeof destructive)[number]): HomeRow => ({ primary: e.action.toLowerCase().replace(/_/g, " "), secondary: `${e.actor?.name ?? "System"} · ${e.entityType}`, badge: e.createdAt.toISOString().slice(5, 16).replace("T", " ") });
  return {
    role: "SYSTEM_ADMIN", title: `Hello, ${first(name)}`, subtitle: "Organisation control: approvals from a second admin, access and system health.",
    needsAction: only([
      { label: "Changes waiting for your approval", count: changes, href: "/admin/changes", tone: changes ? "warning" : "ok" },
      { label: "Failed notifications (7 days)", count: failedNotifications, href: "/admin/notifications", tone: failedNotifications ? "danger" : "ok" },
      { label: "Locked accounts", count: locked, href: "/admin/users", tone: locked ? "warning" : "ok", hint: "Unlock from the user's page" },
    ]),
    lists: [
      { title: "Recent destructive actions", empty: "None recently.", rows: destructive.map(audit), href: "/admin/audit" },
      { title: "Recent configuration changes", empty: "None recently.", rows: config.map(audit), href: "/admin/audit" },
    ],
    kpis: [
      { label: "Active sites", value: sites, href: "/accommodation" },
      { label: "Beds in service", value: beds },
      { label: "Occupancy", value: pct(occupied, beds), note: `${occupied} of ${beds} beds`, href: "/dashboard" },
      { label: "Active users", value: users, href: "/admin/users" },
      { label: "Open work orders", value: openOrders, href: "/maintenance" },
    ],
    quick: [{ label: "New user", href: "/admin/users/new" }, { label: "Grant access", href: "/admin/access" }, { label: "Pending changes", href: "/admin/changes" }, { label: "Audit log", href: "/admin/audit" }],
  };
}

// ---------------------------------------------------------------------------
// Accommodation Admin
// ---------------------------------------------------------------------------

async function accommodationAdminHome(c: Ctx, name: string): Promise<Home> {
  const d = await getDashboard(c.sites, c.now);
  const actor = await withDelegations({ id: c.userId, roles: c.roles });
  const inbox = await listInbox(actor);
  const horizon = new Date(c.now.getTime() + 30 * day);
  const [joiners, exits, unverified] = await Promise.all([
    prisma.allocation.count({ where: { status: "CONFIRMED", startDate: { gte: c.now, lte: horizon } } }),
    prisma.allocation.count({ where: { status: "CHECKED_IN", endDate: { gte: c.now, lte: horizon } } }),
    prisma.staffProfile.count({ where: { verificationStatus: "UNVERIFIED", archivedAt: null } }),
  ]);
  const waitlist = await prisma.waitlistEntry.count({ where: { status: "WAITING" } });
  const s = d.summary;
  const row = (m: (typeof d.arrivals)[number]): HomeRow => ({ primary: `${m.staff} (${m.employeeId})`, secondary: `${m.building} · bed ${m.bed}`, badge: m.kind === "OVERDUE_ARRIVAL" ? "overdue" : m.kind === "OVERSTAY" ? "overstay" : m.date.slice(5), href: `/accommodation/allocations/${m.allocationId}` });
  return {
    role: "ACCOMMODATION_ADMIN", title: `Hello, ${first(name)}`, subtitle: "Decide and approve: requests, allocations, transfers, staff and exits.",
    needsAction: only([
      { label: "Requests and policy approvals", count: inbox.length, href: "/approvals", tone: inbox.length ? "warning" : "ok" },
      { label: "Unverified staff profiles", count: unverified, href: "/people?verification=UNVERIFIED", tone: unverified ? "warning" : "ok" },
      { label: "Overdue arrivals", count: d.pending.overdueArrivals, href: "/accommodation/allocations?filter=upcoming", tone: d.pending.overdueArrivals ? "danger" : "ok" },
      { label: "Overstays", count: d.pending.overstays, href: "/accommodation/allocations?filter=active", tone: d.pending.overstays ? "danger" : "ok" },
      { label: "Waitlist", count: waitlist, href: "/accommodation/waitlist", tone: waitlist ? "info" : "ok" },
      { label: "Approved room changes to move", count: d.pending.approvedRoomChanges, href: "/approvals?filter=approved", tone: d.pending.approvedRoomChanges ? "info" : "ok" },
    ]),
    lists: [
      { title: "Arrivals (next 14 days)", empty: "No arrivals due.", rows: d.arrivals.slice(0, 8).map(row), href: "/accommodation/allocations?filter=upcoming" },
      { title: "Departures (next 14 days)", empty: "No departures due.", rows: d.departures.slice(0, 8).map(row), href: "/accommodation/allocations?filter=active" },
    ],
    kpis: [
      { label: "Occupancy", value: `${d.occupancyRate}%`, note: `${s.occupied} of ${s.capacity} beds`, href: "/dashboard" },
      { label: "Available", value: s.vacant, href: "/accommodation" },
      { label: "Reserved", value: s.awaitingCheckIn, note: "allocated, awaiting check-in" },
      { label: "Blocked", value: s.blocked, tone: s.blocked ? "warning" : undefined },
      { label: "Joiners · 30 days", value: joiners, href: "/people/joiners" },
      { label: "Exits · 30 days", value: exits, href: "/people/exits" },
    ],
    quick: [{ label: "Allocate a bed", href: "/accommodation/allocations/new" }, { label: "Staff directory", href: "/people" }, { label: "Approvals", href: "/approvals" }, { label: "Site tree", href: "/accommodation" }],
  };
}

// ---------------------------------------------------------------------------
// Officer / Reception
// ---------------------------------------------------------------------------

async function officerHome(c: Ctx, name: string): Promise<Home> {
  const d = await getDashboard(c.sites, c.now);
  const today = iso(c.now);
  const tomorrow = iso(new Date(c.now.getTime() + day));
  const todayStart = new Date(`${today}T00:00:00.000Z`);
  const todayEnd = new Date(`${tomorrow}T00:00:00.000Z`);
  const [notReady, keysOverdue, clearances, arrivalsToday, departuresToday, transfersToday, bookings] = await Promise.all([
    prisma.bed.count({ where: { readiness: "NEEDS_CLEANING", status: { not: "RETIRED" }, room: { building: siteWhere(c.sites) } } }),
    prisma.keyTransaction.count({ where: { type: "ISSUE", returnedAt: null, expectedReturnAt: { lt: c.now }, key: siteWhere(c.sites) } }),
    prisma.allocation.count({ where: { status: "CHECKED_IN", endDate: { lte: new Date(c.now.getTime() + 3 * day) }, bed: { room: { building: siteWhere(c.sites) } } } }),
    prisma.allocation.findMany({ where: { status: "CONFIRMED", startDate: { equals: todayStart }, bed: { room: { building: siteWhere(c.sites) } } }, include: { staff: true, bed: { include: { room: { include: { building: true } } } } }, take: 10 }),
    prisma.allocation.findMany({ where: { status: "CHECKED_IN", endDate: { equals: todayStart }, bed: { room: { building: siteWhere(c.sites) } } }, include: { staff: true, bed: { include: { room: { include: { building: true } } } } }, take: 10 }),
    prisma.allocation.count({ where: { previousAllocationId: { not: null }, startDate: { equals: todayStart }, status: { in: ["CONFIRMED", "CHECKED_IN"] } } }),
    prisma.facilityBooking.findMany({ where: { startsAt: { gte: todayStart, lt: todayEnd }, status: { in: ["CONFIRMED", "PENDING_APPROVAL", "CHECKED_IN"] }, facility: siteWhere(c.sites) }, include: { facility: { select: { name: true } }, user: { select: { name: true } } }, orderBy: { startsAt: "asc" }, take: 10 }),
  ]);
  const people = (a: (typeof arrivalsToday)[number]): HomeRow => ({ primary: `${a.staff.firstName} ${a.staff.lastName}`, secondary: `${a.bed.room.building.name} · room ${a.bed.room.code} · bed ${a.bed.code}`, href: `/accommodation/allocations/${a.id}`, badge: a.status === "CONFIRMED" ? "check in" : "check out" });
  const s = d.summary;
  return {
    role: "ACCOMMODATION_OFFICER", title: `Hello, ${first(name)}`, subtitle: "Today's desk: arrivals, departures, keys and room readiness.",
    needsAction: only([
      { label: "Arrivals not yet checked in", count: d.pending.overdueArrivals + arrivalsToday.length, href: "/desk", tone: d.pending.overdueArrivals ? "danger" : arrivalsToday.length ? "warning" : "ok" },
      { label: "Beds not ready", count: notReady, href: "/desk/readiness", tone: notReady ? "warning" : "ok" },
      { label: "Keys overdue", count: keysOverdue, href: "/keys?filter=overdue", tone: keysOverdue ? "danger" : "ok" },
      { label: "Pending clearances", count: clearances, href: "/people/exits", tone: clearances ? "warning" : "ok" },
    ]),
    lists: [
      { title: "Arrivals today", empty: "No arrivals today.", rows: arrivalsToday.map(people), href: "/desk" },
      { title: "Departures today", empty: "No departures today.", rows: departuresToday.map(people), href: "/desk" },
      { title: "Facility bookings today", empty: "No bookings today.", rows: bookings.map((b) => ({ primary: `${b.facility.name} · ${b.user.name}`, secondary: b.startsAt.toISOString().slice(11, 16), badge: b.status === "PENDING_APPROVAL" ? "pending" : undefined, href: `/facilities/${b.facilityId}` })), href: "/facilities" },
    ],
    kpis: [
      { label: "Beds ready", value: Math.max(0, s.vacant - notReady), href: "/desk/readiness" },
      { label: "Beds not ready", value: notReady, tone: notReady ? "warning" : undefined },
      { label: "Transfers today", value: transfersToday },
      { label: "Occupancy", value: `${d.occupancyRate}%`, note: `${s.occupied} of ${s.capacity}` },
    ],
    quick: [{ label: "Front desk", href: "/desk" }, { label: "Keys desk", href: "/keys" }, { label: "Raise a ticket", href: "/maintenance/new" }, { label: "Lost & found", href: "/lost-found" }],
  };
}

// ---------------------------------------------------------------------------
// Maintenance Coordinator
// ---------------------------------------------------------------------------

async function coordinatorHome(c: Ctx, name: string): Promise<Home> {
  const site = siteWhere(c.sites);
  const soon = new Date(c.now.getTime() + 4 * 3600000);
  const open = { notIn: ["CLOSED", "CANCELLED", "RESOLVED"] as never[] };
  const [untriaged, breaching, breached, awaitingCost, awaitingVerification, onHold, byPriority, oldest] = await Promise.all([
    prisma.workOrder.count({ where: { ...site, status: "NEW" } }),
    prisma.workOrder.count({ where: { ...site, status: { ...open }, slaDueAt: { gte: c.now, lte: soon } } }),
    prisma.workOrder.count({ where: { ...site, status: { ...open }, slaDueAt: { lt: c.now } } }),
    prisma.workOrder.count({ where: { ...site, costApprovalStatus: "PENDING" } }),
    prisma.workOrder.count({ where: { ...site, status: "RESOLVED" } }),
    prisma.workOrder.groupBy({ by: ["status"], where: { ...site, status: { in: ["WAITING_STAFF", "WAITING_PARTS", "WAITING_ACCESS", "ON_HOLD"] } }, _count: true }),
    prisma.workOrder.groupBy({ by: ["priority"], where: { ...site, status: { ...open } }, _count: true }),
    prisma.workOrder.findFirst({ where: { ...site, status: { ...open } }, orderBy: { createdAt: "asc" }, select: { createdAt: true } }),
  ]);
  const preventive = await prisma.preventiveSchedule.findMany({ where: { active: true, nextDueAt: { lte: new Date(c.now.getTime() + day) }, ...site }, take: 8, orderBy: { nextDueAt: "asc" } });
  const prio = (p: string) => byPriority.find((x) => x.priority === p)?._count ?? 0;
  const ageDays = oldest ? Math.floor((c.now.getTime() - oldest.createdAt.getTime()) / day) : 0;
  return {
    role: "MAINTENANCE_COORDINATOR", title: `Hello, ${first(name)}`, subtitle: "Triage, assign, approve costs and keep every ticket inside its SLA.",
    needsAction: only([
      { label: "Untriaged", count: untriaged, href: "/maintenance?filter=unassigned", tone: untriaged ? "warning" : "ok" },
      { label: "SLA breached", count: breached, href: "/maintenance?filter=overdue", tone: breached ? "danger" : "ok" },
      { label: "SLA breaching within 4 h", count: breaching, href: "/maintenance?filter=open", tone: breaching ? "warning" : "ok" },
      { label: "Awaiting cost approval", count: awaitingCost, href: "/maintenance?filter=cost", tone: awaitingCost ? "warning" : "ok" },
      { label: "Awaiting verification", count: awaitingVerification, href: "/maintenance?filter=resolved", tone: awaitingVerification ? "info" : "ok" },
    ]),
    lists: [
      { title: "Preventive jobs due today", empty: "None due.", rows: preventive.map((p) => ({ primary: p.title, secondary: `${p.frequencyDays}-day cycle`, href: "/maintenance/preventive" })), href: "/maintenance/preventive" },
      { title: "On hold, by reason", empty: "Nothing on hold.", rows: onHold.map((h) => ({ primary: h.status.replace(/_/g, " ").toLowerCase(), badge: String(h._count), href: `/maintenance?filter=waiting` })), href: "/maintenance?filter=waiting" },
    ],
    kpis: [
      { label: "Urgent open", value: prio("URGENT"), tone: prio("URGENT") ? "danger" : undefined },
      { label: "High open", value: prio("HIGH") },
      { label: "Medium open", value: prio("MEDIUM") },
      { label: "Low open", value: prio("LOW") },
      { label: "Oldest open", value: `${ageDays} d`, note: "backlog ageing" },
    ],
    quick: [{ label: "Work orders", href: "/maintenance" }, { label: "Assignment board", href: "/maintenance/board" }, { label: "Vendors", href: "/maintenance/vendors" }, { label: "Permits", href: "/maintenance/permits" }],
  };
}

// ---------------------------------------------------------------------------
// Technician / Vendor (phone first)
// ---------------------------------------------------------------------------

async function fieldHome(c: Ctx, name: string, role: Role): Promise<Home> {
  const user = await prisma.user.findUnique({ where: { id: c.userId }, select: { vendorId: true } });
  const mine = role === "VENDOR" && user?.vendorId ? { vendorId: user.vendorId } : { assigneeId: c.userId };
  const [toAccept, today, upcoming] = await Promise.all([
    prisma.workOrder.findMany({ where: { ...mine, status: "ASSIGNED" }, orderBy: { slaDueAt: "asc" }, take: 10, include: { room: true, building: true } }),
    prisma.workOrder.findMany({ where: { ...mine, status: { in: ["ACCEPTED", "IN_PROGRESS", "WAITING_PARTS", "WAITING_ACCESS", "WAITING_STAFF"] } }, orderBy: { slaDueAt: "asc" }, take: 10, include: { room: true, building: true } }),
    prisma.workOrder.count({ where: { ...mine, status: { in: ["TRIAGED"] } } }),
  ]);
  const row = (w: (typeof toAccept)[number]): HomeRow => ({ primary: `${w.ticketNumber} · ${w.category}`, secondary: [w.building?.name, w.room ? `room ${w.room.code}` : null].filter(Boolean).join(" · ") || w.description.slice(0, 60), badge: w.priority.toLowerCase(), href: `/maintenance/${w.id}` });
  return {
    role, title: `Hello, ${first(name)}`, subtitle: "Your jobs.",
    needsAction: only([{ label: "New jobs to accept", count: toAccept.length, href: "/maintenance?filter=mine", tone: toAccept.length ? "warning" : "ok" }]),
    lists: [
      { title: "New jobs", empty: "No new jobs.", rows: toAccept.map(row), href: "/maintenance?filter=mine" },
      { title: "My jobs today", empty: "Nothing in progress.", rows: today.map(row), href: "/maintenance?filter=mine" },
    ],
    kpis: [{ label: "Upcoming", value: upcoming }],
    quick: [{ label: "My jobs", href: "/maintenance?filter=mine" }, { label: "History", href: "/maintenance?filter=closed" }],
  };
}

// ---------------------------------------------------------------------------
// Security
// ---------------------------------------------------------------------------

async function securityHome(c: Ctx, name: string): Promise<Home> {
  const site = siteWhere(c.sites);
  const todayStart = new Date(`${iso(c.now)}T00:00:00.000Z`);
  const [sos, overstays, denied, expected, inside] = await Promise.all([
    prisma.sosAlert.count({ where: { ...site, status: { in: ["ACTIVE", "ACKNOWLEDGED"] } } }),
    prisma.visitor.count({ where: { ...site, status: "CHECKED_IN", expectedOutAt: { lt: c.now } } }),
    prisma.visitor.count({ where: { ...site, status: "DENIED", updatedAt: { gte: todayStart } } }),
    prisma.visitor.findMany({ where: { ...site, status: "APPROVED", expectedAt: { gte: todayStart, lt: new Date(todayStart.getTime() + day) } }, orderBy: { expectedAt: "asc" }, take: 10 }),
    prisma.visitor.count({ where: { ...site, status: "CHECKED_IN" } }),
  ]);
  return {
    role: "SECURITY", title: `Hello, ${first(name)}`, subtitle: "Gate and safety.",
    needsAction: only([
      { label: "Active SOS", count: sos, href: "/security/sos", tone: sos ? "danger" : "ok" },
      { label: "Visitors past their time", count: overstays, href: "/security/visitors?filter=inside", tone: overstays ? "danger" : "ok" },
      { label: "Denied entries today", count: denied, href: "/security/visitors?filter=denied", tone: denied ? "warning" : "ok" },
    ]),
    lists: [{ title: "Expected visitors and contractors today", empty: "None expected.", rows: expected.map((v) => ({ primary: v.name, secondary: v.purpose ?? v.kind.toLowerCase(), badge: v.expectedAt ? v.expectedAt.toISOString().slice(11, 16) : undefined, href: `/security/visitors/${v.id}` })), href: "/security/visitors" }],
    kpis: [{ label: "People inside", value: inside, href: "/security/visitors?filter=inside" }],
    quick: [{ label: "Gate", href: "/security" }, { label: "Visitors", href: "/security/visitors" }, { label: "Incidents", href: "/security/incidents" }, { label: "Parcels", href: "/security/parcels" }],
  };
}

// ---------------------------------------------------------------------------
// Read-only Manager and Auditor
// ---------------------------------------------------------------------------

async function managerHome(c: Ctx, name: string): Promise<Home> {
  const d = await getDashboard(c.sites, c.now);
  const site = siteWhere(c.sites);
  const [open, breached, keysOverdue] = await Promise.all([
    prisma.workOrder.count({ where: { ...site, status: { notIn: ["CLOSED", "CANCELLED"] } } }),
    prisma.workOrder.count({ where: { ...site, status: { notIn: ["CLOSED", "CANCELLED", "RESOLVED"] }, slaDueAt: { lt: c.now } } }),
    prisma.keyTransaction.count({ where: { type: "ISSUE", returnedAt: null, expectedReturnAt: { lt: c.now }, key: site } }),
  ]);
  const alerts: HomeItem[] = [
    { label: `Occupancy ${d.occupancyRate}% (threshold 95%)`, count: d.occupancyRate >= 95 ? 1 : 0, href: "/dashboard", tone: d.occupancyRate >= 95 ? "danger" : "ok" },
    { label: "Tickets past SLA", count: breached, href: "/reports/maintenance", tone: breached ? "danger" : "ok" },
    { label: "Keys overdue", count: keysOverdue, href: "/reports/keys", tone: keysOverdue ? "warning" : "ok" },
    { label: "Overstays", count: d.pending.overstays, href: "/reports/movements", tone: d.pending.overstays ? "warning" : "ok" },
  ];
  const s = d.summary;
  return {
    role: "READONLY_MANAGER", title: `Hello, ${first(name)}`, subtitle: "How the operation is doing, at a glance.",
    needsAction: alerts, lists: [],
    kpis: [{ label: "Occupancy", value: `${d.occupancyRate}%`, note: `${s.occupied} of ${s.capacity}`, href: "/dashboard" }, { label: "Open work orders", value: open, href: "/reports/maintenance" }, { label: "Available beds", value: s.vacant }, { label: "Blocked beds", value: s.blocked }],
    quick: [{ label: "Executive 360", href: "/dashboard" }, { label: "Reports", href: "/reports" }, { label: "Scheduled reports", href: "/reports/scheduled" }],
  };
}

async function auditorHome(c: Ctx, name: string): Promise<Home> {
  const month = new Date(c.now.getTime() - 30 * day);
  const count = (where: object) => prisma.auditEvent.count({ where: { createdAt: { gte: month }, ...where } });
  const [selfApproval, afterHours, bulk, overrides, failedLogins, unchecked] = await Promise.all([
    count({ action: { contains: "SELF_APPROVAL" } }),
    prisma.$queryRaw<Array<{ n: bigint }>>`SELECT count(*)::bigint AS n FROM "AuditEvent" WHERE "createdAt" >= ${month} AND "actorId" IS NOT NULL AND (EXTRACT(HOUR FROM "createdAt" AT TIME ZONE 'UTC') < 5 OR EXTRACT(HOUR FROM "createdAt" AT TIME ZONE 'UTC') >= 22) AND ("action" LIKE 'ROLE_%' OR "action" LIKE 'GRANT_%' OR "action" LIKE 'USER_%' OR "action" LIKE 'WORKFLOW_%')`.then((r) => Number(r[0]?.n ?? 0)),
    count({ action: { contains: "BULK" } }),
    count({ action: { contains: "OVERRIDE" } }),
    count({ action: { in: ["LOGIN_FAILED", "LOGIN_LOCKED"] } }),
    count({ action: "CHANGE_APPLIED_UNCHECKED" }),
  ]);
  return {
    role: "AUDITOR", title: `Hello, ${first(name)}`, subtitle: "Exceptions in the last 30 days: did actions follow the rules?",
    needsAction: only([
      { label: "Self-approval attempts", count: selfApproval, href: "/admin/audit?action=SELF_APPROVAL", tone: selfApproval ? "danger" : "ok" },
      { label: "Admin actions after hours", count: afterHours, href: "/reports/exceptions", tone: afterHours ? "warning" : "ok" },
      { label: "Bulk changes", count: bulk, href: "/admin/audit?action=BULK", tone: bulk ? "warning" : "ok" },
      { label: "Overrides", count: overrides, href: "/admin/audit?action=OVERRIDE", tone: overrides ? "warning" : "ok" },
      { label: "Changes applied without a second admin", count: unchecked, href: "/admin/audit?action=CHANGE_APPLIED_UNCHECKED", tone: unchecked ? "warning" : "ok" },
      { label: "Failed or locked sign-ins", count: failedLogins, href: "/admin/audit?action=LOGIN_", tone: failedLogins > 10 ? "warning" : "ok" },
    ]),
    lists: [], kpis: [],
    quick: [{ label: "Audit log", href: "/admin/audit" }, { label: "Exception reports", href: "/reports/exceptions" }, { label: "Reports", href: "/reports" }],
  };
}

async function lineManagerHome(c: Ctx, name: string): Promise<Home> {
  const actor = await withDelegations({ id: c.userId, roles: c.roles });
  const inbox = await listInbox(actor);
  return {
    role: "LINE_MANAGER", title: `Hello, ${first(name)}`, subtitle: "Requests from your direct reports.",
    needsAction: [{ label: "Requests waiting for you", count: inbox.length, href: "/approvals", tone: inbox.length ? "warning" : "ok" }],
    lists: [{ title: "Waiting for your decision", empty: "Nothing waiting.", rows: inbox.slice(0, 8).map((r) => ({ primary: r.requestType.name, secondary: r.requester.name, href: `/approvals/${r.id}` })), href: "/approvals" }],
    kpis: [], quick: [{ label: "Approvals", href: "/approvals" }, { label: "Delegations", href: "/approvals/delegations" }],
  };
}

export { canAccess };
