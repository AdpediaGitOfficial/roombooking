import { Suspense } from "react";
import Link from "next/link";
import type { Role, UserStatus } from "@prisma/client";
import { requireRole } from "@/lib/auth/authorize";
import { ADMIN_VIEW_ROLES, ALL_ROLES } from "@sam/core/modules/admin/access";
import { scopeLabel } from "@sam/core/modules/admin/rules";
import { api } from "@/lib/api";
import { PageHeader } from "@/components/shell/page-header";

const STATUSES: UserStatus[] = ["INVITED", "ACTIVE", "SUSPENDED", "DEACTIVATED"];
const input = "mt-1 block w-full rounded-md border border-zinc-300 px-3 py-2 text-sm";
const STATUS_STYLE: Record<UserStatus, string> = {
  INVITED: "bg-amber-100 text-amber-800",
  ACTIVE: "bg-green-100 text-green-800",
  SUSPENDED: "bg-orange-100 text-orange-800",
  DEACTIVATED: "bg-zinc-200 text-zinc-700",
};

export function UserStatusBadge({ status }: { status: UserStatus }) {
  return <span data-status={status} className={`chip ${STATUS_STYLE[status]}`}>{status.toLowerCase()}</span>;
}

async function Users({ searchParams }: { searchParams: Promise<{ q?: string; status?: string; role?: string }> }) {
  await requireRole(ADMIN_VIEW_ROLES, "/admin/users");
  const { q, status, role } = await searchParams;
  const users = await api.users.list({ q: q || undefined, status: STATUSES.includes(status as UserStatus) ? (status as UserStatus) : undefined, role: ALL_ROLES.includes(role as Role) ? (role as Role) : undefined });
  return (
    <>
      <form method="get" className="grid gap-3 sm:grid-cols-[1fr_160px_200px_auto]">
        <label className="block text-sm">Search<input name="q" defaultValue={q ?? ""} placeholder="Name, email or employee ID" className={input} /></label>
        <label className="block text-sm">Status<select name="status" defaultValue={status ?? ""} className={input}><option value="">Any</option>{STATUSES.map((s) => <option key={s} value={s}>{s.toLowerCase()}</option>)}</select></label>
        <label className="block text-sm">Role<select name="role" defaultValue={role ?? ""} className={input}><option value="">Any</option>{ALL_ROLES.map((r) => <option key={r} value={r}>{r.toLowerCase().replace(/_/g, " ")}</option>)}</select></label>
        <button type="submit" className="mt-6 rounded-md border border-zinc-300 px-3 py-2 text-sm font-medium">Filter</button>
      </form>
      <div className="mt-4 overflow-x-auto card">
        <table className="w-full text-sm">
          <thead className="bg-zinc-50 text-left text-xs uppercase tracking-wide text-zinc-500">
            <tr><th className="px-3 py-2">Person</th><th className="px-3 py-2">Roles</th><th className="px-3 py-2">Linked</th><th className="px-3 py-2">Status</th><th className="px-3 py-2">Last sign-in</th></tr>
          </thead>
          <tbody className="divide-y divide-zinc-200">
            {users.map((u) => (
              <tr key={u.id} data-user={u.email}>
                <td className="px-3 py-3"><Link href={`/admin/users/${u.id}`} className="font-medium underline">{u.name}</Link><div className="text-xs text-zinc-500">{u.email}</div></td>
                <td className="px-3 py-3 text-xs">{u.roleAssignments.length === 0 ? <span className="text-zinc-400">none</span> : u.roleAssignments.map((a) => <div key={a.id}>{a.role.toLowerCase().replace(/_/g, " ")} <span className="text-zinc-500">· {scopeLabel(a)}</span></div>)}</td>
                <td className="px-3 py-3 text-xs">{u.staffProfile ? `${u.staffProfile.employeeId}` : u.vendor ? `Vendor: ${u.vendor.name}` : <span className="text-zinc-400">—</span>}</td>
                <td className="px-3 py-3"><UserStatusBadge status={u.status} />{u.accessExpiresAt && <div className="text-xs text-zinc-500">until {u.accessExpiresAt.toISOString().slice(0, 10)}</div>}</td>
                <td className="px-3 py-3 text-xs tabular-nums">{u.lastLoginAt ? u.lastLoginAt.toISOString().replace("T", " ").slice(0, 16) : <span className="text-zinc-400">never</span>}</td>
              </tr>
            ))}
            {users.length === 0 && <tr><td colSpan={5} className="px-3 py-6 text-center text-zinc-500">No users match.</td></tr>}
          </tbody>
        </table>
      </div>
    </>
  );
}

export default function UsersPage({ searchParams }: PageProps<"/admin/users">) {
  return (
    <main>
      <PageHeader title="Users" subtitle="Accounts, roles and access." crumbs={[["Administration"], ["Users & roles"]]} actions={<Link href="/admin/users/new" className="btn btn-primary">New user</Link>} />
      <div className="mt-6">
        <Suspense fallback={<p className="text-sm text-zinc-500">Loading…</p>}>
          <Users searchParams={searchParams as Promise<{ q?: string; status?: string; role?: string }>} />
        </Suspense>
      </div>
    </main>
  );
}
