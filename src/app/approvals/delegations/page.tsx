import { Suspense } from "react";
import Link from "next/link";
import { hasRole, requireRole } from "@/lib/auth/authorize";
import { APPROVALS_AREA_ROLES, REQUEST_ADMIN_ROLES } from "@/modules/requests/access";
import { delegatableRoles, delegateOptions, delegatorOptions, isoDay, listDelegations } from "@/modules/requests/delegations";
import { CreateDelegationForm, RevokeButton } from "@/modules/requests/components/delegation-forms";

async function Content() {
  const user = await requireRole(APPROVALS_AREA_ROLES, "/approvals/delegations");
  const isAdmin = hasRole(user, ...REQUEST_ADMIN_ROLES);
  const myRoles = delegatableRoles(user.roleAssignments.map((r) => r.role));
  const [rows, delegates, delegators] = await Promise.all([listDelegations({ id: user.id, isAdmin }), delegateOptions(user.organizationId, ""), isAdmin ? delegatorOptions(user.organizationId) : null]);
  const today = isoDay(new Date());
  const state = (d: (typeof rows)[number]) => (d.status === "REVOKED" ? "Ended" : d.live ? "Live now" : d.upcoming ? "Upcoming" : "Expired");
  return (
    <>
      {(myRoles.length > 0 || isAdmin) && <CreateDelegationForm me={{ id: user.id, roles: myRoles }} delegators={delegators} delegates={delegates} today={today} />}
      <h2 className="mt-8 text-lg font-semibold">{isAdmin ? "All delegations" : "My delegations"}</h2>
      <div className="mt-2 overflow-x-auto card">
        <table className="w-full text-sm">
          <thead className="bg-zinc-50 text-left text-xs uppercase tracking-wide text-zinc-500">
            <tr><th className="px-3 py-2">Delegator</th><th className="px-3 py-2">Covered by</th><th className="px-3 py-2">Roles</th><th className="px-3 py-2">Dates</th><th className="px-3 py-2">State</th><th className="px-3 py-2">Decisions</th><th className="px-3 py-2"></th></tr>
          </thead>
          <tbody className="divide-y divide-zinc-200">
            {rows.map((d) => (
              <tr key={d.id} data-delegation={d.id} data-state={state(d)}>
                <td className="px-3 py-3">{d.delegator.name}{d.delegatorId === user.id && <span className="ml-1 text-xs text-zinc-500">(me)</span>}</td>
                <td className="px-3 py-3">{d.delegate.name}{d.delegateId === user.id && <span className="ml-1 text-xs text-zinc-500">(me)</span>}</td>
                <td className="px-3 py-3 text-xs">{d.covered.length ? d.covered.map((r) => r.toLowerCase().replaceAll("_", " ")).join(", ") : "—"}</td>
                <td className="px-3 py-3 tabular-nums">{isoDay(d.startsAt)} → {isoDay(d.endsAt)}{d.reason && <div className="text-xs text-zinc-500">{d.reason}</div>}</td>
                <td className="px-3 py-3"><span className={`rounded-full px-2 py-0.5 text-xs font-medium ${d.live ? "bg-green-100 text-green-800" : d.upcoming ? "bg-amber-100 text-amber-800" : "bg-zinc-100 text-zinc-700"}`}>{state(d)}</span>{d.status === "REVOKED" && d.revokedBy && <div className="text-xs text-zinc-500">by {d.revokedBy.name} {d.revokedAt?.toISOString().slice(0, 10)}</div>}</td>
                <td className="px-3 py-3 tabular-nums">{d._count.decisions}<div className="text-xs text-zinc-500">set up by {d.createdBy.name}</div></td>
                <td className="px-3 py-3 text-right">{d.status === "ACTIVE" && !d.expired && (d.delegatorId === user.id || d.delegateId === user.id || isAdmin) && <RevokeButton delegationId={d.id} label={d.delegateId === user.id && d.delegatorId !== user.id ? "Decline" : "End"} />}</td>
              </tr>
            ))}
            {rows.length === 0 && <tr><td colSpan={7} className="px-3 py-6 text-center text-zinc-500">No delegations.</td></tr>}
          </tbody>
        </table>
      </div>
      <p className="mt-6 text-sm"><Link href="/approvals" className="underline">← Approvals</Link></p>
    </>
  );
}

export default function DelegationsPage() {
  return (
    <main>
      <h1 className="page-title">Delegation &amp; absence cover</h1>
      <p className="mt-1 mb-6 text-sm text-zinc-600">Hand your approvals to a colleague for a period of leave. Every decision they make records both of you.</p>
      <Suspense fallback={<p className="text-sm text-zinc-500">Loading…</p>}><Content /></Suspense>
    </main>
  );
}
