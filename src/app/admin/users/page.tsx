import { Suspense } from "react";
import Link from "next/link";
import type { Role, UserStatus } from "@prisma/client";
import { requireRole } from "@/lib/auth/authorize";
import { ADMIN_VIEW_ROLES, ALL_ROLES } from "@/modules/admin/access";
import { listUsers, scopeLabel } from "@/modules/admin/users-service";

const STATUSES: UserStatus[] = ["INVITED", "ACTIVE", "SUSPENDED", "DEACTIVATED"];
const input = "mt-1 block w-full rounded-md border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900";
const STATUS_STYLE: Record<UserStatus, string> = {
  INVITED: "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-200",
  ACTIVE: "bg-green-100 text-green-800 dark:bg-green-950 dark:text-green-200",
  SUSPENDED: "bg-orange-100 text-orange-800 dark:bg-orange-950 dark:text-orange-200",
  DEACTIVATED: "bg-zinc-200 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300",
};

export function UserStatusBadge({ status }: { status: UserStatus }) {
  return <span data-status={status} className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_STYLE[status]}`}>{status.toLowerCase()}</span>;
}

async function Users({ searchParams }: { searchParams: Promise<{ q?: string; status?: string; role?: string }> }) {
  const actor = await requireRole(ADMIN_VIEW_ROLES, "/admin/users");
  const { q, status, role } = await searchParams;
  const users = await listUsers(actor.organizationId, { q, status: STATUSES.includes(status as UserStatus) ? (status as UserStatus) : null, role: ALL_ROLES.includes(role as Role) ? (role as Role) : null });
  return (
    <>
      <form method="get" className="grid gap-3 sm:grid-cols-[1fr_160px_200px_auto]">
        <label className="block text-sm">Search<input name="q" defaultValue={q ?? ""} placeholder="Name, email or employee ID" className={input} /></label>
        <label className="block text-sm">Status<select name="status" defaultValue={status ?? ""} className={input}><option value="">Any</option>{STATUSES.map((s) => <option key={s} value={s}>{s.toLowerCase()}</option>)}</select></label>
        <label className="block text-sm">Role<select name="role" defaultValue={role ?? ""} className={input}><option value="">Any</option>{ALL_ROLES.map((r) => <option key={r} value={r}>{r.toLowerCase().replace(/_/g, " ")}</option>)}</select></label>
        <button type="submit" className="mt-6 rounded-md border border-zinc-300 px-3 py-2 text-sm font-medium dark:border-zinc-700">Filter</button>
      </form>
      <div className="mt-4 overflow-x-auto rounded-lg border border-zinc-200 dark:border-zinc-800">
        <table className="w-full text-sm">
          <thead className="bg-zinc-50 text-left text-xs uppercase tracking-wide text-zinc-500 dark:bg-zinc-900">
            <tr><th className="px-3 py-2">Person</th><th className="px-3 py-2">Roles</th><th className="px-3 py-2">Linked</th><th className="px-3 py-2">Status</th><th className="px-3 py-2">Last sign-in</th></tr>
          </thead>
          <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800">
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
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div><h1 className="text-2xl font-semibold">Users</h1><p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">Accounts, roles and access.</p></div>
        <Link href="/admin/users/new" className="rounded-md bg-zinc-900 px-3 py-2 text-sm font-medium text-white dark:bg-zinc-100 dark:text-zinc-900">New user</Link>
      </div>
      <div className="mt-6">
        <Suspense fallback={<p className="text-sm text-zinc-500">Loading…</p>}>
          <Users searchParams={searchParams as Promise<{ q?: string; status?: string; role?: string }>} />
        </Suspense>
      </div>
    </main>
  );
}
