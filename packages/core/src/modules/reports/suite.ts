// Report suite (RPT-02..RPT-08): staff movement, maintenance, facility use and
// keys, each with date range, site, building, status and category filters and
// a CSV export. Row-level access (RPT-07): a person scoped to sites or
// buildings sees only those sites; auditors see employee IDs but not names.
// Metric formulas and time-zone boundaries are defined once here (RPT-08) and
// shown on every report page.
import type { AllocationStatus, KeyStatus, Prisma, Role, WorkOrderPriority, WorkOrderStatus } from "@prisma/client";
import { prisma } from "../../lib/db";
import { recordAudit } from "../../lib/audit";
import { addDaysIso, zonedDateTime, zonedToUtc } from "../../lib/time";
import { isoDate } from "../accommodation/occupancy";
import { OPEN_STATUSES } from "../maintenance/service";
import { facilityConfig } from "../facilities/service";
import { toCsv } from "./service";
import { REPORT_VIEW_ROLES } from "./access";

// ---------------------------------------------------------------------------
// Access and masking (RPT-07)
// ---------------------------------------------------------------------------

/** Sites a person may report on: null means every site. */
export type Scope = { siteIds: string[] | null; canSeeNames: boolean };

type RoleHolder = { roleAssignments: Array<{ role: Role; siteId: string | null; buildingId: string | null }> };

export async function scopeFor(user: RoleHolder): Promise<Scope> {
  const relevant = user.roleAssignments.filter((r) => REPORT_VIEW_ROLES.includes(r.role));
  const canSeeNames = user.roleAssignments.some((r) => (["SYSTEM_ADMIN", "ACCOMMODATION_ADMIN", "ACCOMMODATION_OFFICER"] as Role[]).includes(r.role));
  if (relevant.some((r) => r.siteId === null && r.buildingId === null)) return { siteIds: null, canSeeNames };
  const siteIds = new Set(relevant.map((r) => r.siteId).filter((s): s is string => !!s));
  const buildingIds = relevant.map((r) => r.buildingId).filter((b): b is string => !!b);
  if (buildingIds.length) for (const b of await prisma.building.findMany({ where: { id: { in: buildingIds } }, select: { siteId: true } })) siteIds.add(b.siteId);
  return { siteIds: [...siteIds], canSeeNames };
}

/** Narrows a requested site to the scope; a site outside it yields an empty report rather than leaking rows. */
export function siteFilter(scope: Scope, siteId: string | null): { siteId?: string | { in: string[] } } {
  if (siteId) return { siteId: scope.siteIds === null || scope.siteIds.includes(siteId) ? siteId : { in: [] } };
  return scope.siteIds === null ? {} : { siteId: { in: scope.siteIds } };
}

export function person(scope: Scope, p: { firstName: string; lastName: string; employeeId: string } | null | undefined, fallback = "—"): string {
  if (!p) return fallback;
  return scope.canSeeNames ? `${p.firstName} ${p.lastName} (${p.employeeId})` : p.employeeId;
}

// ---------------------------------------------------------------------------
// Date ranges (RPT-08): a report day runs midnight to midnight in the chosen
// site's time zone; with no site chosen, UTC is used.
// ---------------------------------------------------------------------------

export type Range = { from: string; to: string };
const ISO = /^\d{4}-\d{2}-\d{2}$/;

export function defaultRange(now: Date = new Date(), days = 30): Range {
  const to = now.toISOString().slice(0, 10);
  return { from: addDaysIso(to, -(days - 1)), to };
}

export function parseRange(from?: string | null, to?: string | null, now: Date = new Date()): Range {
  const d = defaultRange(now);
  const f = from && ISO.test(from) ? from : d.from;
  let t = to && ISO.test(to) ? to : d.to;
  if (t < f) t = f;
  return { from: f, to: t };
}

export async function rangeBounds(range: Range, siteId: string | null): Promise<{ start: Date; end: Date; timezone: string }> {
  const timezone = siteId ? ((await prisma.site.findUnique({ where: { id: siteId }, select: { timezone: true } }))?.timezone ?? "UTC") : "UTC";
  return { start: zonedToUtc(range.from, "00:00", timezone), end: zonedToUtc(addDaysIso(range.to, 1), "00:00", timezone), timezone };
}

