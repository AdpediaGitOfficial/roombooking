import { Suspense } from "react";
import Link from "next/link";
import type { WorkOrderStatus } from "@prisma/client";
import { requireRole, userCan } from "@/lib/auth/authorize";
import { REPORT_VIEW_ROLES } from "@sam/core/modules/reports/access";
import { DEFINITIONS, filterOptions, maintenanceReport, parseRange, scopeFor } from "@sam/core/modules/reports/suite";
import { Definitions, ReportFilters, Stat, qs, table, tbody, td, th, thead, wrap } from "@/modules/reports/components/report-filters";
import { PageHeader } from "@/components/shell/page-header";

type Search = Promise<Record<string, string | undefined>>;
const STATUSES: WorkOrderStatus[] = ["NEW", "TRIAGED", "ASSIGNED", "IN_PROGRESS", "WAITING_STAFF", "WAITING_PARTS", "WAITING_ACCESS", "REOPENED", "RESOLVED", "CLOSED", "CANCELLED"];
const low = (s: string) => s.toLowerCase().replaceAll("_", " ");

async function Content({ searchParams }: { searchParams: Search }) {
  const user = await requireRole(REPORT_VIEW_ROLES, "/reports/maintenance");
  const scope = await scopeFor(user);
  const sp = await searchParams;
  const range = parseRange(sp.from, sp.to);
  const status = STATUSES.includes(sp.status as WorkOrderStatus) ? (sp.status as WorkOrderStatus) : null;
  const f = { siteId: sp.siteId || null, buildingId: sp.buildingId || null, category: sp.category || null, status, range };
  const [r, options] = await Promise.all([maintenanceReport(scope, f), filterOptions(scope)]);
  const query = qs({ from: range.from, to: range.to, siteId: f.siteId, buildingId: f.buildingId, category: f.category, status });
  const open = r.backlogByStatus.reduce((s, x) => s + x.count, 0);
  return (
    <>
      <ReportFilters action="/reports/maintenance" range={range} sites={options.sites} values={f} csvHref={userCan(user, "rep.export") ? `/api/reports/maintenance.csv?${query}` : null} statuses={STATUSES.map((s) => [s, low(s)])} categories={options.categories} />
      <dl className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-5">
        <Stat label="Open now" value={open} /><Stat label="Overdue" value={r.overdue} note="past SLA" /><Stat label="Resolved in range" value={r.resolution.resolved} /><Stat label="Median hours" value={r.resolution.medianHours ?? "—"} note={r.resolution.meanHours != null ? `mean ${r.resolution.meanHours}` : undefined} /><Stat label="SLA met" value={r.resolution.slaMetPercent != null ? `${r.resolution.slaMetPercent}%` : "—"} note={`${r.resolution.slaMet} of ${r.resolution.resolved}`} />
      </dl>
      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <section>
          <h2 className="font-medium">Backlog by status</h2>
          <div className={wrap}><table className={table}><thead className={thead}><tr><th className={th}>Status</th><th className={`${th} text-right`}>Open</th></tr></thead><tbody className={tbody}>
            {r.backlogByStatus.map((x) => <tr key={x.status} data-backlog={x.status}><td className={td}>{low(x.status)}</td><td className={`${td} text-right tabular-nums`}>{x.count}</td></tr>)}
            {r.backlogByStatus.length === 0 && <tr><td colSpan={2} className="px-3 py-4 text-center text-zinc-500">No open tickets.</td></tr>}
          </tbody></table></div>
        </section>
        <section>
          <h2 className="font-medium">Backlog by priority</h2>
          <div className={wrap}><table className={table}><thead className={thead}><tr><th className={th}>Priority</th><th className={`${th} text-right`}>Open</th><th className={`${th} text-right`}>Overdue</th></tr></thead><tbody className={tbody}>
            {r.backlogByPriority.map((x) => <tr key={x.priority}><td className={td}>{low(x.priority)}</td><td className={`${td} text-right tabular-nums`}>{x.count}</td><td className={`${td} text-right tabular-nums ${x.overdue ? "text-red-700" : ""}`}>{x.overdue}</td></tr>)}
          </tbody></table></div>
        </section>
        <section>
          <h2 className="font-medium">Workload</h2>
          <div className={wrap}><table className={table}><thead className={thead}><tr><th className={th}>Who</th><th className={`${th} text-right`}>Open</th><th className={`${th} text-right`}>Overdue</th><th className={`${th} text-right`}>Resolved</th></tr></thead><tbody className={tbody}>
            {r.workload.map((x) => <tr key={`${x.kind}:${x.who}`} data-workload={x.who}><td className={td}>{x.who}<span className="ml-1 text-xs text-zinc-500">{x.kind}</span></td><td className={`${td} text-right tabular-nums`}>{x.open}</td><td className={`${td} text-right tabular-nums`}>{x.overdue}</td><td className={`${td} text-right tabular-nums`}>{x.resolvedInRange}</td></tr>)}
            {r.workload.length === 0 && <tr><td colSpan={4} className="px-3 py-4 text-center text-zinc-500">Nothing assigned.</td></tr>}
          </tbody></table></div>
        </section>
      </div>
      <section className="mt-4">
        <h2 className="font-medium">Categories</h2>
        <div className={wrap}><table className={table}><thead className={thead}><tr><th className={th}>Category</th><th className={`${th} text-right`}>Created in range</th><th className={`${th} text-right`}>Open now</th></tr></thead><tbody className={tbody}>
          {r.categories.map((x) => <tr key={x.category}><td className={td}>{x.category}</td><td className={`${td} text-right tabular-nums`}>{x.created}</td><td className={`${td} text-right tabular-nums`}>{x.open}</td></tr>)}
        </tbody></table></div>
      </section>
      <section className="mt-4">
        <h2 className="font-medium">Tickets</h2>
        <div className={wrap}>
          <table className={table}>
            <thead className={thead}><tr><th className={th}>Ticket</th><th className={th}>Created</th><th className={th}>Status</th><th className={th}>Priority</th><th className={th}>Category</th><th className={th}>Where</th><th className={th}>Assigned</th><th className={`${th} text-right`}>Hours</th><th className={th}>SLA</th></tr></thead>
            <tbody className={tbody}>
              {r.rows.map((x) => (
                <tr key={x.id} data-ticket={x.ticketNumber}>
                  <td className={td}><Link href={`/maintenance/${x.id}`} className="underline">{x.ticketNumber}</Link></td>
                  <td className={`${td} text-xs tabular-nums`}>{x.createdAt.toISOString().slice(0, 16).replace("T", " ")}</td>
                  <td className={td}>{low(x.status)}{x.overdue && <span className="ml-1 text-xs font-medium text-red-700">overdue</span>}</td>
                  <td className={td}>{low(x.priority)}</td><td className={td}>{x.category}</td><td className={td}>{x.site}{x.building ? ` · ${x.building}` : ""}</td>
                  <td className={td}>{x.assignee ?? x.vendor ?? "—"}</td>
                  <td className={`${td} text-right tabular-nums`}>{x.hours ?? ""}</td>
                  <td className={td}>{x.slaMet === null ? "" : x.slaMet ? "met" : <span className="text-red-700">missed</span>}</td>
                </tr>
              ))}
              {r.rows.length === 0 && <tr><td colSpan={9} className="px-3 py-6 text-center text-zinc-500">No tickets match.</td></tr>}
            </tbody>
          </table>
        </div>
      </section>
      <Definitions lines={DEFINITIONS.maintenance} masked={!scope.canSeeNames} />
    </>
  );
}

export default function MaintenanceReportPage({ searchParams }: PageProps<"/reports/maintenance">) {
  return (
    <main>
      <PageHeader title="Maintenance" subtitle="Backlog, overdue work, resolution times and team and vendor workload." />
      <Suspense fallback={<p className="text-sm text-zinc-500">Loading…</p>}><Content searchParams={searchParams as Search} /></Suspense>
    </main>
  );
}
