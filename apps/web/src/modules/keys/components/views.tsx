import type { KeyStatus } from "@prisma/client";
import { describeKeyStatus, holderLabel, isOverdue, type KeyTransactionRecord } from "@sam/core/modules/keys/rules";

const STYLE: Record<KeyStatus, string> = {
  AVAILABLE: "bg-green-100 text-green-800",
  ISSUED: "bg-blue-100 text-blue-800",
  LOST: "bg-red-100 text-red-800",
  DAMAGED: "bg-orange-100 text-orange-800",
  UNDER_REPAIR: "bg-orange-100 text-orange-800",
  RETIRED: "bg-zinc-200 text-zinc-700",
};

export function KeyStatusBadge({ status }: { status: KeyStatus }) {
  return <span data-status={status} className={`chip ${STYLE[status]}`}>{describeKeyStatus(status)}</span>;
}

export function HolderCell({ issue, now }: { issue: KeyTransactionRecord | null; now: Date }) {
  if (!issue) return <span className="text-zinc-400">—</span>;
  const overdue = isOverdue(issue, now);
  return (
    <div>
      <div>{holderLabel(issue)}</div>
      <div className="text-xs text-zinc-500 tabular-nums">
        since {issue.createdAt.toISOString().slice(0, 10)}
        {issue.expectedReturnAt && <> · due {issue.expectedReturnAt.toISOString().slice(0, 10)}</>}
        {overdue && <span data-overdue="true" className="ml-1 font-medium text-red-700">overdue</span>}
      </div>
    </div>
  );
}

const TYPE_LABEL: Record<string, string> = { ISSUE: "Issued", RETURN: "Returned", LOST: "Lost", DAMAGED: "Damaged", REPAIR: "Repair", REPLACED: "Replaced", RETIRE: "Retired" };

export function TransactionHistory({ transactions }: { transactions: KeyTransactionRecord[] }) {
  return (
    <div className="overflow-x-auto card">
      <table className="w-full text-sm">
        <thead className="bg-zinc-50 text-left text-xs uppercase tracking-wide text-zinc-500">
          <tr><th className="px-3 py-2">When</th><th className="px-3 py-2">Event</th><th className="px-3 py-2">Holder</th><th className="px-3 py-2">Custodian</th><th className="px-3 py-2">Condition / notes</th></tr>
        </thead>
        <tbody className="divide-y divide-zinc-200">
          {transactions.map((t) => (
            <tr key={t.id} data-txn={t.type}>
              <td className="px-3 py-2 tabular-nums text-xs">{t.createdAt.toISOString().replace("T", " ").slice(0, 16)}</td>
              <td className="px-3 py-2">{TYPE_LABEL[t.type] ?? t.type}{t.type === "ISSUE" && (t.returnedAt ? <span className="text-xs text-zinc-500"> · closed {t.returnedAt.toISOString().slice(0, 10)}</span> : <span className="text-xs text-blue-700"> · open</span>)}</td>
              <td className="px-3 py-2">{t.holder || t.holderName ? holderLabel(t) : <span className="text-zinc-400">—</span>}</td>
              <td className="px-3 py-2">{t.custodian.name}</td>
              <td className="px-3 py-2 text-xs">{[t.condition, t.notes, t.expectedReturnAt ? `expected ${t.expectedReturnAt.toISOString().slice(0, 10)}` : null].filter(Boolean).join(" · ")}</td>
            </tr>
          ))}
          {transactions.length === 0 && <tr><td colSpan={5} className="px-3 py-4 text-center text-zinc-500">No transactions yet.</td></tr>}
        </tbody>
      </table>
    </div>
  );
}
