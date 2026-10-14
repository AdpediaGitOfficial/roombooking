import { Suspense } from "react";
import Link from "next/link";
import { requireRole } from "@/lib/auth/authorize";
import { REPORT_VIEW_ROLES } from "@sam/core/modules/reports/access";
import { DEFINITIONS } from "@sam/core/modules/reports/rules";
import { api } from "@/lib/api";
import { Definitions, ReportFilters, Stat, qs, table, tbody, td, th, thead, wrap } from "@/modules/reports/components/report-filters";
import { PageHeader } from "@/components/shell/page-header";

type Search = Promise<Record<string, string | undefined>>;

async function Content({ searchParams }: { searchParams: Search }) {
  await requireRole(REPORT_VIEW_ROLES, "/reports/facilities");
  const sp = await searchParams;
  const f = { siteId: sp.siteId || null, facilityId: sp.facilityId || null };
  const { report: rows, options, range, canSeeNames } = await api.reports.facilities({ siteId: f.siteId ?? undefined, facilityId: f.facilityId ?? undefined, from: sp.from || undefined, to: sp.to || undefined });
  const query = qs({ from: range.from, to: range.to, siteId: f.siteId, facilityId: f.facilityId });
  const sum = (k: "bookings" | "attended" | "noShows" | "cancelled") => rows.reduce((s, r) => s + r[k], 0);
  const util = rows.filter((r) => r.utilisation !== null);
  return (
    <>
      <ReportFilters action="/reports/facilities" range={range} sites={options.sites.map((s) => ({ ...s, buildings: [] }))} values={f} csvHref={`/api/reports/facilities.csv?${query}`} facilities={options.facilities} />
      <dl className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-5">
        <Stat label="Bookings" value={sum("bookings")} /><Stat label="Attended" value={sum("attended")} /><Stat label="No-shows" value={sum("noShows")} /><Stat label="Cancelled" value={sum("cancelled")} /><Stat label="Utilisation" value={util.length ? `${Math.round(util.reduce((s, r) => s + (r.utilisation ?? 0), 0) / util.length)}%` : "—"} note="average over facilities" />
      </dl>
      <div className={wrap}>
        <table className={table}>
          <thead className={thead}><tr><th className={th}>Facility</th><th className={`${th} text-right`}>Bookings</th><th className={`${th} text-right`}>Attended</th><th className={`${th} text-right`}>No-shows</th><th className={`${th} text-right`}>Cancelled</th><th className={`${th} text-right`}>Declined</th><th className={`${th} text-right`}>Pending</th><th className={`${th} text-right`}>People</th><th className={`${th} text-right`}>Booked h</th><th className={`${th} text-right`}>Open h</th><th className={`${th} text-right`}>Utilisation</th></tr></thead>
          <tbody className={tbody}>
            {rows.map((r) => (
              <tr key={r.facilityId} data-facility-row={r.name}>
                <td className={td}><Link href={`/facilities/${r.facilityId}`} className="underline">{r.name}</Link><div className="text-xs text-zinc-500">{r.site}</div></td>
                <td className={`${td} text-right tabular-nums`}>{r.bookings}</td><td className={`${td} text-right tabular-nums`}>{r.attended}</td><td className={`${td} text-right tabular-nums`}>{r.noShows}</td><td className={`${td} text-right tabular-nums`}>{r.cancelled}</td><td className={`${td} text-right tabular-nums`}>{r.rejected}</td><td className={`${td} text-right tabular-nums`}>{r.pending}</td><td className={`${td} text-right tabular-nums`}>{r.people}</td><td className={`${td} text-right tabular-nums`}>{r.bookedHours}</td><td className={`${td} text-right tabular-nums`}>{r.openHours}</td><td className={`${td} text-right tabular-nums`}>{r.utilisation === null ? "—" : `${r.utilisation}%`}</td>
              </tr>
            ))}
            {rows.length === 0 && <tr><td colSpan={11} className="px-3 py-6 text-center text-zinc-500">No facilities.</td></tr>}
          </tbody>
        </table>
      </div>
      <Definitions lines={DEFINITIONS.facilities} masked={!canSeeNames} />
    </>
  );
}

export default function FacilitiesReportPage({ searchParams }: PageProps<"/reports/facilities">) {
  return (
    <main>
      <PageHeader title="Facility use" subtitle="Bookings, attendance, cancellations, no-shows and utilisation by facility." />
      <Suspense fallback={<p className="text-sm text-zinc-500">Loading…</p>}><Content searchParams={searchParams as Search} /></Suspense>
    </main>
  );
}