export const DEFINITIONS = {
  movements: [
    "Rows: allocations that overlap the range (start date on or before the last day, end date empty or on or after the first day), optionally narrowed by status.",
    "Arrivals: check-ins recorded within the range. Departures: check-outs recorded within the range. Transfers: allocations in the range that continue an earlier allocation.",
    "Dates are calendar dates in the site's time zone; check-in and check-out times are shown in UTC.",
  ],
  maintenance: [
    "Backlog: tickets open right now (new, triaged, assigned, in progress, waiting, reopened), regardless of the range. Overdue: open tickets past their SLA due time.",
    "Resolution time: hours from creation to the latest resolution, for tickets resolved or closed within the range. Mean and median are over those tickets. SLA met: resolved on or before the SLA due time.",
    "Workload: open tickets per assignee or vendor now, and tickets they resolved within the range.",
    "The range covers midnight to midnight in the selected site's time zone (UTC when all sites are shown).",
  ],
  facilities: [
    "Bookings: bookings starting within the range, by status. Attended: marked used or completed. No-shows: confirmed bookings marked as not used.",
    "Open hours: the facility's opening hours summed over the days in the range. Utilisation: booked person-hours of confirmed, used and completed bookings divided by capacity × open hours.",
    "Days are the facility site's calendar days.",
  ],
  keys: [
    "Register counts are the state of each key right now. Outstanding: keys issued and not yet returned; overdue: outstanding keys past their expected return date.",
    "Transactions: key events recorded within the range (issues, returns, lost, damaged, repairs, replacements, retirements).",
    "The range covers midnight to midnight in the selected site's time zone (UTC when all sites are shown).",
  ],
};

// ---------------------------------------------------------------------------
// RPT-02 Staff movement / allocation history
// ---------------------------------------------------------------------------

export type MovementFilter = { siteId?: string | null; buildingId?: string | null; status?: AllocationStatus | null; q?: string | null; range: Range };
export type MovementReportRow = { allocationId: string; person: string; site: string; building: string; room: string; bed: string; status: AllocationStatus; startDate: string; endDate: string | null; checkedInAt: Date | null; checkedOutAt: Date | null; transferredFrom: string | null };
export type MovementReport = { rows: MovementReportRow[]; summary: { allocations: number; arrivals: number; departures: number; transfers: number; cancelled: number } };

export async function movementReport(scope: Scope, f: MovementFilter, limit = 1000): Promise<MovementReport> {
  const { start, end } = await rangeBounds(f.range, f.siteId ?? null);
  const where: Prisma.AllocationWhereInput = {
    bed: { room: { building: { ...siteFilter(scope, f.siteId ?? null), ...(f.buildingId ? { id: f.buildingId } : {}) } } },
    ...(f.status ? { status: f.status } : {}),
    startDate: { lte: new Date(`${f.range.to}T00:00:00.000Z`) },
    OR: [{ endDate: null }, { endDate: { gte: new Date(`${f.range.from}T00:00:00.000Z`) } }],
    ...(f.q ? { staff: { OR: [{ employeeId: { contains: f.q, mode: "insensitive" } }, { firstName: { contains: f.q, mode: "insensitive" } }, { lastName: { contains: f.q, mode: "insensitive" } }] } } : {}),
  };
  const rows = await prisma.allocation.findMany({
    where, take: limit, orderBy: [{ startDate: "desc" }, { createdAt: "desc" }],
    include: { staff: { select: { firstName: true, lastName: true, employeeId: true } }, bed: { include: { room: { include: { building: { include: { site: { select: { name: true } } } } } } } }, previous: { select: { bed: { select: { code: true } } } } },
  });
  const inRange = (d: Date | null) => !!d && d >= start && d < end;
  const out = rows.map((a) => ({
    allocationId: a.id, person: person(scope, a.staff), site: a.bed.room.building.site.name, building: a.bed.room.building.name, room: a.bed.room.code, bed: a.bed.code, status: a.status,
    startDate: isoDate(a.startDate), endDate: a.endDate ? isoDate(a.endDate) : null, checkedInAt: a.checkedInAt, checkedOutAt: a.checkedOutAt, transferredFrom: a.previous?.bed.code ?? null,
  }));
  return {
    rows: out,
    summary: {
      allocations: out.length,
      arrivals: rows.filter((a) => inRange(a.checkedInAt)).length,
      departures: rows.filter((a) => inRange(a.checkedOutAt)).length,
      transfers: rows.filter((a) => a.previousAllocationId && isoDate(a.startDate) >= f.range.from && isoDate(a.startDate) <= f.range.to).length,
      cancelled: rows.filter((a) => a.status === "CANCELLED").length,
    },
  };
}

