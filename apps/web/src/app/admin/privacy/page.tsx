import { Suspense } from "react";
import { redirect } from "next/navigation";
import { requireUser, userAccess, userCan } from "@/lib/auth/authorize";
import { CONSENT_VERSION, listDataRequests, listRetention } from "@sam/core/modules/privacy/service";
import { ActionForm } from "@/components/forms/action-form";
import { decideRequestAction, executeRequestAction, retentionAction } from "@/modules/privacy/actions";
import { PageHeader } from "@/components/shell/page-header";

async function Content() {
  const user = await requireUser("/admin/privacy");
  if (!userAccess(user, "priv.decide") && !userAccess(user, "priv.execute") && !userAccess(user, "setup.retention")) redirect("/forbidden");
  const [reqs, policies, consented] = await Promise.all([listDataRequests(), listRetention(user.organizationId), import("@sam/core/lib/db").then(({ prisma }) => prisma.user.count({ where: { organizationId: user.organizationId, consentVersion: CONSENT_VERSION } }))]);
  const decide = userCan(user, "priv.decide"), exec = userCan(user, "priv.execute"), retention = userCan(user, "setup.retention");
  return (
    <div className="grid gap-4 lg:grid-cols-[1.2fr_1fr]">
      <section className="panel"><div className="toolbar"><h2 className="font-medium">Data-subject requests</h2><span className="ml-auto text-xs text-zinc-500">{consented} account(s) have accepted notice {CONSENT_VERSION}</span></div>
        <ul className="divide-y divide-zinc-200">{reqs.map((r) => (
          <li key={r.id} className="px-4 py-3 text-sm">
            <div className="flex flex-wrap justify-between gap-2"><div><b>{r.kind.toLowerCase()}</b> · {r.user?.name ?? "—"} <span className="text-xs text-zinc-500">{r.user?.username}</span><div className="text-xs text-zinc-600">{r.detail ?? "No details"} · {r.createdAt.toISOString().slice(0, 10)}</div></div><span className={`chip ${r.status === "COMPLETED" ? "chip-success" : r.status === "REJECTED" ? "chip-danger" : "chip-warning"}`}>{r.status.toLowerCase().replace(/_/g, " ")}</span></div>
            {r.status === "REQUESTED" && decide && r.userId !== user.id && <div className="mt-2 grid gap-2 sm:grid-cols-2"><ActionForm compact action={decideRequestAction} hidden={{ id: r.id, decision: "approve" }} submit="Approve" fields={[{ name: "note", label: "Note" }]} /><ActionForm compact tone="danger" action={decideRequestAction} hidden={{ id: r.id, decision: "reject" }} submit="Reject" fields={[{ name: "note", label: "Reason", required: true }]} /></div>}
            {r.status === "COMPLIANCE_APPROVED" && exec && r.decidedById !== user.id && <div className="mt-2"><ActionForm compact tone="danger" action={executeRequestAction} hidden={{ id: r.id }} submit={r.kind === "ERASURE" ? "Erase the data now" : "Mark as done"} /></div>}
            {r.status === "COMPLIANCE_APPROVED" && <p className="mt-1 text-xs text-zinc-500">Approved by Compliance; waiting for a Super Admin to carry it out.</p>}
          </li>))}
          {reqs.length === 0 && <li className="px-4 py-6 text-center text-zinc-500">No requests.</li>}</ul></section>
      <section className="panel"><div className="toolbar"><h2 className="font-medium">Retention</h2></div>
        <ul className="divide-y divide-zinc-200">{policies.map((p) => (
          <li key={p.type} className="px-4 py-3 text-sm"><div className="flex justify-between"><b>{p.label}</b><span className="text-xs text-zinc-500">{p.policy?.active ? `${p.policy.action.toLowerCase()} after ${p.policy.retainDays} days` : "kept indefinitely"}</span></div>
            {retention && <details className="mt-1"><summary className="cursor-pointer text-xs underline">Change</summary><div className="mt-2"><ActionForm compact action={retentionAction} hidden={{ recordType: p.type }} submit="Propose change" intro="Needs a second Super Admin to approve." fields={[{ name: "retainDays", label: "Keep for (days)", type: "number", min: 30, defaultValue: p.policy?.retainDays ?? p.defaultDays }, { name: "action", label: "Then", type: "select", defaultValue: p.policy?.action ?? p.actions[0], options: p.actions.map((a) => ({ value: a, label: a.toLowerCase() })) }, { name: "active", label: "Apply automatically", type: "checkbox", defaultValue: p.policy?.active ?? false }]} /></div></details>}
          </li>))}</ul></section>
    </div>
  );
}

export default function PrivacyAdminPage() {
  return <main><PageHeader title="Privacy & retention" subtitle="Data requests (Compliance approves, a Super Admin executes) and how long each kind of record is kept." crumbs={[["Administration"], ["Privacy"]]} /><Suspense fallback={<p className="text-sm text-zinc-500">Loading…</p>}><Content /></Suspense></main>;
}
