import { Suspense } from "react";
import { redirect } from "next/navigation";
import { prisma } from "@sam/core/lib/db";
import { requireUser, userCan } from "@/lib/auth/authorize";
import { visibleSites } from "@/lib/auth/scope";
import { KPI_CATALOG } from "@sam/core/modules/kpi/service";
import { mySubscriptions, myAlerts, subscribableReports } from "@sam/core/modules/reports/schedule";
import { ActionForm } from "@/components/forms/action-form";
import { alertAction, removeAlertAction, subscribeAction, unsubscribeAction } from "@/modules/reports/schedule-actions";
import { PageHeader } from "@/components/shell/page-header";

async function Content() {
  const user = await requireUser("/reports/scheduled");
  if (!userCan(user, "rep.schedule")) redirect("/forbidden");
  const [subs, alerts, sites] = await Promise.all([mySubscriptions(user.id), myAlerts(user.id), prisma.site.findMany({ where: { archivedAt: null }, select: { id: true, name: true } })]);
  const mayExec = userCan(user, "rep.l1"), mayL2 = userCan(user, "rep.l2"), mayL3 = userCan(user, "rep.l3");
  const options = subscribableReports().filter((r) => (r.layer === "L1" ? mayExec : r.layer === "L3" ? mayL3 : mayL2));
  const visible = await visibleSites(user, "rep.l1", "rep.l2");
  const names = new Map(options.map((o) => [o.slug, o.title]));
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <div className="space-y-4">
        <section className="panel"><div className="toolbar"><h2 className="font-medium">Your scheduled reports</h2></div>
          <ul className="divide-y divide-zinc-200">{subs.map((s) => <li key={s.id} className="flex items-center justify-between gap-3 px-4 py-2 text-sm"><span><b>{names.get(s.report) ?? s.report}</b> · {s.frequency.toLowerCase()}<span className="block text-xs text-zinc-500">next {s.nextRunAt.toISOString().slice(0, 16).replace("T", " ")} UTC{s.lastRunAt ? ` · last ${s.lastRunAt.toISOString().slice(0, 10)}` : ""}</span></span><ActionForm compact tone="secondary" action={unsubscribeAction} hidden={{ id: s.id }} submit="Remove" /></li>)}{subs.length === 0 && <li className="px-4 py-4 text-sm text-zinc-500">None yet.</li>}</ul></section>
        <ActionForm action={subscribeAction} title="Schedule a report" intro="Sent only while you can still see the report; it follows your site scope." submit="Schedule" fields={[{ name: "report", label: "Report", type: "select", options: options.map((o) => ({ value: o.slug, label: `${o.layer} · ${o.title}` })) }, { name: "frequency", label: "How often", type: "select", defaultValue: "WEEKLY", options: [{ value: "DAILY", label: "Every day" }, { value: "WEEKLY", label: "Every week" }, { value: "MONTHLY", label: "Every month" }] }]} />
      </div>
      <div className="space-y-4">
        <section className="panel"><div className="toolbar"><h2 className="font-medium">Your threshold alerts</h2></div>
          <ul className="divide-y divide-zinc-200">{alerts.map((a) => <li key={a.id} className="flex items-center justify-between gap-3 px-4 py-2 text-sm"><span><b>{KPI_CATALOG.find((k) => k.key === a.kpiKey)?.name ?? a.kpiKey}</b> {a.comparison === "ABOVE" ? "above" : "below"} {Number(a.threshold)}<span className="block text-xs text-zinc-500">{a.lastTriggeredAt ? `last fired ${a.lastTriggeredAt.toISOString().slice(0, 10)}` : "never fired"}</span></span><ActionForm compact tone="secondary" action={removeAlertAction} hidden={{ id: a.id }} submit="Remove" /></li>)}{alerts.length === 0 && <li className="px-4 py-4 text-sm text-zinc-500">None yet.</li>}</ul></section>
        <ActionForm action={alertAction} title="Set an alert" intro="Checked once a day; notifies you the first time a KPI crosses the line, then at most daily." submit="Set alert" fields={[{ name: "kpiKey", label: "KPI", type: "select", options: KPI_CATALOG.map((k) => ({ value: k.key, label: `${k.group} · ${k.name}` })) }, { name: "comparison", label: "Alert when", type: "select", options: [{ value: "ABOVE", label: "above" }, { value: "BELOW", label: "below" }] }, { name: "threshold", label: "Threshold", type: "number", step: "any", required: true }, { name: "siteId", label: "Site", type: "select", options: [{ value: "", label: "All my sites" }, ...sites.filter((s) => !visible || visible.includes(s.id)).map((s) => ({ value: s.id, label: s.name }))] }]} />
      </div>
    </div>
  );
}

export default function ScheduledPage() {
  return <main><PageHeader title="Scheduled reports & alerts" subtitle="Delivered only to roles permitted to see the report." crumbs={[["Reports", "/reports"], ["Scheduled"]]} /><Suspense fallback={<p className="text-sm text-zinc-500">Loading…</p>}><Content /></Suspense></main>;
}
