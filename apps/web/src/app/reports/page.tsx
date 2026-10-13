import { Suspense } from "react";
import Link from "next/link";
import { requireRole, userAccess, userCan } from "@/lib/auth/authorize";
import { REPORTS } from "@sam/core/modules/reports/layers";
import { REPORT_VIEW_ROLES } from "@sam/core/modules/reports/access";
import { getDashboard } from "@sam/core/modules/reports/service";
import { defaultRange, facilityReport, keyReport, maintenanceReport, movementReport, scopeFor } from "@sam/core/modules/reports/suite";
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
  const l2 = userAccess(user, "rep.l2") ? REPORTS.filter((r) => r.layer === "L2") : [];
  const l3 = userAccess(user, "rep.l3") ? REPORTS.filter((r) => r.layer === "L3") : [];
  const links: Array<[string, string]> = [["/dashboard", "L1 Executive 360 and KPIs"], ...(userAccess(user, "rep.l4") ? ([["/reports/exceptions", "L4 Audit & exception reports"], ["/admin/audit", "Full audit log"]] as Array<[string, string]>) : []), ...(userCan(user, "rep.schedule") ? ([["/reports/scheduled", "Scheduled reports & alerts"]] as Array<[string, string]>) : []), ["/reports/dictionary", "KPI dictionary and targets"]];
  return (
    <>
    <div className="grid gap-4 sm:grid-cols-2">
      {cards.map(([title, href, blurb, stats]) => (
        <Link key={href} href={href} data-report-card={title} className="card p-4 hover:bg-zinc-50">
          <div className="font-medium">{title}</div>
          <div className="mt-0.5 text-xs text-zinc-500">{blurb}</div>
          <dl className="mt-3 grid grid-cols-3 gap-2">{stats.map(([l, v]) => <div key={l}><dt className="text-xs text-zinc-500">{l}</dt><dd className="text-lg font-semibold tabular-nums">{v}</dd></div>)}</dl>
        </Link>
      ))}
    </div>
    {[["L2 Operational reports", l2], ["L3 Desk / shift reports", l3]].map(([title, list]) => (list as typeof l2).length > 0 && (
      <section key={title as string} className="mt-6"><h2 className="section-title">{title as string}</h2>
        <ul className="mt-2 grid gap-2 sm:grid-cols-2">{(list as typeof l2).map((r) => <li key={r.slug}><Link href={`/reports/${r.slug}`} className="card block p-3 hover:bg-zinc-50"><b className="text-sm">{r.title}</b><span className="block text-xs text-zinc-500">{r.module} · {r.description}</span></Link></li>)}</ul></section>
    ))}
    <section className="mt-6"><h2 className="section-title">Also</h2><ul className="mt-2 flex flex-wrap gap-2">{links.map(([href, label]) => <li key={href}><Link href={href} className="pill">{label}</Link></li>)}</ul></section>
    </>
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
