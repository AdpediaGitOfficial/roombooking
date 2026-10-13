import { Suspense } from "react";
import Link from "next/link";
import { hasRole, requireRole } from "@/lib/auth/authorize";
import { MAINTENANCE_AREA_ROLES, MAINTENANCE_COORDINATOR_ROLES } from "@sam/core/modules/maintenance/access";
import { locationLabel, type QueueFilter } from "@sam/core/modules/maintenance/rules";
import { api } from "@/lib/api";
import { PriorityLabel, SlaLabel, WorkOrderStatusBadge } from "@/modules/maintenance/components/views";
import { PageHeader } from "@/components/shell/page-header";
import { Pager, pageHref } from "@/components/shell/pager";

const FILTERS: Array<[QueueFilter, string]> = [
  ["open", "Open"], ["unassigned", "Unassigned"], ["mine", "Assigned to me"], ["waiting", "Waiting"], ["resolved", "Resolved · to close"], ["closed", "Closed"], ["all", "All"],
];

async function Queue({ searchParams }: { searchParams: Promise<{ filter?: string; page?: string }> }) {
  const user = await requireRole(MAINTENANCE_AREA_ROLES, "/maintenance");
  const isCoordinator = hasRole(user, ...MAINTENANCE_COORDINATOR_ROLES);
  const { filter: raw, page: rawPage } = await searchParams;
  const filter = (FILTERS.some(([f]) => f === raw) ? raw : "open") as QueueFilter;
  const { orders: queue, summary, now } = await api.maintenance.queue({ filter, page: Number(rawPage) || 1 });
  const orders = queue.rows;

  const tiles: Array<[string, number, string, string]> = [
    ["Open", summary.open, "var(--deep)", "open"], ["Unassigned", summary.unassigned, "var(--warning)", "unassigned"], ["Overdue", summary.overdue, "var(--danger)", "open"], ["Waiting", summary.waiting, "var(--info)", "waiting"], ["To close", summary.awaitingClose, "var(--primary)", "resolved"],
  ];
  return (
    <>
      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        {tiles.map(([label, value, accent, f]) => (
          <Link key={label} href={`/maintenance?filter=${f}`} className="kpi" style={{ "--acc": accent } as React.CSSProperties}>
            <dt className="kpi-label">{label}</dt>
            <dd className="kpi-value" data-summary={label}>{value}</dd>
          </Link>
        ))}
      </dl>
      <section className="panel mt-4">
        <div className="toolbar">
          <nav className="flex flex-wrap gap-1.5" aria-label="Filter">
            {FILTERS.filter(([f]) => isCoordinator || f !== "unassigned").map(([f, label]) => (
              <Link key={f} href={`/maintenance?filter=${f}`} className={`pill${f === filter ? " pill-on" : ""}`}>{label}</Link>
            ))}
          </nav>
          <span className="ml-auto text-xs text-zinc-500">{queue.total} tickets</span>
        </div>
        <div className="overflow-x-auto">
          <table className="table">
            <thead>
              <tr><th>Ticket</th><th>Issue</th><th>Location</th><th>Assigned</th><th>Status</th><th>SLA</th><th className="num"></th></tr>
            </thead>
            <tbody>
              {orders.map((wo) => (
                <tr key={wo.id} data-ticket={wo.ticketNumber}>
                  <td><Link href={`/maintenance/${wo.id}`} className="font-semibold">{wo.ticketNumber}</Link><div><PriorityLabel priority={wo.priority} /></div></td>
                  <td><div className="font-medium">{wo.category}</div><div className="max-w-xs truncate text-xs text-zinc-500">{wo.description}</div></td>
                  <td className="text-xs">{locationLabel(wo)}</td>
                  <td>{wo.assignee ? <div className="who"><span className="av">{wo.assignee.name.split(" ").map((p) => p[0]).join("").slice(0, 2)}</span><b>{wo.assignee.name}</b></div> : wo.vendor ? <span>{wo.vendor.name}<span className="sub">vendor</span></span> : <span className="chip chip-warning">Unassigned</span>}</td>
                  <td><WorkOrderStatusBadge status={wo.status} /></td>
                  <td><SlaLabel wo={wo} now={now} /></td>
                  <td className="num"><Link href={`/maintenance/${wo.id}`} className="btn btn-small btn-ghost">Open</Link></td>
                </tr>
              ))}
              {orders.length === 0 && <tr><td colSpan={7} className="px-3 py-6 text-center text-zinc-500">Nothing to show.</td></tr>}
            </tbody>
          </table>
        </div>
        <Pager page={queue.page} pages={queue.pages} total={queue.total} pageSize={queue.pageSize} hrefFor={pageHref("/maintenance", { filter })} />
      </section>
    </>
  );
}

export default function MaintenancePage({ searchParams }: PageProps<"/maintenance">) {
  return (
    <main>
      <PageHeader crumbs={[["Maintenance"]]} title="Maintenance" subtitle="Work orders, assignment and progress." actions={<Link href="/maintenance/new" className="btn btn-primary">＋ Raise a ticket</Link>} />
      <div>
        <Suspense fallback={<p className="text-sm text-zinc-500">Loading…</p>}>
          <Queue searchParams={searchParams as Promise<{ filter?: string; page?: string }>} />
        </Suspense>
      </div>
    </main>
  );
}
