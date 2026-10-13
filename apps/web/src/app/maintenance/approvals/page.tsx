import { Suspense } from "react";
import Link from "next/link";
import { actorOf, requireUser } from "@/lib/auth/authorize";
import { userCan } from "@/lib/auth/authorize";
import { redirect } from "next/navigation";
import { costApprovalQueue, costThreshold } from "@sam/core/modules/maintenance/extras";
import { locationLabel } from "@sam/core/modules/maintenance/service";
import { ActionForm } from "@/components/forms/action-form";
import { costDecisionAction } from "@/modules/maintenance/extras-actions";
import { MaintenanceTabs } from "@/modules/maintenance/components/tabs";
import { PageHeader } from "@/components/shell/page-header";

async function Content() {
  const user = await requireUser("/maintenance/approvals");
  if (!userCan(user, "maint.cost_within") && !userCan(user, "maint.cost_above")) redirect("/forbidden");
  const [queue, threshold] = await Promise.all([costApprovalQueue(actorOf(user)), costThreshold()]);
  return (
    <>
      <MaintenanceTabs user={user} active="approvals" />
      <ul className="space-y-3">
        {queue.map((w) => (
          <li key={w.id} className="card p-4">
            <div className="flex flex-wrap justify-between gap-2"><div><Link href={`/maintenance/${w.id}`} className="font-semibold underline">{w.ticketNumber}</Link> · {w.category}<div className="text-xs text-zinc-500">{locationLabel(w)}{w.vendor ? ` · ${w.vendor.name}` : ""}</div></div><div className="text-right"><b className="text-lg">{Number(w.costEstimate).toFixed(2)}</b><div className="text-xs text-zinc-500">{w.aboveThreshold ? `above ${threshold}` : "within threshold"}</div></div></div>
            {w.costNote && <p className="mt-1 text-sm text-zinc-600">{w.costNote}</p>}
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <ActionForm compact action={costDecisionAction} hidden={{ workOrderId: w.id, decision: "approve" }} submit="Approve" fields={[{ name: "note", label: "Note" }]} />
              <ActionForm compact tone="danger" action={costDecisionAction} hidden={{ workOrderId: w.id, decision: "reject" }} submit="Reject" fields={[{ name: "note", label: "Reason", required: true }]} />
            </div>
          </li>
        ))}
        {queue.length === 0 && <li className="card p-6 text-center text-sm text-zinc-500">No cost estimates are waiting for you.</li>}
      </ul>
    </>
  );
}

export default function ApprovalsPage() {
  return <main><PageHeader title="Cost approvals" subtitle="Estimates within the threshold are approved by the Coordinator; above it, by an Admin." crumbs={[["Maintenance", "/maintenance"], ["Cost approvals"]]} /><Suspense fallback={<p className="text-sm text-zinc-500">Loading…</p>}><Content /></Suspense></main>;
}
