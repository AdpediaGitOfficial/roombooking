import { Suspense } from "react";
import Link from "next/link";
import { redirect } from "next/navigation";
import type { MasterKind } from "@prisma/client";
import { prisma } from "@sam/core/lib/db";
import { requireUser, userAccess, userCan } from "@/lib/auth/authorize";
import { MASTER_KINDS, listMasters, masterCounts } from "@sam/core/modules/masters/service";
import { ActionForm } from "@/components/forms/action-form";
import { masterAction, masterArchiveAction, masterRestoreAction } from "@/modules/masters/actions";
import { PageHeader } from "@/components/shell/page-header";

async function Content({ searchParams }: { searchParams: Promise<{ kind?: string; archived?: string }> }) {
  const user = await requireUser("/admin/masters");
  const kinds = MASTER_KINDS.filter((k) => userAccess(user, k.cap));
  if (kinds.length === 0) redirect("/forbidden");
  const sp = await searchParams;
  const def = kinds.find((k) => k.kind === sp.kind) ?? kinds[0];
  const archived = sp.archived === "1";
  const [items, counts, sites, hrms] = await Promise.all([listMasters(user.organizationId, def.kind as MasterKind, { archived }), masterCounts(user.organizationId), prisma.site.findMany({ where: { archivedAt: null }, select: { id: true, name: true } }), prisma.integrationConfig.findFirst({ where: { organizationId: user.organizationId, kind: "HRMS", enabled: true } })])
  const readOnly = !userCan(user, def.cap) || (def.hrmsOwned && !!hrms);
  const siteName = new Map(sites.map((s) => [s.id, s.name]));
  return (
    <div className="grid gap-4 lg:grid-cols-[240px_1fr]">
      <nav className="card p-2 text-sm"><ul>{kinds.map((k) => <li key={k.kind}><Link href={`/admin/masters?kind=${k.kind}`} className={`flex justify-between rounded px-3 py-1.5 hover:bg-zinc-100 ${k.kind === def.kind ? "bg-zinc-100 font-medium" : ""}`}><span>{k.label}</span><span className="text-zinc-500">{counts.get(k.kind) ?? 0}</span></Link></li>)}</ul></nav>
      <div className="space-y-4">
        <section className="panel"><div className="toolbar"><h2 className="font-medium">{def.label}</h2><span className="text-xs text-zinc-500">{def.hint}</span><nav className="ml-auto flex gap-1.5"><Link href={`/admin/masters?kind=${def.kind}`} className={`pill${!archived ? " pill-on" : ""}`}>Active</Link><Link href={`/admin/masters?kind=${def.kind}&archived=1`} className={`pill${archived ? " pill-on" : ""}`}>Archived</Link></nav></div>
          {def.hrmsOwned && hrms && <p className="px-4 py-2 text-xs text-amber-800">Maintained by the HRMS sync: read-only here.</p>}
          <ul className="divide-y divide-zinc-200">{items.map((m) => (
            <li key={m.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2 text-sm"><span><b>{m.name}</b> <code className="text-xs text-zinc-500">{m.code}</code>{m.siteId ? <span className="chip ml-2">{siteName.get(m.siteId) ?? "site"}</span> : null}{(m.data as { value?: string } | null)?.value ? <span className="ml-2 text-xs text-zinc-600">{(m.data as { value: string }).value}</span> : null}</span>
              {!readOnly && (archived ? <ActionForm compact tone="secondary" action={masterRestoreAction} hidden={{ id: m.id }} submit="Restore" /> : <span className="flex gap-2"><details><summary className="btn btn-small btn-ghost cursor-pointer">Edit</summary><div className="absolute z-10 mt-1 w-80 card p-3"><ActionForm compact action={masterAction} hidden={{ id: m.id, kind: def.kind }} submit="Save" fields={[{ name: "code", label: "Code", defaultValue: m.code }, { name: "name", label: "Name", defaultValue: m.name }, { name: "value", label: "Value / note", defaultValue: (m.data as { value?: string } | null)?.value ?? "" }, { name: "sortOrder", label: "Order", type: "number", defaultValue: m.sortOrder }]} /></div></details><ActionForm compact tone="secondary" action={masterArchiveAction} hidden={{ id: m.id, reason: "No longer used" }} submit="Archive" /></span>)}
            </li>))}
            {items.length === 0 && <li className="px-4 py-4 text-sm text-zinc-500">{archived ? "Nothing archived." : "Nothing yet."}</li>}</ul></section>
        {!readOnly && !archived && <ActionForm action={masterAction} hidden={{ kind: def.kind }} title={`Add to ${def.label.toLowerCase()}`} submit="Add" fields={[{ name: "code", label: "Code", required: true }, { name: "name", label: "Name", required: true }, ...(def.siteScoped ? [{ name: "siteId", label: "Site", type: "select" as const, options: [{ value: "", label: "All sites" }, ...sites.map((s) => ({ value: s.id, label: s.name }))] }] : []), { name: "value", label: "Value / note" }, { name: "sortOrder", label: "Order", type: "number", defaultValue: 0 }]} />}
      </div>
    </div>
  );
}

export default function MastersPage({ searchParams }: PageProps<"/admin/masters">) {
  return <main><PageHeader title="Organization & masters" subtitle="Property types, room and bed types, amenities, categories, stores, gates, key cabinets, patrol checkpoints and the calendar." crumbs={[["Administration"], ["Masters"]]} /><Suspense fallback={<p className="text-sm text-zinc-500">Loading…</p>}><Content searchParams={searchParams as Promise<{ kind?: string; archived?: string }>} /></Suspense></main>;
}
