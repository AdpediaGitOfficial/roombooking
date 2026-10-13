const CHIP: Record<string, string> = { ACTIVE: "bg-green-100 text-green-800", DRAFT: "bg-amber-100 text-amber-800", MAINTENANCE: "bg-orange-100 text-orange-800", BLOCKED: "bg-red-100 text-red-800", ARCHIVED: "bg-zinc-200 text-zinc-700", INACTIVE: "bg-zinc-200 text-zinc-700", RETIRED: "bg-zinc-200 text-zinc-700" };

/** Lifecycle status of a site, building, room or bed: draft, active, under maintenance, blocked or archived. */
export function StatusChip({ status }: { status: string }) {
  const label = status === "MAINTENANCE" ? "under maintenance" : status.toLowerCase();
  return <span className={`chip ${CHIP[status] ?? CHIP.ACTIVE}`} data-status={status}>{label}</span>;
}
