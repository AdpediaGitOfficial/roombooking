import { Suspense } from "react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { prisma } from "@sam/core/lib/db";
import { requireUser, userCan } from "@/lib/auth/authorize";
import { visibleSites } from "@/lib/auth/scope";
import { listVisits } from "@sam/core/modules/maintenance/extras";
import { ActionForm } from "@/components/forms/action-form";
import { visitAction } from "@/modules/maintenance/extras-actions";
import { MaintenanceTabs } from "@/modules/maintenance/components/tabs";
import { PageHeader } from "@/components/shell/page-header";

async function Content() {
  const user = await requireUser("/maintenance/visits");
  if (!userCan(user, "maint.triage") && !userCan(user, "maint.workers")) redirect("/forbidden");
  const visible = await visibleSites(user, "maint.triage", "maint.workers");
  const own = user.vendorId && !userCan(user, "maint.triage");
  const [visits, orders, workers] = await Promise.all([
    listVisits({ siteIds: visible, upcomingOnly: false }),
    prisma.workOrder.findMany({ where: { vendorId: own ? user.vendorId : { not: null }, status: { in: ["ASSIGNED", "ACCEPTED", "IN_PROGRESS", "REOPENED"] } }, include: { vendor: true }, orderBy: { createdAt: "desc" }, take: 100 }),
    prisma.contractorWorker.findMany({ where: { status: "VERIFIED", archivedAt: null, ...(own ? { vendorId: user.vendorId! } : {}) }, orderBy: { name: "asc" } }),
  ]);
  const vendorIds = [...new Set(orders.map((o) => o.vendorId!))];
  return (
    <>
      <MaintenanceTabs user={user} active="visits" />
      <div className="grid gap-4 lg:grid-cols-[1fr_360px]">
        <section className="panel">
          <div className="toolbar"><h2 className="font-medium">Visits ({visits.length})</h2></div>
          <ul className="divide-y divide-zinc-200">
            {visits.map((v) => (
              <li key={v.id} className="px-4 py-3 text-sm">
                <div className="flex flex-wrap justify-between gap-2"><b>{v.vendorName}</b><span className={`chip ${v.status === "CANCELLED" || v.status === "DENIED" ? "chip-danger" : v.status === "CHECKED_IN" ? "chip-success" : ""}`}>{v.status.toLowerCase().replace(/_/g, " ")}</span></div>
                <div className="text-xs text-zinc-600">{v.scheduledStart.toISOString().slice(0, 16).replace("T", " ")} → {v.scheduledEnd.toISOString().slice(11, 16)} · {v.workerNames.join(", ")}{v.escortRequired ? " · escort required" : ""}{v.deniedReason ? ` · ${v.deniedReason}` : ""}</div>
                {v.workOrderId && <Link href={`/maintenance/${v.workOrderId}`} className="text-xs underline">View job</Link>}
              </li>
            ))}
            {visits.length === 0 && <li className="px-4 py-6 text-center text-zinc-500">No contractor visits scheduled.</li>}
          </ul>
        </section>
        <ActionForm action={visitAction} title="Schedule a visit" intro="Access is valid only for verified workers of an active vendor, for an assigned job, inside this window." submit="Schedule" fields={[
          { name: "vendorId", label: "Vendor", type: "select", options: vendorIds.map((id) => ({ value: id, label: orders.find((o) => o.vendorId === id)!.vendor!.name })) },
          { name: "workOrderId", label: "Job", type: "select", options: orders.map((o) => ({ value: o.id, label: `${o.ticketNumber} · ${o.category}` })) },
          { name: "workerIds", label: "Workers", type: "multiselect", options: workers.map((w) => ({ value: w.id, label: w.name })), help: "Hold Ctrl/Cmd to pick several. Choose workers of the selected vendor." },
          { name: "start", label: "From", type: "datetime-local", required: true },
          { name: "end", label: "Until", type: "datetime-local", required: true },
          { name: "escortRequired", label: "Escort required", type: "checkbox" },
        ]} />
      </div>
    </>
  );
}

export default function VisitsPage() {
  return <main><PageHeader title="Contractor visits" subtitle="Contractor access ends automatically when the visit window does." crumbs={[["Maintenance", "/maintenance"], ["Visits"]]} /><Suspense fallback={<p className="text-sm text-zinc-500">Loading…</p>}><Content /></Suspense></main>;
}
