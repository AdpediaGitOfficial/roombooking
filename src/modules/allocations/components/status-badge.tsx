import type { AllocationStatus } from "@prisma/client";

const STYLES: Partial<Record<AllocationStatus, string>> = {
  CONFIRMED: "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-200",
  CHECKED_IN: "bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-200",
  CHECKED_OUT: "bg-zinc-200 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300",
  CANCELLED: "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-200",
};

export function AllocationStatusBadge({ status }: { status: AllocationStatus }) {
  const style = STYLES[status] ?? "bg-zinc-100 text-zinc-700 dark:bg-zinc-900 dark:text-zinc-300";
  return (
    <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${style}`}>
      {status.toLowerCase().replace("_", " ")}
    </span>
  );
}
