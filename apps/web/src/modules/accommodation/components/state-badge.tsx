import type { BedState } from "@sam/core/modules/accommodation/occupancy";

const STYLES: Record<BedState, string> = {
  OCCUPIED: "bg-blue-100 text-blue-800",
  ALLOCATED: "bg-amber-100 text-amber-800",
  VACANT: "bg-green-100 text-green-800",
  BLOCKED: "bg-red-100 text-red-800",
  RETIRED: "bg-zinc-200 text-zinc-700",
  NEEDS_CLEANING: "bg-yellow-100 text-yellow-800",
  MAINTENANCE: "bg-orange-100 text-orange-800",
  DRAFT: "bg-zinc-100 text-zinc-600",
};

const LABELS: Record<BedState, string> = {
  OCCUPIED: "Occupied",
  ALLOCATED: "Reserved · awaiting check-in",
  VACANT: "Available",
  BLOCKED: "Blocked",
  RETIRED: "Archived",
  NEEDS_CLEANING: "Needs cleaning",
  MAINTENANCE: "Under maintenance",
  DRAFT: "Draft",
};

export function StateBadge({ state }: { state: BedState }) {
  return (
    <span className={`chip ${STYLES[state]}`}>
      {LABELS[state]}
    </span>
  );
}
