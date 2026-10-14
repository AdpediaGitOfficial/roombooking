import Link from "next/link";
import type { StayAllocation } from "@sam/core/modules/self-service/service";
import { isoDate } from "@sam/core/modules/accommodation/occupancy-rules";

export function StayCard({ allocation, compact = false }: { allocation: StayAllocation | null; compact?: boolean }) {
  if (!allocation) {
    return (
      <div className="rounded-lg border border-dashed border-zinc-300 p-4 text-sm text-zinc-600">
        No accommodation is currently allocated to you. Contact the accommodation office if you expect one.
      </div>
    );
  }
  const { bed } = allocation;
  const awaiting = allocation.status === "CONFIRMED";
  return (
    <div data-stay={bed.code} className="card p-4">
      <div className="text-xs uppercase tracking-wide text-zinc-500">{awaiting ? "Allocated · check in at reception" : "Your bed"}</div>
      <div className="mt-1 text-2xl font-semibold">Bed {bed.code}</div>
      <div className="mt-1 text-sm text-zinc-600">
        {bed.room.building.name} · Room {bed.room.code}{bed.room.floor ? ` · Floor ${bed.room.floor}` : ""}
      </div>
      <div className="mt-1 text-sm text-zinc-600">{bed.room.building.site.name}</div>
      <div className="mt-2 text-sm tabular-nums">
        {isoDate(allocation.startDate)} → {allocation.endDate ? isoDate(allocation.endDate) : "open-ended"}
      </div>
      {compact && <Link href="/my/stay" className="mt-3 inline-block text-sm underline">Stay details</Link>}
    </div>
  );
}
