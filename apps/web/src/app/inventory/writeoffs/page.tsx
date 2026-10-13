import { Suspense } from "react";
import Link from "next/link";
import { requireUser, userCan, userCanAccess } from "@/lib/auth/authorize";
import { redirect } from "next/navigation";
import { listWriteOffs, writeOffLimitValue } from "@sam/core/modules/inventory/extras";
import { ActionForm } from "@/components/forms/action-form";
import { writeOffDecisionAction } from "@/modules/inventory/extras-actions";
import { PageHeader } from "@/components/shell/page-header";

async function Content() {
  const user = await requireUser("/inventory/writeoffs");
  if (!userCanAccess(user, "inv.writeoff") && !userCanAccess(user, "inv.adjust")) redirect("/forbidden");
  const [rows, limit] = await Promise.all([listWriteOffs(), writeOffLimitValue()]);
  const isSuper = user.roleAssignments.some((r) => r.role === "SYSTEM_ADMIN");
  return (
    <section className="panel">
      <div className="toolbar"><h2 className="font-medium">Write-offs</h2><span className="ml-auto text-xs text-zinc-500">Above a value of {limit} a Super Admin approves</span></div>
      <ul className="divide-y divide-zinc-200">
        {rows.map((w) => (
          <li key={w.id} className="px-4 py-3 text-sm">
            <div className="flex flex-wrap justify-between gap-2"><div><Link href={`/inventory/${w.item.id}`} className="font-medium underline">{w.item.name}</Link> · {w.quantity} · value {Number(w.value).toFixed(2)}{w.needsSuperAdmin && <span className="chip chip-warning ml-2">Super Admin</span>}<div className="text-xs text-zinc-500">{w.reason}</div></div><span className={`chip ${w.status === "APPROVED" ? "chip-success" : w.status === "REJECTED" ? "chip-danger" : "chip-warning"}`}>{w.status.toLowerCase()}</span></div>
            {w.status === "PENDING" && userCan(user, "inv.writeoff") && w.recordedById !== user.id && (!w.needsSuperAdmin || isSuper) && (
              <div className="mt-2 grid gap-3 sm:grid-cols-2">
                <ActionForm compact action={writeOffDecisionAction} hidden={{ writeOffId: w.id, decision: "approve" }} submit="Approve" fields={[{ name: "note", label: "Note" }]} />
                <ActionForm compact tone="danger" action={writeOffDecisionAction} hidden={{ writeOffId: w.id, decision: "reject" }} submit="Reject" fields={[{ name: "note", label: "Reason", required: true }]} />
              </div>
            )}
          </li>
        ))}
        {rows.length === 0 && <li className="px-4 py-6 text-center text-zinc-500">No write-offs recorded.</li>}
      </ul>
    </section>
  );
}

export default function WriteOffsPage() {
  return <main><PageHeader title="Write-offs & disposal" subtitle="Requested by the Inventory supervisor, approved by an Admin." crumbs={[["Inventory", "/inventory"], ["Write-offs"]]} /><Suspense fallback={<p className="text-sm text-zinc-500">Loading…</p>}><Content /></Suspense></main>;
}
