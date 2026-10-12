import type { BedState } from "../occupancy";

const STYLES: Record<BedState, string> = {
  OCCUPIED: "bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-200",
  ALLOCATED: "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-200",
  VACANT: "bg-green-100 text-green-800 dark:bg-green-950 dark:text-green-200",
  BLOCKED: "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-200",
  RETIRED: "bg-zinc-200 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300",
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
    <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${STYLES[state]}`}>
      {LABELS[state]}
    </span>
  );
}
