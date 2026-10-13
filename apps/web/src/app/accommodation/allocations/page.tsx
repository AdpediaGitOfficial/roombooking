import { Suspense } from "react";
import Link from "next/link";
import { requireRole, requireUser, userCan } from "@/lib/auth/authorize";
import { visibleSites } from "@/lib/auth/scope";
import { ALLOCATION_VIEW_ROLES } from "@sam/core/modules/allocations/access";
import { listAllocations, type AllocationListFilter } from "@sam/core/modules/allocations/service";
import { AllocationStatusBadge } from "@/modules/allocations/components/status-badge";
import { isoDate } from "@sam/core/modules/accommodation/occupancy";
import { PageHeader } from "@/components/shell/page-header";

const FILTERS: Array<[AllocationListFilter, string]> = [
  ["active", "Checked in"],
  ["upcoming", "Confirmed / arriving"],
  ["history", "History"],
  ["all", "All"],
];

async function HeaderActions() {
  const user = await requireUser("/accommodation/allocations");
  return (
    <>
      <Link href="/accommodation" className="btn">Buildings &amp; rooms</Link>
      {userCan(user, "accom.allocate") && <Link href="/accommodation/waitlist" className="btn">Waitlist</Link>}
      {userCan(user, "accom.bulk_allocate") && <Link href="/accommodation/allocations/bulk" className="btn">Bulk allocate</Link>}
      {userCan(user, "accom.allocate") && <Link href="/accommodation/allocations/new" className="btn btn-primary">＋ New allocation</Link>}
    </>
  );
}

async function AllocationList({ searchParams }: { searchParams: Promise<{ filter?: string; staffId?: string; requestId?: string }> }) {
  const user = await requireRole(ALLOCATION_VIEW_ROLES, "/accommodation/allocations");
  const { filter: raw, staffId, requestId } = await searchParams;
  const filter = (FILTERS.some(([f]) => f === raw) ? raw : "active") as AllocationListFilter;
  const allocations = await listAllocations(filter, staffId || null, await visibleSites(user, "accom.view"));

  const counts = { active: allocations.filter((a) => a.status === "CHECKED_IN").length };
  return (
    <section className="panel">
      <div className="toolbar">
        <nav className="flex flex-wrap gap-1.5" aria-label="Filter">
          {FILTERS.map(([f, label]) => (
            <Link key={f} href={`/accommodation/allocations?filter=${f}${staffId ? `&staffId=${staffId}` : ""}`} className={`pill${f === filter ? " pill-on" : ""}`}>{label}</Link>
          ))}
        </nav>
        {staffId && <Link href={`/accommodation/allocations?filter=${filter}`} className="chip chip-info">Filtered to one person · clear ×</Link>}
        <span className="ml-auto text-xs text-zinc-500">{allocations.length} shown{filter === "active" ? ` · ${counts.active} checked in` : ""}</span>
      </div>
      <div className="overflow-x-auto">
        <table className="table">
          <thead>
            <tr>
              <th>Resident</th>
              <th>Bed</th>
              <th>From → to</th>
              <th>Status</th>
              <th className="num"></th>
            </tr>
          </thead>
          <tbody>
            {allocations.map((a) => (
              <tr key={a.id} data-allocation={a.id}>
                <td>
                  <div className="who"><span className="av">{(a.staff.firstName[0] ?? "") + (a.staff.lastName[0] ?? "")}</span><div><b>{a.staff.firstName} {a.staff.lastName}</b><small>{a.staff.employeeId}</small></div></div>
                </td>
                <td>{a.bed.code}<span className="sub">{a.bed.room.building.name} · Room {a.bed.room.code}</span></td>
                <td className="tabular-nums">{isoDate(a.startDate)} → {a.endDate ? isoDate(a.endDate) : "open-ended"}</td>
                <td><AllocationStatusBadge status={a.status} /></td>
                <td className="num">
                  {requestId && (a.status === "CONFIRMED" || a.status === "CHECKED_IN") ? (
                    <Link href={`/accommodation/allocations/${a.id}/transfer?requestId=${requestId}&reason=${encodeURIComponent(`Room change request ${requestId.slice(-8).toUpperCase()}`)}`} className="btn btn-small">Transfer for request</Link>
                  ) : (
                    <Link href={`/accommodation/allocations/${a.id}`} className={`btn btn-small${a.status === "CONFIRMED" ? "" : " btn-ghost"}`}>{a.status === "CONFIRMED" ? "Check in" : "Open"}</Link>
                  )}
                </td>
              </tr>
            ))}
            {allocations.length === 0 && (
              <tr><td colSpan={5} className="px-3 py-6 text-center text-zinc-500">Nothing to show.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}

export default function AllocationsPage({ searchParams }: PageProps<"/accommodation/allocations">) {
  return (
    <main>
      <PageHeader crumbs={[["Accommodation", "/accommodation"], ["Allocations"]]} title="Allocations" subtitle="Who is in which bed, who is arriving and who is leaving." actions={<Suspense fallback={null}><HeaderActions /></Suspense>} />
      <div>
        <Suspense fallback={<p className="text-sm text-zinc-500">Loading…</p>}>
          <AllocationList searchParams={searchParams as Promise<{ filter?: string; staffId?: string; requestId?: string }>} />
        </Suspense>
      </div>
    </main>
  );
}
