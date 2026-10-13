import { Suspense } from "react";
import Link from "next/link";
import { requireUser, userCan, userCanAccess } from "@/lib/auth/authorize";
import { redirect } from "next/navigation";
import { listLossCases } from "@sam/core/modules/keys/extras";
import { ActionForm } from "@/components/forms/action-form";
import { lossCompleteAction, lossDecisionAction } from "@/modules/keys/extras-actions";
import { KeyTabs } from "@/modules/keys/components/tabs";
import { PageHeader } from "@/components/shell/page-header";

async function Content() {
  const user = await requireUser("/keys/losses");
  if (!userCanAccess(user, "keys.loss_approve") && !userCanAccess(user, "keys.report_lost")) redirect("/forbidden");
  const cases = await listLossCases();
  return (
    <>
      <KeyTabs user={user} active="losses" />
      <ul className="space-y-3">
        {cases.map((c) => (
          <li key={c.id} className="card p-4">
            <div className="flex flex-wrap justify-between gap-2"><div><Link href={`/keys/${c.keyId}`} className="font-semibold underline">Key {c.key.code}</Link>{c.key.sensitive && <span className="chip chip-danger ml-2">sensitive</span>}<div className="text-xs text-zinc-500">Reported {c.createdAt.toISOString().slice(0, 10)} · {c.note}</div></div><span className="chip">{c.status.toLowerCase().replace(/_/g, " ")}</span></div>
            {c.workOrderId && <Link href={`/maintenance/${c.workOrderId}`} className="mt-1 inline-block text-sm underline">Lock-change work order</Link>}
            {c.status === "REPORTED" && c.reportedById !== user.id && userCan(user, "keys.loss_approve", { siteId: c.key.siteId }) && (
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                <ActionForm compact action={lossDecisionAction} hidden={{ caseId: c.id, decision: "approve" }} submit="Approve and order lock change" fields={[{ name: "note", label: "Note" }]} />
                <ActionForm compact tone="danger" action={lossDecisionAction} hidden={{ caseId: c.id, decision: "reject" }} submit="Reject" fields={[{ name: "note", label: "Reason", required: true }]} />
              </div>
            )}
            {(c.status === "APPROVED" || c.status === "LOCK_CHANGE_ORDERED") && userCan(user, "keys.retire_replace", { siteId: c.key.siteId }) && <div className="mt-3"><ActionForm compact action={lossCompleteAction} hidden={{ caseId: c.id }} submit="Retire lost key and register replacement" fields={[{ name: "newCode", label: "Replacement key code", defaultValue: `${c.key.code}-R1`, required: true }]} /></div>}
          </li>
        ))}
        {cases.length === 0 && <li className="card p-6 text-center text-sm text-zinc-500">No lost-key cases.</li>}
      </ul>
    </>
  );
}

export default function LossesPage() {
  return <main><PageHeader title="Lost keys" subtitle="Approval by a Key supervisor or Admin, then a lock-change work order and a replacement key." crumbs={[["Keys", "/keys"], ["Lost keys"]]} /><Suspense fallback={<p className="text-sm text-zinc-500">Loading…</p>}><Content /></Suspense></main>;
}
