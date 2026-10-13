import { Suspense } from "react";
import Link from "next/link";
import { requireRole } from "@/lib/auth/authorize";
import { REPORT_VIEW_ROLES } from "@/modules/reports/access";
import { ARRIVAL_WINDOW_DAYS, getDashboard, getOccupancyTrend, type MovementRow } from "@/modules/reports/service";
import { OccupancyStackChart, OccupancyTrendChart } from "@/modules/reports/components/charts";

function Tile({ label, value, note, hero, href }: { label: string; value: string | number; note?: string; hero?: boolean; href?: string }) {
  const inner = (
    <>
      <dt className="text-xs uppercase tracking-wide text-zinc-500">{label}</dt>
      <dd data-tile={label} className={`mt-1 font-semibold ${hero ? "text-4xl" : "text-2xl"}`}>{value}</dd>
      {note && <dd className="mt-1 text-xs text-zinc-500">{note}</dd>}
    </>
  );
  const cls = "rounded-lg border border-zinc-200 p-4 dark:border-zinc-800";
  return href ? <Link href={href} className={`${cls} block hover:bg-zinc-50 dark:hover:bg-zinc-900`}>{inner}</Link> : <div className={cls}>{inner}</div>;
}

function MovementList({ rows, empty, kindLabel }: { rows: MovementRow[]; empty: string; kindLabel: (k: MovementRow["kind"]) => string }) {
  if (rows.length === 0) return <p className="mt-2 text-sm text-zinc-500">{empty}</p>;
  return (
    <ul className="mt-2 divide-y divide-zinc-200 rounded-lg border border-zinc-200 text-sm dark:divide-zinc-800 dark:border-zinc-800">
      {rows.map((r) => (
        <li key={r.allocationId} data-movement={r.kind} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
          <span><Link href={`/accommodation/allocations/${r.allocationId}`} className="font-medium underline">{r.staff}</Link> <span className="text-zinc-500">· {r.employeeId} · bed {r.bed}, {r.building}</span></span>
          <span className={`text-xs tabular-nums ${r.kind === "OVERDUE_ARRIVAL" || r.kind === "OVERSTAY" ? "font-medium text-red-700 dark:text-red-300" : "text-zinc-500"}`}>{kindLabel(r.kind)} {r.date}</span>
        </li>
      ))}
    </ul>
  );
}

