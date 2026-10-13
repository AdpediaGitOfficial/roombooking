import { Suspense } from "react";
import { redirect } from "next/navigation";
import { requireUser, userCan, userCanAccess } from "@/lib/auth/authorize";
import { visibleSites } from "@/lib/auth/scope";
import { checkpoints, listRounds, openRound } from "@sam/core/modules/security/service";
import { ActionForm } from "@/components/forms/action-form";
import { patrolAction } from "@/modules/security/actions";
import { siteOptions } from "@/modules/security/context";
import { SecurityTabs } from "@/modules/security/tabs";
import { PageHeader } from "@/components/shell/page-header";

async function Content() {
  const user = await requireUser("/security/patrol");
  if (!userCanAccess(user, "sec.patrol") && !userCanAccess(user, "sec.patrol_points")) redirect("/forbidden");
  const sites = await visibleSites(user, "sec.patrol", "sec.patrol_points");
  const [open, rounds, siteList] = await Promise.all([openRound(user.id), listRounds(sites), siteOptions(sites)]);
  const cps = open ? await checkpoints(open.siteId) : [];
  const scanned = new Set(open?.scans.map((s) => s.checkpointCode));
  const patrol = userCan(user, "sec.patrol");
  return (
    <>
      <SecurityTabs user={user} active="patrol" />
      <div className="grid gap-4 lg:grid-cols-2">
        {patrol && (open ? (
          <section className="card p-4 space-y-3">
            <h3 className="font-medium">Round in progress</h3>
            <ul className="text-sm">{cps.map((c) => <li key={c.id} className="flex justify-between py-1"><span>{c.name} <span className="text-xs text-zinc-500">{c.code}</span></span><span className={scanned.has(c.code) ? "text-green-700" : "text-zinc-400"}>{scanned.has(c.code) ? "✓ scanned" : "pending"}</span></li>)}</ul>
            <ActionForm compact action={patrolAction} hidden={{ op: "scan", roundId: open.id }} submit="Record checkpoint" fields={[{ name: "code", label: "Checkpoint code", type: "select", options: cps.map((c) => ({ value: c.code, label: `${c.name} (${c.code})` })) }, { name: "note", label: "Note" }]} />
            <ActionForm compact tone="secondary" action={patrolAction} hidden={{ op: "finish", roundId: open.id }} submit="Finish round" fields={[{ name: "notes", label: "Notes" }]} />
          </section>
        ) : <ActionForm action={patrolAction} hidden={{ op: "start" }} title="Start a patrol round" submit="Start round" fields={[{ name: "siteId", label: "Site", type: "select", options: siteList.map((s) => ({ value: s.id, label: s.name })) }]} />)}
        <section className="panel"><div className="toolbar"><h2 className="font-medium">Recent rounds</h2></div><ul className="divide-y divide-zinc-200 text-sm">{rounds.map((r) => <li key={r.id} className="px-4 py-2"><b>{r.startedAt.toISOString().slice(0, 16).replace("T", " ")}</b> · {r.scans.length} checkpoint(s){r.completedAt ? "" : " · in progress"}{r.notes ? <div className="text-xs text-zinc-500">{r.notes}</div> : null}</li>)}{rounds.length === 0 && <li className="px-4 py-4 text-zinc-500">No rounds yet.</li>}</ul></section>
      </div>
    </>
  );
}

export default function PatrolPage() {
  return <main><PageHeader title="Patrol rounds" subtitle="Record each checkpoint as you pass it; missed ones are reported when the round finishes." crumbs={[["Security", "/security"], ["Patrols"]]} /><Suspense fallback={<p className="text-sm text-zinc-500">Loading…</p>}><Content /></Suspense></main>;
}
