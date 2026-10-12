import { Suspense } from "react";
import Link from "next/link";
import { requireUser } from "@/lib/auth/authorize";
import { listMyWorkOrders, locationLabel } from "@/modules/maintenance/service";
import { WorkOrderStatusBadge } from "@/modules/maintenance/components/views";

async function List() {
  const user = await requireUser("/my/maintenance");
  const orders = await listMyWorkOrders(user.id);
  if (orders.length === 0) return <p className="rounded-lg border border-dashed border-zinc-300 p-6 text-center text-sm text-zinc-500 dark:border-zinc-700">No maintenance requests yet.</p>;
  return (
    <ul className="divide-y divide-zinc-200 rounded-lg border border-zinc-200 dark:divide-zinc-800 dark:border-zinc-800">
      {orders.map((wo) => (
        <li key={wo.id} data-ticket={wo.ticketNumber}>
          <Link href={`/my/maintenance/${wo.id}`} className="block p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="font-medium">{wo.category} · {wo.ticketNumber}</div>
                <div className="mt-0.5 text-xs text-zinc-500">{locationLabel(wo)} · {wo.createdAt.toISOString().slice(0, 10)}</div>
              </div>
              <WorkOrderStatusBadge status={wo.status} />
            </div>
          </Link>
        </li>
      ))}
    </ul>
  );
}

export default function MyMaintenancePage() {
  return (
    <main>
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold">Maintenance</h1>
        <Link href="/my/maintenance/new" className="rounded-md bg-zinc-900 px-3 py-2 text-sm font-medium text-white dark:bg-zinc-100 dark:text-zinc-900">Report an issue</Link>
      </div>
      <div className="mt-4">
        <Suspense fallback={<p className="text-sm text-zinc-500">Loading…</p>}>
          <List />
        </Suspense>
      </div>
    </main>
  );
}
