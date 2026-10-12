import type { OccupancySummary } from "../occupancy";

export function SummaryTiles({ summary }: { summary: OccupancySummary }) {
  const tiles: Array<[string, number, string?]> = [
    ["Bed capacity", summary.capacity, summary.retired ? `${summary.retired} retired` : undefined],
    [
      "Occupied",
      summary.occupied,
      summary.awaitingCheckIn ? `${summary.checkedIn} checked in · ${summary.awaitingCheckIn} awaiting check-in` : undefined,
    ],
    ["Vacant", summary.vacant, summary.upcomingArrivals ? `${summary.upcomingArrivals} arriving` : undefined],
    ["Blocked", summary.blocked],
  ];
  return (
    <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      {tiles.map(([label, value, note]) => (
        <div key={label} className="rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
          <dt className="text-xs uppercase tracking-wide text-zinc-500">{label}</dt>
          <dd className="mt-1 text-2xl font-semibold tabular-nums">{value}</dd>
          {note && <dd className="mt-1 text-xs text-zinc-500">{note}</dd>}
        </div>
      ))}
    </dl>
  );
}
