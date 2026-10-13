import { Suspense } from "react";
import { redirect } from "next/navigation";
import { requireUser, userCan, userCanAccess } from "@/lib/auth/authorize";
import { visibleSites } from "@/lib/auth/scope";
import { listSos } from "@sam/core/modules/security/service";
import { ActionForm } from "@/components/forms/action-form";
import { sosRespondAction } from "@/modules/security/actions";
import { SecurityTabs } from "@/modules/security/tabs";
import { PageHeader } from "@/components/shell/page-header";

async function Content() {
  const user = await requireUser("/security/sos");
  if (!userCanAccess(user, "sec.sos_respond")) redirect("/forbidden");
  const rows = await listSos({ siteIds: await visibleSites(user, "sec.sos_respond") });
  const respond = userCan(user, "sec.sos_respond");
  return (
    <>
      <SecurityTabs user={user} active="sos" />
      <ul className="space-y-3">
        {rows.map((s) => (
          <li key={s.id} className={`card p-4 ${s.status === "ACTIVE" ? "border-red-400" : ""}`}>
            <div className="flex flex-wrap justify-between gap-2"><div><b>{s.raisedBy}</b> <span className="text-xs text-zinc-500">{s.raisedByRole?.toLowerCase().replace(/_/g, " ")}</span><div className="text-sm">{s.location ?? "Location not given"}{s.note ? ` · ${s.note}` : ""}</div><div className="text-xs text-zinc-500">{s.createdAt.toISOString().slice(0, 16).replace("T", " ")}{s.responseMinutes != null ? ` · acknowledged after ${s.responseMinutes} min` : ""}{s.resolutionNote ? ` · ${s.resolutionNote}` : ""}</div></div><span className={`chip ${s.status === "ACTIVE" ? "chip-danger" : s.status === "ACKNOWLEDGED" ? "chip-warning" : "chip-success"}`}>{s.status.toLowerCase().replace("_", " ")}</span></div>
            {respond && s.status === "ACTIVE" && <div className="mt-2"><ActionForm compact action={sosRespondAction} hidden={{ sosId: s.id, op: "ack" }} submit="Acknowledge: I am responding" /></div>}
            {respond && (s.status === "ACTIVE" || s.status === "ACKNOWLEDGED") && <div className="mt-2 grid gap-2 sm:grid-cols-2"><ActionForm compact action={sosRespondAction} hidden={{ sosId: s.id, op: "resolve" }} submit="Resolve" fields={[{ name: "note", label: "What happened", required: true }]} /><ActionForm compact tone="secondary" action={sosRespondAction} hidden={{ sosId: s.id, op: "false" }} submit="False alarm" fields={[{ name: "note", label: "Note", required: true }]} /></div>}
          </li>
        ))}
        {rows.length === 0 && <li className="card p-6 text-center text-sm text-zinc-500">No SOS alerts.</li>}
      </ul>
    </>
  );
}

export default function SosPage() {
  return <main><PageHeader title="SOS alerts" subtitle="Raised by residents and Security; Admins, Officers and Security respond." crumbs={[["Security", "/security"], ["SOS"]]} /><Suspense fallback={<p className="text-sm text-zinc-500">Loading…</p>}><Content /></Suspense></main>;
}
