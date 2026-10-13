import { Suspense } from "react";
import { redirect } from "next/navigation";
import { prisma } from "@sam/core/lib/db";
import { requireUser, userAccess, userCan } from "@/lib/auth/authorize";
import { listHouseRules } from "@sam/core/modules/masters/service";
import { ActionForm } from "@/components/forms/action-form";
import { houseRuleAction } from "@/modules/masters/actions";
import { PageHeader } from "@/components/shell/page-header";

async function Content() {
  const user = await requireUser("/admin/house-rules");
  if (!userAccess(user, "setup.house_rules")) redirect("/forbidden");
  const [rules, sites] = await Promise.all([listHouseRules(user.organizationId), prisma.site.findMany({ where: { archivedAt: null }, select: { id: true, name: true } })]);
  const siteName = new Map(sites.map((s) => [s.id, s.name]));
  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_380px]">
      <ul className="space-y-3">{rules.map((r) => (
        <li key={r.id} className={`card p-4 ${r.isCurrent ? "" : "opacity-60"}`}><div className="flex flex-wrap justify-between gap-2"><b>{r.title}</b><span className="text-xs text-zinc-500">{r.code} · v{r.version} · {r.siteId ? siteName.get(r.siteId) ?? "site" : "all sites"} · {r.isCurrent ? `${r._count.acknowledgements} acknowledged` : "superseded"}</span></div><p className="mt-1 whitespace-pre-line text-sm text-zinc-700">{r.body}</p></li>))}
        {rules.length === 0 && <li className="card p-6 text-center text-sm text-zinc-500">No house rules yet.</li>}</ul>
      {userCan(user, "setup.house_rules") && <ActionForm action={houseRuleAction} title="Publish a rule or a new version" intro="Using an existing code publishes a new version; residents are asked to acknowledge it again." submit="Publish" fields={[{ name: "code", label: "Code", required: true, placeholder: "QUIET_HOURS" }, { name: "title", label: "Title", required: true }, { name: "siteId", label: "Applies to", type: "select", options: [{ value: "", label: "All sites" }, ...sites.map((s) => ({ value: s.id, label: s.name }))] }, { name: "body", label: "Rule text", type: "textarea", required: true }]} />}
    </div>
  );
}

export default function HouseRulesPage() {
  return <main><PageHeader title="House rules & agreements" subtitle="Versioned. Residents acknowledge the current version." crumbs={[["Administration"], ["House rules"]]} /><Suspense fallback={<p className="text-sm text-zinc-500">Loading…</p>}><Content /></Suspense></main>;
}
