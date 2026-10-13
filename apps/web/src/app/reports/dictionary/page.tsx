import { Suspense } from "react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { prisma } from "@sam/core/lib/db";
import { requireUser, userAccess, userCan } from "@/lib/auth/authorize";
import { listDictionary } from "@sam/core/modules/kpi/service";
import { ActionForm } from "@/components/forms/action-form";
import { definitionAction, targetAction } from "@/modules/reports/schedule-actions";
import { PageHeader } from "@/components/shell/page-header";

async function Content() {
  const user = await requireUser("/reports/dictionary");
  if (!userAccess(user, "rep.l1") && !userAccess(user, "rep.l2") && !userAccess(user, "rep.l4")) redirect("/forbidden");
  const [dict, sites] = await Promise.all([listDictionary(user.organizationId), prisma.site.findMany({ where: { archivedAt: null }, select: { id: true, name: true }, orderBy: { name: "asc" } })]);
  const edit = userCan(user, "rep.kpi_targets");
  const isSuper = user.roleAssignments.some((r) => r.role === "SYSTEM_ADMIN");
  const siteName = new Map(sites.map((s) => [s.id, s.name]));
  const groups = [...new Set(dict.map((d) => d.group))];
  return (
    <div className="space-y-6">
      {groups.map((g) => (
        <section key={g} className="panel">
          <div className="toolbar"><h2 className="font-medium">{g}</h2></div>
          <ul className="divide-y divide-zinc-200">
            {dict.filter((d) => d.group === g).map((d) => (
              <li key={d.id} className="px-4 py-3 text-sm">
                <div className="flex flex-wrap justify-between gap-2"><b>{d.name}</b><span className="text-xs text-zinc-500">{d.href ? <Link className="underline" href={d.href}>open</Link> : null} · {d.unit} · {d.higherIsBetter ? "higher is better" : "lower is better"}</span></div>
                <dl className="kv mt-1"><dt>Formula</dt><dd>{d.formula}</dd><dt>Source</dt><dd>{d.source}</dd><dt>Owner</dt><dd>{d.owner}</dd><dt>Targets</dt><dd>{d.targets.length ? d.targets.map((t) => `${t.siteId ? siteName.get(t.siteId) ?? "site" : "All sites"}: ${Number(t.target)}`).join(" · ") : "none set"}</dd></dl>
                {edit && (
                  <details className="mt-2"><summary className="cursor-pointer text-xs underline">Edit target{isSuper ? " or definition" : ""}</summary>
                    <div className="mt-2 grid gap-3 sm:grid-cols-2">
                      <ActionForm compact action={targetAction} hidden={{ key: d.key }} submit="Save target" fields={[{ name: "siteId", label: "For", type: "select", options: [...(isSuper ? [{ value: "", label: "All sites" }] : []), ...sites.map((s) => ({ value: s.id, label: s.name }))] }, { name: "target", label: "Target (blank removes)", type: "number", step: "any" }]} />
                      {isSuper && <ActionForm compact tone="secondary" action={definitionAction} hidden={{ key: d.key }} submit="Save definition" fields={[{ name: "formula", label: "Formula", type: "textarea", defaultValue: d.formula }, { name: "source", label: "Source", defaultValue: d.source }, { name: "owner", label: "Owner", defaultValue: d.owner }]} />}
                    </div>
                  </details>
                )}
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

export default function DictionaryPage() {
  return <main><PageHeader title="KPI dictionary" subtitle="One definition per KPI: name, formula, source, owner and targets. The same text appears as a tooltip wherever the KPI is shown." crumbs={[["Reports", "/reports"], ["KPI dictionary"]]} /><Suspense fallback={<p className="text-sm text-zinc-500">Loading…</p>}><Content /></Suspense></main>;
}
