import type { ClaimOutcome, LostFoundStatus } from "@prisma/client";
import { describeOutcome, describeStatus } from "../service";

const STATUS_TONE: Record<LostFoundStatus, string> = {
  REPORTED: "bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200",
  STORED: "bg-blue-100 text-blue-900 dark:bg-blue-950 dark:text-blue-200",
  CLAIM_PENDING: "bg-purple-100 text-purple-900 dark:bg-purple-950 dark:text-purple-200",
  RETURNED: "bg-green-100 text-green-900 dark:bg-green-950 dark:text-green-200",
  DISPOSED: "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300",
};
export function StatusBadge({ status }: { status: LostFoundStatus }) {
  return <span data-status={status} className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_TONE[status]}`}>{describeStatus(status)}</span>;
}

const OUTCOME_TONE: Record<ClaimOutcome, string> = {
  PENDING: "bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200",
  VERIFIED: "bg-green-100 text-green-900 dark:bg-green-950 dark:text-green-200",
  REJECTED: "bg-red-100 text-red-900 dark:bg-red-950 dark:text-red-200",
  WITHDRAWN: "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300",
};
export function OutcomeBadge({ outcome }: { outcome: ClaimOutcome }) {
  return <span data-outcome={outcome} className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${OUTCOME_TONE[outcome]}`}>{describeOutcome(outcome)}</span>;
}

export const when = (d: Date) => d.toISOString().slice(0, 16).replace("T", " ");

export function PhotoStrip({ photos }: { photos: Array<{ id: string; fileName: string }> }) {
  if (photos.length === 0) return null;
  return (
    <ul data-photos className="flex flex-wrap gap-2">
      {photos.map((p) => (
        <li key={p.id}>
          <a href={`/api/attachments/${p.id}`} target="_blank" rel="noreferrer">
            {/* Uploaded photos are served by our own route, so next/image optimisation does not apply. */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={`/api/attachments/${p.id}`} alt={p.fileName} className="h-24 w-24 rounded-md border border-zinc-200 object-cover dark:border-zinc-800" />
          </a>
        </li>
      ))}
    </ul>
  );
}