export async function movementCsv(scope: Scope, f: MovementFilter, actorId: string): Promise<string> {
  const r = await movementReport(scope, f, 10000);
  await recordAudit({ actorId, action: "REPORT_EXPORTED", entityType: "Report", entityId: "movements", after: { ...f, rows: r.rows.length, masked: !scope.canSeeNames } });
  return toCsv(["Person", "Site", "Building", "Room", "Bed", "Status", "Start", "End", "Checked in (UTC)", "Checked out (UTC)", "Transferred from"], r.rows.map((x) => [x.person, x.site, x.building, x.room, x.bed, x.status, x.startDate, x.endDate ?? "", x.checkedInAt?.toISOString() ?? "", x.checkedOutAt?.toISOString() ?? "", x.transferredFrom ?? ""]));
}

// ---------------------------------------------------------------------------
// RPT-03 Maintenance backlog, overdue, resolution time, workload
// ---------------------------------------------------------------------------

export type MaintenanceFilter = { siteId?: string | null; buildingId?: string | null; category?: string | null; status?: WorkOrderStatus | null; range: Range };
export type MaintenanceRow = { id: string; ticketNumber: string; createdAt: Date; status: WorkOrderStatus; priority: WorkOrderPriority; category: string; site: string; building: string | null; assignee: string | null; vendor: string | null; resolvedAt: Date | null; hours: number | null; overdue: boolean; slaMet: boolean | null };
export type MaintenanceReport = {
  backlogByStatus: Array<{ status: WorkOrderStatus; count: number }>;
  backlogByPriority: Array<{ priority: WorkOrderPriority; count: number; overdue: number }>;
  overdue: number;
  resolution: { resolved: number; meanHours: number | null; medianHours: number | null; slaMet: number; slaMetPercent: number | null };
  workload: Array<{ who: string; kind: "assignee" | "vendor"; open: number; overdue: number; resolvedInRange: number }>;
  categories: Array<{ category: string; created: number; open: number }>;
  rows: MaintenanceRow[];
};

const hoursBetween = (a: Date, b: Date) => Math.round(((b.getTime() - a.getTime()) / 3600000) * 10) / 10;
function median(values: number[]): number | null {
  if (!values.length) return null;
  const s = [...values].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : Math.round(((s[m - 1] + s[m]) / 2) * 10) / 10;
}

