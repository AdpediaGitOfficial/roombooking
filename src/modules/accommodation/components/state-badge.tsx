import type { BedState } from "../occupancy";

const STYLES: Record<BedState, string> = {
  OCCUPIED: "bg-blue-100 text-blue-800",
  ALLOCATED: "bg-amber-100 text-amber-800",
  VACANT: "bg-green-100 text-green-800",
  BLOCKED: "bg-red-100 text-red-800",
  RETIRED: "bg-zinc-200 text-zinc-700",
};

const LABELS: Record<BedState, string> = {
  OCCUPIED: "Occupied",
  ALLOCATED: "Allocated · awaiting check-in",
  VACANT: "Vacant",
  BLOCKED: "Blocked",
  RETIRED: "Retired",
};

export function StateBadge({ state }: { state: BedState }) {
  return (
    <span className={`chip ${STYLES[state]}`}>
      {LABELS[state]}
    </span>
  );
}
