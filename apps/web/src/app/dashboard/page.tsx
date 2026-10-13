import { Suspense } from "react";
import Link from "next/link";
import { requireRole } from "@/lib/auth/authorize";
import { REPORT_VIEW_ROLES } from "@sam/core/modules/reports/access";
import { ARRIVAL_WINDOW_DAYS, getDashboard, getOccupancyTrend, type MovementRow } from "@sam/core/modules/reports/service";
import { OccupancyStackChart, OccupancyTrendChart } from "@/modules/reports/components/charts";
import { PageHeader } from "@/components/shell/page-header";

type Severity = "danger" | "warning" | "info";

function Tile({ label, value, note, hero, href, accent, icon, chip, pct }: { label: string; value: string | number; note?: React.ReactNode; hero?: boolean; href?: string; accent?: string; icon?: string; chip?: React.ReactNode; pct?: number }) {
  const inner = (
    <>
      <dt className="kpi-label">{label}{icon && <span className="kpi-icon" aria-hidden="true">{icon}</span>}</dt>
      <dd data-tile={label} className="kpi-value">{value}{hero && note && <small>{note}</small>}</dd>
      {(chip || (!hero && note)) && <dd className="kpi-foot">{chip}{!hero && note}</dd>}
      {hero && typeof pct === "number" && <div className="gauge" style={{ "--pct": `${pct}%` } as React.CSSProperties} aria-hidden="true" />}
    </>
  );
  const cls = `kpi${hero ? " kpi-hero" : ""}`;
  const style = accent ? ({ "--acc": accent } as React.CSSProperties) : undefined;
  return href ? <Link href={href} className={cls} style={style}>{inner}</Link> : <div className={cls} style={style}>{inner}</div>;
}

function MovementTable({ rows }: { rows: Array<MovementRow & { direction: "arrival" | "departure" }> }) {
  if (rows.length === 0) return <p className="panel-body text-sm text-zinc-500">No arrivals or departures due in the next two weeks.</p>;
  const label = (k: MovementRow["kind"]) => (k === "OVERDUE_ARRIVAL" ? "Overdue arrival" : k === "OVERSTAY" ? "Overstaying" : k === "ARRIVAL" ? "Arriving" : "Departing");
  const chip = (k: MovementRow["kind"]) => (k === "OVERDUE_ARRIVAL" || k === "OVERSTAY" ? "chip chip-dot chip-danger" : k === "ARRIVAL" ? "chip chip-dot chip-warning" : "chip chip-dot chip-info");
  return (
    <div className="overflow-x-auto"><table className="table">
      <thead><tr><th>Resident</th><th>Bed</th><th>Movement</th><th>Date</th><th>Status</th><th className="num"></th></tr></thead>
      <tbody>
        {rows.map((r) => (
          <tr key={`${r.direction}-${r.allocationId}`} data-movement={r.kind}>
            <td><div className="who"><span className="av">{r.staff.split(" ").map((p) => p[0]).join("").slice(0, 2)}</span><div><b>{r.staff}</b><small>{r.employeeId}</small></div></div></td>
            <td>{r.bed}<span className="sub">{r.building}</span></td>
            <td>{r.direction === "arrival" ? "Arrival" : "Departure"}</td>
            <td className="tabular-nums">{r.date}</td>
            <td><span className={chip(r.kind)}>{label(r.kind)}</span></td>
            <td className="num"><Link href={`/accommodation/allocations/${r.allocationId}`} className="btn btn-small">{r.direction === "arrival" && r.kind !== "OVERSTAY" ? "Check in" : "Open"}</Link></td>
          </tr>
        ))}
      </tbody>
    </table></div>
  );
}

