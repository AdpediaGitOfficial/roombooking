import { Suspense } from "react";
import Link from "next/link";
import { requireCapability, userCan } from "@/lib/auth/authorize";
import { CAPABILITIES, type Cell } from "@sam/core/lib/permissions/matrix";
import { CAPABILITY_SETS, CAPABILITY_SET_BY_ID } from "@sam/core/lib/permissions/sets";
import { MATRIX_ROLES, ROLE_META } from "@sam/core/lib/permissions/roles";
import { CAPABILITY_BY_KEY } from "@sam/core/lib/permissions/matrix";
import { listActiveGrants } from "@sam/core/modules/admin/grants";
import { scopeOptions } from "@sam/core/modules/admin/users-service";
import { CreateGrantForm, RevokeGrantForm } from "@/modules/admin/components/forms";
import { grantTargets } from "@/modules/admin/context";
import { PageHeader } from "@/components/shell/page-header";

function cellText(c: Cell): { text: string; cls: string; title: string } {
  if (c.state === "L") return { text: "—", cls: "text-zinc-300", title: "Locked: never available to this role" };
  if (c.state === "G") return { text: "G", cls: "bg-amber-100 font-semibold text-amber-800", title: `Grantable${c.tag ? ` (${c.tag})` : ""}: off until the Super Admin enables it` };
  if (c.level === "view") return { text: "V", cls: "bg-sky-100 text-sky-800", title: `View only${c.tag ? ` (${c.tag})` : ""}` };
  if (c.level === "own") return { text: "O", cls: "bg-sky-100 text-sky-800", title: "Own records only" };
  if (c.level === "limited") return { text: "•", cls: "bg-green-50 text-green-800", title: c.tag ?? "Limited" };
  return { text: "D", cls: "bg-green-100 font-semibold text-green-800", title: `Default: always on${c.tag ? ` (${c.tag})` : ""}` };
}

async function Content({ searchParams }: { searchParams: Promise<{ module?: string }> }) {
  const user = await requireCapability("setup.roles", { returnTo: "/admin/access", level: "access" });
  const canManage = userCan(user, "setup.roles");
  const { module: moduleFilter } = await searchParams;
  const modules = [...new Set(CAPABILITIES.map((c) => c.module))];
  const shown = CAPABILITIES.filter((c) => !moduleFilter || c.module === moduleFilter);
  const [grants, options, targets] = await Promise.all([listActiveGrants(user.organizationId), scopeOptions(), canManage ? grantTargets(user.organizationId) : Promise.resolve(null)]);

  return (
    <>
      <section className="panel">
        <div className="toolbar"><h2 className="section-title">Active grants (access review)</h2></div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm" data-grants-table>
            <thead className="text-left text-xs uppercase tracking-wide text-zinc-500"><tr><th className="px-3 py-2">Access</th><th className="px-3 py-2">Given to</th><th className="px-3 py-2">Scope</th><th className="px-3 py-2">Reason</th><th className="px-3 py-2">Granted by</th><th className="px-3 py-2">Expires</th><th /></tr></thead>
            <tbody className="divide-y divide-zinc-200">
              {grants.map((g) => (
                <tr key={g.id}>
                  <td className="px-3 py-2 font-medium">{g.capabilitySet ? CAPABILITY_SET_BY_ID.get(g.capabilitySet)?.label ?? g.capabilitySet : CAPABILITY_BY_KEY.get(g.capability ?? "")?.label ?? g.capability}</td>
                  <td className="px-3 py-2">{g.user ? <Link href={`/admin/users/${g.user.id}`} className="underline">{g.user.name}</Link> : `All ${ROLE_META[g.role!].label}`}</td>
                  <td className="px-3 py-2 text-xs">{g.buildingId ? "Building" : g.siteId ? "Site" : "Holder's scope"}</td>
                  <td className="px-3 py-2 text-xs">{g.reason}</td>
                  <td className="px-3 py-2 text-xs">{g.grantedBy.name}<div className="text-zinc-500">{g.createdAt.toISOString().slice(0, 10)}</div></td>
                  <td className="px-3 py-2 text-xs tabular-nums">{g.expiresAt ? g.expiresAt.toISOString().slice(0, 10) : "never"}</td>
                  <td className="px-3 py-2">{canManage && <RevokeGrantForm grantId={g.id} userId={g.userId} />}</td>
                </tr>
              ))}
              {grants.length === 0 && <tr><td colSpan={7} className="px-3 py-6 text-center text-zinc-500">No extra access is currently granted.</td></tr>}
            </tbody>
          </table>
        </div>
      </section>

      {canManage && targets && <div className="mt-6 max-w-3xl"><CreateGrantForm targets={targets} options={options} /></div>}

      <section className="mt-8">
        <h2 className="section-title">Capability sets</h2>
        <ul className="mt-3 grid gap-3 sm:grid-cols-2">
          {CAPABILITY_SETS.map((s) => (
            <li key={s.id} className="card p-4 text-sm">
              <div className="font-medium">{s.label}</div>
              <div className="text-zinc-600">{s.adds}</div>
              <div className="mt-1 text-xs text-zinc-500">Typically given to: {s.typicallyGivenTo}</div>
            </li>
          ))}
        </ul>
      </section>

      <section className="mt-8">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="section-title">Permission matrix</h2>
          <nav className="flex flex-wrap gap-1.5" aria-label="Module">
            <Link href="/admin/access" className={`pill${!moduleFilter ? " pill-on" : ""}`}>All</Link>
            {modules.map((m) => <Link key={m} href={`/admin/access?module=${encodeURIComponent(m)}`} className={`pill${m === moduleFilter ? " pill-on" : ""}`}>{m}</Link>)}
          </nav>
        </div>
        <p className="mt-2 text-xs text-zinc-500"><b>D</b> default · <b>G</b> grantable · <b>—</b> locked · <b>V</b> view only · <b>O</b> own records · <b>•</b> limited (hover for the limit). Every screen, button, query, report and export is driven by this one matrix.</p>
        <div className="panel mt-3 overflow-x-auto">
          <table className="w-full text-sm" data-matrix>
            <thead className="text-left text-xs uppercase tracking-wide text-zinc-500">
              <tr><th className="px-3 py-2">Capability</th>{MATRIX_ROLES.map((r) => <th key={r} className="px-2 py-2 text-center" title={ROLE_META[r].label}>{ROLE_META[r].code}</th>)}</tr>
            </thead>
            <tbody className="divide-y divide-zinc-200">
              {shown.map((c) => (
                <tr key={c.key} data-capability={c.key}>
                  <td className="px-3 py-1.5"><span className="text-xs text-zinc-500">{c.module} · </span>{c.label}</td>
                  {MATRIX_ROLES.map((r) => { const t = cellText(c.cells[r]); return <td key={r} title={t.title} className={`px-2 py-1.5 text-center ${t.cls}`}>{t.text}</td>; })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}

export default function AccessPage({ searchParams }: PageProps<"/admin/access">) {
  return (
    <main>
      <PageHeader title="Roles & access" subtitle="What each role may do, extra access granted on top, and who holds it." crumbs={[["Administration"], ["Roles & access"]]} />
      <div className="mt-6">
        <Suspense fallback={<p className="text-sm text-zinc-500">Loading…</p>}>
          <Content searchParams={searchParams as Promise<{ module?: string }>} />
        </Suspense>
      </div>
    </main>
  );
}
