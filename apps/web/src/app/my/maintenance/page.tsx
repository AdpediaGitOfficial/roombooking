import { Suspense } from "react";
import Link from "next/link";
import { requireUser } from "@/lib/auth/authorize";
import { locationLabel } from "@sam/core/modules/maintenance/rules";
import { api } from "@/lib/api";
import { WorkOrderStatusBadge } from "@/modules/maintenance/components/views";

async function List() {
  await requireUser("/my/maintenance");
  const orders = await api.maintenance.mine();
  if (orders.length === 0) return <p className="rounded-lg border border-dashed border-zinc-300 p-6 text-center text-sm text-zinc-500">No maintenance requests yet.</p>;
  return (
    <ul className="divide-y divide-zinc-200 card">
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
        <h1 className="page-title">Maintenance</h1>
        <Link href="/my/maintenance/new" className="btn btn-primary">Report an issue</Link>
      </div>
      <div className="mt-4">
        <Suspense fallback={<p className="text-sm text-zinc-500">Loading…</p>}>
          <List />
        </Suspense>
      </div>
    </main>
  );
}