async function Dashboard({ searchParams }: { searchParams: Promise<{ siteId?: string }> }) {
  await requireRole(REPORT_VIEW_ROLES, "/dashboard");
  const { siteId: raw } = await searchParams;
  const siteId = raw || null;
  const [d, trend] = await Promise.all([getDashboard(siteId), getOccupancyTrend(siteId, 30)]);
  const s = d.summary;
  const p = d.pending;
  const pendingItems: Array<[string, string, number, string, Severity]> = [
    ["Overdue arrivals", "Allocated, not checked in by the start date", p.overdueArrivals, "/accommodation/allocations?filter=upcoming", "danger"],
    ["Overstays past end date", "Still checked in after the allocation ended", p.overstays, "/accommodation/allocations?filter=active", "danger"],
    ["Requests awaiting approval", "Waiting on an approver", p.pendingRequests, "/approvals?filter=pending", "warning"],
    ["Maintenance tickets unassigned", "No engineer or vendor yet", p.unassignedTickets, "/maintenance?filter=unassigned", "warning"],
    ["Keys overdue for return", "Past the agreed return date", p.overdueKeys, "/keys?filter=overdue", "warning"],
    ["Approved room changes awaiting move", "Beds reserved for the transfer", p.approvedRoomChanges, "/approvals?filter=approved", "info"],
  ];
  const movements = [...d.arrivals.map((r) => ({ ...r, direction: "arrival" as const })), ...d.departures.map((r) => ({ ...r, direction: "departure" as const }))].sort((a, b) => a.date.localeCompare(b.date));
  const last = trend[trend.length - 1]?.occupied ?? 0;
  const first = trend[0]?.occupied ?? 0;
  const delta = last - first;
  const siteName = siteId ? d.sites.find((x) => x.id === siteId)?.name : null;

  return (
    <>
      <PageHeader
        crumbs={[["Dashboard"]]}
        title="Occupancy dashboard"
        subtitle={`As of ${d.today} (${d.timezone})${siteName ? ` · ${siteName}` : " · all sites"}. Occupied counts checked-in residents and confirmed allocations that have started.`}
        actions={<>
          <form method="get" className="flex items-center gap-2">
            <label className="sr-only" htmlFor="siteId">Site</label>
            <select id="siteId" name="siteId" defaultValue={siteId ?? ""} className="rounded-md border border-zinc-300 px-3 py-2 text-sm"><option value="">All sites</option>{d.sites.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select>
            <button type="submit" className="btn">Apply</button>
          </form>
          <a href={`/api/reports/occupancy.csv${siteId ? `?siteId=${siteId}` : ""}`} className="btn">Export bed list</a>
          <Link href="/accommodation/allocations/new" className="btn btn-primary">＋ New allocation</Link>
        </>}
      />

      <dl className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <Tile label="Occupancy" value={`${d.occupancyRate}%`} note={`${s.occupied} of ${s.capacity} beds`} hero pct={d.occupancyRate} icon="◔" chip={delta !== 0 ? <span className="chip chip-lite">{delta > 0 ? "▲" : "▼"} {Math.abs(delta)} vs 30 days ago</span> : undefined} />
        <Tile label="Occupied" value={s.occupied} note={<>{s.checkedIn} checked in · {s.awaitingCheckIn} awaiting</>} accent="var(--deep)" icon="▣" href="/accommodation/allocations?filter=active" />
        <Tile label="Vacant" value={s.vacant} note={s.upcomingArrivals ? `${s.upcomingArrivals} reserved for arrivals` : "ready to allocate"} accent="var(--primary)" icon="▢" href="/accommodation/allocations/new" />
        <Tile label="Blocked" value={s.blocked} note={s.retired ? `${s.retired} retired` : "out of service"} accent="#aeb8b1" icon="⊘" href="/accommodation" />
        <Tile label={`Arrivals · ${ARRIVAL_WINDOW_DAYS}d`} value={d.arrivals.length} note={p.overdueArrivals ? undefined : "on schedule"} chip={p.overdueArrivals ? <span className="chip chip-warning">{p.overdueArrivals} overdue</span> : undefined} accent="var(--warning)" icon="→" href="/accommodation/allocations?filter=upcoming" />
        <Tile label={`Departures · ${ARRIVAL_WINDOW_DAYS}d`} value={d.departures.length} note={p.overstays ? undefined : "no overstays"} chip={p.overstays ? <span className="chip chip-danger">{p.overstays} overstaying</span> : undefined} accent="var(--info)" icon="←" href="/accommodation/allocations?filter=active" />
      </dl>

      <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)]">
        <section className="panel">
          <div className="panel-head"><div><h2>Capacity by building</h2><p>Beds in service, by current state</p></div></div>
          <div className="panel-body">
            <OccupancyStackChart rows={d.buildings.map((b) => ({ id: b.id, label: d.sites.length > 1 && !siteId ? `${b.name} (${b.siteName})` : b.name, occupied: b.summary.occupied, vacant: b.summary.vacant, blocked: b.summary.blocked, href: `/accommodation/buildings/${b.id}` }))} />
          </div>
        </section>
        <div className="grid gap-4 content-start">
          <section className="panel">
            <div className="panel-head"><div><h2>Needs attention</h2><p>Items that block an arrival, a departure or a resident</p></div></div>
            <ul className="att">
              {pendingItems.map(([label, hint, value, href, sev]) => (
                <li key={label} className={value > 0 ? `sev-${sev}` : ""}><i aria-hidden="true" /><Link href={href} data-pending={label}><b>{label}</b><small>{hint}</small></Link><span className="n">{value}</span></li>
              ))}
            </ul>
          </section>
          <section className="panel">
            <div className="panel-head"><div><h2>Occupied beds, last 30 days</h2><p>From actual check-in and check-out times; capacity today is {trend[trend.length - 1]?.capacity ?? 0}</p></div>{delta !== 0 && <span className={`chip ${delta > 0 ? "chip-success" : "chip-warning"}`}>{delta > 0 ? "▲" : "▼"} {Math.abs(delta)} this month</span>}</div>
            <div className="panel-body"><OccupancyTrendChart points={trend} /></div>
          </section>
        </div>
      </div>

      <section className="panel mt-4">
        <div className="panel-head"><div><h2>Arrivals and departures, next {ARRIVAL_WINDOW_DAYS} days</h2><p>Confirmed allocations starting or ending, overdue first</p></div><Link href="/accommodation/allocations?filter=upcoming" className="btn btn-small">All allocations</Link></div>
        <MovementTable rows={movements} />
      </section>
    </>
  );
}

export default function DashboardPage({ searchParams }: PageProps<"/dashboard">) {
  return (
    <main>
      <Suspense fallback={<p className="text-sm text-zinc-500">Loading…</p>}>
        <Dashboard searchParams={searchParams as Promise<{ siteId?: string }>} />
      </Suspense>
    </main>
  );
}
