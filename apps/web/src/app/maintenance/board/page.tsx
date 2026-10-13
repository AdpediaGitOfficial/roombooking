import { Suspense } from "react";
import Link from "next/link";
import { prisma } from "@sam/core/lib/db";
import { requireCapability } from "@/lib/auth/authorize";
import { sitesFor } from "@/lib/auth/scope";
import { siteWhere } from "@sam/core/lib/permissions/scope";
import { OPEN_STATUSES, isOverdue, locationLabel } from "@sam/core/modules/maintenance/service";
import { MaintenanceTabs } from "@/modules/maintenance/components/tabs";
import { PriorityLabel, WorkOrderStatusBadge } from "@/modules/maintenance/components/views";
import { PageHeader } from "@/components/shell/page-header";

async function Content() {
  const user = await requireCapability("maint.triage", { returnTo: "/maintenance/board" });
  const sites = await sitesFor(user, "maint.triage");
  const orders = await prisma.workOrder.findMany({ where: { status: { in: OPEN_STATUSES }, ...siteWhere(sites) }, include: { assignee: { select: { id: true, name: true } }, vendor: { select: { id: true, name: true } }, building: true, room: true, site: true }, orderBy: [{ priority: "desc" }, { slaDueAt: "asc" }], take: 400 });
  const cols = new Map<string, { title: string; items: typeof orders }>();
  const col = (key: string, title: string) => { if (!cols.has(key)) cols.set(key, { title, items: [] }); return cols.get(key)!; };
  col("unassigned", "Unassigned");
  for (const o of orders) {
    if (o.assignee) col(`u:${o.assignee.id}`, o.assignee.name).items.push(o);
    else if (o.vendor) col(`v:${o.vendor.id}`, `${o.vendor.name} (vendor)`).items.push(o);
    else col("unassigned", "Unassigned").items.push(o);
  }
  const now = new Date();
  return (
    <>
      <MaintenanceTabs user={user} active="board" />
      <div className="flex gap-3 overflow-x-auto pb-3">
        {[...cols.entries()].map(([key, c]) => (
          <section key={key} className="panel w-72 shrink-0">
            <div className="panel-head"><div><h2>{c.title}</h2><p>{c.items.length} open</p></div></div>
            <ul className="divide-y divide-zinc-100">
              {c.items.map((o) => (
                <li key={o.id} className="px-3 py-2 text-sm">
                  <div className="flex items-center justify-between gap-2"><Link href={`/maintenance/${o.id}`} className="font-semibold underline">{o.ticketNumber}</Link><PriorityLabel priority={o.priority} /></div>
                  <div className="text-xs text-zinc-600">{o.category} · {locationLabel(o)}</div>
                  <div className="mt-1 flex items-center gap-2"><WorkOrderStatusBadge status={o.status} />{isOverdue(o, now) && <span className="chip chip-danger">Overdue</span>}</div>
                </li>
              ))}
              {c.items.length === 0 && <li className="px-3 py-3 text-sm text-zinc-500">Nothing here.</li>}
            </ul>
          </section>
        ))}
      </div>
    </>
  );
}

export default function BoardPage() {
  return <main><PageHeader title="Assignment board" subtitle="Open work orders by who holds them. Open a ticket to assign or reassign." crumbs={[["Maintenance", "/maintenance"], ["Board"]]} /><Suspense fallback={<p className="text-sm text-zinc-500">Loading…</p>}><Content /></Suspense></main>;
}