export async function maintenanceReport(scope: Scope, f: MaintenanceFilter, now: Date = new Date(), limit = 1000): Promise<MaintenanceReport> {
  const { start, end } = await rangeBounds(f.range, f.siteId ?? null);
  const base: Prisma.WorkOrderWhereInput = { ...siteFilter(scope, f.siteId ?? null), ...(f.buildingId ? { buildingId: f.buildingId } : {}), ...(f.category ? { category: f.category } : {}) };
  const include = { site: { select: { name: true } }, building: { select: { name: true } }, assignee: { select: { name: true } }, vendor: { select: { name: true } } } satisfies Prisma.WorkOrderInclude;
  // Open now (backlog) plus everything created, resolved or closed in the range.
  const tickets = await prisma.workOrder.findMany({
    where: { ...base, OR: [{ status: { in: OPEN_STATUSES } }, { createdAt: { gte: start, lt: end } }, { resolvedAt: { gte: start, lt: end } }, { closedAt: { gte: start, lt: end } }], ...(f.status ? { status: f.status } : {}) },
    include, orderBy: { createdAt: "desc" }, take: limit,
  });
  const open = tickets.filter((t) => OPEN_STATUSES.includes(t.status));
  const isOverdue = (t: { status: WorkOrderStatus; slaDueAt: Date | null }) => OPEN_STATUSES.includes(t.status) && !!t.slaDueAt && t.slaDueAt < now;
  const resolvedIn = tickets.filter((t) => (t.resolvedAt && t.resolvedAt >= start && t.resolvedAt < end) || (t.status === "CLOSED" && t.closedAt && t.closedAt >= start && t.closedAt < end && t.resolvedAt));
  const hours = resolvedIn.map((t) => hoursBetween(t.createdAt, t.resolvedAt!));
  const slaMet = resolvedIn.filter((t) => !t.slaDueAt || t.resolvedAt! <= t.slaDueAt).length;
  const byStatus = new Map<WorkOrderStatus, number>();
  for (const t of open) byStatus.set(t.status, (byStatus.get(t.status) ?? 0) + 1);
  const byPriority = new Map<WorkOrderPriority, { count: number; overdue: number }>();
  for (const t of open) { const r = byPriority.get(t.priority) ?? { count: 0, overdue: 0 }; r.count++; if (isOverdue(t)) r.overdue++; byPriority.set(t.priority, r); }
  const workload = new Map<string, MaintenanceReport["workload"][number]>();
  const bump = (key: string, who: string, kind: "assignee" | "vendor", field: "open" | "overdue" | "resolvedInRange") => {
    const r = workload.get(key) ?? { who, kind, open: 0, overdue: 0, resolvedInRange: 0 };
    r[field]++;
    workload.set(key, r);
  };
  for (const t of open) {
    if (t.assignee) { bump(`a:${t.assigneeId}`, t.assignee.name, "assignee", "open"); if (isOverdue(t)) bump(`a:${t.assigneeId}`, t.assignee.name, "assignee", "overdue"); }
    if (t.vendor) { bump(`v:${t.vendorId}`, t.vendor.name, "vendor", "open"); if (isOverdue(t)) bump(`v:${t.vendorId}`, t.vendor.name, "vendor", "overdue"); }
  }
  for (const t of resolvedIn) {
    if (t.assignee) bump(`a:${t.assigneeId}`, t.assignee.name, "assignee", "resolvedInRange");
    if (t.vendor) bump(`v:${t.vendorId}`, t.vendor.name, "vendor", "resolvedInRange");
  }
  const categories = new Map<string, { created: number; open: number }>();
  for (const t of tickets) {
    const r = categories.get(t.category) ?? { created: 0, open: 0 };
    if (t.createdAt >= start && t.createdAt < end) r.created++;
    if (OPEN_STATUSES.includes(t.status)) r.open++;
    categories.set(t.category, r);
  }
  const priorities: WorkOrderPriority[] = ["URGENT", "HIGH", "MEDIUM", "LOW"];
  return {
    backlogByStatus: OPEN_STATUSES.map((status) => ({ status, count: byStatus.get(status) ?? 0 })).filter((r) => r.count > 0),
    backlogByPriority: priorities.map((priority) => ({ priority, ...(byPriority.get(priority) ?? { count: 0, overdue: 0 }) })),
    overdue: open.filter(isOverdue).length,
    resolution: { resolved: resolvedIn.length, meanHours: hours.length ? Math.round((hours.reduce((a, b) => a + b, 0) / hours.length) * 10) / 10 : null, medianHours: median(hours), slaMet, slaMetPercent: resolvedIn.length ? Math.round((slaMet / resolvedIn.length) * 100) : null },
    workload: [...workload.values()].sort((a, b) => b.open - a.open || a.who.localeCompare(b.who)),
    categories: [...categories.entries()].map(([category, r]) => ({ category, ...r })).sort((a, b) => b.open - a.open || b.created - a.created),
    rows: tickets.map((t) => ({ id: t.id, ticketNumber: t.ticketNumber, createdAt: t.createdAt, status: t.status, priority: t.priority, category: t.category, site: t.site.name, building: t.building?.name ?? null, assignee: t.assignee?.name ?? null, vendor: t.vendor?.name ?? null, resolvedAt: t.resolvedAt, hours: t.resolvedAt ? hoursBetween(t.createdAt, t.resolvedAt) : null, overdue: isOverdue(t), slaMet: t.resolvedAt ? !t.slaDueAt || t.resolvedAt <= t.slaDueAt : null })),
  };
}

export async function maintenanceCsv(scope: Scope, f: MaintenanceFilter, actorId: string): Promise<string> {
  const r = await maintenanceReport(scope, f, new Date(), 10000);
  await recordAudit({ actorId, action: "REPORT_EXPORTED", entityType: "Report", entityId: "maintenance", after: { ...f, rows: r.rows.length } });
  return toCsv(["Ticket", "Created (UTC)", "Status", "Priority", "Category", "Site", "Building", "Assignee", "Vendor", "Resolved (UTC)", "Hours to resolve", "Overdue", "SLA met"], r.rows.map((x) => [x.ticketNumber, x.createdAt.toISOString(), x.status, x.priority, x.category, x.site, x.building ?? "", x.assignee ?? "", x.vendor ?? "", x.resolvedAt?.toISOString() ?? "", x.hours ?? "", x.overdue ? "yes" : "", x.slaMet === null ? "" : x.slaMet ? "yes" : "no"]));
}

