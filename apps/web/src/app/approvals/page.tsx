import { Suspense } from "react";
import Link from "next/link";
import { requireRole } from "@/lib/auth/authorize";
import { APPROVALS_AREA_ROLES } from "@sam/core/modules/requests/access";
import type { RequestListFilter, RequestRecord } from "@sam/core/modules/requests/rules";
import { api } from "@/lib/api";
import { RequestStatusBadge } from "@/modules/requests/components/request-view";
import { PageHeader } from "@/components/shell/page-header";

const FILTERS: Array<[RequestListFilter | "inbox", string]> = [
  ["inbox", "Waiting for me"],
  ["pending", "All pending"],
  ["approved", "Approved, in progress"],
  ["closed", "Closed"],
  ["all", "All"],
];

function Row({ r }: { r: RequestRecord & { coveringFor?: string | null } }) {
  const staff = r.requester.staffProfile;
  return (
    <tr data-request={r.id}>
      <td className="px-3 py-3">
        <div>{staff ? `${staff.firstName} ${staff.lastName}` : r.requester.name}</div>
        <div className="text-xs text-zinc-500">{staff?.employeeId ?? r.requester.email}{staff?.department ? ` · ${staff.department}` : ""}</div>
      </td>
      <td className="px-3 py-3">{r.requestType.name}</td>
      <td className="px-3 py-3 tabular-nums">{r.createdAt.toISOString().slice(0, 10)}</td>
      <td className="px-3 py-3"><RequestStatusBadge request={r} />{r.coveringFor && <div data-covering className="mt-1 text-xs text-amber-700">covering for {r.coveringFor}</div>}</td>
      <td className="px-3 py-3 text-right"><Link href={`/approvals/${r.id}`} className="underline">Open</Link></td>
    </tr>
  );
}

async function Inbox({ searchParams }: { searchParams: Promise<{ filter?: string }> }) {
  await requireRole(APPROVALS_AREA_ROLES, "/approvals");
  const { filter: raw } = await searchParams;
  const asked = (FILTERS.some(([f]) => f === raw) ? raw : "inbox") as RequestListFilter | "inbox";
  // The API ignores a list filter for anyone who is not an administrator.
  const { requests, covering, isAdmin, filter } = await api.approvals.inbox({ filter: asked });

  return (
    <>
      <p className="mb-3 text-sm"><Link href="/approvals/delegations" className="underline" data-delegations-link>Delegation &amp; absence cover</Link>{covering.length > 0 && <span className="ml-2 text-amber-700">· you are currently covering for {covering.join(", ")}</span>}</p>
      {isAdmin && (
        <nav className="flex flex-wrap gap-2 text-sm">
          {FILTERS.map(([f, label]) => (
            <Link key={f} href={`/approvals?filter=${f}`} className={`pill ${f === filter ? "pill-on" : ""}`}>{label}</Link>
          ))}
        </nav>
      )}
      <div className="mt-4 overflow-x-auto card">
        <table className="w-full text-sm">
          <thead className="bg-zinc-50 text-left text-xs uppercase tracking-wide text-zinc-500">
            <tr><th className="px-3 py-2">Requester</th><th className="px-3 py-2">Type</th><th className="px-3 py-2">Submitted</th><th className="px-3 py-2">Status</th><th className="px-3 py-2"></th></tr>
          </thead>
          <tbody className="divide-y divide-zinc-200">
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
      <PageHeader title="Approvals" subtitle="Requests waiting on a step you are responsible for." crumbs={[["Approvals"]]} />
      <Suspense fallback={<p className="text-sm text-zinc-500">Loading…</p>}>
        <Inbox searchParams={searchParams as Promise<{ filter?: string }>} />
      </Suspense>
    </main>
  );
}