async function Dashboard({ searchParams }: { searchParams: Promise<{ siteId?: string }> }) {
  await requireRole(REPORT_VIEW_ROLES, "/dashboard");
  const { siteId: raw } = await searchParams;
  const siteId = raw || null;
  const [d, trend] = await Promise.all([getDashboard(siteId), getOccupancyTrend(siteId, 30)]);
  const s = d.summary;
  const p = d.pending;
  const input = "rounded-md border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900";
  const pendingItems: Array<[string, number, string]> = [
    ["Overdue arrivals (not checked in)", p.overdueArrivals, "/accommodation/allocations?filter=upcoming"],
    ["Overstays past end date", p.overstays, "/accommodation/allocations?filter=active"],
    ["Approved room changes awaiting move", p.approvedRoomChanges, "/approvals?filter=approved"],
    ["Requests awaiting approval", p.pendingRequests, "/approvals?filter=pending"],
    ["Keys overdue for return", p.overdueKeys, "/keys?filter=overdue"],
    ["Maintenance tickets unassigned", p.unassignedTickets, "/maintenance?filter=unassigned"],
  ];

  return (
    <>
      <form method="get" className="flex flex-wrap items-end gap-3">
        <label className="text-sm">Site<br /><select name="siteId" defaultValue={siteId ?? ""} className={input}><option value="">All sites</option>{d.sites.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select></label>
        <button type="submit" className="rounded-md border border-zinc-300 px-3 py-2 text-sm font-medium dark:border-zinc-700">Apply</button>
        <a href={`/api/reports/occupancy.csv${siteId ? `?siteId=${siteId}` : ""}`} className="ml-auto rounded-md border border-zinc-300 px-3 py-2 text-sm font-medium dark:border-zinc-700">Export bed list (CSV)</a>
      </form>
      <p className="mt-2 text-xs text-zinc-500">As of {d.today} ({d.timezone}). Occupied counts checked-in residents and confirmed allocations that have started.</p>

      <dl className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-6">
        <Tile label="Occupancy" value={`${d.occupancyRate}%`} note={`${s.occupied} of ${s.capacity} beds`} hero />
        <Tile label="Occupied" value={s.occupied} note={`${s.checkedIn} checked in · ${s.awaitingCheckIn} awaiting`} />
        <Tile label="Vacant" value={s.vacant} note={s.upcomingArrivals ? `${s.upcomingArrivals} reserved for arrivals` : undefined} href="/accommodation/allocations/new" />
        <Tile label="Blocked" value={s.blocked} note={s.retired ? `${s.retired} retired` : undefined} href="/accommodation" />
        <Tile label={`Arrivals · ${ARRIVAL_WINDOW_DAYS} days`} value={d.arrivals.length} note={p.overdueArrivals ? `${p.overdueArrivals} overdue` : undefined} />
        <Tile label={`Departures · ${ARRIVAL_WINDOW_DAYS} days`} value={d.departures.length} note={p.overstays ? `${p.overstays} overstaying` : undefined} />
      </dl>

      <div className="mt-8 grid gap-8 lg:grid-cols-2">
        <section>
          <h2 className="text-lg font-semibold">Capacity by building</h2>
          <p className="mb-3 text-xs text-zinc-500">Beds in service, by current state.</p>
          <OccupancyStackChart rows={d.buildings.map((b) => ({ id: b.id, label: d.sites.length > 1 && !siteId ? `${b.name} (${b.siteName})` : b.name, occupied: b.summary.occupied, vacant: b.summary.vacant, blocked: b.summary.blocked, href: `/accommodation/buildings/${b.id}` }))} />
        </section>
        <section>
          <h2 className="text-lg font-semibold">Occupied beds, last 30 days</h2>
          <p className="mb-3 text-xs text-zinc-500">From actual check-in and check-out times; capacity today is {trend[trend.length - 1]?.capacity ?? 0}.</p>
          <OccupancyTrendChart points={trend} />
        </section>
      </div>

      <section className="mt-8">
        <h2 className="text-lg font-semibold">Pending actions</h2>
        <ul className="mt-2 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {pendingItems.map(([label, value, href]) => (
            <li key={label}>
              <Link href={href} data-pending={label} className={`flex items-center justify-between rounded-lg border px-3 py-2 text-sm ${value > 0 ? "border-amber-300 bg-amber-50 dark:border-amber-800 dark:bg-amber-950" : "border-zinc-200 dark:border-zinc-800"}`}>
                <span>{label}</span><span className="text-lg font-semibold tabular-nums">{value}</span>
              </Link>
            </li>
          ))}
        </ul>
      </section>

      <div className="mt-8 grid gap-8 lg:grid-cols-2">
        <section>
          <h2 className="text-lg font-semibold">Arrivals</h2>
          <MovementList rows={d.arrivals} empty="No arrivals due in the next two weeks." kindLabel={(k) => (k === "OVERDUE_ARRIVAL" ? "overdue since" : "due")} />
        </section>
        <section>
          <h2 className="text-lg font-semibold">Departures</h2>
          <MovementList rows={d.departures} empty="No departures due in the next two weeks." kindLabel={(k) => (k === "OVERSTAY" ? "overstaying since" : "due")} />
        </section>
      </div>
    </>
  );
}

export default function DashboardPage({ searchParams }: PageProps<"/dashboard">) {
  return (
    <main className="mx-auto w-full max-w-6xl px-4 py-8">
      <nav className="mb-4 text-sm text-zinc-600 dark:text-zinc-400"><Link href="/" className="underline">Home</Link><span className="mx-2">/</span>Dashboard</nav>
      <h1 className="text-2xl font-semibold">Occupancy dashboard</h1>
      <div className="mt-4">
        <Suspense fallback={<p className="text-sm text-zinc-500">Loading…</p>}>
          <Dashboard searchParams={searchParams as Promise<{ siteId?: string }>} />
        </Suspense>
      </div>
    </main>
  );
}
