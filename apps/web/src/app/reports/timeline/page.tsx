import { Suspense } from "react";
import { redirect } from "next/navigation";
import { requireUser, userAccess } from "@/lib/auth/authorize";
import { recordTimeline } from "@sam/core/modules/reports/layers";
import { PageHeader } from "@/components/shell/page-header";

async function Content({ searchParams }: { searchParams: Promise<{ entityType?: string; entityId?: string }> }) {
  const user = await requireUser("/reports/timeline");
  if (!userAccess(user, "rep.l4")) redirect("/forbidden");
  const { entityType, entityId } = await searchParams;
  if (!entityType || !entityId) return <p className="text-sm text-zinc-500">Open a record from the exception reports or the audit log to see its history.</p>;
  const events = await recordTimeline(entityType, entityId);
  return (
    <ol className="space-y-3">
      {events.map((e) => (
        <li key={e.id} className="card p-3 text-sm">
          <div className="flex flex-wrap justify-between gap-2"><b>{e.action.toLowerCase().replace(/_/g, " ")}</b><span className="text-xs text-zinc-500">{e.when.toISOString().replace("T", " ").slice(0, 19)} · {e.actor}{e.ip ? ` · ${e.ip}` : ""}</span></div>
          {e.reason && <div className="text-xs text-zinc-600">Reason: {e.reason}</div>}
          {(e.before || e.after) && <div className="mt-1 font-mono text-xs text-zinc-600">{e.before ? <div>− {JSON.stringify(e.before)}</div> : null}{e.after ? <div>+ {JSON.stringify(e.after)}</div> : null}</div>}
        </li>
      ))}
      {events.length === 0 && <li className="text-sm text-zinc-500">No history for that record.</li>}
    </ol>
  );
}

export default function TimelinePage({ searchParams }: PageProps<"/reports/timeline">) {
  return <main><PageHeader title="Record timeline" subtitle="Every change to one record, oldest first." crumbs={[["Reports", "/reports"], ["Exceptions", "/reports/exceptions"], ["Timeline"]]} /><Suspense fallback={<p className="text-sm text-zinc-500">Loading…</p>}><Content searchParams={searchParams as Promise<{ entityType?: string; entityId?: string }>} /></Suspense></main>;
}
