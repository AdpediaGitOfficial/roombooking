import { Suspense } from "react";
import { notFound } from "next/navigation";
import { hasRole, requireRole } from "@/lib/auth/authorize";
import { INVENTORY_MANAGE_ROLES, INVENTORY_OPERATE_ROLES, INVENTORY_VIEW_ROLES } from "@/modules/inventory/access";
import { describeLocation, getItem, isLowStock, targetLabel } from "@/modules/inventory/service";
import { targetOptions } from "@/modules/inventory/context";
import { ConditionBadge, ItemStateBadge, TransactionTable } from "@/modules/inventory/components/views";
import { EditItemForm, MovementForm } from "@/modules/inventory/components/forms";

type Params = Promise<{ itemId: string }>;

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <div><dt className="text-xs uppercase tracking-wide text-zinc-500">{label}</dt><dd className="mt-0.5 text-sm">{children}</dd></div>;
}

async function Content({ params }: { params: Params }) {
  const { itemId } = await params;
  const user = await requireRole(INVENTORY_VIEW_ROLES, `/inventory/${itemId}`);
  const canOperate = hasRole(user, ...INVENTORY_OPERATE_ROLES);
  const canManage = hasRole(user, ...INVENTORY_MANAGE_ROLES);
  const detail = await getItem(itemId);
  if (!detail) notFound();
  const { item, transactions, outstanding } = detail;
  const serialised = item.trackingType === "SERIALIZED";
  const active = item.status === "ACTIVE";
  const open = item.assignments[0] ?? null;
  const options = canOperate ? await targetOptions() : null;
  const openValue = open ? (open.roomId ? `room:${open.roomId}` : open.staffId ? `staff:${open.staffId}` : `facility:${open.facilityId}`) : undefined;
  const outstandingOptions = serialised
    ? (open ? [{ value: openValue!, label: targetLabel(open) }] : [])
    : outstanding.map((o) => ({ value: o.roomId ? `room:${o.roomId}` : o.staffId ? `staff:${o.staffId}` : `facility:${o.facilityId}`, label: `${o.label} (${o.quantity} ${item.unit})` }));
  const base = { itemId: item.id, serialised, unit: item.unit, onHand: item.quantity };
  return (
    <>
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="page-title">{item.name}</h1>
        <ItemStateBadge item={item} />
        {serialised && <ConditionBadge condition={item.condition} />}
      </div>
      <p className="mt-1 text-sm text-zinc-600">{item.sku}{item.serialNumber ? ` · serial #${item.serialNumber}` : ""} · {item.category} · {item.site.name}</p>
      {isLowStock(item) && <p data-low-stock className="mt-3 rounded-lg bg-amber-50 p-3 text-sm text-amber-900">Low stock: {item.quantity} {item.unit} on hand, reorder threshold {item.reorderThreshold}.</p>}

      <dl className="mt-4 grid grid-cols-2 gap-3 card p-4 sm:grid-cols-4">
        <Field label={serialised ? "In store" : "On hand"}><span data-on-hand className="text-lg font-semibold tabular-nums">{serialised ? (item.quantity === 1 ? "Yes" : "No") : `${item.quantity} ${item.unit}`}</span></Field>
        {!serialised && <Field label="Issued out">{outstanding.reduce((s, o) => s + o.quantity, 0)} {item.unit}</Field>}
        {!serialised && <Field label="Reorder threshold">{item.reorderThreshold ?? "—"}</Field>}
        <Field label="Location">{describeLocation(item)}</Field>
        {open && <Field label="Issued on">{open.startedAt.toISOString().slice(0, 10)} by {open.assignedBy.name}</Field>}
        {item.description && <Field label="Description">{item.description}</Field>}
        {item.notes && <Field label="Notes">{item.notes}</Field>}
        {item.retiredAt && <Field label="Retired">{item.retiredAt.toISOString().slice(0, 10)}</Field>}
      </dl>

      {!serialised && outstanding.length > 0 && (
        <section className="mt-6">
          <h2 className="section-title">Currently issued</h2>
          <ul data-outstanding className="mt-2 divide-y divide-zinc-200 card text-sm">
            {outstanding.map((o) => <li key={`${o.roomId}${o.staffId}${o.facilityId}`} className="flex justify-between p-3"><span>{o.label}</span><span className="tabular-nums">{o.quantity} {item.unit}</span></li>)}
          </ul>
        </section>
      )}

      {canOperate && active && options && (
        <section className="mt-6">
          <h2 className="section-title">Actions</h2>
          <div className="mt-3 grid gap-4 sm:grid-cols-2">
            {!serialised && <MovementForm kind="RECEIVE" {...base} />}
            {(serialised ? !open && item.condition !== "DAMAGED" : item.quantity > 0) && <MovementForm kind="ISSUE" {...base} options={options} />}
            {outstandingOptions.length > 0 && <MovementForm kind="RETURN" {...base} options={options} outstanding={outstandingOptions} />}
            {(serialised ? item.condition !== "DAMAGED" : item.quantity > 0) && <MovementForm kind="DAMAGE" {...base} />}
            {canManage && !serialised && <MovementForm kind="ADJUST" {...base} />}
            {canManage && (serialised ? !open : item.quantity > 0) && <MovementForm kind="TRANSFER" {...base} sites={options.sites.filter((s) => s.id !== item.siteId)} />}
            {canManage && !open && <MovementForm kind="RETIRE" {...base} />}
          </div>
        </section>
      )}

      {canManage && active && <section className="mt-6"><EditItemForm item={item} /></section>}

      <section className="mt-6">
        <h2 className="section-title">History</h2>
        <div className="mt-2"><TransactionTable rows={transactions} /></div>
      </section>
    </>
  );
}

export default function ItemPage({ params }: PageProps<"/inventory/[itemId]">) {
  return (
    <main>
      <Suspense fallback={<p className="text-sm text-zinc-500">Loading…</p>}>
        <Content params={params as Params} />
      </Suspense>
    </main>
  );
}
