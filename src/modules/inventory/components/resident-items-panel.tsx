import Link from "next/link";
import { prisma } from "@/lib/db";
import { itemsHeldBy } from "../service";
import { targetOptions } from "../context";
import { MovementForm } from "./forms";
import { IssuePicker } from "./issue-picker";

/** Handover panel for an allocation: items issued to the resident, return and issue (INV-03). */
export async function ResidentItemsPanel({ staffId, canOperate, returnPath }: { staffId: string; canOperate: boolean; returnPath: string }) {
  const held = await itemsHeldBy({ staffId });
  const available = canOperate ? await prisma.inventoryItem.findMany({ where: { status: "ACTIVE", quantity: { gt: 0 }, condition: { not: "DAMAGED" } }, orderBy: [{ category: "asc" }, { name: "asc" }], take: 200 }) : [];
  if (held.length === 0 && available.length === 0) return null;
  const options = canOperate ? await targetOptions() : null;
  const target = `staff:${staffId}`;
  return (
    <div className="rounded-lg border border-zinc-200 p-4 dark:border-zinc-800" data-resident-items>
      <h3 className="font-medium">Items issued to the resident</h3>
      {held.length === 0 ? <p className="mt-1 text-sm text-zinc-500">Nothing issued.</p> : (
        <ul className="mt-2 space-y-3">
          {held.map((h) => (
            <li key={h.itemId} data-held-item={h.serialNumber ?? h.sku} className="text-sm">
              <div><Link href={`/inventory/${h.itemId}`} className="font-medium underline">{h.name}</Link>{h.serialNumber ? ` #${h.serialNumber}` : ` · ${h.quantity} ${h.unit}`}{h.since && <span className="ml-1 text-xs text-zinc-500">since {h.since.toISOString().slice(0, 10)}</span>}</div>
              {canOperate && options && <div className="mt-1"><MovementForm kind="RETURN" compact itemId={h.itemId} serialised={!!h.serialNumber} unit={h.unit} onHand={0} options={options} outstanding={[{ value: target, label: "this resident" }]} returnPath={returnPath} /></div>}
            </li>
          ))}
        </ul>
      )}
      {canOperate && options && available.length > 0 && (
        <details className="mt-3 text-sm">
          <summary className="cursor-pointer font-medium">Issue an item</summary>
          <IssuePicker items={available.map((i) => ({ id: i.id, label: `${i.name}${i.serialNumber ? ` #${i.serialNumber}` : ` (${i.quantity} ${i.unit})`}`, serialised: i.trackingType === "SERIALIZED", unit: i.unit }))} target={target} returnPath={returnPath} />
        </details>
      )}
    </div>
  );
}
