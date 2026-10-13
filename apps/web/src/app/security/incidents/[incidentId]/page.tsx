import { Suspense } from "react";
import { notFound, redirect } from "next/navigation";
import { actorOf, requireUser, userCan } from "@/lib/auth/authorize";
import { SecurityError } from "@sam/core/modules/security/errors";
import { getIncident } from "@sam/core/modules/security/service";
import { ActionForm } from "@/components/forms/action-form";
import { incidentUpdateAction } from "@/modules/security/actions";
import { SecurityTabs } from "@/modules/security/tabs";
import { PageHeader } from "@/components/shell/page-header";

async function Content({ params }: { params: Promise<{ incidentId: string }> }) {
  const { incidentId } = await params;
  const user = await requireUser(`/security/incidents/${incidentId}`);
  const inc = await getIncident(actorOf(user), incidentId).catch((e) => { if (e instanceof SecurityError) { if (e.code === "FORBIDDEN") redirect("/forbidden"); notFound(); } throw e; });
  const manage = userCan(user, "sec.incident_manage", { siteId: inc.siteId });
  const statuses = manage ? ["UNDER_REVIEW", "ACTION_TAKEN", "ESCALATED", ...(inc.reportedById !== user.id ? ["CLOSED"] : [])] : ["ACTION_TAKEN"];
  return (
    <>
      <SecurityTabs user={user} active="incidents" />
      <div className="grid gap-4 lg:grid-cols-[1fr_340px]">
        <div className="space-y-4">
          <section className="card p-4"><p className="whitespace-pre-line text-sm">{inc.description}</p><dl className="kv mt-3"><dt>Category</dt><dd>{inc.category}</dd><dt>Severity</dt><dd>{inc.severity.toLowerCase()}</dd><dt>Where</dt><dd>{inc.location ?? "—"}</dd><dt>Occurred</dt><dd>{inc.occurredAt.toISOString().slice(0, 16).replace("T", " ")}</dd>{inc.actionTaken && <><dt>Action taken</dt><dd>{inc.actionTaken}</dd></>}</dl></section>
          <section className="card p-4"><h3 className="font-medium">Timeline</h3><ul className="mt-2 divide-y divide-zinc-100 text-sm">{inc.updates.map((u) => <li key={u.id} className="py-2"><span className="chip mr-2">{(u.status ?? "").toLowerCase().replace(/_/g, " ")}</span>{u.note}<div className="text-xs text-zinc-500">{u.createdAt.toISOString().slice(0, 16).replace("T", " ")}</div></li>)}</ul></section>
        </div>
        {inc.status !== "CLOSED" && <ActionForm action={incidentUpdateAction} hidden={{ incidentId: inc.id }} title="Update" submit="Save update" fields={[{ name: "status", label: "Status", type: "select", options: statuses.map((s) => ({ value: s, label: s.toLowerCase().replace(/_/g, " ") })) }, { name: "actionTaken", label: "Action taken" }, { name: "note", label: "Note", type: "textarea", required: true }]} />}
      </div>
    </>
  );
}

export default function IncidentPage({ params }: PageProps<"/security/incidents/[incidentId]">) {
  return <main><PageHeader title="Incident" crumbs={[["Security", "/security"], ["Incidents", "/security/incidents"], ["Incident"]]} /><Suspense fallback={<p className="text-sm text-zinc-500">Loading…</p>}><Content params={params} /></Suspense></main>;
}
