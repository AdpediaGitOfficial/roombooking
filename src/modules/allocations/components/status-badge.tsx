import type { AllocationStatus } from "@prisma/client";

const STYLES: Partial<Record<AllocationStatus, string>> = {
  CONFIRMED: "bg-amber-100 text-amber-800",
  CHECKED_IN: "bg-blue-100 text-blue-800",
  CHECKED_OUT: "bg-zinc-200 text-zinc-700",
  CANCELLED: "bg-red-100 text-red-800",
};

export function AllocationStatusBadge({ status }: { status: AllocationStatus }) {
  const style = STYLES[status] ?? "bg-zinc-100 text-zinc-700";
  return (
    <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${style}`}>
      {status.toLowerCase().replace("_", " ")}
    </span>
  );
}