// ---------------------------------------------------------------------------
// RPT-04 Facility utilisation, bookings, cancellations, no-shows
// ---------------------------------------------------------------------------

export type FacilityFilter = { siteId?: string | null; facilityId?: string | null; range: Range };
export type FacilityRow = { facilityId: string; name: string; site: string; bookings: number; confirmed: number; cancelled: number; rejected: number; expired: number; noShows: number; attended: number; pending: number; people: number; bookedHours: number; openHours: number; utilisation: number | null };

export async function facilityReport(scope: Scope, f: FacilityFilter): Promise<FacilityRow[]> {
  const facilities = await prisma.facility.findMany({ where: { ...siteFilter(scope, f.siteId ?? null), ...(f.facilityId ? { id: f.facilityId } : {}) }, include: { site: { select: { id: true, name: true, timezone: true } } }, orderBy: [{ site: { name: "asc" } }, { name: "asc" }] });
  const out: FacilityRow[] = [];
  for (const fac of facilities) {
    const tz = fac.site.timezone;
    const start = zonedToUtc(f.range.from, "00:00", tz);
    const end = zonedToUtc(addDaysIso(f.range.to, 1), "00:00", tz);
    const rows = await prisma.facilityBooking.findMany({ where: { facilityId: fac.id, startsAt: { gte: start, lt: end } }, select: { status: true, startsAt: true, endsAt: true, headcount: true } });
    const { hours } = facilityConfig(fac);
    let openHours = 0;
    for (let d = f.range.from; d <= f.range.to; d = addDaysIso(d, 1)) {
      const h = hours[zonedDateTime(zonedToUtc(d, "12:00", tz), tz).weekday];
      if (h) openHours += (Number(h.close.slice(0, 2)) * 60 + Number(h.close.slice(3)) - Number(h.open.slice(0, 2)) * 60 - Number(h.open.slice(3))) / 60;
    }
    const used = rows.filter((r) => ["CONFIRMED", "CHECKED_IN", "COMPLETED"].includes(r.status));
    const bookedHours = Math.round(used.reduce((s, r) => s + ((r.endsAt.getTime() - r.startsAt.getTime()) / 3600000) * r.headcount, 0) * 10) / 10;
    const count = (...st: string[]) => rows.filter((r) => st.includes(r.status)).length;
    out.push({
      facilityId: fac.id, name: fac.name, site: fac.site.name, bookings: rows.length, confirmed: count("CONFIRMED"), cancelled: count("CANCELLED"), rejected: count("REJECTED"), expired: count("EXPIRED"),
      noShows: count("NO_SHOW"), attended: count("CHECKED_IN", "COMPLETED"), pending: count("PENDING_APPROVAL"), people: used.reduce((s, r) => s + r.headcount, 0), bookedHours, openHours: Math.round(openHours),
      utilisation: openHours > 0 ? Math.round((bookedHours / (openHours * fac.capacity)) * 100) : null,
    });
  }
  return out;
}

export async function facilityCsv(scope: Scope, f: FacilityFilter, actorId: string): Promise<string> {
  const rows = await facilityReport(scope, f);
  await recordAudit({ actorId, action: "REPORT_EXPORTED", entityType: "Report", entityId: "facilities", after: { ...f, rows: rows.length } });
  return toCsv(["Facility", "Site", "Bookings", "Confirmed", "Attended", "No-shows", "Cancelled", "Declined", "Expired", "Pending", "People", "Booked hours", "Open hours", "Utilisation %"], rows.map((r) => [r.name, r.site, r.bookings, r.confirmed, r.attended, r.noShows, r.cancelled, r.rejected, r.expired, r.pending, r.people, r.bookedHours, r.openHours, r.utilisation ?? ""]));
}

// ---------------------------------------------------------------------------
// RPT-05 Keys issued, outstanding, overdue, lost, damaged
// ---------------------------------------------------------------------------

export type KeyFilter = { siteId?: string | null; buildingId?: string | null; status?: KeyStatus | null; range: Range };
export type OutstandingKey = { keyId: string; code: string; label: string | null; site: string; location: string; holder: string; issuedAt: Date; expectedReturnAt: Date | null; overdue: boolean };
export type KeyReport = {
  register: Array<{ site: string; total: number; available: number; issued: number; overdue: number; lost: number; damaged: number; underRepair: number; retired: number }>;
  transactions: Record<string, number>;
  outstanding: OutstandingKey[];
};

