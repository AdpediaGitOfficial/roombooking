// KPI dictionary and L1 Executive 360 figures (document section 11). Every KPI has one definition (name, formula,
// source, owner) that the UI shows as a tooltip, and every figure is shown against the last period and its target.
import type { Prisma } from "@prisma/client";
import { prisma } from "../../lib/db";
import { recordAudit } from "../../lib/audit";
import { actorCan, type ActorLike } from "../../lib/permissions/actor";

export class KpiError extends Error {
  constructor(public readonly code: "NOT_FOUND" | "FORBIDDEN" | "VALIDATION", message: string) {
    super(message);
    this.name = "KpiError";
  }
}

export type KpiScope = { siteIds: string[] | null };
export type KpiPeriod = { from: Date; to: Date };
type Compute = (s: KpiScope, p: KpiPeriod) => Promise<number | null>;
export type KpiDef = { key: string; group: string; name: string; formula: string; source: string; owner: string; unit: "count" | "percent" | "hours" | "days" | "minutes" | "currency"; higherIsBetter: boolean; point?: boolean; compute: Compute; href?: string };

const DAY = 86400000;
const siteIn = (s: KpiScope) => (s.siteIds ? { siteId: { in: s.siteIds } } : {});
const bedIn = (s: KpiScope): Prisma.BedWhereInput => (s.siteIds ? { room: { building: { siteId: { in: s.siteIds } } } } : {});
const allocIn = (s: KpiScope): Prisma.AllocationWhereInput => (s.siteIds ? { bed: { room: { building: { siteId: { in: s.siteIds } } } } } : {});
const pct = (n: number, d: number) => (d > 0 ? Math.round((n / d) * 1000) / 10 : null);
const avg = (xs: number[]) => (xs.length ? Math.round((xs.reduce((a, b) => a + b, 0) / xs.length) * 10) / 10 : null);
const inRange = (p: KpiPeriod) => ({ gte: p.from, lt: p.to });

const capacity = (s: KpiScope) => prisma.bed.count({ where: { ...bedIn(s), archivedAt: null, status: "ACTIVE", room: { archivedAt: null, status: "ACTIVE", ...(s.siteIds ? { building: { siteId: { in: s.siteIds }, status: "ACTIVE" } } : { building: { status: "ACTIVE" } }) } } });
const occupiedAt = (s: KpiScope, d: Date) => prisma.allocation.count({ where: { ...allocIn(s), checkedInAt: { lte: d }, OR: [{ checkedOutAt: null }, { checkedOutAt: { gt: d } }] } });

