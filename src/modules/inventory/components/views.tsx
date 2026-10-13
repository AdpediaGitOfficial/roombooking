import Link from "next/link";
import type { AssetCondition, InventoryTransactionType } from "@prisma/client";
import { describeCondition, describeLocation, describeTransaction, isLowStock, targetLabel, type ItemRecord, type TransactionRecord } from "../service";

export function ConditionBadge({ condition }: { condition: AssetCondition }) {
  const tone = condition === "DAMAGED" ? "bg-red-100 text-red-900" : condition === "RETIRED" ? "bg-zinc-100 text-zinc-700" : condition === "FAIR" ? "bg-amber-100 text-amber-900" : "bg-green-100 text-green-900";
  return <span data-condition={condition} className={`chip ${tone}`}>{describeCondition(condition)}</span>;
}

/** One-line state for the register: on hand / issued / low / retired. */
export function ItemStateBadge({ item }: { item: ItemRecord }) {
  if (item.status !== "ACTIVE") return <span data-state="RETIRED" className="inline-block rounded-full bg-zinc-100 px-2 py-0.5 text-xs font-medium text-zinc-700">Retired</span>;
  if (item.trackingType === "SERIALIZED") {
    if (item.assignments[0]) return <span data-state="ISSUED" className="inline-block rounded-full bg-blue-100 px-2 py-0.5 text-xs font-medium text-blue-900">Issued</span>;
    return <span data-state="IN_STORE" className="inline-block rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-900">In store</span>;
  }
  if (isLowStock(item)) return <span data-state="LOW" className="inline-block rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-900">Low stock</span>;
  return <span data-state="OK" className="inline-block rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-900">In stock</span>;
}

const TYPE_TONE: Record<InventoryTransactionType, string> = {
  RECEIPT: "text-green-700", ISSUE: "text-blue-700", RETURN: "text-green-700", TRANSFER: "text-zinc-700",
  ADJUSTMENT: "text-amber-700", DAMAGE: "text-red-700", RETIREMENT: "text-zinc-700",
};

export function TransactionTable({ rows, showItem }: { rows: Array<TransactionRecord & { item?: { id: string; sku: string; name: string; serialNumber: string | null; site: { name: string } } }>; showItem?: boolean }) {
  return (
    <div className="overflow-x-auto card">
      <table className="w-full text-sm">
        <thead className="bg-zinc-50 text-left text-xs uppercase tracking-wide text-zinc-500">
          <tr><th className="px-3 py-2">When</th>{showItem && <th className="px-3 py-2">Item</th>}<th className="px-3 py-2">Movement</th><th className="px-3 py-2 text-right">Qty</th><th className="px-3 py-2 text-right">Balance</th><th className="px-3 py-2">Where</th><th className="px-3 py-2">Notes</th><th className="px-3 py-2">By</th></tr>
        </thead>
        <tbody className="divide-y divide-zinc-200">
          {rows.map((t) => (
            <tr key={t.id} data-transaction={t.type}>
              <td className="px-3 py-2 whitespace-nowrap text-xs text-zinc-500">{t.createdAt.toISOString().slice(0, 16).replace("T", " ")}</td>
              {showItem && t.item && <td className="px-3 py-2"><Link href={`/inventory/${t.item.id}`} className="underline">{t.item.name}</Link><div className="text-xs text-zinc-500">{t.item.sku}{t.item.serialNumber ? ` · #${t.item.serialNumber}` : ""} · {t.item.site.name}</div></td>}
              <td className={`px-3 py-2 font-medium ${TYPE_TONE[t.type]}`}>{describeTransaction(t.type)}{t.condition ? ` · ${describeCondition(t.condition)}` : ""}</td>
              <td className="px-3 py-2 text-right tabular-nums">{t.quantity > 0 ? `+${t.quantity}` : t.quantity}</td>
              <td className="px-3 py-2 text-right tabular-nums">{t.balanceAfter ?? "—"}</td>
              <td className="px-3 py-2">{targetLabel(t)}{t.counterpart ? ` ${t.quantity < 0 ? "→" : "←"} ${t.counterpart.site.name}` : ""}</td>
              <td className="px-3 py-2 text-xs text-zinc-600">{[t.reference, t.notes].filter(Boolean).join(" · ")}</td>
              <td className="px-3 py-2 text-xs">{t.actor.name}</td>
            </tr>
          ))}
          {rows.length === 0 && <tr><td colSpan={showItem ? 8 : 7} className="px-3 py-6 text-center text-zinc-500">No movements.</td></tr>}
        </tbody>
      </table>
    </div>
  );
}

export function itemLocation(item: ItemRecord): string {
  return describeLocation(item);
}