export async function keyReport(scope: Scope, f: KeyFilter, now: Date = new Date()): Promise<KeyReport> {
  const { start, end } = await rangeBounds(f.range, f.siteId ?? null);
  const keys = await prisma.key.findMany({
    where: { ...siteFilter(scope, f.siteId ?? null), ...(f.buildingId ? { room: { buildingId: f.buildingId } } : {}), ...(f.status ? { status: f.status } : {}) },
    include: { site: { select: { name: true } }, room: { include: { building: { select: { name: true } } } }, facility: { select: { name: true } }, transactions: { where: { OR: [{ type: "ISSUE", returnedAt: null }, { createdAt: { gte: start, lt: end } }] }, include: { holder: { select: { firstName: true, lastName: true, employeeId: true } } }, orderBy: { createdAt: "desc" } } },
    orderBy: [{ site: { name: "asc" } }, { code: "asc" }],
  });
  const register = new Map<string, KeyReport["register"][number]>();
  const outstanding: OutstandingKey[] = [];
  const transactions: Record<string, number> = {};
  for (const k of keys) {
    const r = register.get(k.site.name) ?? { site: k.site.name, total: 0, available: 0, issued: 0, overdue: 0, lost: 0, damaged: 0, underRepair: 0, retired: 0 };
    r.total++;
    if (k.status === "AVAILABLE") r.available++;
    if (k.status === "ISSUED") r.issued++;
    if (k.status === "LOST") r.lost++;
    if (k.status === "DAMAGED") r.damaged++;
    if (k.status === "UNDER_REPAIR") r.underRepair++;
    if (k.status === "RETIRED") r.retired++;
    const open = k.transactions.find((t) => t.type === "ISSUE" && t.returnedAt === null);
    if (open && k.status !== "RETIRED") {
      const overdue = !!open.expectedReturnAt && open.expectedReturnAt < now;
      if (overdue) r.overdue++;
      outstanding.push({ keyId: k.id, code: k.code, label: k.label, site: k.site.name, location: k.room ? `${k.room.building.name} room ${k.room.code}` : (k.facility?.name ?? "site"), holder: open.holder ? person(scope, open.holder) : (open.holderName ?? "Unknown"), issuedAt: open.createdAt, expectedReturnAt: open.expectedReturnAt, overdue });
    }
    for (const t of k.transactions) if (t.createdAt >= start && t.createdAt < end) transactions[t.type] = (transactions[t.type] ?? 0) + 1;
    register.set(k.site.name, r);
  }
  outstanding.sort((a, b) => Number(b.overdue) - Number(a.overdue) || a.issuedAt.getTime() - b.issuedAt.getTime());
  return { register: [...register.values()], transactions, outstanding };
}

export async function keyCsv(scope: Scope, f: KeyFilter, actorId: string): Promise<string> {
  const r = await keyReport(scope, f);
  await recordAudit({ actorId, action: "REPORT_EXPORTED", entityType: "Report", entityId: "keys", after: { ...f, rows: r.outstanding.length, masked: !scope.canSeeNames } });
  return toCsv(["Key", "Label", "Site", "Opens", "Holder", "Issued (UTC)", "Expected return", "Overdue"], r.outstanding.map((x) => [x.code, x.label ?? "", x.site, x.location, x.holder, x.issuedAt.toISOString(), x.expectedReturnAt?.toISOString().slice(0, 10) ?? "", x.overdue ? "yes" : ""]));
}

/** Filter options shared by the report pages. */
export async function filterOptions(scope: Scope) {
  const sites = await prisma.site.findMany({ where: { status: "ACTIVE", ...(scope.siteIds ? { id: { in: scope.siteIds } } : {}) }, include: { buildings: { where: { status: "ACTIVE" }, orderBy: { code: "asc" }, select: { id: true, name: true } } }, orderBy: { name: "asc" } });
  const [categories, facilities] = await Promise.all([
    prisma.workOrder.findMany({ where: siteFilter(scope, null), select: { category: true }, distinct: ["category"], orderBy: { category: "asc" } }),
    prisma.facility.findMany({ where: siteFilter(scope, null), select: { id: true, name: true, siteId: true }, orderBy: { name: "asc" } }),
  ]);
  return { sites: sites.map((s) => ({ id: s.id, name: s.name, buildings: s.buildings })), categories: categories.map((c) => c.category), facilities };
}