export const KPI_CATALOG: KpiDef[] = [
  { key: "occupancy_pct", group: "Occupancy", name: "Occupancy %", formula: "Occupied beds ÷ available beds (active beds in active rooms and buildings) × 100, at the end of the period", source: "Allocations, beds", owner: "Accommodation Admin", unit: "percent", higherIsBetter: true, point: true, href: "/accommodation", compute: async (s, p) => pct(await occupiedAt(s, p.to), await capacity(s)) },
  { key: "beds_available", group: "Occupancy", name: "Beds available", formula: "Active beds in active rooms minus beds occupied at the end of the period", source: "Beds, allocations", owner: "Accommodation Admin", unit: "count", higherIsBetter: true, point: true, href: "/accommodation", compute: async (s, p) => Math.max(0, (await capacity(s)) - (await occupiedAt(s, p.to))) },
  { key: "beds_blocked", group: "Occupancy", name: "Beds blocked or under maintenance", formula: "Beds with status Blocked or Under maintenance, plus beds in blocked rooms", source: "Beds", owner: "Accommodation Admin", unit: "count", higherIsBetter: false, point: true, compute: async (s) => prisma.bed.count({ where: { ...bedIn(s), archivedAt: null, OR: [{ status: { in: ["BLOCKED", "MAINTENANCE"] } }, { room: { status: { in: ["BLOCKED", "MAINTENANCE"] } } }] } }) },
  { key: "arrivals", group: "People flow", name: "Arrivals", formula: "Check-ins recorded in the period", source: "Allocations", owner: "Front desk", unit: "count", higherIsBetter: true, href: "/reports/movements", compute: (s, p) => prisma.allocation.count({ where: { ...allocIn(s), checkedInAt: inRange(p) } }) },
  { key: "departures", group: "People flow", name: "Departures", formula: "Check-outs recorded in the period", source: "Allocations", owner: "Front desk", unit: "count", higherIsBetter: true, href: "/reports/movements", compute: (s, p) => prisma.allocation.count({ where: { ...allocIn(s), checkedOutAt: inRange(p) } }) },
  { key: "transfers", group: "People flow", name: "Transfers", formula: "Allocations created in the period that replace an earlier one", source: "Allocations", owner: "Accommodation Admin", unit: "count", higherIsBetter: false, compute: (s, p) => prisma.allocation.count({ where: { ...allocIn(s), previousAllocationId: { not: null }, createdAt: inRange(p) } }) },
  { key: "joiners_waiting", group: "People flow", name: "Joiners waiting for a bed", formula: "Joiners expected and not yet allocated", source: "Joiners", owner: "Accommodation Admin", unit: "count", higherIsBetter: false, point: true, href: "/people/joiners", compute: () => prisma.joiner.count({ where: { status: "EXPECTED" } }) },
  { key: "waitlist", group: "People flow", name: "Waitlist", formula: "People waiting or offered a bed", source: "Waitlist", owner: "Accommodation Admin", unit: "count", higherIsBetter: false, point: true, href: "/accommodation/waitlist", compute: (s) => prisma.waitlistEntry.count({ where: { status: { in: ["WAITING", "OFFERED"] }, ...(s.siteIds ? { OR: [{ siteId: null }, { siteId: { in: s.siteIds } }] } : {}) } }) },
  { key: "overstays", group: "Stay health", name: "Overstays", formula: "Residents still checked in after their end date", source: "Allocations", owner: "Accommodation Admin", unit: "count", higherIsBetter: false, point: true, href: "/accommodation/allocations?filter=active", compute: (s, p) => prisma.allocation.count({ where: { ...allocIn(s), checkedInAt: { lte: p.to }, OR: [{ checkedOutAt: null }, { checkedOutAt: { gt: p.to } }], endDate: { lt: p.to } } }) },
  { key: "pending_checkouts", group: "Stay health", name: "Checkouts due", formula: "Exit cases with checkout due", source: "Exits", owner: "Front desk", unit: "count", higherIsBetter: false, point: true, href: "/people/exits", compute: () => prisma.exitCase.count({ where: { status: "CHECKOUT_DUE" } }) },
  { key: "pending_clearances", group: "Stay health", name: "Clearances pending", formula: "Exit cases open or clearing", source: "Exits", owner: "Accommodation Admin", unit: "count", higherIsBetter: false, point: true, href: "/people/exits", compute: () => prisma.exitCase.count({ where: { status: { in: ["OPEN", "CLEARING", "CHECKOUT_DUE"] } } }) },
  { key: "approvals_pending", group: "Approvals", name: "Approvals pending", formula: "Requests waiting on an approver", source: "Requests", owner: "Accommodation Admin", unit: "count", higherIsBetter: false, point: true, href: "/approvals", compute: () => prisma.request.count({ where: { status: { in: ["PENDING_APPROVAL", "SUBMITTED", "RESUBMITTED"] } } }) },
  { key: "approval_hours", group: "Approvals", name: "Average approval time (hours)", formula: "Mean hours from submission to decision, for requests decided in the period", source: "Requests", owner: "Accommodation Admin", unit: "hours", higherIsBetter: false, compute: async (_s, p) => avg((await prisma.request.findMany({ where: { decidedAt: inRange(p) }, select: { createdAt: true, decidedAt: true }, take: 5000 })).map((r) => (r.decidedAt!.getTime() - r.createdAt.getTime()) / 3600000)) },
  { key: "approvals_overdue", group: "Approvals", name: "Approvals overdue", formula: "Pending requests whose current step has waited more than 48 hours", source: "Requests", owner: "Accommodation Admin", unit: "count", higherIsBetter: false, point: true, compute: (_s, p) => prisma.request.count({ where: { status: "PENDING_APPROVAL", stepStartedAt: { lt: new Date(p.to.getTime() - 2 * DAY) } } }) },
  { key: "rejection_rate", group: "Approvals", name: "Rejection rate %", formula: "Rejected ÷ (approved + rejected) decided in the period × 100", source: "Requests", owner: "Accommodation Admin", unit: "percent", higherIsBetter: false, compute: async (_s, p) => { const [r, a] = await Promise.all([prisma.request.count({ where: { status: "REJECTED", decidedAt: inRange(p) } }), prisma.request.count({ where: { status: { in: ["APPROVED", "FULFILLED", "CLOSED"] }, decidedAt: inRange(p) } })]); return pct(r, r + a); } },
  { key: "wo_open", group: "Maintenance", name: "Open work orders", formula: "Work orders not resolved, verified, closed or cancelled at the end of the period", source: "Work orders", owner: "Maintenance Coordinator", unit: "count", higherIsBetter: false, point: true, href: "/maintenance", compute: (s, p) => prisma.workOrder.count({ where: { ...siteIn(s), createdAt: { lt: p.to }, OR: [{ closedAt: null, resolvedAt: null }, { resolvedAt: { gte: p.to } }, { closedAt: { gte: p.to } }], status: { notIn: ["CANCELLED"] } } }) },
  { key: "wo_sla_pct", group: "Maintenance", name: "Work orders resolved within SLA %", formula: "Work orders resolved in the period on or before their SLA target ÷ all resolved × 100", source: "Work orders", owner: "Maintenance Coordinator", unit: "percent", higherIsBetter: true, href: "/reports/maintenance", compute: async (s, p) => { const rows = await prisma.workOrder.findMany({ where: { ...siteIn(s), resolvedAt: inRange(p), slaDueAt: { not: null } }, select: { resolvedAt: true, slaDueAt: true }, take: 5000 }); return pct(rows.filter((r) => r.resolvedAt! <= r.slaDueAt!).length, rows.length); } },
  { key: "wo_backlog_days", group: "Maintenance", name: "Backlog ageing (days)", formula: "Mean age of work orders still open at the end of the period", source: "Work orders", owner: "Maintenance Coordinator", unit: "days", higherIsBetter: false, point: true, compute: async (s, p) => avg((await prisma.workOrder.findMany({ where: { ...siteIn(s), createdAt: { lt: p.to }, resolvedAt: null, closedAt: null, status: { notIn: ["CANCELLED", "CLOSED"] } }, select: { createdAt: true }, take: 5000 })).map((r) => (p.to.getTime() - r.createdAt.getTime()) / DAY)) },
  { key: "wo_repeat", group: "Maintenance", name: "Repeat issues", formula: "Work orders created in the period that were reopened at least once", source: "Work orders", owner: "Maintenance Coordinator", unit: "count", higherIsBetter: false, compute: (s, p) => prisma.workOrder.count({ where: { ...siteIn(s), createdAt: inRange(p), reopenCount: { gt: 0 } } }) },
  { key: "wo_cost", group: "Maintenance", name: "Maintenance cost", formula: "Sum of actual cost on work orders resolved in the period (estimate where actual is missing)", source: "Work orders", owner: "Maintenance Coordinator", unit: "currency", higherIsBetter: false, compute: async (s, p) => { const r = await prisma.workOrder.findMany({ where: { ...siteIn(s), resolvedAt: inRange(p) }, select: { costActual: true, costEstimate: true }, take: 5000 }); return Math.round(r.reduce((t, w) => t + Number(w.costActual ?? w.costEstimate ?? 0), 0) * 100) / 100; } },
  { key: "fac_noshow_rate", group: "Facilities", name: "Facility no-show rate %", formula: "No-shows ÷ (completed + checked-in + no-show) bookings in the period × 100", source: "Facility bookings", owner: "Facility manager", unit: "percent", higherIsBetter: false, href: "/reports/facilities", compute: async (s, p) => { const where = { startsAt: inRange(p), ...(s.siteIds ? { facility: { siteId: { in: s.siteIds } } } : {}) }; const [n, t] = await Promise.all([prisma.facilityBooking.count({ where: { ...where, status: "NO_SHOW" } }), prisma.facilityBooking.count({ where: { ...where, status: { in: ["COMPLETED", "CHECKED_IN", "NO_SHOW"] } } })]); return pct(n, t); } },
  { key: "fac_bookings", group: "Facilities", name: "Facility bookings", formula: "Confirmed, attended and completed bookings starting in the period", source: "Facility bookings", owner: "Facility manager", unit: "count", higherIsBetter: true, href: "/reports/facilities", compute: (s, p) => prisma.facilityBooking.count({ where: { startsAt: inRange(p), status: { in: ["CONFIRMED", "CHECKED_IN", "COMPLETED"] }, ...(s.siteIds ? { facility: { siteId: { in: s.siteIds } } } : {}) } }) },
  { key: "keys_overdue", group: "Keys & inventory", name: "Keys overdue", formula: "Keys issued whose expected return date has passed", source: "Key transactions", owner: "Key supervisor", unit: "count", higherIsBetter: false, point: true, href: "/keys?filter=overdue", compute: (s, p) => prisma.keyTransaction.count({ where: { type: "ISSUE", returnedAt: null, expectedReturnAt: { lt: p.to }, ...(s.siteIds ? { key: { siteId: { in: s.siteIds } } } : {}) } }) },
  { key: "keys_lost", group: "Keys & inventory", name: "Keys lost", formula: "Keys recorded lost in the period", source: "Key transactions", owner: "Key supervisor", unit: "count", higherIsBetter: false, compute: (s, p) => prisma.keyTransaction.count({ where: { type: "LOST", createdAt: inRange(p), ...(s.siteIds ? { key: { siteId: { in: s.siteIds } } } : {}) } }) },
  { key: "low_stock", group: "Keys & inventory", name: "Low-stock lines", formula: "Active stock lines at or below their reorder threshold", source: "Inventory", owner: "Inventory supervisor", unit: "count", higherIsBetter: false, point: true, href: "/inventory?filter=low", compute: async (s) => { const rows = await prisma.inventoryItem.findMany({ where: { ...siteIn(s), status: "ACTIVE", trackingType: "STOCK", reorderThreshold: { not: null } }, select: { quantity: true, reorderThreshold: true } }); return rows.filter((r) => r.quantity <= (r.reorderThreshold ?? 0)).length; } },
  { key: "writeoff_value", group: "Keys & inventory", name: "Write-off value", formula: "Value of write-offs approved in the period", source: "Inventory write-offs", owner: "Accommodation Admin", unit: "currency", higherIsBetter: false, href: "/inventory/writeoffs", compute: async (_s, p) => Number((await prisma.inventoryWriteOff.aggregate({ where: { status: "APPROVED", decidedAt: inRange(p) }, _sum: { value: true } }))._sum.value ?? 0) },
  { key: "vendor_rating", group: "Vendors", name: "Average vendor rating", formula: "Mean rating (1-5) of verified jobs done by vendors in the period", source: "Work orders", owner: "Maintenance Coordinator", unit: "count", higherIsBetter: true, compute: async (s, p) => avg((await prisma.workOrder.findMany({ where: { ...siteIn(s), vendorId: { not: null }, rating: { not: null }, verifiedAt: inRange(p) }, select: { rating: true }, take: 5000 })).map((r) => r.rating!)) },
  { key: "vendors_expiring", group: "Vendors", name: "Vendor contracts / documents expiring in 30 days", formula: "Active vendors whose contract or document expires within 30 days of the period end", source: "Vendors", owner: "Accommodation Admin", unit: "count", higherIsBetter: false, point: true, href: "/maintenance/vendors", compute: async (_s, p) => { const until = new Date(p.to.getTime() + 30 * DAY); const active = (await prisma.vendor.findMany({ where: { archivedAt: null, state: "ACTIVE" }, select: { id: true, contractEnd: true } })); const c = active.filter((v) => v.contractEnd && v.contractEnd <= until).length; const d = await prisma.vendorDocument.count({ where: { vendorId: { in: active.map((v) => v.id) }, expiresAt: { lte: until } } }); return c + d; } },
  { key: "job_rating", group: "Resident experience", name: "Average job rating", formula: "Mean rating (1-5) on all verified jobs in the period", source: "Work orders", owner: "Maintenance Coordinator", unit: "count", higherIsBetter: true, compute: async (s, p) => avg((await prisma.workOrder.findMany({ where: { ...siteIn(s), rating: { not: null }, verifiedAt: inRange(p) }, select: { rating: true }, take: 5000 })).map((r) => r.rating!)) },
  { key: "ack_hours", group: "Resident experience", name: "Average response time (hours)", formula: "Mean hours from a ticket being raised to its first acknowledgement, for tickets raised in the period", source: "Work orders", owner: "Maintenance Coordinator", unit: "hours", higherIsBetter: false, compute: async (s, p) => avg((await prisma.workOrder.findMany({ where: { ...siteIn(s), createdAt: inRange(p), acknowledgedAt: { not: null } }, select: { createdAt: true, acknowledgedAt: true }, take: 5000 })).map((r) => (r.acknowledgedAt!.getTime() - r.createdAt.getTime()) / 3600000)) },
  { key: "open_complaints", group: "Resident experience", name: "Open complaints", formula: "Reopened work orders that are still open", source: "Work orders", owner: "Maintenance Coordinator", unit: "count", higherIsBetter: false, point: true, compute: (s) => prisma.workOrder.count({ where: { ...siteIn(s), reopenCount: { gt: 0 }, status: { notIn: ["CLOSED", "CANCELLED", "VERIFIED"] } } }) },
  { key: "incidents", group: "Safety", name: "Incidents", formula: "Incidents reported in the period", source: "Incidents", owner: "Security", unit: "count", higherIsBetter: false, href: "/security/incidents", compute: (s, p) => prisma.incident.count({ where: { ...siteIn(s), createdAt: inRange(p) } }) },
  { key: "sos_minutes", group: "Safety", name: "SOS response time (minutes)", formula: "Mean minutes from an SOS being raised to being acknowledged, for alerts raised in the period", source: "SOS alerts", owner: "Security", unit: "minutes", higherIsBetter: false, href: "/security/sos", compute: async (s, p) => avg((await prisma.sosAlert.findMany({ where: { ...siteIn(s), createdAt: inRange(p), acknowledgedAt: { not: null } }, select: { createdAt: true, acknowledgedAt: true } })).map((r) => (r.acknowledgedAt!.getTime() - r.createdAt.getTime()) / 60000)) },
  { key: "late_entries", group: "Safety", name: "Late entries", formula: "Visitors checked in after the curfew hour in the period", source: "Audit log", owner: "Security", unit: "count", higherIsBetter: false, compute: (_s, p) => prisma.auditEvent.count({ where: { action: "VISITOR_CHECKED_IN_LATE", createdAt: inRange(p) } }) },
  { key: "overrides", group: "Risk & compliance", name: "Overrides", formula: "Eligibility and clearance overrides recorded in the period", source: "Audit log", owner: "Auditor", unit: "count", higherIsBetter: false, href: "/admin/audit?action=OVERRIDE", compute: (_s, p) => prisma.auditEvent.count({ where: { action: { contains: "OVERRIDE" }, createdAt: inRange(p) } }) },
  { key: "sensitive_key_moves", group: "Risk & compliance", name: "Sensitive key movements", formula: "Issues, returns and losses of sensitive keys in the period", source: "Key transactions", owner: "Key supervisor", unit: "count", higherIsBetter: false, compute: (s, p) => prisma.keyTransaction.count({ where: { createdAt: inRange(p), key: { sensitive: true, ...siteIn(s) } } }) },
  { key: "eligibility_exceptions", group: "Risk & compliance", name: "Eligibility exceptions", formula: "Allocations made with an eligibility override in the period", source: "Audit log", owner: "Accommodation Admin", unit: "count", higherIsBetter: false, compute: (_s, p) => prisma.auditEvent.count({ where: { action: "ELIGIBILITY_OVERRIDE", createdAt: inRange(p) } }) },
  { key: "failed_integrations", group: "Risk & compliance", name: "Failed integration runs", formula: "Integration sync runs that failed in the period", source: "Sync runs", owner: "Super Admin", unit: "count", higherIsBetter: false, compute: (_s, p) => prisma.syncRun.count({ where: { status: "FAILED", startedAt: inRange(p) } }) },
];

