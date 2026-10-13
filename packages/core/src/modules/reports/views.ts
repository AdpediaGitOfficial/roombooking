// Everything a report page needs in one call: the report for the caller's scope, plus the filter options.
import type { AllocationStatus, KeyStatus, WorkOrderStatus } from "@prisma/client";
import { getDashboard, getOccupancyTrend } from "./service";
import { defaultRange, facilityReport, filterOptions, keyReport, maintenanceReport, movementReport, parseRange, scopeFor } from "./suite";

type Holder = Parameters<typeof scopeFor>[0];
type Dates = { from?: string | null; to?: string | null };

/** The occupancy dashboard for a site (or all sites) with its 30-day trend. */
export async function dashboardView(siteId: string | null) {
  const [d, trend] = await Promise.all([getDashboard(siteId), getOccupancyTrend(siteId, 30)]);
  return { d, trend };
}

/** The reports landing page: headline numbers from each report over the default range. */
export async function overviewView(user: Holder) {
  const scope = await scopeFor(user);
  const range = defaultRange();
  const siteId = scope.siteIds?.length === 1 ? scope.siteIds[0] : null;
  const [dash, moves, maint, fac, keys] = await Promise.all([
    getDashboard(siteId),
    movementReport(scope, { siteId, range }),
    maintenanceReport(scope, { siteId, range }),
    facilityReport(scope, { siteId, range }),
    keyReport(scope, { siteId, range }),
  ]);
  // The landing page shows headline numbers only, so send those rather than every report row.
  return {
    dash: { occupancyRate: dash.occupancyRate, summary: dash.summary },
    moves: { summary: moves.summary },
    maint: { backlogByStatus: maint.backlogByStatus, overdue: maint.overdue, resolution: { medianHours: maint.resolution.medianHours } },
    fac,
    keys: { outstanding: keys.outstanding.map((k) => ({ overdue: k.overdue })), register: keys.register.map((r) => ({ lost: r.lost })) },
  };
}

export async function movementsView(user: Holder, f: Dates & { siteId?: string | null; buildingId?: string | null; status?: AllocationStatus | null; q?: string | null }) {
  const scope = await scopeFor(user);
  const range = parseRange(f.from, f.to);
  const [report, options] = await Promise.all([movementReport(scope, { siteId: f.siteId ?? null, buildingId: f.buildingId ?? null, status: f.status ?? null, q: f.q ?? null, range }), filterOptions(scope)]);
  return { report, options, range, canSeeNames: scope.canSeeNames };
}

export async function maintenanceView(user: Holder, f: Dates & { siteId?: string | null; buildingId?: string | null; category?: string | null; status?: WorkOrderStatus | null }) {
  const scope = await scopeFor(user);
  const range = parseRange(f.from, f.to);
  const [report, options] = await Promise.all([maintenanceReport(scope, { siteId: f.siteId ?? null, buildingId: f.buildingId ?? null, category: f.category ?? null, status: f.status ?? null, range }), filterOptions(scope)]);
  return { report, options, range, canSeeNames: scope.canSeeNames };
}

export async function facilitiesView(user: Holder, f: Dates & { siteId?: string | null; facilityId?: string | null }) {
  const scope = await scopeFor(user);
  const range = parseRange(f.from, f.to);
  const [report, options] = await Promise.all([facilityReport(scope, { siteId: f.siteId ?? null, facilityId: f.facilityId ?? null, range }), filterOptions(scope)]);
  return { report, options, range, canSeeNames: scope.canSeeNames };
}

export async function keysView(user: Holder, f: Dates & { siteId?: string | null; buildingId?: string | null; status?: KeyStatus | null }) {
  const scope = await scopeFor(user);
  const range = parseRange(f.from, f.to);
  const [report, options] = await Promise.all([keyReport(scope, { siteId: f.siteId ?? null, buildingId: f.buildingId ?? null, status: f.status ?? null, range }), filterOptions(scope)]);
  return { report, options, range, canSeeNames: scope.canSeeNames };
}
