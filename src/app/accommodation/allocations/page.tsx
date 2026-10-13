import { Suspense } from "react";
import Link from "next/link";
import { requireRole } from "@/lib/auth/authorize";
import { ALLOCATION_VIEW_ROLES } from "@/modules/allocations/access";
import { listAllocations, type AllocationListFilter } from "@/modules/allocations/service";
import { AllocationStatusBadge } from "@/modules/allocations/components/status-badge";
import { isoDate } from "@/modules/accommodation/occupancy";

const FILTERS: Array<[AllocationListFilter, string]> = [
  ["active", "Checked in"],
  ["upcoming", "Confirmed / arriving"],
  ["history", "History"],
  ["all", "All"],
];

async function AllocationList({ searchParams }: { searchParams: Promise<{ filter?: string; staffId?: string; requestId?: string }> }) {
  await requireRole(ALLOCATION_VIEW_ROLES, "/accommodation/allocations");
  const { filter: raw, staffId, requestId } = await searchParams;
  const filter = (FILTERS.some(([f]) => f === raw) ? raw : "active") as AllocationListFilter;
  const allocations = await listAllocations(filter, staffId || null);

  return (
    <>
      <nav className="flex flex-wrap gap-2 text-sm">
        {FILTERS.map(([f, label]) => (
          <Link
            key={f}
            href={`/accommodation/allocations?filter=${f}`}
            className={`rounded-full px-3 py-1 ${f === filter ? "bg-deep text-white" : "border border-zinc-300"}`}
          >
            {label}
          </Link>
        ))}
      </nav>
      <div className="mt-4 overflow-x-auto card">
        <table className="w-full text-sm">
          <thead className="bg-zinc-50 text-left text-xs uppercase tracking-wide text-zinc-500">
            <tr>
              <th className="px-3 py-2">Resident</th>
              <th className="px-3 py-2">Bed</th>
              <th className="px-3 py-2">From / to</th>
              <th className="px-3 py-2">Status</th>
              <th className="px-3 py-2"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-200">
            {allocations.map((a) => (
              <tr key={a.id} data-allocation={a.id}>
                <td className="px-3 py-3">
                  <div>{a.staff.firstName} {a.staff.lastName}</div>
                  <div className="text-xs text-zinc-500">{a.staff.employeeId}</div>
                </td>
                <td className="px-3 py-3">
                  <div>{a.bed.code}</div>
                  <div className="text-xs text-zinc-500">{a.bed.room.building.name} · Room {a.bed.room.code}</div>
                </td>
                <td className="px-3 py-3 tabular-nums">{isoDate(a.startDate)} → {a.endDate ? isoDate(a.endDate) : "open-ended"}</td>
                <td className="px-3 py-3"><AllocationStatusBadge status={a.status} /></td>
                <td className="px-3 py-3 text-right">
                  {requestId && (a.status === "CONFIRMED" || a.status === "CHECKED_IN") ? (
                    <Link href={`/accommodation/allocations/${a.id}/transfer?requestId=${requestId}&reason=${encodeURIComponent(`Room change request ${requestId.slice(-8).toUpperCase()}`)}`} className="underline">Transfer for request</Link>
                  ) : (
                    <Link href={`/accommodation/allocations/${a.id}`} className="underline">Open</Link>
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
    </>
  );
}

export default function AllocationsPage({ searchParams }: PageProps<"/accommodation/allocations">) {
  return (
    <main>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="page-title">Allocations</h1>
          <p className="mt-1 text-sm text-zinc-600">Who is in which bed, arrivals and departures.</p>
        </div>
        <Link href="/accommodation/allocations/new" className="rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-ink">
          New allocation
        </Link>
      </div>
      <div className="mt-6">
        <Suspense fallback={<p className="text-sm text-zinc-500">Loading…</p>}>
          <AllocationList searchParams={searchParams as Promise<{ filter?: string; staffId?: string; requestId?: string }>} />
        </Suspense>
      </div>
    </main>
  );
}
