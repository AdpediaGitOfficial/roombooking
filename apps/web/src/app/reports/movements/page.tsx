import { Suspense } from "react";
import Link from "next/link";
import type { AllocationStatus } from "@prisma/client";
import { requireRole, userCan } from "@/lib/auth/authorize";
import { REPORT_VIEW_ROLES } from "@sam/core/modules/reports/access";
import { DEFINITIONS, filterOptions, movementReport, parseRange, scopeFor } from "@sam/core/modules/reports/suite";
import { Definitions, ReportFilters, Stat, qs, table, tbody, td, th, thead, wrap } from "@/modules/reports/components/report-filters";
import { PageHeader } from "@/components/shell/page-header";

type Search = Promise<Record<string, string | undefined>>;
const STATUSES: AllocationStatus[] = ["CONFIRMED", "CHECKED_IN", "CHECKED_OUT", "CANCELLED", "PENDING_APPROVAL", "DRAFT", "REJECTED", "EXPIRED"];

async function Content({ searchParams }: { searchParams: Search }) {
  const user = await requireRole(REPORT_VIEW_ROLES, "/reports/movements");
  const scope = await scopeFor(user);
  const sp = await searchParams;
  const range = parseRange(sp.from, sp.to);
  const status = STATUSES.includes(sp.status as AllocationStatus) ? (sp.status as AllocationStatus) : null;
  const f = { siteId: sp.siteId || null, buildingId: sp.buildingId || null, status, q: sp.q || null, range };
  const [r, options] = await Promise.all([movementReport(scope, f), filterOptions(scope)]);
  const query = qs({ from: range.from, to: range.to, siteId: f.siteId, buildingId: f.buildingId, status, q: f.q });
  return (
    <>
      <ReportFilters action="/reports/movements" range={range} sites={options.sites} values={f} csvHref={userCan(user, "rep.export") ? `/api/reports/movements.csv?${query}` : null} statuses={STATUSES.map((s) => [s, s.toLowerCase().replace("_", " ")])} search="Employee ID or name" />
      <dl className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-5">
        <Stat label="Allocations" value={r.summary.allocations} note="overlapping the range" /><Stat label="Arrivals" value={r.summary.arrivals} /><Stat label="Departures" value={r.summary.departures} /><Stat label="Transfers" value={r.summary.transfers} /><Stat label="Cancelled" value={r.summary.cancelled} />
      </dl>
      <div className={wrap}>
        <table className={table}>
          <thead className={thead}><tr><th className={th}>Person</th><th className={th}>Where</th><th className={th}>Status</th><th className={th}>Start</th><th className={th}>End</th><th className={th}>Checked in</th><th className={th}>Checked out</th><th className={th}>From</th></tr></thead>
          <tbody className={tbody}>
            {r.rows.map((x) => (
              <tr key={x.allocationId} data-row={x.allocationId}>
                <td className={td}><Link href={`/accommodation/allocations/${x.allocationId}`} className="underline">{x.person}</Link></td>
                <td className={td}>{x.site} · {x.building} · {x.room} / {x.bed}</td>
                <td className={td}>{x.status.toLowerCase().replace("_", " ")}</td>
                <td className={`${td} tabular-nums`}>{x.startDate}</td><td className={`${td} tabular-nums`}>{x.endDate ?? "—"}</td>
                <td className={`${td} text-xs tabular-nums`}>{x.checkedInAt?.toISOString().slice(0, 16).replace("T", " ") ?? ""}</td>
                <td className={`${td} text-xs tabular-nums`}>{x.checkedOutAt?.toISOString().slice(0, 16).replace("T", " ") ?? ""}</td>
                <td className={td}>{x.transferredFrom ? `bed ${x.transferredFrom}` : ""}</td>
              </tr>
            ))}
            {r.rows.length === 0 && <tr><td colSpan={8} className="px-3 py-6 text-center text-zinc-500">No allocations match.</td></tr>}
          </tbody>
        </table>
      </div>
      <Definitions lines={DEFINITIONS.movements} masked={!scope.canSeeNames} />
    </>
  );
}

export default function MovementsReportPage({ searchParams }: PageProps<"/reports/movements">) {
  return (
    <main>
      <PageHeader title="Staff movements" subtitle="Allocation history: arrivals, departures, transfers and cancellations." />
      <Suspense fallback={<p className="text-sm text-zinc-500">Loading…</p>}><Content searchParams={searchParams as Search} /></Suspense>
    </main>
  );
}
