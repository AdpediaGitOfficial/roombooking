import { Suspense } from "react";
import { requireRole } from "@/lib/auth/authorize";
import { ADMIN_VIEW_ROLES } from "@/modules/admin/access";
import { auditEntityTypes, listAudit } from "@/modules/admin/users-service";

const input = "mt-1 block w-full rounded-md border border-zinc-300 px-3 py-2 text-sm";

async function Log({ searchParams }: { searchParams: Promise<{ entityType?: string; action?: string; entityId?: string }> }) {
  await requireRole(ADMIN_VIEW_ROLES, "/admin/audit");
  const { entityType, action, entityId } = await searchParams;
  const [events, types] = await Promise.all([listAudit({ entityType, action, entityId }), auditEntityTypes()]);
  return (
    <>
      <form method="get" className="grid gap-3 sm:grid-cols-[200px_1fr_1fr_auto]">
        <label className="block text-sm">Entity<select name="entityType" defaultValue={entityType ?? ""} className={input}><option value="">Any</option>{types.map((t) => <option key={t} value={t}>{t}</option>)}</select></label>
        <label className="block text-sm">Action contains<input name="action" defaultValue={action ?? ""} placeholder="e.g. LOGIN, KEY, ROLE" className={input} /></label>
        <label className="block text-sm">Entity ID<input name="entityId" defaultValue={entityId ?? ""} className={input} /></label>
        <button type="submit" className="mt-6 rounded-md border border-zinc-300 px-3 py-2 text-sm font-medium">Filter</button>
      </form>
      <div className="mt-4 overflow-x-auto card">
        <table className="w-full text-sm">
          <thead className="bg-zinc-50 text-left text-xs uppercase tracking-wide text-zinc-500">
            <tr><th className="px-3 py-2">When</th><th className="px-3 py-2">Actor</th><th className="px-3 py-2">Action</th><th className="px-3 py-2">Entity</th><th className="px-3 py-2">Change</th></tr>
          </thead>
          <tbody className="divide-y divide-zinc-200">
            {events.map((e) => (
              <tr key={e.id} data-audit={e.action}>
                <td className="px-3 py-2 text-xs tabular-nums">{e.createdAt.toISOString().replace("T", " ").slice(0, 19)}</td>
                <td className="px-3 py-2 text-xs">{e.actor?.name ?? <span className="text-zinc-400">system / anonymous</span>}</td>
                <td className="px-3 py-2 font-medium">{e.action.toLowerCase().replace(/_/g, " ")}</td>
                <td className="px-3 py-2 text-xs">{e.entityType} <span className="text-zinc-500">{e.entityId.slice(-8)}</span></td>
                <td className="max-w-md px-3 py-2 font-mono text-xs text-zinc-600">{e.before ? <div className="truncate">− {JSON.stringify(e.before)}</div> : null}{e.after ? <div className="truncate">+ {JSON.stringify(e.after)}</div> : null}</td>
              </tr>
            ))}
            {events.length === 0 && <tr><td colSpan={5} className="px-3 py-6 text-center text-zinc-500">No events match.</td></tr>}
          </tbody>
        </table>
      </div>
      <p className="mt-2 text-xs text-zinc-500">Showing the latest {events.length} events. Audit rows are append-only at the database level.</p>
    </>
  );
}

export default function AuditPage({ searchParams }: PageProps<"/admin/audit">) {
  return (
    <main>
      <h1 className="page-title">Audit log</h1>
      <p className="mt-1 mb-6 text-sm text-zinc-600">Who did what, when, with before and after values.</p>
      <Suspense fallback={<p className="text-sm text-zinc-500">Loading…</p>}>
        <Log searchParams={searchParams as Promise<{ entityType?: string; action?: string; entityId?: string }>} />
      </Suspense>
    </main>
  );
}
