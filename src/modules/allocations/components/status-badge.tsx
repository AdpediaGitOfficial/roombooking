import type { AllocationStatus } from "@prisma/client";

const STYLES: Partial<Record<AllocationStatus, string>> = {
  CONFIRMED: "chip-warning",
  CHECKED_IN: "chip-success",
  PENDING_APPROVAL: "chip-info",
  CHECKED_OUT: "",
  CANCELLED: "chip-danger",
  REJECTED: "chip-danger",
  EXPIRED: "chip-danger",
};

const LABELS: Partial<Record<AllocationStatus, string>> = { CONFIRMED: "Arriving", CHECKED_IN: "Checked in", CHECKED_OUT: "Checked out", PENDING_APPROVAL: "Pending approval" };

export function AllocationStatusBadge({ status }: { status: AllocationStatus }) {
  const label = LABELS[status] ?? status.toLowerCase().replace("_", " ");
  return <span data-status={status} className={`chip chip-dot ${STYLES[status] ?? ""}`}>{label}</span>;
}
