import type { OccupancySummary } from "@sam/core/modules/accommodation/occupancy";

export function SummaryTiles({ summary }: { summary: OccupancySummary }) {
  const tiles: Array<[string, number, string?]> = [
    ["Bed capacity", summary.capacity, [summary.retired ? `${summary.retired} archived` : "", summary.draft ? `${summary.draft} draft` : ""].filter(Boolean).join(" · ") || undefined],
    [
      "Occupied",
      summary.occupied,
      summary.awaitingCheckIn ? `${summary.checkedIn} checked in · ${summary.awaitingCheckIn} awaiting check-in` : undefined,
    ],
    ["Available", summary.vacant, [summary.upcomingArrivals ? `${summary.upcomingArrivals} arriving` : "", summary.needsCleaning ? `${summary.needsCleaning} need cleaning` : ""].filter(Boolean).join(" · ") || undefined],
    ["Blocked", summary.blocked, summary.maintenance ? `${summary.maintenance} under maintenance` : undefined],
  ];
  return (
    <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      {tiles.map(([label, value, note]) => (
        <div key={label} className="card p-4">
          <dt className="text-xs uppercase tracking-wide text-zinc-500">{label}</dt>
          <dd className="mt-1 text-2xl font-semibold tabular-nums">{value}</dd>
          {note && <dd className="mt-1 text-xs text-zinc-500">{note}</dd>}
        </div>
      ))}
    </dl>
  );
}
