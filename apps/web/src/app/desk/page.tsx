import { Suspense } from "react";
import Link from "next/link";
import { prisma } from "@sam/core/lib/db";
import { requireCapability, userCan } from "@/lib/auth/authorize";
import { sitesFor } from "@/lib/auth/scope";
import { deskBoard, emergencyBeds, type DeskBoard } from "@sam/core/modules/desk/board";
import { staffOptions } from "@sam/core/modules/people/service";
import { EmergencyCheckInForm } from "@/modules/allocations/components/extras-forms";
import { PageHeader } from "@/components/shell/page-header";

type Row = DeskBoard["arrivals"][number];
const who = (a: Row) => `${a.staff.firstName} ${a.staff.lastName}`;
const where = (a: Row) => `${a.bed.room.building.name} · room ${a.bed.room.code} · bed ${a.bed.code}`;

function List({ title, empty, rows, action }: { title: string; empty: string; rows: Array<{ key: string; primary: string; secondary: string; href: string; badge?: string }>; action?: string }) {
  return (
    <section className="panel">
      <div className="toolbar"><h2 className="font-medium">{title} <span className="text-zinc-500">({rows.length})</span></h2></div>
      <ul className="divide-y divide-zinc-200">
        {rows.map((r) => (
          <li key={r.key} className="flex items-center justify-between gap-3 px-4 py-2 text-sm">
            <div className="min-w-0"><div className="font-medium">{r.primary}</div><div className="truncate text-xs text-zinc-500">{r.secondary}</div></div>
            <div className="flex items-center gap-2">{r.badge && <span className="chip">{r.badge}</span>}<Link href={r.href} className="btn btn-small">{action ?? "Open"}</Link></div>
          </li>
        ))}
        {rows.length === 0 && <li className="px-4 py-4 text-sm text-zinc-500">{empty}</li>}
      </ul>
    </section>
  );
}

async function Board() {
  const user = await requireCapability(["accom.checkin", "accom.readiness"], { returnTo: "/desk", level: "access" });
  const sites = await sitesFor(user, ["accom.checkin", "accom.view"]);
  const board = await deskBoard(sites);
  const canEmergency = userCan(user, "accom.emergency_checkin");
  const [people, beds] = canEmergency ? await Promise.all([staffOptions({ includeUnverified: true }), emergencyBeds(sites)]) : [[], []];
  const open = await prisma.allocation.count({ where: { id: { in: board.provisional.map((p) => p.id) } } });
  void open;
  return (
    <>
      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[["Arrivals today", board.arrivals.length + board.overdueArrivals.length], ["Departures today", board.departures.length], ["Beds not ready", board.notReady.length], ["Provisional stays", board.provisional.length]].map(([l, v]) => <div key={l} className="kpi"><dt className="kpi-label">{l}</dt><dd className="kpi-value" data-desk={l}>{v}</dd></div>)}
      </dl>
      <div className="mt-6 grid gap-4 lg:grid-cols-2">
        <List title="Arrivals" empty="No arrivals due." action="Check in" rows={[...board.overdueArrivals.map((a) => ({ key: a.id, primary: who(a), secondary: where(a), href: `/accommodation/allocations/${a.id}`, badge: "overdue" })), ...board.arrivals.map((a) => ({ key: a.id, primary: who(a), secondary: where(a), href: `/accommodation/allocations/${a.id}` }))]} />
        <List title="Departures" empty="No departures due." action="Check out" rows={[...board.overstays.map((a) => ({ key: a.id, primary: who(a), secondary: where(a), href: `/accommodation/allocations/${a.id}`, badge: "overstay" })), ...board.departures.map((a) => ({ key: a.id, primary: who(a), secondary: where(a), href: `/accommodation/allocations/${a.id}` }))]} />
        <List title="Transfers today" empty="No transfers today." rows={board.transfers.map((a) => ({ key: a.id, primary: who(a), secondary: `${a.previous ? `from bed ${a.previous.bed.code} → ` : ""}${where(a)}`, href: `/accommodation/allocations/${a.id}` }))} />
        <List title="Facility bookings today" empty="No bookings today." rows={board.bookings.map((b) => ({ key: b.id, primary: `${b.facility.name} · ${b.user.name}`, secondary: `${b.startsAt.toISOString().slice(11, 16)}–${b.endsAt.toISOString().slice(11, 16)}`, href: `/facilities/${b.facilityId}`, badge: b.status === "PENDING_APPROVAL" ? "pending" : undefined }))} />
        <List title="Provisional (emergency) stays" empty="None awaiting approval." rows={board.provisional.map((a) => ({ key: a.id, primary: who(a), secondary: `${where(a)} · approve by ${a.provisionalApproveBy?.toISOString().replace("T", " ").slice(0, 16)} UTC`, href: `/accommodation/allocations/${a.id}`, badge: a.provisionalApproveBy && a.provisionalApproveBy < new Date() ? "overdue" : undefined }))} />
        <List title="Move tasks" empty="No residents waiting to be moved." rows={board.moveTasks.map((t) => ({ key: t.id, primary: "Move a resident", secondary: t.reason, href: `/accommodation/allocations/${t.allocationId}/transfer` }))} action="Move" />
      </div>
      {canEmergency && <div className="mt-6 max-w-3xl"><EmergencyCheckInForm staff={people.map((p) => ({ id: p.id, label: `${p.lastName}, ${p.firstName} (${p.employeeId})${p.verificationStatus === "UNVERIFIED" ? " · unverified" : ""}` }))} beds={beds.map((b) => ({ id: b.id, label: `${b.room.building.name} · room ${b.room.code} · bed ${b.code}` }))} /></div>}
    </>
  );
}

export default function DeskPage() {
  return (
    <main>
      <PageHeader title="Front desk" subtitle="Today's board: arrivals, departures, transfers and bookings." crumbs={[["Front desk"]]} actions={<><Link href="/desk/readiness" className="btn">Room readiness</Link><Link href="/desk/shift" className="btn">Shift log</Link><Link href="/people" className="btn">Residents</Link></>} />
      <Suspense fallback={<p className="text-sm text-zinc-500">Loading…</p>}><Board /></Suspense>
    </main>
  );
}