export const KPI_BY_KEY = new Map(KPI_CATALOG.map((k) => [k.key, k]));
export const KPI_GROUPS = [...new Set(KPI_CATALOG.map((k) => k.group))];

/** Writes any missing KPI definitions into the dictionary table (the definition shown in tooltips is the stored one, so owners can refine it). */
export async function ensureKpiDictionary(organizationId: string) {
  for (const k of KPI_CATALOG) {
    await prisma.kpiDefinition.upsert({ where: { organizationId_key: { organizationId, key: k.key } }, update: {}, create: { organizationId, key: k.key, name: k.name, formula: k.formula, source: k.source, owner: k.owner, unit: k.unit, higherIsBetter: k.higherIsBetter } });
  }
}

export async function listDictionary(organizationId: string) {
  await ensureKpiDictionary(organizationId);
  const rows = await prisma.kpiDefinition.findMany({ where: { organizationId }, include: { targets: true } });
  const order = new Map(KPI_CATALOG.map((k, i) => [k.key, i]));
  return rows.sort((a, b) => (order.get(a.key) ?? 999) - (order.get(b.key) ?? 999)).map((r) => ({ ...r, group: KPI_BY_KEY.get(r.key)?.group ?? "Other", href: KPI_BY_KEY.get(r.key)?.href ?? null }));
}

