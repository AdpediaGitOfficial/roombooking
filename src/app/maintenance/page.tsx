import { Suspense } from "react";
import Link from "next/link";
import { hasRole, requireRole } from "@/lib/auth/authorize";
import { MAINTENANCE_AREA_ROLES, MAINTENANCE_COORDINATOR_ROLES } from "@/modules/maintenance/access";
import { listWorkOrders, locationLabel, queueSummary, type QueueFilter } from "@/modules/maintenance/service";
import { actorOf } from "@/modules/maintenance/context";
import { PriorityLabel, SlaLabel, WorkOrderStatusBadge } from "@/modules/maintenance/components/views";

const FILTERS: Array<[QueueFilter, string]> = [
  ["open", "Open"], ["unassigned", "Unassigned"], ["mine", "Assigned to me"], ["waiting", "Waiting"], ["resolved", "Resolved · to close"], ["closed", "Closed"], ["all", "All"],
];

async function Queue({ searchParams }: { searchParams: Promise<{ filter?: string }> }) {
  const user = await requireRole(MAINTENANCE_AREA_ROLES, "/maintenance");
  const actor = actorOf(user);
  const isCoordinator = hasRole(user, ...MAINTENANCE_COORDINATOR_ROLES);
  const { filter: raw } = await searchParams;
  const filter = (FILTERS.some(([f]) => f === raw) ? raw : "open") as QueueFilter;
  const now = new Date();
  const [orders, summary] = await Promise.all([listWorkOrders(actor, filter), queueSummary(actor, now)]);

  return (
    <>
      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        {[["Open", summary.open], ["Unassigned", summary.unassigned], ["Overdue", summary.overdue], ["Waiting", summary.waiting], ["To close", summary.awaitingClose]].map(([label, value]) => (
          <div key={label} className="card p-3">
            <dt className="text-xs uppercase tracking-wide text-zinc-500">{label}</dt>
            <dd className="mt-1 text-2xl font-semibold tabular-nums" data-summary={label}>{value}</dd>
          </div>
        ))}
      </dl>
      <nav className="mt-4 flex flex-wrap gap-2 text-sm">
        {FILTERS.filter(([f]) => isCoordinator || f !== "unassigned").map(([f, label]) => (
          <Link key={f} href={`/maintenance?filter=${f}`} className={`rounded-full px-3 py-1 ${f === filter ? "bg-deep text-white" : "border border-zinc-300"}`}>{label}</Link>
        ))}
      </nav>
      <div className="mt-4 overflow-x-auto card">
        <table className="w-full text-sm">
          <thead className="bg-zinc-50 text-left text-xs uppercase tracking-wide text-zinc-500">
            <tr><th className="px-3 py-2">Ticket</th><th className="px-3 py-2">Issue</th><th className="px-3 py-2">Location</th><th className="px-3 py-2">Assigned</th><th className="px-3 py-2">Status</th><th className="px-3 py-2">SLA</th></tr>
          </thead>
          <tbody className="divide-y divide-zinc-200">
            {orders.map((wo) => (
              <tr key={wo.id} data-ticket={wo.ticketNumber}>
                <td className="px-3 py-3"><Link href={`/maintenance/${wo.id}`} className="font-medium underline">{wo.ticketNumber}</Link><div><PriorityLabel priority={wo.priority} /></div></td>
                <td className="px-3 py-3"><div>{wo.category}</div><div className="max-w-xs truncate text-xs text-zinc-500">{wo.description}</div></td>
                <td className="px-3 py-3 text-xs">{locationLabel(wo)}</td>
                <td className="px-3 py-3 text-xs">{wo.assignee?.name ?? wo.vendor?.name ?? <span className="text-zinc-400">—</span>}</td>
                <td className="px-3 py-3"><WorkOrderStatusBadge status={wo.status} /></td>
                <td className="px-3 py-3"><SlaLabel wo={wo} now={now} /></td>
              </tr>
            ))}
            {orders.length === 0 && <tr><td colSpan={6} className="px-3 py-6 text-center text-zinc-500">Nothing to show.</td></tr>}
          </tbody>
        </table>
      </div>
    </>
  );
}

export default function MaintenancePage({ searchParams }: PageProps<"/maintenance">) {
  return (
    <main>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="page-title">Maintenance</h1>
          <p className="mt-1 text-sm text-zinc-600">Work orders, assignment and progress.</p>
        </div>
        <Link href="/maintenance/new" className="rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-ink">Raise a ticket</Link>
      </div>
      <div className="mt-6">
        <Suspense fallback={<p className="text-sm text-zinc-500">Loading…</p>}>
          <Queue searchParams={searchParams as Promise<{ filter?: string }>} />
        </Suspense>
      </div>
    </main>
  );
}
