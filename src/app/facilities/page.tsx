import { Suspense } from "react";
import Link from "next/link";
import { prisma } from "@/lib/db";
import { hasRole, requireRole } from "@/lib/auth/authorize";
import { zonedDateTime } from "@/lib/time";
import { FACILITY_MANAGE_ROLES, FACILITY_VIEW_ROLES } from "@/modules/facilities/access";
import { facilityConfig, facilityReports, listFacilities } from "@/modules/facilities/service";
import { describeHours } from "@/modules/facilities/rules";
import { siteOptions } from "@/modules/facilities/context";
import { CreateFacilityForm } from "@/modules/facilities/components/forms";
import { PageHeader } from "@/components/shell/page-header";

async function Overview() {
  const user = await requireRole(FACILITY_VIEW_ROLES, "/facilities");
  const canManage = hasRole(user, ...FACILITY_MANAGE_ROLES);
  const now = new Date();
  const [facilities, reports, pending, sites] = await Promise.all([
    listFacilities({ includeInactive: true }),
    facilityReports(30, now),
    prisma.facilityBooking.findMany({ where: { status: "PENDING_APPROVAL", startsAt: { gt: now } }, include: { facility: { include: { site: true } }, user: { select: { name: true } } }, orderBy: { startsAt: "asc" } }),
    canManage ? siteOptions() : null,
  ]);
  const todayCounts = await Promise.all(facilities.map(async (f) => {
    const today = zonedDateTime(now, f.site.timezone).date;
    const start = new Date(now); start.setUTCHours(0, 0, 0, 0);
    const count = await prisma.facilityBooking.count({ where: { facilityId: f.id, status: { in: ["CONFIRMED", "CHECKED_IN", "PENDING_APPROVAL"] }, endsAt: { gt: now }, startsAt: { lt: new Date(now.getTime() + 24 * 3600000) } } });
    return [f.id, { today, count }] as const;
  }));
  const todayMap = new Map(todayCounts);
  const upcoming = [...todayMap.values()].reduce((s, v) => s + v.count, 0);
  return (
    <>
      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[["Facilities", facilities.filter((f) => f.status === "ACTIVE").length], ["Bookings next 24 h", upcoming], ["Awaiting approval", pending.length], ["Utilisation (30 d)", `${reports.length ? Math.round(reports.reduce((s, r) => s + r.utilisation, 0) / reports.length) : 0}%`]].map(([label, value]) => (
          <div key={label} className="kpi"><dt className="kpi-label">{label}</dt><dd data-summary={label} className="kpi-value">{value}</dd></div>
        ))}
      </dl>

      {pending.length > 0 && (
        <section className="mt-6">
          <h2 className="section-title">Awaiting approval</h2>
          <ul className="mt-2 space-y-2">
            {pending.map((b) => {
              const local = zonedDateTime(b.startsAt, b.facility.site.timezone);
              return (
                <li key={b.id} data-pending={b.id} className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900">
                  <Link href={`/facilities/${b.facilityId}?date=${local.date}`} className="font-medium underline">{b.facility.name}</Link> · {local.date} {local.time} · {b.user.name} · {b.headcount} {b.headcount === 1 ? "person" : "people"}{b.purpose ? ` · ${b.purpose}` : ""}
                </li>
              );
            })}
          </ul>
        </section>
      )}

      <section className="mt-6">
        <h2 className="section-title">Facilities</h2>
        <div className="mt-2 overflow-x-auto card">
          <table className="w-full text-sm">
            <thead className="bg-zinc-50 text-left text-xs uppercase tracking-wide text-zinc-500">
              <tr><th className="px-3 py-2">Facility</th><th className="px-3 py-2">Site</th><th className="px-3 py-2">Open</th><th className="px-3 py-2">Capacity</th><th className="px-3 py-2">Next 24 h</th><th className="px-3 py-2">Status</th></tr>
            </thead>
            <tbody className="divide-y divide-zinc-200">
              {facilities.map((f) => (
                <tr key={f.id} data-facility={f.code}>
                  <td className="px-3 py-3"><Link href={`/facilities/${f.id}`} className="font-medium underline">{f.name}</Link><div className="text-xs text-zinc-500">{f.code}{f.location ? ` · ${f.location}` : ""}</div></td>
                  <td className="px-3 py-3">{f.site.name}</td>
                  <td className="px-3 py-3 text-xs">{describeHours(facilityConfig(f).hours)}</td>
                  <td className="px-3 py-3 tabular-nums">{f.capacity}</td>
                  <td className="px-3 py-3 tabular-nums">{todayMap.get(f.id)?.count ?? 0}</td>
                  <td className="px-3 py-3 text-xs">{f.status === "ACTIVE" ? "Active" : "Inactive"}{f.requiresApproval ? " · approval" : ""}</td>
                </tr>
              ))}
              {facilities.length === 0 && <tr><td colSpan={6} className="px-3 py-6 text-center text-zinc-500">No facilities yet.</td></tr>}
            </tbody>
          </table>
        </div>
      </section>

      <section className="mt-6">
        <h2 className="section-title">Last 30 days</h2>
        <p className="mt-1 text-xs text-zinc-500">Utilisation is booked person-hours (confirmed, used or completed) against capacity × opening hours.</p>
        <div className="mt-2 overflow-x-auto card">
          <table className="w-full text-sm">
            <thead className="bg-zinc-50 text-left text-xs uppercase tracking-wide text-zinc-500">
              <tr><th className="px-3 py-2">Facility</th><th className="px-3 py-2 text-right">Bookings</th><th className="px-3 py-2 text-right">Attended</th><th className="px-3 py-2 text-right">No-shows</th><th className="px-3 py-2 text-right">Cancelled</th><th className="px-3 py-2 text-right">Booked h</th><th className="px-3 py-2 text-right">Open h</th><th className="px-3 py-2 text-right">Utilisation</th></tr>
            </thead>
            <tbody className="divide-y divide-zinc-200">
              {reports.map((r) => (
                <tr key={r.facilityId} data-report={r.facilityId}>
                  <td className="px-3 py-2">{r.name}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{r.bookings}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{r.attended}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{r.noShows}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{r.cancelled}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{r.bookedHours}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{r.openHours}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{r.utilisation}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {sites && <div className="mt-6"><CreateFacilityForm sites={sites} /></div>}
    </>
  );
}

export default function FacilitiesPage() {
  return (
    <main>
      <PageHeader title="Facility booking" subtitle="Shared facilities, daily schedules, approvals and utilisation." crumbs={[["Facilities"]]} />
      <Suspense fallback={<p className="text-sm text-zinc-500">Loading…</p>}>
        <Overview />
      </Suspense>
    </main>
  );
}
