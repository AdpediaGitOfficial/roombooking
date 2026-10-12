import { Suspense } from "react";
import Link from "next/link";
import { hasRole, requireRole } from "@/lib/auth/authorize";
import { APPROVALS_AREA_ROLES, REQUEST_ADMIN_ROLES } from "@/modules/requests/access";
import { listAllRequests, listInbox, type RequestListFilter, type RequestRecord } from "@/modules/requests/service";
import { RequestStatusBadge } from "@/modules/requests/components/request-view";

const FILTERS: Array<[RequestListFilter | "inbox", string]> = [
  ["inbox", "Waiting for me"],
  ["pending", "All pending"],
  ["approved", "Approved, in progress"],
  ["closed", "Closed"],
  ["all", "All"],
];

function Row({ r }: { r: RequestRecord }) {
  const staff = r.requester.staffProfile;
  return (
    <tr data-request={r.id}>
      <td className="px-3 py-3">
        <div>{staff ? `${staff.firstName} ${staff.lastName}` : r.requester.name}</div>
        <div className="text-xs text-zinc-500">{staff?.employeeId ?? r.requester.email}{staff?.department ? ` · ${staff.department}` : ""}</div>
      </td>
      <td className="px-3 py-3">{r.requestType.name}</td>
      <td className="px-3 py-3 tabular-nums">{r.createdAt.toISOString().slice(0, 10)}</td>
      <td className="px-3 py-3"><RequestStatusBadge request={r} /></td>
      <td className="px-3 py-3 text-right"><Link href={`/approvals/${r.id}`} className="underline">Open</Link></td>
    </tr>
  );
}

async function Inbox({ searchParams }: { searchParams: Promise<{ filter?: string }> }) {
  const user = await requireRole(APPROVALS_AREA_ROLES, "/approvals");
  const isAdmin = hasRole(user, ...REQUEST_ADMIN_ROLES);
  const { filter: raw } = await searchParams;
  const filter = (isAdmin && FILTERS.some(([f]) => f === raw) ? raw : "inbox") as RequestListFilter | "inbox";
  const actor = { id: user.id, roles: user.roleAssignments.map((r) => r.role) };
  const requests = filter === "inbox" ? await listInbox(actor) : await listAllRequests(filter);

  return (
    <>
      {isAdmin && (
        <nav className="flex flex-wrap gap-2 text-sm">
          {FILTERS.map(([f, label]) => (
            <Link key={f} href={`/approvals?filter=${f}`} className={`rounded-full px-3 py-1 ${f === filter ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900" : "border border-zinc-300 dark:border-zinc-700"}`}>{label}</Link>
          ))}
        </nav>
      )}
      <div className="mt-4 overflow-x-auto rounded-lg border border-zinc-200 dark:border-zinc-800">
        <table className="w-full text-sm">
          <thead className="bg-zinc-50 text-left text-xs uppercase tracking-wide text-zinc-500 dark:bg-zinc-900">
            <tr><th className="px-3 py-2">Requester</th><th className="px-3 py-2">Type</th><th className="px-3 py-2">Submitted</th><th className="px-3 py-2">Status</th><th className="px-3 py-2"></th></tr>
          </thead>
          <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800">
            {requests.map((r) => <Row key={r.id} r={r} />)}
            {requests.length === 0 && <tr><td colSpan={5} className="px-3 py-6 text-center text-zinc-500">{filter === "inbox" ? "Nothing is waiting for your approval." : "Nothing to show."}</td></tr>}
          </tbody>
        </table>
      </div>
    </>
  );
}

export default function ApprovalsPage({ searchParams }: PageProps<"/approvals">) {
  return (
    <main>
      <h1 className="text-2xl font-semibold">Approvals</h1>
      <p className="mt-1 mb-6 text-sm text-zinc-600 dark:text-zinc-400">Requests waiting on a step you are responsible for.</p>
      <Suspense fallback={<p className="text-sm text-zinc-500">Loading…</p>}>
        <Inbox searchParams={searchParams as Promise<{ filter?: string }>} />
      </Suspense>
    </main>
  );
}
