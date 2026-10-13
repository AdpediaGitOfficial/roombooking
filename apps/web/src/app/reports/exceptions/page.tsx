import { Suspense } from "react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { requireUser, userAccess } from "@/lib/auth/authorize";
import { visibleSites } from "@/lib/auth/scope";
import { EXCEPTION_GROUPS, exceptionCounts, exceptionReport } from "@sam/core/modules/reports/layers";
import { parseRange } from "@sam/core/modules/reports/suite";
import { PageHeader } from "@/components/shell/page-header";

async function Content({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const user = await requireUser("/reports/exceptions");
  if (!userAccess(user, "rep.l4")) redirect("/forbidden");
  const sp = await searchParams;
  const range = parseRange(sp.from, sp.to);
  const bounds = { from: new Date(`${range.from}T00:00:00.000Z`), to: new Date(new Date(`${range.to}T00:00:00.000Z`).getTime() + 86400000) };
  const isSuper = user.roleAssignments.some((r) => r.role === "SYSTEM_ADMIN"), isAuditor = user.roleAssignments.some((r) => r.role === "AUDITOR");
  const excludeSuper = !isSuper && !isAuditor; // an Accommodation Admin does not see Super Admin actions
  const key = EXCEPTION_GROUPS.some((g) => g.key === sp.group) ? sp.group! : EXCEPTION_GROUPS[0].key;
  const siteIds = isSuper || isAuditor ? null : await visibleSites(user, "rep.l4");
  const [counts, report] = await Promise.all([exceptionCounts(bounds, excludeSuper), exceptionReport({ groupKey: key, range: bounds, excludeSuperAdmin: excludeSuper, siteIds, q: sp.q })]);
  const qs = (g: string) => `/reports/exceptions?group=${g}&from=${range.from}&to=${range.to}`;
  return (
    <>
      <form method="get" className="toolbar flex flex-wrap items-end gap-3">
        <input type="hidden" name="group" value={key} />
        <label className="text-sm">From<input type="date" name="from" defaultValue={range.from} className="mt-1 block rounded-md border border-zinc-300 px-2 py-1.5 text-sm" /></label>
        <label className="text-sm">To<input type="date" name="to" defaultValue={range.to} className="mt-1 block rounded-md border border-zinc-300 px-2 py-1.5 text-sm" /></label>
        <label className="text-sm">Search user, action or record<input name="q" defaultValue={sp.q} className="mt-1 block rounded-md border border-zinc-300 px-2 py-1.5 text-sm" /></label>
        <button className="btn btn-small" type="submit">Apply</button>
      </form>
      <nav className="mt-3 flex flex-wrap gap-1.5">{counts.map((c) => <Link key={c.key} href={qs(c.key)} className={`pill${c.key === key ? " pill-on" : ""}`}>{c.title} <b>{c.count}</b></Link>)}</nav>
      <p className="mt-2 text-xs text-zinc-500">As of {report.asOf.toISOString().slice(0, 16).replace("T", " ")} UTC{excludeSuper ? " · Super Admin actions are not shown to Accommodation Admins" : ""}. The audit log cannot be edited by anyone.</p>
      <div className="mt-3 overflow-x-auto card">
        <table className="table">
          <thead><tr><th>When</th><th>Who</th><th>Action</th><th>Record</th><th>Reason</th><th>Device</th><th>Change</th></tr></thead>
          <tbody>
            {report.rows.map((e) => (
              <tr key={e.id}>
                <td className="whitespace-nowrap tabular-nums text-xs">{e.when.toISOString().replace("T", " ").slice(0, 19)}</td><td>{e.actor ?? <span className="text-zinc-400">system</span>}</td>
                <td className="font-medium">{e.action.toLowerCase().replace(/_/g, " ")}</td>
                <td className="text-xs"><Link className="underline" href={`/reports/timeline?entityType=${encodeURIComponent(e.entity)}&entityId=${encodeURIComponent(e.entityId)}`}>{e.entity} {e.entityId.slice(-8)}</Link></td>
                <td className="text-xs">{e.reason ?? "—"}</td><td className="text-xs">{e.ip ?? "—"}</td>
                <td className="max-w-sm truncate font-mono text-xs text-zinc-600" title={e.change}>{e.change}</td>
              </tr>
            ))}
            {report.rows.length === 0 && <tr><td colSpan={7} className="py-6 text-center text-sm text-zinc-500">Nothing in this group for the period.</td></tr>}
          </tbody>
        </table>
      </div>
    </>
  );
}

export default function ExceptionsPage({ searchParams }: PageProps<"/reports/exceptions">) {
  return <main><PageHeader title="Audit & exception reports" subtitle="L4. Overrides, failed logins, sensitive keys, stock write-offs, access changes, exports and more." crumbs={[["Reports", "/reports"], ["Exceptions"]]} actions={<Link href="/admin/audit" className="btn btn-small">Full audit log</Link>} /><Suspense fallback={<p className="text-sm text-zinc-500">Loading…</p>}><Content searchParams={searchParams as Promise<Record<string, string | undefined>>} /></Suspense></main>;
}