export async function updateDefinition(actor: ActorLike, organizationId: string, key: string, input: { name?: string; formula?: string; source?: string; owner?: string }) {
  if (!actorCan(actor, "rep.kpi_targets")) throw new KpiError("FORBIDDEN", "Only an Admin can edit the KPI dictionary.");
  const row = await prisma.kpiDefinition.findUnique({ where: { organizationId_key: { organizationId, key } } });
  if (!row) throw new KpiError("NOT_FOUND", "KPI not found.");
  if (input.formula !== undefined && !input.formula.trim()) throw new KpiError("VALIDATION", "A KPI needs a formula.");
  const updated = await prisma.kpiDefinition.update({ where: { id: row.id }, data: { name: input.name?.trim() || undefined, formula: input.formula?.trim() || undefined, source: input.source?.trim() || undefined, owner: input.owner?.trim() || undefined } });
  await recordAudit({ actorId: actor.id, action: "KPI_DEFINITION_UPDATED", entityType: "KpiDefinition", entityId: row.id, before: { formula: row.formula, owner: row.owner }, after: { formula: updated.formula, owner: updated.owner } });
  return updated;
}

/** Super Admin sets organisation targets (site = null); an Accommodation Admin may set targets for their own sites only. */
export async function setTarget(actor: ActorLike, organizationId: string, key: string, siteId: string | null, target: number | null) {
  if (!actorCan(actor, "rep.kpi_targets", { siteId })) throw new KpiError("FORBIDDEN", "You cannot set targets for that site.");
  if (siteId === null && !actor.roles.includes("SYSTEM_ADMIN")) throw new KpiError("FORBIDDEN", "Organisation-wide targets are set by the Super Admin; set a site target instead.");
  if (!KPI_BY_KEY.has(key)) throw new KpiError("NOT_FOUND", "KPI not found.");
  await ensureKpiDictionary(organizationId);
  const def = await prisma.kpiDefinition.findUniqueOrThrow({ where: { organizationId_key: { organizationId, key } } });
  const existing = await prisma.kpiTarget.findFirst({ where: { kpiId: def.id, siteId } });
  if (target === null || Number.isNaN(target)) {
    if (existing) await prisma.kpiTarget.delete({ where: { id: existing.id } });
  } else if (existing) await prisma.kpiTarget.update({ where: { id: existing.id }, data: { target, setById: actor.id } });
  else await prisma.kpiTarget.create({ data: { kpiId: def.id, siteId, target, setById: actor.id } });
  await recordAudit({ actorId: actor.id, action: "KPI_TARGET_SET", entityType: "KpiDefinition", entityId: def.id, after: { siteId, target } });
}

