import { Suspense } from "react";
import Link from "next/link";
import { requireRole } from "@/lib/auth/authorize";
import { REPORT_VIEW_ROLES } from "@/modules/reports/access";
import { getDashboard } from "@/modules/reports/service";
import { defaultRange, facilityReport, keyReport, maintenanceReport, movementReport, scopeFor } from "@/modules/reports/suite";
import { PageHeader } from "@/components/shell/page-header";

async function Overview() {
  const user = await requireRole(REPORT_VIEW_ROLES, "/reports");
  const scope = await scopeFor(user);
  const range = defaultRange();
  const siteId = scope.siteIds?.length === 1 ? scope.siteIds[0] : null;
  const [dash, moves, maint, fac, keys] = await Promise.all([getDashboard(siteId), movementReport(scope, { siteId, range }), maintenanceReport(scope, { siteId, range }), facilityReport(scope, { siteId, range }), keyReport(scope, { siteId, range })]);
  const util = fac.filter((f) => f.utilisation !== null);
  const cards: Array<[string, string, string, Array<[string, string | number]>]> = [
    ["Occupancy", "/dashboard", "Beds, arrivals, departures and pending actions today.", [["Occupancy", `${dash.occupancyRate}%`], ["Occupied", dash.summary.occupied], ["Vacant", dash.summary.vacant]]],
    ["Movements", "/reports/movements", "Allocation history with arrivals, departures and transfers.", [["Arrivals (30 d)", moves.summary.arrivals], ["Departures (30 d)", moves.summary.departures], ["Transfers (30 d)", moves.summary.transfers]]],
    ["Maintenance", "/reports/maintenance", "Backlog, overdue work, resolution times and workload.", [["Open", maint.backlogByStatus.reduce((s, r) => s + r.count, 0)], ["Overdue", maint.overdue], ["Median hours (30 d)", maint.resolution.medianHours ?? "—"]]],
    ["Facilities", "/reports/facilities", "Bookings, attendance, no-shows and utilisation.", [["Bookings (30 d)", fac.reduce((s, f) => s + f.bookings, 0)], ["No-shows", fac.reduce((s, f) => s + f.noShows, 0)], ["Utilisation", util.length ? `${Math.round(util.reduce((s, f) => s + (f.utilisation ?? 0), 0) / util.length)}%` : "—"]]],
    ["Keys", "/reports/keys", "Issued, outstanding, overdue, lost and damaged keys.", [["Outstanding", keys.outstanding.length], ["Overdue", keys.outstanding.filter((k) => k.overdue).length], ["Lost", keys.register.reduce((s, r) => s + r.lost, 0)]]],
  ];
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      {cards.map(([title, href, blurb, stats]) => (
        <Link key={href} href={href} data-report-card={title} className="card p-4 hover:bg-zinc-50">
          <div className="font-medium">{title}</div>
          <div className="mt-0.5 text-xs text-zinc-500">{blurb}</div>
          <dl className="mt-3 grid grid-cols-3 gap-2">{stats.map(([l, v]) => <div key={l}><dt className="text-xs text-zinc-500">{l}</dt><dd className="text-lg font-semibold tabular-nums">{v}</dd></div>)}</dl>
        </Link>
      ))}
    </div>
  );
}

export default function ReportsPage() {
  return (
    <main>
      <PageHeader title="Reports" subtitle="Last 30 days across the sites you can see. Each report has date, site, building, status and category filters and a CSV export." crumbs={[["Reports"]]} />
      <Suspense fallback={<p className="text-sm text-zinc-500">Loading…</p>}>
        <Overview />
      </Suspense>
    </main>
  );
}
