import { Suspense } from "react";
import Link from "next/link";
import { requireCapability } from "@/lib/auth/authorize";
import { listPermitQueue } from "@sam/core/modules/maintenance/extras";
import { locationLabel } from "@sam/core/modules/maintenance/service";
import { ActionForm } from "@/components/forms/action-form";
import { permitDecisionAction } from "@/modules/maintenance/extras-actions";
import { MaintenanceTabs } from "@/modules/maintenance/components/tabs";
import { PageHeader } from "@/components/shell/page-header";

async function Content() {
  const user = await requireCapability("maint.permit", { returnTo: "/maintenance/permits" });
  const [requested, approved] = await Promise.all([listPermitQueue("REQUESTED"), listPermitQueue("APPROVED")]);
  return (
    <>
      <MaintenanceTabs user={user} active="permits" />
      <h2 className="section-title">Waiting for approval ({requested.length})</h2>
      <ul className="mt-2 space-y-3">
        {requested.map(({ permit: p, workOrder: w }) => (
          <li key={p.id} className="card p-4">
            <div><b>{p.type}</b> · <Link href={`/maintenance/${w.id}`} className="underline">{w.ticketNumber}</Link> <span className="text-xs text-zinc-500">{locationLabel(w)}</span></div>
            {p.hazards && <p className="text-sm text-zinc-600">Hazards: {p.hazards}</p>}
            {p.controls && <p className="text-sm text-zinc-600">Controls: {p.controls}</p>}
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <ActionForm compact action={permitDecisionAction} hidden={{ permitId: p.id, decision: "approve" }} submit="Approve" fields={[{ name: "validTo", label: "Valid until", type: "datetime-local" }, { name: "note", label: "Note" }]} />
              <ActionForm compact tone="danger" action={permitDecisionAction} hidden={{ permitId: p.id, decision: "reject" }} submit="Reject" fields={[{ name: "note", label: "Reason", required: true }]} />
            </div>
          </li>
        ))}
        {requested.length === 0 && <li className="card p-4 text-sm text-zinc-500">No permits waiting.</li>}
      </ul>
      <h2 className="section-title mt-6">In force ({approved.length})</h2>
      <ul className="mt-2 divide-y divide-zinc-100 card">
        {approved.map(({ permit: p, workOrder: w }) => <li key={p.id} className="flex flex-wrap justify-between gap-2 px-4 py-2 text-sm"><span><b>{p.type}</b> · <Link href={`/maintenance/${w.id}`} className="underline">{w.ticketNumber}</Link></span><span className="text-zinc-500">until {p.validTo ? p.validTo.toISOString().slice(0, 16).replace("T", " ") : "—"}</span></li>)}
        {approved.length === 0 && <li className="px-4 py-3 text-sm text-zinc-500">None.</li>}
      </ul>
    </>
  );
}

export default function PermitsPage() {
  return <main><PageHeader title="Work permits" subtitle="High-risk jobs cannot start until a permit is approved by someone other than the requester." crumbs={[["Maintenance", "/maintenance"], ["Permits"]]} /><Suspense fallback={<p className="text-sm text-zinc-500">Loading…</p>}><Content /></Suspense></main>;
}