export type KpiValue = { key: string; group: string; name: string; formula: string; source: string; owner: string; unit: KpiDef["unit"]; value: number | null; previous: number | null; delta: number | null; target: number | null; status: "ok" | "warn" | "bad" | "none"; higherIsBetter: boolean; href?: string };

export function periodOf(days: number, now: Date = new Date()): { current: KpiPeriod; previous: KpiPeriod } {
  const to = new Date(now.getTime() + 1000);
  const from = new Date(to.getTime() - days * DAY);
  return { current: { from, to }, previous: { from: new Date(from.getTime() - days * DAY), to: from } };
}

function status(v: number | null, target: number | null, higher: boolean): KpiValue["status"] {
  if (v === null || target === null) return "none";
  const ok = higher ? v >= target : v <= target;
  if (ok) return "ok";
  const gap = Math.abs(v - target) / (Math.abs(target) || 1);
  return gap <= 0.1 ? "warn" : "bad";
}

/** All (or the named) KPIs for a scope, each with last-period and target comparison. Targets prefer the site target when one site is in scope. */
export async function computeKpis(organizationId: string, scope: KpiScope, opts: { days?: number; keys?: string[]; now?: Date } = {}): Promise<{ asOf: Date; days: number; values: KpiValue[] }> {
  await ensureKpiDictionary(organizationId);
  const days = opts.days ?? 30;
  const now = opts.now ?? new Date();
  const { current, previous } = periodOf(days, now);
  const defs = await prisma.kpiDefinition.findMany({ where: { organizationId }, include: { targets: true } });
  const stored = new Map(defs.map((d) => [d.key, d]));
  const single = scope.siteIds && scope.siteIds.length === 1 ? scope.siteIds[0] : null;
  const list = KPI_CATALOG.filter((k) => !opts.keys || opts.keys.includes(k.key));
  const values = await Promise.all(list.map(async (k): Promise<KpiValue> => {
    const [value, prev] = await Promise.all([k.compute(scope, current), k.compute(scope, previous)]);
    const d = stored.get(k.key);
    const t = d?.targets.find((x) => x.siteId === single) ?? d?.targets.find((x) => x.siteId === null);
    const target = t ? Number(t.target) : null;
    return { key: k.key, group: k.group, name: d?.name ?? k.name, formula: d?.formula ?? k.formula, source: d?.source ?? k.source, owner: d?.owner ?? k.owner, unit: k.unit, value, previous: prev, delta: value !== null && prev !== null ? Math.round((value - prev) * 10) / 10 : null, target, status: status(value, target, k.higherIsBetter), higherIsBetter: k.higherIsBetter, href: k.href };
  }));
  return { asOf: now, days, values };
}

export function formatKpi(v: number | null, unit: KpiDef["unit"]): string {
  if (v === null) return "—";
  switch (unit) {
    case "percent": return `${v}%`;
    case "hours": return `${v} h`;
    case "days": return `${v} d`;
    case "minutes": return `${v} min`;
    case "currency": return v.toLocaleString("en", { minimumFractionDigits: 0, maximumFractionDigits: 2 });
    default: return String(v);
  }
}
